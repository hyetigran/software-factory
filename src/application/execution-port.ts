import { createHash } from "node:crypto";

import { canonicalJson } from "../domain/canonical-json.js";
import type { BudgetReservation } from "../domain/index.js";
import {
  resolvedConfigurationIsValid,
  type ResolvedConfigurationSnapshot,
} from "./stage-configuration.js";

export type AttemptStatus =
  "started" | "completed" | "failed" | "unknown" | "discarded";

export type StartedCommandAttempt = {
  runId: string;
  commandId: string;
  attemptId: string;
  attemptNumber: number;
  correlationId: string;
  reservation: BudgetReservation;
  startedAt: string;
};

const executionPolicyBrand = Symbol("ExecutionPolicy");

export class ExecutionPolicy {
  readonly [executionPolicyBrand] = true;

  private constructor(
    readonly configurationHash: string,
    readonly ceilings: Readonly<ResolvedConfigurationSnapshot["hardCeilings"]>,
  ) {}

  static fromConfiguration(input: {
    configuration: ResolvedConfigurationSnapshot;
    expectedContentHash: string;
  }): ExecutionPolicy {
    if (!resolvedConfigurationIsValid(input.configuration)) {
      throw new TypeError(
        "Execution policy requires a valid resolved configuration",
      );
    }
    const actualHash = createHash("sha256")
      .update(canonicalJson(input.configuration))
      .digest("hex");
    if (actualHash !== input.expectedContentHash) {
      throw new TypeError("Execution policy configuration hash does not match");
    }
    return new ExecutionPolicy(
      actualHash,
      Object.freeze(structuredClone(input.configuration.hardCeilings)),
    );
  }
}

export type BeginAttemptRequest = {
  commandId: string;
  attemptId: string;
  correlationId: string;
  ownerProcess: string;
  policy: ExecutionPolicy;
};

export interface CommandExecutionPort {
  beginAttempt(request: BeginAttemptRequest): Promise<StartedCommandAttempt>;
}

export function beginEligibleCommandAttempt(
  execution: CommandExecutionPort,
  request: BeginAttemptRequest,
): Promise<StartedCommandAttempt> {
  if (
    request.commandId.trim().length === 0 ||
    request.attemptId.trim().length === 0 ||
    request.correlationId.trim().length === 0 ||
    request.ownerProcess.trim().length === 0 ||
    request.policy[executionPolicyBrand] !== true
  ) {
    throw new TypeError(
      "Command attempt identity and execution policy are required",
    );
  }
  return execution.beginAttempt(request);
}
