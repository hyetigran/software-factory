import { canonicalJson } from "../domain/canonical-json.js";
import type { BudgetReservation } from "../domain/index.js";
import type {
  CompleteProviderFailureEvidence,
  ProviderFailureDisposition,
} from "./execution-port.js";

export function terminalFailureEvidenceDocuments(input: {
  completion: CompleteProviderFailureEvidence;
  disposition: ProviderFailureDisposition;
  attempts: Array<{
    attemptId: string;
    requestArtifactId: string;
    requestContentHash: string;
    outcomeArtifactId: string;
    nativeUsageArtifactId: string | null;
    reserved: BudgetReservation;
    actual: BudgetReservation;
    actualKind: "actual" | "conservative_charge";
  }>;
}): {
  policyDecision: Buffer;
  budgetReport: Buffer;
  diagnostic: Buffer;
} {
  const { completion, disposition } = input;
  const total = (field: keyof BudgetReservation, kind: "reserved" | "actual") =>
    input.attempts.reduce((sum, attempt) => sum + attempt[kind][field], 0);
  const totals = (kind: "reserved" | "actual"): BudgetReservation => ({
    calls: total("calls", kind),
    inputTokens: total("inputTokens", kind),
    outputTokens: total("outputTokens", kind),
    costUsdMicros: total("costUsdMicros", kind),
  });
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
        attempts: input.attempts,
        totals: {
          reserved: totals("reserved"),
          actual: totals("actual"),
        },
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
