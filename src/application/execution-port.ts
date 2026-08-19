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
  status: "started";
  runId: string;
  commandId: string;
  attemptId: string;
  attemptNumber: number;
  triggeringStateVersion: number;
  correlationId: string;
  reservation: BudgetReservation;
  lease: {
    ownerProcess: string;
    acquiredAt: string;
    heartbeatAt: string;
  };
  startedAt: string;
  resolvedPrerequisiteArtifacts: Array<{
    commandId: string;
    attemptId: string;
    artifactId: string;
    contentHash: string;
  }>;
};

export type BeginAttemptOutcome =
  | StartedCommandAttempt
  | {
      status: "already_succeeded";
      runId: string;
      commandId: string;
      acceptedAttemptId: string;
    };

const executionPolicyBrand = Symbol("ExecutionPolicy");

export class ExecutionPolicy {
  readonly [executionPolicyBrand] = true;

  private constructor(
    readonly runId: string,
    readonly configurationArtifactId: string,
    readonly configurationHash: string,
    readonly configuration: Readonly<ResolvedConfigurationSnapshot>,
  ) {
    Object.freeze(this);
  }

  static fromConfiguration(input: {
    configuration: ResolvedConfigurationSnapshot;
    runId: string;
    configurationArtifactId: string;
    expectedContentHash: string;
  }): ExecutionPolicy {
    if (
      input.runId.trim().length === 0 ||
      input.configurationArtifactId.trim().length === 0 ||
      !resolvedConfigurationIsValid(input.configuration)
    ) {
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
      input.runId,
      input.configurationArtifactId,
      actualHash,
      immutableCopy(input.configuration),
    );
  }

  get ceilings(): Readonly<ResolvedConfigurationSnapshot["hardCeilings"]> {
    return this.configuration.hardCeilings;
  }
}

function immutableCopy<T>(value: T): Readonly<T> {
  const copy = structuredClone(value);
  const freeze = (nested: unknown): void => {
    if (nested === null || typeof nested !== "object") return;
    Object.freeze(nested);
    Object.values(nested).forEach(freeze);
  };
  freeze(copy);
  return copy;
}

export type BeginAttemptRequest = {
  runId: string;
  commandId: string;
  attemptId: string;
  correlationId: string;
  ownerProcess: string;
  configurationArtifactId: string;
  policy: ExecutionPolicy;
  attemptKind:
    | "initial"
    | "transport_retry"
    | "schema_repair"
    | "strict_replay"
    | "human_rerun";
  humanAuthorizationId?: string;
  strictReplay?: {
    recordingManifestArtifactId: string;
    cassetteKey: string;
    normalizedRequestHash: string;
  };
};

export interface CommandExecutionPort {
  beginAttempt(request: BeginAttemptRequest): Promise<BeginAttemptOutcome>;
}

export function beginEligibleCommandAttempt(
  execution: CommandExecutionPort,
  request: BeginAttemptRequest,
): Promise<BeginAttemptOutcome> {
  if (
    request.commandId.trim().length === 0 ||
    request.runId !== request.policy.runId ||
    request.configurationArtifactId !==
      request.policy.configurationArtifactId ||
    request.attemptId.trim().length === 0 ||
    request.correlationId.trim().length === 0 ||
    request.ownerProcess.trim().length === 0 ||
    (request.attemptKind === "human_rerun" &&
      (request.humanAuthorizationId?.trim().length ?? 0) === 0) ||
    (request.attemptKind === "strict_replay" &&
      (request.strictReplay === undefined ||
        request.strictReplay.recordingManifestArtifactId.trim().length === 0 ||
        !/^[a-f0-9]{64}$/u.test(request.strictReplay.cassetteKey) ||
        !/^[a-f0-9]{64}$/u.test(request.strictReplay.normalizedRequestHash))) ||
    (request.attemptKind !== "strict_replay" &&
      request.strictReplay !== undefined) ||
    (request.attemptKind !== "human_rerun" &&
      request.humanAuthorizationId !== undefined) ||
    request.policy[executionPolicyBrand] !== true
  ) {
    throw new TypeError(
      "Command attempt identity and execution policy are required",
    );
  }
  return execution.beginAttempt(request);
}
