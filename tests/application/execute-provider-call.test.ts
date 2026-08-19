import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { executeProviderCall } from "../../src/application/execute-provider-call.js";
import type { ArtifactRegistration } from "../../src/application/artifact-port.js";
import type { ProviderAdapter } from "../../src/application/provider-port.js";

describe("executeProviderCall", () => {
  it("registers the exact redacted request before dispatch", async () => {
    const events: string[] = [];
    const requestBytes = Buffer.from('{"redacted":true}');
    const requestHash = createHash("sha256").update(requestBytes).digest("hex");
    const adapter: ProviderAdapter = {
      prepare: vi.fn(() => ({
        redactedRequestBytes: requestBytes,
        normalizedRequestHash: requestHash,
        identity: {
          endpoint: "https://provider.invalid",
          behaviorHeaders: {},
          preflight: {
            canonicalModelId: "model-pinned",
            structuredOutput: true as const,
            contextWindowTokens: 10_000,
            maxOutputTokens: 1_000,
            inputTokens: 100,
          },
        },
        dispatch: vi.fn(() => {
          events.push("dispatch");
          return Promise.resolve({
            kind: "completed" as const,
            structured: { ok: true },
            evidence: {
              requestedModel: "model-pinned",
              returnedModel: "model-pinned",
              endpoint: "https://provider.invalid",
              behaviorHeaders: {},
              providerResponseId: "response_1",
              correlationId: "correlation_1",
              preflight: {
                canonicalModelId: "model-pinned",
                structuredOutput: true as const,
                contextWindowTokens: 10_000,
                maxOutputTokens: 1_000,
                inputTokens: 100,
              },
            },
            recording: {
              rawResponseBytes: Buffer.from("response"),
              nativeUsageBytes: Buffer.from("usage"),
            },
          });
        }),
      })),
    };
    const descriptor = {
      schemaVersion: 1 as const,
      artifactId: "provider_request_1",
      kind: "provider_request" as const,
      contentHash: requestHash,
      byteLength: requestBytes.length,
      mediaType: "application/json",
      schemaId: "provider-request-recording.v1",
      createdBy: "executor",
      provenance: {
        method: "provider_generated" as const,
        sourceArtifactIds: ["ledger_1"],
        commandId: "command_1",
        attemptId: "attempt_1",
      },
    };
    const stageArtifact = vi.fn(
      (stagedBytes: Uint8Array, registration: ArtifactRegistration) => {
        expect(stagedBytes).toEqual(requestBytes);
        expect(registration.artifactId).toBe("provider_request_1");
        events.push("stage");
        return Promise.resolve(descriptor);
      },
    );
    const registerArtifact = vi.fn(() => {
      events.push("register");
      return Promise.resolve();
    });

    const result = await executeProviderCall({
      adapter,
      artifactStaging: { stageArtifact },
      artifactRegistration: { registerArtifact },
      providerRequest: {
        provider: "openai",
        role: "planner",
        modelId: "model-pinned",
        logicalCommandKey: "a".repeat(64),
        correlationId: "correlation_1",
        systemPrompt: "plan",
        inputArtifacts: [
          { kind: "ledger", content: "{}", contentHash: "b".repeat(64) },
        ],
        outputSchema: {},
        maxOutputTokens: 1_000,
        timeoutMs: 10_000,
        providerStorage: "minimize",
      },
      requestArtifactId: "provider_request_1",
      commandId: "command_1",
      attemptId: "attempt_1",
      inputArtifactIds: ["ledger_1"],
      createdBy: "executor",
    });

    expect(events).toEqual(["stage", "register", "dispatch"]);
    expect(stageArtifact.mock.calls[0]?.[0]).toEqual(requestBytes);
    expect(registerArtifact).toHaveBeenCalledWith(descriptor);
    expect(result.requestArtifact).toEqual(descriptor);
    expect(result.execution.kind).toBe("completed");
  });

  it("never dispatches when durable registration fails", async () => {
    const dispatch = vi.fn();
    const bytes = Buffer.from("request");
    const hash = createHash("sha256").update(bytes).digest("hex");
    await expect(
      executeProviderCall({
        adapter: {
          prepare: () => ({
            redactedRequestBytes: bytes,
            normalizedRequestHash: hash,
            identity: {
              endpoint: "endpoint",
              behaviorHeaders: {},
              preflight: {
                canonicalModelId: "model",
                structuredOutput: true,
                contextWindowTokens: 2,
                maxOutputTokens: 1,
                inputTokens: 1,
              },
            },
            dispatch,
          }),
        },
        artifactStaging: {
          stageArtifact: (_bytes, registration) =>
            Promise.resolve({
              ...registration,
              schemaVersion: 1,
              contentHash: hash,
              byteLength: bytes.length,
            }),
        },
        artifactRegistration: {
          registerArtifact: () =>
            Promise.reject(new Error("database unavailable")),
        },
        providerRequest: {} as never,
        requestArtifactId: "provider_request_1",
        commandId: "command_1",
        attemptId: "attempt_1",
        inputArtifactIds: ["ledger_1"],
        createdBy: "executor",
      }),
    ).rejects.toThrow("database unavailable");
    expect(dispatch).not.toHaveBeenCalled();
  });
});
