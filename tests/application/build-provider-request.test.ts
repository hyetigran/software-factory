import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildProviderRequest } from "../../src/application/build-provider-request.js";
import type { PersistableCommand } from "../../src/application/authority-port.js";
import type { StartedCommandAttempt } from "../../src/application/execution-port.js";
import { canonicalJson } from "../../src/domain/canonical-json.js";
import { OpenAiResponsesAdapter } from "../../src/infrastructure/providers/openai.js";

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("buildProviderRequest", () => {
  it("constructs an alias-safe baseline request with exact prerequisite evidence", () => {
    const values = [
      ["prompt", Buffer.from("Review exactly")],
      ["schema", Buffer.from('{\n  "type": "object"\n}\n')],
      ["ledger", Buffer.from("ledger")],
      ["plan", Buffer.from("plan")],
      ["taxonomy", Buffer.from("taxonomy")],
      ["component", Buffer.from("component")],
      ["policy", Buffer.from("policy")],
      ["rendered", Buffer.from("rendered plan")],
    ] as const;
    const artifacts = values.map(([artifactId, bytes]) => ({
      artifactId,
      contentHash: hash(bytes),
      kind: "other",
      bytes,
    }));
    const contentHash = (artifactId: string) =>
      artifacts.find((artifact) => artifact.artifactId === artifactId)!
        .contentHash;
    const command = {
      commandId: "command_review",
      commandKey: "a".repeat(64),
      commandType: "baseline_review",
      schemaVersion: 1,
      runId: "run_1",
      triggeringStateVersion: 3,
      prerequisiteCommandIds: ["command_render"],
      purposeId: "review",
      inputArtifactHashes: [
        "prompt",
        "schema",
        "ledger",
        "plan",
        "taxonomy",
        "component",
        "policy",
      ].map(contentHash),
      policyHash: "b".repeat(64),
      provider: "anthropic",
      modelId: "model-pinned",
      budgetReservation: {
        calls: 1,
        inputTokens: 100,
        outputTokens: 20,
        costUsdMicros: 100,
      },
      providerRequestPolicy: {
        configurationArtifactId: "configuration",
        configurationContentHash: "c".repeat(64),
        policyHash: "b".repeat(64),
        role: "reviewer",
        promptArtifactId: "prompt",
        promptContentHash: contentHash("prompt"),
        outputSchemaArtifactId: "schema",
        outputSchemaContentHash: contentHash("schema"),
        maxOutputTokens: 20,
        timeoutMs: 1000,
        reasoning: null,
        providerStorage: "minimize",
      },
      payload: {
        ledgerVersionId: "ledger-v1",
        ledgerArtifactId: "ledger",
        planVersionId: "plan-v1",
        planArtifactId: "plan",
        renderPlanCommandId: "command_render",
        reviewerPromptArtifactId: "prompt",
        reviewSchemaArtifactId: "schema",
        taxonomyArtifactId: "taxonomy",
        componentRegistryArtifactId: "component",
        reviewPolicyArtifactId: "policy",
        evidenceArtifactIds: ["ledger", "plan", "taxonomy"],
        independence: { reduced: false },
        providerStorage: "minimize",
      },
    } satisfies PersistableCommand;
    const attempt = {
      status: "started",
      runId: "run_1",
      commandId: command.commandId,
      attemptId: "attempt_1",
      attemptNumber: 1,
      triggeringStateVersion: 3,
      correlationId: "correlation_1",
      reservation: command.budgetReservation,
      lease: {
        ownerProcess: "test",
        acquiredAt: "2026-08-19T00:00:00.000Z",
        heartbeatAt: "2026-08-19T00:00:00.000Z",
      },
      startedAt: "2026-08-19T00:00:00.000Z",
      attemptKind: "initial",
      resolvedPrerequisiteArtifacts: [
        {
          commandId: "command_render",
          attemptId: "attempt_render",
          artifactId: "rendered",
          contentHash: contentHash("rendered"),
        },
      ],
    } satisfies StartedCommandAttempt;

    const request = buildProviderRequest({ command, attempt, artifacts });

    expect(request.inputArtifacts.map(({ artifactId }) => artifactId)).toEqual([
      "ledger",
      "plan",
      "taxonomy",
      "component",
      "policy",
      "rendered",
    ]);
    expect(request.outputSchema).toEqual({ type: "object" });
    expect(request.outputSchemaContentHash).not.toBe(
      request.outputSchemaCanonicalHash,
    );
    expect(request.outputSchemaCanonicalHash).toBe(
      hash(Buffer.from(canonicalJson({ type: "object" }))),
    );
    expect(request.correlationId).toBe(attempt.correlationId);
    expect(() =>
      new OpenAiResponsesAdapter(
        { send: async () => Promise.reject(new Error("not dispatched")) },
        () => "credential",
        {
          resolve: () => ({
            canonicalModelId: command.modelId,
            structuredOutput: true,
            contextWindowTokens: 100_000,
            maxOutputTokens: 10_000,
          }),
          schemaSupported: () => true,
          countInputTokens: () => 100,
        },
      ).prepare({ ...request, provider: "openai", modelId: command.modelId }),
    ).not.toThrow();
  });

  it("rejects a same-hash alias substituted for a command-bound artifact", () => {
    const prompt = Buffer.from("prompt");
    const schema = Buffer.from('{"type":"object"}');
    const body = Buffer.from("same");
    const base = {
      commandId: "command_plan",
      commandKey: "a".repeat(64),
      commandType: "generate_plan",
      schemaVersion: 1,
      runId: "run_1",
      triggeringStateVersion: 1,
      purposeId: "plan",
      inputArtifactHashes: [hash(prompt), hash(schema), hash(body)],
      policyHash: "b".repeat(64),
      provider: "openai",
      modelId: "model",
      budgetReservation: {
        calls: 1,
        inputTokens: 1,
        outputTokens: 1,
        costUsdMicros: 1,
      },
      providerRequestPolicy: {
        configurationArtifactId: "config",
        configurationContentHash: "c".repeat(64),
        policyHash: "b".repeat(64),
        role: "planner",
        promptArtifactId: "prompt",
        promptContentHash: hash(prompt),
        outputSchemaArtifactId: "schema",
        outputSchemaContentHash: hash(schema),
        maxOutputTokens: 1,
        timeoutMs: 1,
        reasoning: null,
        providerStorage: "minimize",
      },
      payload: {
        ledgerVersionId: "v1",
        ledgerArtifactId: "ledger",
        promptArtifactId: "prompt",
        outputSchemaArtifactId: "schema",
        providerStorage: "minimize",
      },
    } satisfies PersistableCommand;
    const attempt = {
      status: "started",
      runId: "run_1",
      commandId: base.commandId,
      attemptId: "attempt",
      attemptNumber: 1,
      triggeringStateVersion: 1,
      correlationId: "correlation",
      reservation: base.budgetReservation,
      lease: { ownerProcess: "test", acquiredAt: "now", heartbeatAt: "now" },
      startedAt: "now",
      attemptKind: "initial",
      resolvedPrerequisiteArtifacts: [],
    } satisfies StartedCommandAttempt;
    expect(() =>
      buildProviderRequest({
        command: base,
        attempt,
        artifacts: [
          {
            artifactId: "prompt",
            contentHash: hash(prompt),
            kind: "prompt",
            bytes: prompt,
          },
          {
            artifactId: "schema",
            contentHash: hash(schema),
            kind: "schema",
            bytes: schema,
          },
          {
            artifactId: "ledger-alias",
            contentHash: hash(body),
            kind: "ledger",
            bytes: body,
          },
        ],
      }),
    ).toThrow(/ledger/u);
  });
});
