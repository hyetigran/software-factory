import type { BudgetReservation } from "../domain/index.js";
import type { BeginAttemptRequest, ExecutionPolicy } from "./execution-port.js";

export type AttemptRecoverySnapshot = {
  logicalStatus: string;
  acceptedAttemptId: string | null;
  triggeringStateVersion: number;
  currentStateVersion: number;
  commandType: string;
  commandReservation: BudgetReservation;
  priorAttempts: number;
  transportRetries: number;
  schemaRepairs: number;
  runAttempts: number;
  lastAttempt?: {
    attemptId: string;
    status: string;
    failureClass: string | null;
    correlationId: string;
  };
  humanRerunAuthorized: boolean;
  strictReplayVerified: boolean;
};

export type AttemptPolicyDecision = {
  noOpAcceptedAttemptId?: string;
  reservation: BudgetReservation;
  duplicateCallPossible: boolean;
  priorAttemptId?: string;
};

const zeroReservation = (): BudgetReservation => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsdMicros: 0,
});

export function decideAttemptPolicy(
  request: BeginAttemptRequest,
  snapshot: AttemptRecoverySnapshot,
  policy: ExecutionPolicy,
): AttemptPolicyDecision {
  if (
    snapshot.acceptedAttemptId !== null &&
    request.attemptKind !== "human_rerun"
  ) {
    return {
      noOpAcceptedAttemptId: snapshot.acceptedAttemptId,
      reservation: zeroReservation(),
      duplicateCallPossible: false,
    };
  }
  if (
    snapshot.runAttempts >= policy.ceilings.physicalAttempts ||
    (snapshot.triggeringStateVersion !== snapshot.currentStateVersion &&
      request.attemptKind !== "human_rerun")
  ) {
    throw new TypeError("Logical command is not eligible for execution");
  }
  const last = snapshot.lastAttempt;
  const retryingUnknown =
    request.attemptKind === "transport_retry" && last?.status === "unknown";
  const allowed =
    (request.attemptKind === "initial" &&
      snapshot.logicalStatus === "planned" &&
      snapshot.priorAttempts === 0) ||
    (request.attemptKind === "transport_retry" &&
      ["failed", "unknown"].includes(snapshot.logicalStatus) &&
      snapshot.transportRetries < policy.ceilings.retries &&
      (last?.status === "unknown" ||
        ["transport_retryable", "provider_error_retryable"].includes(
          last?.failureClass ?? "",
        )) &&
      (!retryingUnknown || last?.correlationId === request.correlationId)) ||
    (request.attemptKind === "schema_repair" &&
      snapshot.logicalStatus === "failed" &&
      last?.failureClass === "schema_invalid" &&
      snapshot.schemaRepairs < policy.ceilings.repairs) ||
    (request.attemptKind === "strict_replay" &&
      snapshot.strictReplayVerified &&
      ["planned", "failed", "unknown"].includes(snapshot.logicalStatus)) ||
    (request.attemptKind === "human_rerun" &&
      snapshot.humanRerunAuthorized &&
      ["planned", "failed", "unknown", "succeeded"].includes(
        snapshot.logicalStatus,
      ));
  if (!allowed) {
    throw new TypeError("Attempt kind is not eligible under recovery policy");
  }
  return {
    reservation:
      request.attemptKind === "strict_replay"
        ? zeroReservation()
        : request.attemptKind === "schema_repair"
          ? policy.configuration.providerRequestBudgets.schemaRepair
          : snapshot.commandReservation,
    duplicateCallPossible: retryingUnknown,
    ...(last === undefined ? {} : { priorAttemptId: last.attemptId }),
  };
}
