import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { validateSectionTransitions } from "../../src/application/section-transitions.js";
import { canonicalJson } from "../../src/domain/canonical-json.js";

type Transition = {
  kind: "preserved" | "retitled" | "split" | "merged" | "retired" | "new";
  from_section_ids: string[];
  to_section_ids: string[];
  reason: string;
};

function planBytes(
  sectionIds: string[],
  transitions: Transition[] = [],
): Buffer {
  return Buffer.from(
    canonicalJson({
      schema_version: 1,
      plan_id: "plan_version_01JTEST",
      version: 1,
      title: "Plan",
      summary: "Summary",
      components: [
        {
          component_id: "component_core",
          name: "Core",
          responsibility: "Everything",
        },
      ],
      sections: sectionIds.map((sectionId) => ({
        section_id: sectionId,
        kind: "approach",
        title: `Title ${sectionId}`,
        body: `Body ${sectionId}`,
        component_ids: ["component_core"],
        requirement_ids: ["req_1"],
      })),
      requirement_coverage: [],
      section_transitions: transitions,
    }),
  );
}

function mapBytes(transitions: Transition[]): Buffer {
  return Buffer.from(canonicalJson(transitions));
}

const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

describe("validateSectionTransitions", () => {
  it("accepts declared splits, retirements, and additions", () => {
    const transitions: Transition[] = [
      {
        kind: "split",
        from_section_ids: ["section_alpha"],
        to_section_ids: ["section_alpha_api", "section_alpha_data"],
        reason: "Alpha split into API and data concerns",
      },
      {
        kind: "retired",
        from_section_ids: ["section_beta"],
        to_section_ids: [],
        reason: "Beta is obsolete",
      },
      {
        kind: "new",
        from_section_ids: [],
        to_section_ids: ["section_delta"],
        reason: "New failure-handling section",
      },
    ];
    const prior = planBytes(["section_alpha", "section_beta", "section_gamma"]);
    const revised = planBytes(
      [
        "section_alpha_api",
        "section_alpha_data",
        "section_gamma",
        "section_delta",
      ],
      transitions,
    );
    const map = mapBytes(transitions);

    expect(
      validateSectionTransitions({
        priorPlanBytes: prior,
        planBytes: revised,
        transitionMapBytes: map,
      }),
    ).toEqual({
      validator: "deterministic-section-transition-v1",
      validatedPlanContentHash: hash(revised),
      validatedTransitionMapContentHash: hash(map),
      classificationsComplete: true,
      existingSectionIdsPreserved: true,
      onlyDeclaredNewSectionsAssignedIds: true,
    });
  });

  it("flags a vanished section that no transition declares", () => {
    const prior = planBytes(["section_alpha", "section_beta"]);
    const revised = planBytes(["section_alpha"]);
    const map = mapBytes([]);

    const validation = validateSectionTransitions({
      priorPlanBytes: prior,
      planBytes: revised,
      transitionMapBytes: map,
    });

    expect(validation.existingSectionIdsPreserved).toBe(false);
    expect(validation.onlyDeclaredNewSectionsAssignedIds).toBe(true);
  });

  it("flags an undeclared new section id", () => {
    const prior = planBytes(["section_alpha"]);
    const revised = planBytes(["section_alpha", "section_smuggled"]);
    const map = mapBytes([]);

    const validation = validateSectionTransitions({
      priorPlanBytes: prior,
      planBytes: revised,
      transitionMapBytes: map,
    });

    expect(validation.onlyDeclaredNewSectionsAssignedIds).toBe(false);
    expect(validation.existingSectionIdsPreserved).toBe(true);
  });

  it("rejects a transition referencing sections neither plan contains", () => {
    const transitions: Transition[] = [
      {
        kind: "retired",
        from_section_ids: ["section_ghost"],
        to_section_ids: [],
        reason: "Never existed",
      },
    ];
    const prior = planBytes(["section_alpha"]);
    const revised = planBytes(["section_alpha"], transitions);
    const map = mapBytes(transitions);

    expect(
      validateSectionTransitions({
        priorPlanBytes: prior,
        planBytes: revised,
        transitionMapBytes: map,
      }).classificationsComplete,
    ).toBe(false);
  });

  it("rejects a map artifact that differs from the plan's declared transitions", () => {
    const declared: Transition[] = [
      {
        kind: "new",
        from_section_ids: [],
        to_section_ids: ["section_delta"],
        reason: "Added",
      },
    ];
    const prior = planBytes(["section_alpha"]);
    const revised = planBytes(["section_alpha", "section_delta"], declared);
    const map = mapBytes([]);

    const validation = validateSectionTransitions({
      priorPlanBytes: prior,
      planBytes: revised,
      transitionMapBytes: map,
    });

    expect(validation.classificationsComplete).toBe(false);
    expect(validation.onlyDeclaredNewSectionsAssignedIds).toBe(false);
  });

  it("rejects kind shapes that contradict their declaration", () => {
    for (const transitions of [
      [
        {
          kind: "split" as const,
          from_section_ids: ["section_alpha"],
          to_section_ids: ["section_alpha_only"],
          reason: "A split into one section is not a split",
        },
      ],
      [
        {
          kind: "new" as const,
          from_section_ids: ["section_alpha"],
          to_section_ids: ["section_delta"],
          reason: "A new section cannot come from an existing one",
        },
      ],
    ]) {
      const prior = planBytes(["section_alpha"]);
      const revised = planBytes(
        transitions[0]!.kind === "split"
          ? ["section_alpha_only"]
          : ["section_alpha", "section_delta"],
        transitions,
      );
      expect(
        validateSectionTransitions({
          priorPlanBytes: prior,
          planBytes: revised,
          transitionMapBytes: mapBytes(transitions),
        }).classificationsComplete,
      ).toBe(false);
    }
  });

  it("fails closed on unparseable documents", () => {
    const validation = validateSectionTransitions({
      priorPlanBytes: Buffer.from("not json"),
      planBytes: planBytes(["section_alpha"]),
      transitionMapBytes: mapBytes([]),
    });

    expect(validation.classificationsComplete).toBe(false);
    expect(validation.existingSectionIdsPreserved).toBe(false);
    expect(validation.onlyDeclaredNewSectionsAssignedIds).toBe(false);
  });
});
