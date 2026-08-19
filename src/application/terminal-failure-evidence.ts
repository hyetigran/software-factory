import { canonicalJson } from "../domain/canonical-json.js";
import type { BudgetReservation } from "../domain/index.js";
import type {
  CompleteProviderFailureEvidence,
  ProviderFailureDisposition,
} from "./execution-port.js";

export function terminalFailureEvidenceDocuments(input: {
  completion: CompleteProviderFailureEvidence;
  disposition: ProviderFailureDisposition;
  attemptIds: string[];
  reserved: BudgetReservation;
  actual: BudgetReservation;
}): {
  policyDecision: Buffer;
  budgetReport: Buffer;
  diagnostic: Buffer;
} {
  const { completion, disposition } = input;
  return {
    policyDecision: Buffer.from(
      canonicalJson({
        schemaVersion: 1,
        decision: "halt",
        runId: completion.runId,
        commandId: completion.commandId,
        attemptId: completion.attemptId,
        failureKind: disposition.failureKind,
        failureClass: disposition.failureClass,
        recovery: disposition.recovery,
      }),
    ),
    budgetReport: Buffer.from(
      canonicalJson({
        schemaVersion: 1,
        runId: completion.runId,
        commandId: completion.commandId,
        attemptIds: input.attemptIds,
        reserved: input.reserved,
        actual: input.actual,
        recoveryBounds: disposition.recoveryBounds,
      }),
    ),
    diagnostic: Buffer.from(
      canonicalJson({
        schemaVersion: 1,
        runId: completion.runId,
        commandId: completion.commandId,
        attemptId: completion.attemptId,
        requestArtifactId: completion.requestArtifactId,
        outcomeArtifactId: completion.outcomeArtifact.artifactId,
        outcomeContentHash: completion.outcomeArtifact.contentHash,
        nativeUsageArtifactId:
          completion.nativeUsageArtifact?.artifactId ?? null,
        providerEvidence: completion.execution.evidence,
        failureKind: disposition.failureKind,
      }),
    ),
  };
}
