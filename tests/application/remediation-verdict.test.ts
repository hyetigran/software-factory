import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildRemediationReviewAccepted } from "../../src/application/remediation-verdict.js";
import { canonicalJson } from "../../src/domain/canonical-json.js";

const reviewSchemaBytes = readFileSync(
  resolve("schemas/review.v1.schema.json"),
);
const reviewSchemaHash = createHash("sha256")
  .update(reviewSchemaBytes)
  .digest("hex");

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function reviewDocument(
  disposition: "resolved" | "reproduced" | "uncertain",
): Buffer {
  return Buffer.from(
    canonicalJson({
      schema_version: 1,
      review_id: "review_verify_01JTEST",
      review_kind: "remediation",
      plan_artifact_id: "artifact_plan_02JTEST",
      policy_hash: "a".repeat(64),
      prior_findings: [
        {
          finding_id: "finding_architecture_01JTEST",
          disposition,
          severity: "high",
          evidence: [
            {
              artifact_id: "artifact_plan_02JTEST",
              section_ids: [],
              explanation: "Verified against the revised sections",
            },
          ],
          reason: "Claim evaluated against the diff",
        },
      ],
      new_concerns: [],
      summary: "Remediation claim verification",
    }),
  );
}

const diffBytes = Buffer.from(
  canonicalJson({
    schema_version: 1,
    kind: "remediation_diff",
    complete: true,
    prior_plan_content_hash: "1".repeat(64),
    revised_plan_content_hash: "2".repeat(64),
    claims: [
      {
        claimId: "claim_finding_architecture_01JTEST",
        findingId: "finding_architecture_01JTEST",
        changedSectionIds: ["section_alpha"],
        evidence: [],
      },
    ],
    changed_sections: [],
  }),
);

const configuration = {
  policyHash: "a".repeat(64),
  artifactHashes: { reviewSchema: reviewSchemaHash },
  providerRequestBudgets: {
    reviewer: {
      calls: 1,
      inputTokens: 4_000,
      outputTokens: 1_000,
      costUsdMicros: 400_000,
    },
    remediation: {
      calls: 1,
      inputTokens: 5_000,
      outputTokens: 2_000,
      costUsdMicros: 500_000,
    },
  },
  providerRequestSettings: {
    reviewer: { timeoutMs: 30_000, reasoning: null },
    remediation: { timeoutMs: 45_000, reasoning: "high" },
  },
  hardCeilings: { remediationCycles: 3 },
} as unknown as Parameters<
  typeof buildRemediationReviewAccepted
>[0]["configuration"];

function state(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run_01JTEST0000000000000000000",
    stateVersion: 10,
    state: "remediation",
    policyHash: "a".repeat(64),
    currentPlan: {
      versionId: "plan_version_02JTEST",
      artifactId: "artifact_plan_02JTEST",
      contentHash: "2".repeat(64),
    },
    blockingFindingIds: ["finding_architecture_01JTEST"],
    activeReview: {
      cycle: 1,
      commandId: "command_verify_remediation_01JTEST",
      reviewPurposeId:
        "run_01JTEST0000000000000000000:plan:plan_version_02JTEST:verify:1",
      reviewerAssignment: { provider: "anthropic", modelId: "reviewer" },
    },
    ...overrides,
  } as unknown as Parameters<typeof buildRemediationReviewAccepted>[0]["state"];
}

function request(responseBytes: Buffer) {
  return {
    state: state(),
    completion: {
      commandId: "command_verify_remediation_01JTEST",
      attemptId: "attempt_verify_remediation_01JTEST_1",
      requestArtifactId: "artifact_verify_request_01JTEST",
      requestContentHash: "5".repeat(64),
      outputArtifact: {
        artifactId: "artifact_verify_review_01JTEST",
        contentHash: hash(responseBytes),
      },
      rawResponseArtifact: {
        artifactId: "artifact_verify_raw_01JTEST",
        contentHash: "6".repeat(64),
      },
      nativeUsageArtifact: {
        artifactId: "artifact_verify_usage_01JTEST",
        contentHash: "7".repeat(64),
      },
    },
    configuration,
    responseBytes,
    reviewSchema: { bytes: reviewSchemaBytes, contentHash: reviewSchemaHash },
    diffArtifactBytes: diffBytes,
    diffArtifactContentHash: hash(diffBytes),
    claimIds: ["claim_finding_architecture_01JTEST"],
    nextCommandId: "command_after_verify_01JTEST",
    remediationPromptArtifactId: "artifact_remediation_prompt_01JTEST",
    remediationSchemaArtifactId: "artifact_remediation_schema_01JTEST",
    availableBudget: {
      calls: 2,
      inputTokens: 100_000,
      outputTokens: 40_000,
      costUsdMicros: 50_000_000,
    },
    exhaustion: null,
    auditChainVerified: true,
    databaseIntegrityVerified: true,
    schemaCompatible: true,
    mutationLeaseAvailable: true,
  };
}

