import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type {
  ArtifactRegistration,
  ArtifactStagingPort,
} from "../../src/application/artifact-port.js";
import type { StartedCommandAttempt } from "../../src/application/execution-port.js";
import { stageProviderExecution } from "../../src/application/stage-provider-execution.js";

const attempt: StartedCommandAttempt = {
  status: "started",
  runId: "run_1",
  commandId: "command_1",
  attemptId: "attempt_1",
  attemptNumber: 1,
  triggeringStateVersion: 1,
  correlationId: "correlation_1",
  reservation: {
    calls: 1,
    inputTokens: 100,
    outputTokens: 50,
    costUsdMicros: 999,
  },
  lease: {
    ownerProcess: "executor:1",
    acquiredAt: "2026-08-19T00:00:00.000Z",
    heartbeatAt: "2026-08-19T00:00:00.000Z",
  },
  startedAt: "2026-08-19T00:00:00.000Z",
  attemptKind: "initial",
  resolvedPrerequisiteArtifacts: [],
};

function staging(): ArtifactStagingPort {
  return {
    stageArtifact: (bytes, registration: ArtifactRegistration) =>
      Promise.resolve({
        ...registration,
        schemaVersion: 1,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength,
        stagedPath: `/tmp/${registration.artifactId}`,
      }),
  };
}

const evidence = {
  requestedModel: "model",
  returnedModel: "model",
  endpoint: "https://provider.example/v1",
  behaviorHeaders: {},
  providerResponseId: "response_1",
  correlationId: attempt.correlationId,
  completionStatus: "completed",
  preflight: {
    canonicalModelId: "model",
    structuredOutput: true as const,
    contextWindowTokens: 1000,
    maxOutputTokens: 100,
    inputTokens: 10,
  },
};

describe("stageProviderExecution", () => {
  it("stages a completed execution with exact lineage and conservative cost", async () => {
    const result = await stageProviderExecution({
      staging: staging(),
      attempt,
      requestArtifactId: "request_1",
      outputSchemaArtifactId: "schema_1",
      normalizedUsage: { inputTokens: 12, outputTokens: 7 },
      execution: {
        kind: "completed",
        structured: { ok: true },
        evidence,
        recording: {
          rawResponseBytes: Buffer.from('{"id":"response_1"}'),
          nativeUsageBytes: Buffer.from(
            '{"input_tokens":12,"output_tokens":7}',
          ),
        },
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        kind: "completed",
        actualUsage: {
          calls: 1,
          inputTokens: 12,
          outputTokens: 7,
          costUsdMicros: 999,
        },
      }),
    );
    if (result.kind !== "completed") throw new Error("expected completion");
    expect(result.outputArtifact.provenance).toEqual(
      expect.objectContaining({
        method: "application_generated",
        purpose: "structured_provider_output",
        sourceArtifactIds: [result.rawResponseArtifact.artifactId, "schema_1"],
      }),
    );
  });

  it("stages a no-response transport failure as deterministic evidence", async () => {
    const { returnedModel: _returnedModel, ...failureEvidence } = evidence;
    void _returnedModel;
    const result = await stageProviderExecution({
      staging: staging(),
      attempt,
      requestArtifactId: "request_1",
      outputSchemaArtifactId: "schema_1",
      execution: {
        kind: "transport_failure",
        retryable: true,
        evidence: failureEvidence,
        recording: {},
      },
    });
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") throw new Error("expected failure");
    expect(result.outcomeArtifact.kind).toBe("other");
    expect(result.outcomeArtifact.provenance).toEqual({
      method: "application_generated",
      purpose: "provider_failure_evidence",
      sourceArtifactIds: ["request_1"],
      commandId: attempt.commandId,
      attemptId: attempt.attemptId,
    });
  });

  it("stages replayed evidence with cassette lineage and zero accounting", async () => {
    const result = await stageProviderExecution({
      staging: staging(),
      attempt: {
        ...attempt,
        attemptKind: "strict_replay",
        reservation: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
        strictReplay: {
          recordingManifestArtifactId: "manifest_1",
          recordingManifestContentHash: "a".repeat(64),
        },
      },
      requestArtifactId: "request_1",
      outputSchemaArtifactId: "schema_1",
      execution: {
        kind: "completed",
        structured: { ok: true },
        evidence,
        recording: {
          rawResponseBytes: Buffer.from('{"id":"response_1"}'),
          nativeUsageBytes: Buffer.from(
            '{"input_tokens":12,"output_tokens":7}',
          ),
        },
      },
    });
    if (result.kind !== "completed") throw new Error("expected completion");
    expect(result.actualUsage).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicros: 0,
    });
    expect(result.rawResponseArtifact.provenance).toEqual({
      method: "application_generated",
      purpose: "replayed_provider_evidence",
      sourceArtifactIds: ["request_1", "manifest_1"],
      commandId: attempt.commandId,
      attemptId: attempt.attemptId,
    });
  });

  it("preserves the complete normalized failure when no raw response exists", async () => {
    const { returnedModel: _returnedModel, ...failureEvidence } = evidence;
    void _returnedModel;
    const staged: Uint8Array[] = [];
    const result = await stageProviderExecution({
      staging: {
        stageArtifact: (bytes, registration) => {
          staged.push(Buffer.from(bytes));
          return staging().stageArtifact(bytes, registration);
        },
      },
      attempt,
      requestArtifactId: "request_1",
      outputSchemaArtifactId: "schema_1",
      execution: {
        kind: "transport_failure",
        retryable: false,
        evidence: failureEvidence,
        recording: {},
      },
    });
    expect(result.kind).toBe("failed");
    expect(JSON.parse(Buffer.from(staged[0] ?? []).toString("utf8"))).toEqual(
      expect.objectContaining({
        kind: "transport_failure",
        retryable: false,
      }),
    );
  });
});
