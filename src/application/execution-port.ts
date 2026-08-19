import { createHash } from "node:crypto";

import { canonicalJson } from "../domain/canonical-json.js";
import type { BudgetReservation } from "../domain/index.js";
import {
  resolvedConfigurationIsValid,
  type ResolvedConfigurationSnapshot,
} from "./stage-configuration.js";
import {
  artifactRegistrationIsValid,
  type StagedArtifactRegistration,
} from "./artifact-port.js";

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
const strictReplayBrand = Symbol("StrictReplayEvidence");

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

export class StrictReplayEvidence {
  readonly [strictReplayBrand] = true;

  private constructor(
    readonly recordingManifestArtifactId: string,
    readonly recordingManifestContentHash: string,
    readonly cassetteKey: string,
    readonly normalizedRequestHash: string,
    readonly commandKey: string,
    readonly responseArtifactId: string,
    readonly responseContentHash: string,
  ) {
    Object.freeze(this);
  }

  static fromManifest(input: {
    recordingManifestArtifactId: string;
    recordingManifestBytes: Uint8Array;
    expectedCassetteKey: string;
    expectedNormalizedRequestHash: string;
    expectedCommandKey: string;
  }): StrictReplayEvidence {
    const manifestHash = createHash("sha256")
      .update(input.recordingManifestBytes)
      .digest("hex");
    const parsed: unknown = JSON.parse(
      Buffer.from(input.recordingManifestBytes).toString("utf8"),
    );
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new TypeError("Strict replay manifest must be an object");
    }
    const manifest = parsed as Record<string, unknown>;
    if (
      Object.keys(manifest).sort().join(",") !==
        [
          "cassetteKey",
          "commandKey",
          "normalizedRequestHash",
          "responseArtifactId",
          "responseContentHash",
          "schemaVersion",
        ]
          .sort()
          .join(",") ||
      manifest.schemaVersion !== 1 ||
      manifest.cassetteKey !== input.expectedCassetteKey ||
      manifest.normalizedRequestHash !== input.expectedNormalizedRequestHash ||
      manifest.commandKey !== input.expectedCommandKey ||
      typeof manifest.responseArtifactId !== "string" ||
      manifest.responseArtifactId.trim().length === 0 ||
      typeof manifest.responseContentHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(manifest.responseContentHash)
    ) {
      throw new TypeError("Strict replay manifest does not match the request");
    }
    return new StrictReplayEvidence(
      input.recordingManifestArtifactId,
      manifestHash,
      input.expectedCassetteKey,
      input.expectedNormalizedRequestHash,
      input.expectedCommandKey,
      manifest.responseArtifactId,
      manifest.responseContentHash,
    );
  }
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
  strictReplay?: StrictReplayEvidence;
  schemaRepair?: {
    promptArtifactId: string;
    promptContentHash: string;
    outputSchemaArtifactId: string;
    outputSchemaContentHash: string;
    invalidResponseArtifactId: string;
    invalidResponseContentHash: string;
  };
};

export type CompleteAttemptRequest = {
  runId: string;
  commandId: string;
  attemptId: string;
  ownerProcess: string;
  correlationId: string;
  resultArtifact: StagedArtifactRegistration;
  nativeUsageArtifact: StagedArtifactRegistration;
  actualUsage: BudgetReservation;
  providerEvidence: Readonly<Record<string, string | null>>;
};

export type CompletedCommandAttempt = {
  status: "completed";
  runId: string;
  commandId: string;
  attemptId: string;
  acceptedAsLogicalResult: boolean;
};

export interface CommandExecutionPort {
  beginAttempt(request: BeginAttemptRequest): Promise<BeginAttemptOutcome>;
  completeAttempt(
    request: CompleteAttemptRequest,
  ): Promise<CompletedCommandAttempt>;
}

function schemaRepairPolicyIsValid(
  repair: NonNullable<BeginAttemptRequest["schemaRepair"]>,
): boolean {
  const hash = /^[a-f0-9]{64}$/u;
  return (
    repair.promptArtifactId.trim().length > 0 &&
    hash.test(repair.promptContentHash) &&
    repair.outputSchemaArtifactId.trim().length > 0 &&
    hash.test(repair.outputSchemaContentHash) &&
    repair.invalidResponseArtifactId.trim().length > 0 &&
    hash.test(repair.invalidResponseContentHash)
  );
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
    (request.attemptKind === "schema_repair") !==
      (request.schemaRepair !== undefined) ||
    (request.schemaRepair !== undefined &&
      !schemaRepairPolicyIsValid(request.schemaRepair)) ||
    request.ownerProcess.trim().length === 0 ||
    (request.attemptKind === "human_rerun" &&
      (request.humanAuthorizationId?.trim().length ?? 0) === 0) ||
    (request.attemptKind === "strict_replay" &&
      (request.strictReplay === undefined ||
        request.strictReplay.recordingManifestArtifactId.trim().length === 0 ||
        !/^[a-f0-9]{64}$/u.test(request.strictReplay.cassetteKey) ||
        !/^[a-f0-9]{64}$/u.test(request.strictReplay.normalizedRequestHash) ||
        request.strictReplay[strictReplayBrand] !== true)) ||
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

export function completeCommandAttempt(
  execution: CommandExecutionPort,
  request: CompleteAttemptRequest,
): Promise<CompletedCommandAttempt> {
  const identityFields = [
    request.runId,
    request.commandId,
    request.attemptId,
    request.ownerProcess,
    request.correlationId,
    request.resultArtifact.artifactId,
    request.nativeUsageArtifact.artifactId,
  ];
  const usage = request.actualUsage;
  if (
    identityFields.some((value) => value.trim().length === 0) ||
    request.resultArtifact.schemaVersion !== 1 ||
    !artifactRegistrationIsValid(request.resultArtifact) ||
    !/^[a-f0-9]{64}$/u.test(request.resultArtifact.contentHash) ||
    request.nativeUsageArtifact.schemaVersion !== 1 ||
    request.nativeUsageArtifact.kind !== "native_usage" ||
    !artifactRegistrationIsValid(request.nativeUsageArtifact) ||
    !/^[a-f0-9]{64}$/u.test(request.nativeUsageArtifact.contentHash) ||
    ![
      usage.calls,
      usage.inputTokens,
      usage.outputTokens,
      usage.costUsdMicros,
    ].every((value) => Number.isInteger(value) && value >= 0) ||
    Object.values(request.providerEvidence).some(
      (value) => value !== null && typeof value !== "string",
    ) ||
    Object.keys(request.providerEvidence).length !== 0
  ) {
    throw new TypeError("Completed command attempt evidence is invalid");
  }
  return execution.completeAttempt(request);
}
