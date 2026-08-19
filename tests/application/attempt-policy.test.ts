import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decideAttemptPolicy } from "../../src/application/attempt-policy.js";
import { ExecutionPolicy } from "../../src/application/execution-port.js";
import type { ResolvedConfigurationSnapshot } from "../../src/application/stage-configuration.js";
import { canonicalJson } from "../../src/domain/canonical-json.js";

const configuration: ResolvedConfigurationSnapshot = {
  schemaVersion: 1,
  policyHash: "a".repeat(64),
  plannerAssignment: { provider: "openai", modelId: "planner" },
  reviewerAssignment: { provider: "anthropic", modelId: "reviewer" },
  artifactHashes: {
    requirementsSchema: "1".repeat(64),
    artifactSchema: "2".repeat(64),
    planSchema: "3".repeat(64),
    reviewSchema: "4".repeat(64),
    taxonomy: "5".repeat(64),
    componentRegistry: "6".repeat(64),
    plannerPrompt: "7".repeat(64),
    reviewerPrompt: "8".repeat(64),
    reviewPolicy: "9".repeat(64),
  },
  hardCeilings: {
    calls: 4,
    physicalAttempts: 5,
    inputTokens: 10_000,
    outputTokens: 10_000,
    costUsdMicros: 1_000_000,
    retries: 1,
    repairs: 1,
    remediationCycles: 1,
    closureCycles: 1,
  },
  credentialReferences: {
    openai: { kind: "environment", reference: "OPENAI_API_KEY" },
    anthropic: { kind: "environment", reference: "ANTHROPIC_API_KEY" },
  },
};
const policy = ExecutionPolicy.fromConfiguration({
  configuration,
  runId: "run_1",
  configurationArtifactId: "configuration_1",
  expectedContentHash: createHash("sha256")
    .update(canonicalJson(configuration))
    .digest("hex"),
});
const reservation = {
  calls: 1,
  inputTokens: 100,
  outputTokens: 100,
  costUsdMicros: 1_000,
};
const baseRequest = {
  runId: "run_1",
  commandId: "command_1",
  attemptId: "attempt_2",
  correlationId: "correlation_1",
  ownerProcess: "pid:1",
  configurationArtifactId: "configuration_1",
  policy,
} as const;
const baseSnapshot = {
  logicalStatus: "unknown",
  acceptedAttemptId: null,
  triggeringStateVersion: 2,
  currentStateVersion: 2,
  commandType: "generate_plan",
  commandReservation: reservation,
  priorAttempts: 1,
  runAttempts: 1,
  humanRerunAuthorized: false,
  strictReplayVerified: false,
};

describe("attempt recovery policy", () => {
  it("requires the same correlation key and emits duplicate-call intent for unknown retry", () => {
    const snapshot = {
      ...baseSnapshot,
      lastAttempt: {
        attemptId: "attempt_1",
        status: "unknown",
        failureClass: null,
        correlationId: "correlation_1",
      },
    };
    expect(
      decideAttemptPolicy(
        { ...baseRequest, attemptKind: "transport_retry" },
        snapshot,
        policy,
      ),
    ).toMatchObject({
      duplicateCallPossible: true,
      priorAttemptId: "attempt_1",
    });
    expect(() =>
      decideAttemptPolicy(
        {
          ...baseRequest,
          attemptKind: "transport_retry",
          correlationId: "different",
        },
        snapshot,
        policy,
      ),
    ).toThrow("not eligible");
  });

  it("rejects non-retryable failures and permits authorized stale reruns", () => {
    expect(() =>
      decideAttemptPolicy(
        { ...baseRequest, attemptKind: "transport_retry" },
        {
          ...baseSnapshot,
          logicalStatus: "failed",
          lastAttempt: {
            attemptId: "attempt_1",
            status: "failed",
            failureClass: "transport_nonretryable",
            correlationId: "correlation_1",
          },
        },
        policy,
      ),
    ).toThrow("not eligible");
    expect(
      decideAttemptPolicy(
        {
          ...baseRequest,
          attemptKind: "human_rerun",
          humanAuthorizationId: "decision_1",
        },
        {
          ...baseSnapshot,
          logicalStatus: "succeeded",
          acceptedAttemptId: "attempt_1",
          currentStateVersion: 3,
          humanRerunAuthorized: true,
        },
        policy,
      ).reservation,
    ).toEqual(reservation);
  });

  it("returns an accepted-result no-op even after state advancement", () => {
    expect(
      decideAttemptPolicy(
        { ...baseRequest, attemptKind: "initial" },
        {
          ...baseSnapshot,
          logicalStatus: "succeeded",
          acceptedAttemptId: "attempt_accepted",
          currentStateVersion: 99,
        },
        policy,
      ),
    ).toMatchObject({ noOpAcceptedAttemptId: "attempt_accepted" });
  });
});
