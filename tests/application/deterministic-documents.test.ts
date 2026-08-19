import { describe, expect, it } from "vitest";

import { canonicalJson } from "../../src/domain/canonical-json.js";
import {
  renderLedger,
  renderPlan,
  validateLedger,
  verifyProjection,
} from "../../src/application/deterministic-documents.js";

const source = Buffer.from("build api", "utf8");
const ledger = {
  schema_version: 1,
  ledger_id: "ledger_v1",
  version: 1,
  source_artifact_id: "artifact_source",
  requirements: [
    {
      requirement_id: "requirement_api",
      display_id: "REQ-001",
      statement: "Build the API.",
      status: "active",
      source_ranges: [{ start_byte: 0, end_byte: source.byteLength }],
      lineage_roots: ["requirement_api"],
      predecessor_ids: [],
    },
  ],
  source_exclusions: [],
};

const plan = {
  schema_version: 1,
  plan_id: "plan_v1",
  version: 1,
  title: "Implementation Plan",
  summary: "Build the API safely.",
  components: [
    {
      component_id: "component_api",
      name: "API",
      responsibility: "Serve requests",
    },
  ],
  sections: [
    {
      section_id: "section_api",
      kind: "component",
      title: "API",
      body: "Implement the endpoint.",
      component_ids: ["component_api"],
      requirement_ids: ["requirement_api"],
    },
  ],
  requirement_coverage: [
    {
      requirement_id: "requirement_api",
      section_ids: ["section_api"],
      justification: "The API section implements it.",
    },
  ],
  section_transitions: [
    {
      kind: "new",
      from_section_ids: [],
      to_section_ids: ["section_api"],
      reason: "Initial plan",
    },
  ],
};

describe("deterministic documents", () => {
  it("validates complete byte coverage and reports gaps", () => {
    const valid = validateLedger({
      ledgerBytes: Buffer.from(canonicalJson(ledger)),
      sourceBytes: source,
      expectedSourceArtifactId: "artifact_source",
      approvedExclusionIds: [],
    });
    expect(valid.coverageValid).toBe(true);
    expect(valid.uncoveredRanges).toEqual([]);

    const partial = structuredClone(ledger);
    partial.requirements[0]!.source_ranges = [{ start_byte: 0, end_byte: 5 }];
    expect(
      validateLedger({
        ledgerBytes: Buffer.from(canonicalJson(partial)),
        sourceBytes: source,
        expectedSourceArtifactId: "artifact_source",
        approvedExclusionIds: [],
      }).uncoveredRanges,
    ).toEqual([{ startByte: 5, endByte: source.byteLength }]);
  });

  it("binds source identity, approved exclusions, and acyclic lineage", () => {
    const withoutOptionalPredecessors = JSON.parse(canonicalJson(ledger)) as {
      requirements: Array<Record<string, unknown>>;
    };
    delete withoutOptionalPredecessors.requirements[0]!.predecessor_ids;
    expect(() =>
      validateLedger({
        ledgerBytes: Buffer.from(canonicalJson(withoutOptionalPredecessors)),
        sourceBytes: source,
        expectedSourceArtifactId: "artifact_source",
        approvedExclusionIds: [],
      }),
    ).not.toThrow();

    expect(() =>
      validateLedger({
        ledgerBytes: Buffer.from(canonicalJson(ledger)),
        sourceBytes: source,
        expectedSourceArtifactId: "artifact_other",
        approvedExclusionIds: [],
      }),
    ).toThrow("source identity");

    const excluded = JSON.parse(canonicalJson(ledger)) as Record<
      string,
      unknown
    >;
    excluded.requirements = [];
    excluded.source_exclusions = [
      {
        exclusion_id: "exclusion_all",
        source_range: { start_byte: 0, end_byte: source.byteLength },
        reason: "Not relevant",
      },
    ];
    expect(() =>
      validateLedger({
        ledgerBytes: Buffer.from(canonicalJson(excluded)),
        sourceBytes: source,
        expectedSourceArtifactId: "artifact_source",
        approvedExclusionIds: [],
      }),
    ).toThrow("human approval");

    const cyclic = JSON.parse(canonicalJson(ledger)) as {
      requirements: Array<Record<string, unknown>>;
    };
    cyclic.requirements[0]!.predecessor_ids = ["requirement_api"];
    expect(() =>
      validateLedger({
        ledgerBytes: Buffer.from(canonicalJson(cyclic)),
        sourceBytes: source,
        expectedSourceArtifactId: "artifact_source",
        approvedExclusionIds: [],
      }),
    ).toThrow("lineage");
  });

  it("renders byte-stable anchored ledger and plan Markdown", () => {
    const ledgerBytes = Buffer.from(canonicalJson(ledger));
    const firstLedger = renderLedger(ledgerBytes);
    expect(renderLedger(ledgerBytes)).toEqual(firstLedger);
    expect(firstLedger.bytes.toString()).toContain(
      "factory:requirement id=requirement_api",
    );

    const planBytes = Buffer.from(canonicalJson(plan));
    const firstPlan = renderPlan(planBytes);
    expect(renderPlan(planBytes)).toEqual(firstPlan);
    expect(firstPlan.bytes.toString()).toContain(
      "factory:section id=section_api",
    );
  });

  it("preserves externally edited bytes for artifact staging", () => {
    const rendered = renderPlan(Buffer.from(canonicalJson(plan)));
    expect(verifyProjection(rendered.bytes, rendered.contentHash)).toEqual({
      status: "verified",
      contentHash: rendered.contentHash,
    });
    const edited = Buffer.concat([rendered.bytes, Buffer.from("human edit\n")]);
    const result = verifyProjection(edited, rendered.contentHash);
    expect(result.status).toBe("external_edit");
    if (result.status === "external_edit") {
      expect(result.editedBytes).toEqual(edited);
    }
  });
});