describe("buildRemediationReviewAccepted", () => {
  it("derives a resolved verdict from the reviewer's resolved disposition", () => {
    const bytes = reviewDocument("resolved");
    const built = buildRemediationReviewAccepted(request(bytes));

    expect(built.reviewId).toBe("review_verify_01JTEST");
    expect(built.outputValid).toBe(true);
    expect(built.reviewArtifact.verified).toBe(true);
    expect(built.verdicts).toEqual([
      {
        claimId: "claim_finding_architecture_01JTEST",
        findingId: "finding_architecture_01JTEST",
        disposition: "resolved",
      },
    ]);
    expect(built.verdictValidation).toEqual({
      validator: "deterministic-remediation-verdict-v1",
      validatedReviewContentHash: hash(bytes),
      schemaValid: true,
      claimsAccountedFor: true,
      controlledIdsValid: true,
    });
    expect(built.remediationCycleCeiling).toBe(3);
    expect(built.remediationCyclesUsed).toBe(1);
    expect(built.nextCommandBudgetMaximum).toEqual(
      configuration.providerRequestBudgets.reviewer,
    );
    expect(built.nextCommandTimeoutMs).toBe(30_000);
    expect(built.actor).toEqual({
      kind: "reviewer",
      provider: "anthropic",
      modelId: "reviewer",
    });
    expect(built.exhaustionReport).toBeNull();
  });

  it.each(["reproduced", "uncertain"] as const)(
    "keeps a finding open on a %s disposition and funds the next cycle",
    (disposition) => {
      const built = buildRemediationReviewAccepted(
        request(reviewDocument(disposition)),
      );

      expect(built.verdicts[0]?.disposition).toBe("unresolved");
      expect(built.nextCommandBudgetMaximum).toEqual(
        configuration.providerRequestBudgets.remediation,
      );
      expect(built.nextCommandTimeoutMs).toBe(45_000);
      expect(built.nextCommandReasoning).toBe("high");
    },
  );

  it("fails closed on a schema-invalid response", () => {
    const invalid = Buffer.from(canonicalJson({ schema_version: 1 }));
    const built = buildRemediationReviewAccepted({
      ...request(invalid),
      responseBytes: invalid,
    });

    expect(built.outputValid).toBe(false);
    expect(built.verdictValidation.schemaValid).toBe(false);
  });

  it("fails closed when the reviewer reviewed the wrong context", () => {
    for (const document of [
      { review_kind: "closure" },
      { policy_hash: "b".repeat(64) },
      { plan_artifact_id: "artifact_plan_01JTEST" },
      {
        prior_findings: [
          {
            finding_id: "finding_unknown_01JTEST",
            disposition: "resolved",
            severity: "high",
            evidence: [
              {
                artifact_id: "artifact_plan_02JTEST",
                section_ids: [],
                explanation: "e",
              },
            ],
            reason: "r",
          },
        ],
      },
    ]) {
      const base = JSON.parse(
        Buffer.from(reviewDocument("resolved")).toString("utf8"),
      ) as Record<string, unknown>;
      const bytes = Buffer.from(canonicalJson({ ...base, ...document }));
      const built = buildRemediationReviewAccepted({
        ...request(bytes),
        responseBytes: bytes,
      });

      expect(
        built.verdictValidation.controlledIdsValid &&
          built.verdictValidation.claimsAccountedFor,
      ).toBe(false);
    }
  });

  it("fails closed when the diff claims do not match the command claims", () => {
    const built = buildRemediationReviewAccepted({
      ...request(reviewDocument("resolved")),
      claimIds: ["claim_other_01JTEST"],
    });

    expect(built.verdictValidation.claimsAccountedFor).toBe(false);
  });

  it("fails closed when the diff bytes do not match the pinned diff artifact", () => {
    const built = buildRemediationReviewAccepted({
      ...request(reviewDocument("resolved")),
      diffArtifactContentHash: "0".repeat(64),
    });

    expect(built.verdictValidation.claimsAccountedFor).toBe(false);
  });

  it("marks the response unverified when bytes do not match the artifact hash", () => {
    const bytes = reviewDocument("resolved");
    const base = request(bytes);
    const built = buildRemediationReviewAccepted({
      ...base,
      completion: {
        ...base.completion,
        outputArtifact: {
          artifactId: "artifact_verify_review_01JTEST",
          contentHash: "0".repeat(64),
        },
      },
    });

    expect(built.reviewArtifact.verified).toBe(false);
  });

  it("passes the exhaustion report through only when the ceiling is reached", () => {
    const exhaustion = {
      terminalReportCommandId: "command_terminal_report_01JTEST",
      budgetReportArtifact: {
        artifactId: "artifact_budget_report_01JTEST",
        contentHash: "3".repeat(64),
        verified: true,
      },
      attemptIds: ["attempt_verify_remediation_01JTEST_1"],
      reason: "Remediation cycles exhausted",
    };
    const funded = buildRemediationReviewAccepted({
      ...request(reviewDocument("reproduced")),
      exhaustion,
    });
    expect(funded.exhaustionReport).toBeNull();

    const exhausted = buildRemediationReviewAccepted({
      ...request(reviewDocument("reproduced")),
      state: state({
        activeReview: {
          cycle: 3,
          commandId: "command_verify_remediation_01JTEST",
          reviewPurposeId:
            "run_01JTEST0000000000000000000:plan:plan_version_02JTEST:verify:3",
          reviewerAssignment: { provider: "anthropic", modelId: "reviewer" },
        },
      }),
      exhaustion,
    });
    expect(exhausted.exhaustionReport).toEqual(exhaustion);
    expect(exhausted.remediationCyclesUsed).toBe(3);
  });

  it("rejects a review schema that is not the pinned schema", () => {
    const base = request(reviewDocument("resolved"));
    expect(() =>
      buildRemediationReviewAccepted({
        ...base,
        reviewSchema: {
          bytes: Buffer.from("{}"),
          contentHash: hash(Buffer.from("{}")),
        },
      }),
    ).toThrow("pinned");
  });
});
