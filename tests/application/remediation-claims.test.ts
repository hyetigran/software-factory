import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildRemediationGenerated,
  deriveRemediationClaims,
} from "../../src/application/remediation-claims.js";
import { canonicalJson } from "../../src/domain/canonical-json.js";

function planBytes(sections: Array<{ id: string; body: string }>): Buffer {
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
      sections: sections.map(({ id, body }) => ({
        section_id: id,
        kind: "approach",
        title: `Title ${id}`,
        body,
        component_ids: ["component_core"],
        requirement_ids: ["req_1"],
      })),
      requirement_coverage: [
        {
          requirement_id: "req_1",
          section_ids: [sections[0]!.id],
          justification: "Covered",
        },
      ],
      section_transitions: [],
    }),
  );
}

const priorBytes = planBytes([
  { id: "section_alpha", body: "original alpha" },
  { id: "section_beta", body: "original beta" },
  { id: "section_gamma", body: "original gamma" },
]);
const revisedBytes = planBytes([
  { id: "section_alpha", body: "revised alpha" },
  { id: "section_beta", body: "original beta" },
  { id: "section_delta", body: "new delta" },
]);
const revisedHash = createHash("sha256").update(revisedBytes).digest("hex");

const remediationArtifact = {
  artifactId: "artifact_remediation_01JTEST",
  contentHash: revisedHash,
};

