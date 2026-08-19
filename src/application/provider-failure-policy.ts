import type {
  ExecutionPolicy,
  ProviderFailureDisposition,
} from "./execution-port.js";
import type { ProviderExecution } from "./provider-port.js";
import type { ProviderOutcomeFailed } from "../domain/index.js";

export type ProviderRecoveryCounts = {
  retriesUsed: number;
  repairsUsed: number;
};

const failureRoutes = {
  refusal: { status: "failed", failureClass: "refusal", recovery: "terminal" },
  truncated: {
    status: "failed",
    failureClass: "invalid_output",
    recovery: "terminal",
  },
  schema_invalid: {
    status: "failed",
    failureClass: "schema_invalid",
    recovery: "schema_repair",
  },
  transport_retryable: {
    status: "failed",
    failureClass: "transport_retryable",
    recovery: "transport_retry",
  },
  transport_nonretryable: {
    status: "failed",
    failureClass: "transport",
    recovery: "terminal",
  },
  unknown_outcome: {
    status: "unknown",
    failureClass: "unknown",
    recovery: "transport_retry",
  },
  model_unavailable: {
    status: "failed",
    failureClass: "provider_error",
    recovery: "pinned_model_unavailable",
  },
  model_mismatch: {
    status: "failed",
    failureClass: "provider_error",
    recovery: "terminal",
  },
} as const;

export function providerFailureKind(
  execution: Exclude<ProviderExecution, { kind: "completed" }>,
): keyof typeof failureRoutes {
  if (execution.kind === "refused") return "refusal";
  if (execution.kind === "transport_failure") {
    return execution.retryable
      ? "transport_retryable"
      : "transport_nonretryable";
  }
  return execution.kind;
}

export function decideProviderFailure(input: {
  runId: string;
  commandId: string;
  attemptId: string;
  execution: Exclude<ProviderExecution, { kind: "completed" }>;
  counts: ProviderRecoveryCounts;
  policy: ExecutionPolicy;
}): ProviderFailureDisposition {
  const failureKind = providerFailureKind(input.execution);
  const selected = failureRoutes[failureKind];
  const recovery =
    selected.recovery === "transport_retry" &&
    input.counts.retriesUsed >= input.policy.ceilings.retries
      ? "terminal"
      : selected.recovery === "schema_repair" &&
          input.counts.repairsUsed >= input.policy.ceilings.repairs
        ? "terminal"
        : selected.recovery;
  return {
    status: selected.status,
    runId: input.runId,
    commandId: input.commandId,
    attemptId: input.attemptId,
    failureClass: selected.failureClass,
    failureKind,
    recovery,
    recoveryBounds: {
      retryLimit: input.policy.ceilings.retries,
      repairLimit: input.policy.ceilings.repairs,
      ...input.counts,
    },
  };
}

export function terminalFailureClassification(
  disposition: ProviderFailureDisposition,
): ProviderOutcomeFailed["failureClassification"] {
  if (disposition.failureClass === "refusal") return "refusal";
  if (
    disposition.failureClass === "invalid_output" ||
    disposition.failureClass === "schema_invalid"
  )
    return "invalid_output";
  if (disposition.failureClass === "provider_error") return "provider_error";
  return "transport";
}
