import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  beginEligibleCommandAttempt,
  completeCommandAttempt,
  ExecutionPolicy,
  StrictReplayEvidence,
} from "../../src/application/execution-port.js";
import { canonicalJson } from "../../src/domain/canonical-json.js";
import type { ResolvedConfigurationSnapshot } from "../../src/application/stage-configuration.js";

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
    calls: 8,
    physicalAttempts: 12,
    inputTokens: 100_000,
    outputTokens: 50_000,
    costUsdMicros: 100_000_000,
    retries: 2,
    repairs: 1,
    remediationCycles: 3,
    closureCycles: 2,
  },
  credentialReferences: {
    openai: { kind: "environment", reference: "OPENAI_API_KEY" },
    anthropic: { kind: "environment", reference: "ANTHROPIC_API_KEY" },
  },
};

describe("execution policy and attempt boundary", () => {
  it("binds hard ceilings to the immutable resolved configuration", async () => {
    const expectedContentHash = createHash("sha256")
      .update(canonicalJson(configuration))
      .digest("hex");
    const policy = ExecutionPolicy.fromConfiguration({
      configuration,
      runId: "run_1",
      configurationArtifactId: "artifact_configuration",
      expectedContentHash,
    });
    const beginAttempt = vi.fn().mockResolvedValue({
      status: "started",
      runId: "run_1",
      commandId: "command_1",
      attemptId: "attempt_1",
      attemptNumber: 1,
      triggeringStateVersion: 2,
      correlationId: "correlation_1",
      reservation: {
        calls: 1,
        inputTokens: 100,
        outputTokens: 100,
        costUsdMicros: 1_000,
      },
      lease: {
        ownerProcess: "pid:1",
        acquiredAt: "2026-08-19T00:00:00.000Z",
        heartbeatAt: "2026-08-19T00:00:00.000Z",
      },
      startedAt: "2026-08-19T00:00:00.000Z",
      resolvedPrerequisiteArtifacts: [],
    });

    await expect(
      beginEligibleCommandAttempt(
        { beginAttempt, completeAttempt: vi.fn() },
        {
          runId: "run_1",
          commandId: "command_1",
          attemptId: "attempt_1",
          correlationId: "correlation_1",
          ownerProcess: "pid:1",
          configurationArtifactId: "artifact_configuration",
          policy,
          attemptKind: "initial",
        },
      ),
    ).resolves.toMatchObject({ attemptNumber: 1 });
    expect(beginAttempt).toHaveBeenCalledOnce();
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.configuration)).toBe(true);
    expect(Object.isFrozen(policy.configuration.hardCeilings)).toBe(true);
    expect(() => {
      (policy.configuration.hardCeilings as { calls: number }).calls = 99;
    }).toThrow();
    expect(() =>
      beginEligibleCommandAttempt(
        { beginAttempt, completeAttempt: vi.fn() },
        {
          runId: "run_other",
          commandId: "command_1",
          attemptId: "attempt_2",
          correlationId: "correlation_2",
          ownerProcess: "pid:1",
          configurationArtifactId: "artifact_configuration",
          policy,
          attemptKind: "initial",
        },
      ),
    ).toThrow("identity and execution policy");
  });

  it("rejects a configuration hash mismatch", () => {
    expect(() =>
      ExecutionPolicy.fromConfiguration({
        configuration,
        runId: "run_1",
        configurationArtifactId: "artifact_configuration",
        expectedContentHash: "f".repeat(64),
      }),
    ).toThrow("hash does not match");
  });

  it("submits a verified physical result through the execution boundary", async () => {
    const completeAttempt = vi.fn().mockResolvedValue({
      status: "completed",
      runId: "run_1",
      commandId: "command_1",
      attemptId: "attempt_1",
      acceptedAsLogicalResult: true,
    });

    await expect(
      completeCommandAttempt(
        { beginAttempt: vi.fn(), completeAttempt },
        {
          runId: "run_1",
          commandId: "command_1",
          attemptId: "attempt_1",
          ownerProcess: "pid:1",
          correlationId: "correlation_1",
          resultArtifact: {
            schemaVersion: 1,
            artifactId: "artifact_result",
            kind: "provider_response",
            contentHash: "a".repeat(64),
            byteLength: 1,
            mediaType: "application/json",
            createdBy: "system:test",
            provenance: {
              method: "provider_generated",
              sourceArtifactIds: ["artifact_source"],
              commandId: "command_1",
              attemptId: "attempt_1",
            },
          },
          nativeUsageArtifact: {
            schemaVersion: 1,
            artifactId: "artifact_usage",
            kind: "native_usage",
            contentHash: "b".repeat(64),
            byteLength: 1,
            mediaType: "application/json",
            createdBy: "system:test",
            provenance: {
              method: "provider_generated",
              sourceArtifactIds: ["artifact_source"],
              commandId: "command_1",
              attemptId: "attempt_1",
            },
          },
          actualUsage: {
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsdMicros: 0,
          },
          providerEvidence: {},
        },
      ),
    ).resolves.toMatchObject({ acceptedAsLogicalResult: true });
    expect(completeAttempt).toHaveBeenCalledOnce();
  });

  it("mints replay evidence only from an exact matching recording manifest", () => {
    const cassetteKey = "b".repeat(64);
    const normalizedRequestHash = "c".repeat(64);
    const commandKey = "d".repeat(64);
    const bytes = Buffer.from(
      canonicalJson({
        schemaVersion: 1,
        cassetteKey,
        normalizedRequestHash,
        commandKey,
        responseArtifactId: "artifact_response",
        responseContentHash: "e".repeat(64),
      }),
    );
    expect(
      StrictReplayEvidence.fromManifest({
        recordingManifestArtifactId: "artifact_recording_manifest",
        recordingManifestBytes: bytes,
        expectedCassetteKey: cassetteKey,
        expectedNormalizedRequestHash: normalizedRequestHash,
        expectedCommandKey: commandKey,
      }),
    ).toMatchObject({ responseArtifactId: "artifact_response" });
    expect(() =>
      StrictReplayEvidence.fromManifest({
        recordingManifestArtifactId: "artifact_recording_manifest",
        recordingManifestBytes: bytes,
        expectedCassetteKey: "f".repeat(64),
        expectedNormalizedRequestHash: normalizedRequestHash,
        expectedCommandKey: commandKey,
      }),
    ).toThrow("does not match");
  });
});