describe("deriveRemediationClaims", () => {
  it("derives one evidence-backed claim per blocking finding from the plan diff", () => {
    const derived = deriveRemediationClaims({
      priorPlanBytes: priorBytes,
      revisedPlanBytes: revisedBytes,
      remediationArtifact,
      blockingFindingIds: [
        "finding_architecture_01JTEST",
        "finding_security_01JTEST",
      ],
    });

    expect(derived.changedSectionIds).toEqual([
      "section_alpha",
      "section_delta",
      "section_gamma",
    ]);
    expect(derived.claims).toEqual([
      {
        claimId: "claim_finding_architecture_01JTEST",
        findingId: "finding_architecture_01JTEST",
        changedSectionIds: ["section_alpha", "section_delta", "section_gamma"],
        evidence: [
          {
            kind: "artifact",
            artifactId: remediationArtifact.artifactId,
            contentHash: remediationArtifact.contentHash,
          },
        ],
      },
      {
        claimId: "claim_finding_security_01JTEST",
        findingId: "finding_security_01JTEST",
        changedSectionIds: ["section_alpha", "section_delta", "section_gamma"],
        evidence: [
          {
            kind: "artifact",
            artifactId: remediationArtifact.artifactId,
            contentHash: remediationArtifact.contentHash,
          },
        ],
      },
    ]);
    expect(derived.validation).toEqual({
      validator: "deterministic-remediation-claims-v1",
      validatedRemediationContentHash: revisedHash,
      claimsMatchArtifact: true,
      changedSectionsDeclared: true,
    });
  });

  it("is deterministic across repeated derivations", () => {
    const run = () =>
      deriveRemediationClaims({
        priorPlanBytes: priorBytes,
        revisedPlanBytes: revisedBytes,
        remediationArtifact,
        blockingFindingIds: ["finding_architecture_01JTEST"],
      });

    expect(run()).toEqual(run());
  });

  it("refuses claims when the revised bytes do not match the artifact hash", () => {
    const derived = deriveRemediationClaims({
      priorPlanBytes: priorBytes,
      revisedPlanBytes: revisedBytes,
      remediationArtifact: {
        artifactId: remediationArtifact.artifactId,
        contentHash: "0".repeat(64),
      },
      blockingFindingIds: ["finding_architecture_01JTEST"],
    });

    expect(derived.validation.claimsMatchArtifact).toBe(false);
  });

  it("declares no changed sections for an unchanged plan", () => {
    const derived = deriveRemediationClaims({
      priorPlanBytes: priorBytes,
      revisedPlanBytes: priorBytes,
      remediationArtifact: {
        artifactId: remediationArtifact.artifactId,
        contentHash: createHash("sha256").update(priorBytes).digest("hex"),
      },
      blockingFindingIds: ["finding_architecture_01JTEST"],
    });

    expect(derived.changedSectionIds).toEqual([]);
    expect(derived.validation.changedSectionsDeclared).toBe(false);
    expect(derived.validation.claimsMatchArtifact).toBe(true);
  });

  it("assembles the domain input itself and refuses a mismatched baseline", () => {
    const state = {
      runId: "run_01JTEST0000000000000000000",
      stateVersion: 9,
      state: "remediation",
      currentPlan: {
        versionId: "plan_version_01JTEST",
        contentHash: createHash("sha256").update(priorBytes).digest("hex"),
      },
      blockingFindingIds: ["finding_architecture_01JTEST"],
      activePlanning: {
        purposeId: "purpose_remediation_01JTEST",
        commandId: "command_generate_remediation_01JTEST",
        plannerAssignment: { provider: "openai", modelId: "planner" },
      },
    } as unknown as Parameters<typeof buildRemediationGenerated>[0]["state"];
    const configuration = {
      providerRequestBudgets: {
        reviewer: {
          calls: 1,
          inputTokens: 4_000,
          outputTokens: 1_000,
          costUsdMicros: 400_000,
        },
      },
      providerRequestSettings: {
        reviewer: { timeoutMs: 30_000, reasoning: null },
      },
    } as unknown as Parameters<
      typeof buildRemediationGenerated
    >[0]["configuration"];
    const request = {
      state,
      completion: {
        commandId: "command_generate_remediation_01JTEST",
        attemptId: "attempt_generate_remediation_01JTEST_1",
        requestArtifactId: "artifact_remediation_request_01JTEST",
        requestContentHash: "5".repeat(64),
        outputArtifact: remediationArtifact,
        rawResponseArtifact: {
          artifactId: "artifact_remediation_raw_01JTEST",
          contentHash: "6".repeat(64),
        },
        nativeUsageArtifact: {
          artifactId: "artifact_remediation_usage_01JTEST",
          contentHash: "7".repeat(64),
        },
      },
      configuration,
      priorPlanBytes: priorBytes,
      revisedPlanBytes: revisedBytes,
      planArtifactId: "artifact_plan_02JTEST",
      sectionTransitionMapArtifactId: "artifact_section_map_02JTEST",
      sectionTransitionMapBytes: Buffer.from(canonicalJson([])),
      provenanceArtifact: {
        artifactId: "artifact_plan_provenance_02JTEST",
        contentHash: "8".repeat(64),
        verified: true,
      },
      outputValid: true,
      verifyCommandId: "command_verify_remediation_01JTEST",
      availableBudget: {
        calls: 2,
        inputTokens: 100_000,
        outputTokens: 40_000,
        costUsdMicros: 50_000_000,
      },
      auditChainVerified: true,
      databaseIntegrityVerified: true,
      schemaCompatible: true,
      mutationLeaseAvailable: true,
    };

    const built = buildRemediationGenerated(request);
    expect(built.planVersionId).toBe("plan_version_01JTEST");
    expect(built.claims).toHaveLength(1);
    expect(built.claimsValidation.claimsMatchArtifact).toBe(true);
    expect(built.remediationArtifact.verified).toBe(true);
    expect(built.verifyBudgetMaximum).toEqual(
      configuration.providerRequestBudgets.reviewer,
    );
    expect(built.actor).toEqual({
      kind: "planner",
      provider: "openai",
      modelId: "planner",
    });

    expect(
      buildRemediationGenerated({
        ...request,
        completion: {
          ...request.completion,
          outputArtifact: {
            artifactId: remediationArtifact.artifactId,
            contentHash: "0".repeat(64),
          },
        },
      }).remediationArtifact.verified,
    ).toBe(false);

    expect(() =>
      buildRemediationGenerated({ ...request, priorPlanBytes: revisedBytes }),
    ).toThrow("do not match the current plan");
  });

  it("fails closed when either plan document is not a valid plan shape", () => {
    const broken = Buffer.from("not json");
    for (const [prior, revised] of [
      [broken, revisedBytes],
      [priorBytes, broken],
      [priorBytes, Buffer.from(canonicalJson({ sections: "wrong" }))],
    ] as const) {
      const derived = deriveRemediationClaims({
        priorPlanBytes: prior,
        revisedPlanBytes: revised,
        remediationArtifact: {
          artifactId: remediationArtifact.artifactId,
          contentHash: createHash("sha256").update(revised).digest("hex"),
        },
        blockingFindingIds: ["finding_architecture_01JTEST"],
      });

      expect(derived.claims).toEqual([]);
      expect(derived.validation.claimsMatchArtifact).toBe(false);
      expect(derived.validation.changedSectionsDeclared).toBe(false);
    }
  });
});
