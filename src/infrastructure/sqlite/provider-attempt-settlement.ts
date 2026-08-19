import type { PersistableAuditFact } from "../../application/authority-port.js";

export type ProviderSettlementState = {
  commandStatus: string;
  acceptedAttemptId: string | null;
  triggeringStateVersion: number;
  attemptStatus: string;
  currentStateVersion: number;
};

export type ProviderSettlementMode =
  "exact_replay" | "eligible" | "discard" | "invalid";

export function providerSettlementMode(input: {
  state: ProviderSettlementState;
  settledStatuses: readonly string[];
  explicitlyExpected: boolean;
}): ProviderSettlementMode {
  const { state } = input;
  if (input.settledStatuses.includes(state.attemptStatus)) {
    return "exact_replay";
  }
  if (
    state.attemptStatus === "started" &&
    state.acceptedAttemptId === null &&
    state.commandStatus === "running" &&
    (state.currentStateVersion === state.triggeringStateVersion ||
      input.explicitlyExpected)
  ) {
    return "eligible";
  }
  if (
    state.attemptStatus === "started" &&
    (state.acceptedAttemptId !== null ||
      state.currentStateVersion !== state.triggeringStateVersion)
  ) {
    return "discard";
  }
  return "invalid";
}

export function resultDiscardedFact(input: {
  commandId: string;
  attemptId: string;
  acceptedAttemptId: string | null;
  triggeringStateVersion: number;
  currentStateVersion: number;
  evidence: PersistableAuditFact["evidence"];
}): PersistableAuditFact {
  return {
    type: "result_discarded",
    actor: { kind: "system", component: "executor", version: "0.0.0" },
    reason:
      "The provider result is stale or a logical result was already accepted",
    evidence: input.evidence,
    payload: {
      commandId: input.commandId,
      attemptId: input.attemptId,
      acceptedAttemptId: input.acceptedAttemptId,
      triggeringStateVersion: input.triggeringStateVersion,
      currentStateVersion: input.currentStateVersion,
    },
  };
}
