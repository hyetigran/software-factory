import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PersistableCommand } from "../../src/application/authority-port.js";
import { commandIsValid } from "../../src/application/command-validation.js";
import { providerCommandPayloadIsValid } from "../../src/application/provider-command-specification.js";
import { canonicalJson } from "../../src/domain/canonical-json.js";

function command(
  commandType: string,
  payload: object,
  provider: "local" | "openai" = "local",
): PersistableCommand {
  const body = {
    commandType,
    schemaVersion: 1,
    runId: "run_1",
    triggeringStateVersion: 1,
    purposeId: "purpose_1",
    inputArtifactHashes: ["a".repeat(64)],
    policyHash: "b".repeat(64),
    provider,
    ...(provider === "local" ? {} : { modelId: "model-1" }),
    budgetReservation:
      provider === "local"
        ? { calls: 0, inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }
        : { calls: 1, inputTokens: 10, outputTokens: 10, costUsdMicros: 10 },
    payload,
  };
  return {
    commandId: "command_1",
    commandKey: createHash("sha256").update(canonicalJson(body)).digest("hex"),
    ...body,
  };
}

describe("command validation", () => {
  it.each([
    [
      "baseline_review",
      {
        ledgerVersionId: "ledger-v1",
        ledgerArtifactId: "ledger",
        planVersionId: "plan-v1",
        planArtifactId: "plan",
        renderPlanCommandId: "render",
        reviewerPromptArtifactId: "prompt",
        reviewSchemaArtifactId: "schema",
        taxonomyArtifactId: "taxonomy",
        componentRegistryArtifactId: "components",
        reviewPolicyArtifactId: "policy",
        evidenceArtifactIds: ["evidence"],
        independence: { reduced: true, overrideEvidence: null },
        providerStorage: "minimize",
      },
    ],
    [
      "closure_review",
      {
        ledgerVersionId: "ledger-v1",
        ledgerArtifactId: "ledger",
        planVersionId: "plan-v1",
        planArtifactId: "plan",
        baselineReviewArtifactId: "review",
        renderedPlanArtifactId: "rendered",
        reviewerPromptArtifactId: "prompt",
        reviewSchemaArtifactId: "schema",
        taxonomyArtifactId: "taxonomy",
        componentRegistryArtifactId: "components",
        reviewPolicyArtifactId: "policy",
        evidenceArtifactIds: ["evidence"],
        findingIds: [],
        independence: {
          reduced: true,
          overrideEvidence: { artifactId: "override", contentHash: "bad" },
        },
        providerStorage: "minimize",
      },
    ],
  ])("rejects invalid reduced independence for %s", (commandType, payload) => {
    expect(providerCommandPayloadIsValid(commandType, payload)).toBe(false);
  });
  it("accepts exact operational command payloads", () => {
    expect(
      commandIsValid(command("verify_integrity", { scope: "workspace" })),
    ).toBe(true);
    expect(
      commandIsValid(command("backup_workspace", { backupId: "backup_1" })),
    ).toBe(true);
  });

  it("rejects missing, extra, and malformed nested command fields", () => {
    expect(commandIsValid(command("verify_integrity", {}))).toBe(false);
    expect(
      commandIsValid(
        command("backup_workspace", {
          backupId: "backup_1",
          credential: "secret",
        }),
      ),
    ).toBe(false);
    expect(
      commandIsValid(
        command("render_ledger_approval", {
          ledgerVersionId: "ledger_1",
          ledgerArtifactId: "artifact_ledger",
          coverageReportArtifactId: "artifact_coverage",
          coverageValidatedStateVersion: 1,
          coverageValidatedPolicyHash: "b".repeat(64),
          approvalGateId: "gate_1",
          sourceExclusions: [],
          approvedBy: { kind: "human", displayName: "A" },
        }),
      ),
    ).toBe(false);
  });

  it("accepts a terminal export before ledger or plan creation", () => {
    expect(
      commandIsValid(
        command("export_terminal", {
          haltedFrom: "planning",
          reason: "provider refused",
          failedCommandId: "command_failed",
          failureClassification: "refusal",
          attemptIds: ["attempt_1"],
          evidenceArtifactIds: ["artifact_failure"],
          unresolvedFindingIds: [],
          sourceArtifactId: "artifact_source",
          configurationArtifactId: "artifact_config",
          ledgerArtifactId: null,
          planArtifactId: null,
          policyHash: "b".repeat(64),
          plannerAssignment: { provider: "openai", modelId: "planner" },
          reviewerAssignment: { provider: "anthropic", modelId: "reviewer" },
          budgetReportArtifactId: "artifact_budget",
          recoveryBounds: {
            retryLimit: 1,
            repairLimit: 1,
            retriesUsed: 0,
            repairsUsed: 0,
          },
          independence: null,
          lineageArtifactIds: [],
          waiverIds: [],
          outcome: "halted",
        }),
      ),
    ).toBe(true);
  });
});
