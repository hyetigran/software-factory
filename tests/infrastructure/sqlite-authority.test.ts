import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  AuthorityTransaction,
  PersistableTransition,
} from "../../src/application/authority-port.js";
import { ValidatedProjection } from "../../src/application/authority-port.js";
import { commitTransition } from "../../src/application/commit-transition.js";
import { renderSourceRegistrationReport } from "../../src/application/deterministic-documents.js";
import { completeProviderFailure } from "../../src/application/complete-provider-failure.js";
import { OpenAiResponsesAdapter } from "../../src/infrastructure/providers/openai.js";
import type { ProviderPreflight } from "../../src/infrastructure/providers/transport.js";
import {
  ExecutionPolicy,
  type BeginAttemptRequest,
} from "../../src/application/execution-port.js";
import type { ResolvedConfigurationSnapshot } from "../../src/application/stage-configuration.js";
import { canonicalJson } from "../../src/domain/canonical-json.js";
import {
  transition,
  type LedgerSubmitted,
  type NonterminalRunState,
  type RunStarted,
} from "../../src/domain/index.js";
import { ContentAddressedArtifactStore } from "../../src/infrastructure/artifacts/object-store.js";
import {
  AuthorityIntegrityError,
  SqliteAuthority,
  StaleStateError,
} from "../../src/infrastructure/sqlite/authority.js";

type TestState = Record<string, unknown> & {
  runId: string;
  stateVersion: number;
  state: "draft" | "halted";
  sourceArtifactId: string;
  sourceContentHash: string;
  configurationArtifactId: string;
  configurationContentHash: string;
  policyHash: string;
  policyLocked: boolean;
};

const directories: string[] = [];
const requirementsLedgerSchema = JSON.parse(
  readFileSync(resolve("schemas/requirements-ledger.v1.schema.json"), "utf8"),
) as unknown;
const planSchema = JSON.parse(
  readFileSync(resolve("schemas/plan.v1.schema.json"), "utf8"),
) as unknown;
const reviewSchema = JSON.parse(
  readFileSync(resolve("schemas/review.v1.schema.json"), "utf8"),
) as unknown;

const executionConfiguration: ResolvedConfigurationSnapshot = {
  schemaVersion: 1,
  policyHash: "a".repeat(64),
  plannerAssignment: { provider: "openai", modelId: "planner" },
  reviewerAssignment: { provider: "anthropic", modelId: "reviewer" },
  artifactHashes: {
    projectConfigurationSchema: "0".repeat(64),
    resolvedConfigurationSchema: "0".repeat(64),
    providerSettingsDefaults: "0".repeat(64),
    runConfigurationSchema: "0".repeat(64),
    requirementsSchema: "1".repeat(64),
    artifactSchema: "2".repeat(64),
    planSchema: createHash("sha256").update("{}").digest("hex"),
    reviewSchema: "4".repeat(64),
    terminalManifestSchema: "0".repeat(64),
    taxonomy: "5".repeat(64),
    componentRegistry: "6".repeat(64),
    plannerPrompt: createHash("sha256").update("plan").digest("hex"),
    reviewerPrompt: "8".repeat(64),
    remediationPrompt: "a".repeat(64),
    remediationSchema: "b".repeat(64),
    schemaRepairPrompt: createHash("sha256").update("repair").digest("hex"),
    reviewPolicy: "9".repeat(64),
    frontierAllowlist: "0".repeat(64),
    budgetDefaults: "0".repeat(64),
    productDefaults: "0".repeat(64),
  },
  providerRequestSettings: {
    planner: { timeoutMs: 1_000, reasoning: null },
    reviewer: { timeoutMs: 30_000, reasoning: null },
    remediation: { timeoutMs: 30_000, reasoning: null },
    schemaRepair: { timeoutMs: 30_000, reasoning: null },
  },
  recordingMode: "record",
  humanActorDisplayName: "Test User",
  providerStorage: "minimize",
  budgetAcceptanceRequired: false,
  hardCeilings: {
    calls: 4,
    physicalAttempts: 4,
    inputTokens: 10_000,
    outputTokens: 10_000,
    costUsdMicros: 1_000_000,
    retries: 1,
    repairs: 2,
    remediationCycles: 1,
    closureCycles: 1,
  },
  credentialReferences: {
    openai: { kind: "environment", reference: "OPENAI_API_KEY" },
    anthropic: { kind: "environment", reference: "ANTHROPIC_API_KEY" },
  },
};
const executionConfigurationHash = createHash("sha256")
  .update(canonicalJson(executionConfiguration))
  .digest("hex");

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "factory-sqlite-test-"));
  directories.push(directory);
  return join(directory, ".factory", "factory.sqlite3");
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function openAuthority(
  path: string,
  options: { now?: () => string } = {},
): Promise<SqliteAuthority> {
  const store = await ContentAddressedArtifactStore.open(
    resolve(path, "../.."),
  );
  const authority = SqliteAuthority.open(path, {
    ...options,
    artifactStore: store,
  });
  for (const [artifactId, kind, bytes] of [
    ["artifact_source", "raw_requirements", Buffer.from("source")],
    [
      "artifact_configuration",
      "other",
      Buffer.from(canonicalJson(executionConfiguration)),
    ],
    ["artifact_prompt", "other", Buffer.from("plan")],
    ["artifact_schema", "other", Buffer.from("{}")],
  ] as const) {
    const descriptor = await store.stageArtifact(bytes, {
      artifactId,
      kind,
      mediaType: "application/octet-stream",
      createdBy: "system:test",
      provenance: { method: "human_submitted" },
    });
    await authority.registerArtifact(descriptor);
  }
  return authority;
}

function transitionResult(
  runId: string,
  stateVersion: number,
  commandId = `command_${stateVersion}`,
  forcedCommandKey?: string,
): PersistableTransition<TestState> {
  const commandWithoutIdentity = {
    commandType: "render_source_registration_report",
    schemaVersion: 1,
    runId,
    triggeringStateVersion: stateVersion,
    purposeId: `purpose_${stateVersion}`,
    inputArtifactHashes: [
      createHash("sha256").update("source").digest("hex"),
      executionConfigurationHash,
    ],
    policyHash: "a".repeat(64),
    provider: "local" as const,
    budgetReservation: {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicros: 0,
    },
    payload: {
      sourceArtifactId: "artifact_source",
      configurationArtifactId: "artifact_configuration",
    },
  };
  const commandKey =
    forcedCommandKey ??
    createHash("sha256")
      .update(canonicalJson(commandWithoutIdentity))
      .digest("hex");
  return {
    nextState: {
      runId,
      stateVersion,
      state: "draft",
      sourceArtifactId: "artifact_source",
      sourceContentHash: createHash("sha256").update("source").digest("hex"),
      configurationArtifactId: "artifact_configuration",
      configurationContentHash: executionConfigurationHash,
      policyHash: "a".repeat(64),
      policyLocked: false,
    },
    commands: [{ commandId, commandKey, ...commandWithoutIdentity }],
    auditFacts: [
      {
        type: "command_planned",
        actor: { kind: "system", component: "test", version: "1" },
        reason: "exercise atomic authority",
        evidence: [],
        payload: { commandId, commandKey },
      },
    ],
  };
}

function providerTransitionResult(
  runId: string,
  stateVersion: number,
): PersistableTransition<TestState> {
  const inputHash = createHash("sha256").update("source").digest("hex");
  const promptHash = createHash("sha256").update("plan").digest("hex");
  const schemaHash = createHash("sha256").update("{}").digest("hex");
  const commandWithoutIdentity = {
    commandType: "generate_plan",
    schemaVersion: 1,
    runId,
    triggeringStateVersion: stateVersion,
    purposeId: "planning",
    inputArtifactHashes: [inputHash, promptHash, schemaHash],
    policyHash: "a".repeat(64),
    provider: "openai" as const,
    modelId: "planner",
    budgetReservation: {
      calls: 1,
      inputTokens: 100,
      outputTokens: 100,
      costUsdMicros: 100,
    },
    providerRequestPolicy: {
      configurationArtifactId: "artifact_configuration",
      configurationContentHash: executionConfigurationHash,
      policyHash: "a".repeat(64),
      role: "planner" as const,
      promptArtifactId: "artifact_prompt",
      promptContentHash: promptHash,
      outputSchemaArtifactId: "artifact_schema",
      outputSchemaContentHash: schemaHash,
      maxOutputTokens: 100,
      timeoutMs: 1_000,
      reasoning: null,
      providerStorage: "minimize" as const,
    },
    payload: {
      ledgerVersionId: "ledger_1",
      ledgerArtifactId: "artifact_source",
      promptArtifactId: "artifact_prompt",
      outputSchemaArtifactId: "artifact_schema",
      providerStorage: "minimize" as const,
    },
  };
  const commandKey = createHash("sha256")
    .update(canonicalJson(commandWithoutIdentity))
    .digest("hex");
  return {
    ...transitionResult(runId, stateVersion),
    commands: [
      {
        commandId: "command_provider",
        commandKey,
        ...commandWithoutIdentity,
      },
    ],
  };
}

describe("SQLite authority", () => {
  it("binds a recorded provider request to the active leased attempt", async () => {
    const path = await databasePath();
    const authority = await openAuthority(path);
    await commitTransition<TestState>(authority, {
      runId: "run_provider_request",
      expectedStateVersion: 0,
      transition: () => providerTransitionResult("run_provider_request", 1),
    });
    const policy = ExecutionPolicy.fromConfiguration({
      runId: "run_provider_request",
      configurationArtifactId: "artifact_configuration",
      configuration: executionConfiguration,
      expectedContentHash: executionConfigurationHash,
    });
    const attempt = await authority.beginAttempt({
      runId: "run_provider_request",
      commandId: "command_provider",
      attemptId: "attempt_provider_1",
      correlationId: "correlation_provider_1",
      ownerProcess: "pid:provider",
      configurationArtifactId: "artifact_configuration",
      policy,
      attemptKind: "initial",
    });
    expect(attempt.status).toBe("started");
    if (attempt.status !== "started") throw new Error("attempt must start");
    const store = await ContentAddressedArtifactStore.open(
      resolve(path, "../.."),
    );
    const requestBytes = Buffer.from('{"request":"redacted"}');
    const requestArtifact = await store.stageArtifact(requestBytes, {
      artifactId: "artifact_provider_request",
      kind: "provider_request",
      mediaType: "application/json",
      schemaId: "provider-request-recording.v1",
      createdBy: "pid:provider",
      provenance: {
        method: "application_generated",
        purpose: "provider_request",
        sourceArtifactIds: [
          "artifact_prompt",
          "artifact_schema",
          "artifact_source",
        ],
        commandId: "command_provider",
        attemptId: "attempt_provider_1",
      },
    });
    const command = authority
      .listCommands("run_provider_request")
      .find(({ commandId }) => commandId === "command_provider");
    expect(command).toBeDefined();
    const providerRequest = {
      provider: "openai" as const,
      role: "planner" as const,
      modelId: "planner",
      logicalCommandKey: command?.commandKey ?? "",
      correlationId: "correlation_provider_1",
      systemPromptArtifactId: "artifact_prompt",
      systemPromptContentHash: createHash("sha256")
        .update("plan")
        .digest("hex"),
      systemPrompt: "plan",
      inputArtifacts: [
        {
          artifactId: "artifact_source",
          kind: "raw_requirements",
          content: "source",
          contentHash: createHash("sha256").update("source").digest("hex"),
        },
      ],
      outputSchema: {},
      outputSchemaArtifactId: "artifact_schema",
      outputSchemaContentHash: createHash("sha256").update("{}").digest("hex"),
      maxOutputTokens: 100,
      timeoutMs: 1_000,
      providerStorage: "minimize" as const,
    };

    await expect(
      authority.registerPreparedProviderRequest({
        attempt,
        providerRequest,
        normalizedRequestHash: requestArtifact.contentHash,
        artifact: requestArtifact,
      }),
    ).resolves.toBe("claimed");
    await expect(
      authority.registerPreparedProviderRequest({
        attempt,
        providerRequest: {
          ...providerRequest,
          logicalCommandKey: "f".repeat(64),
        },
        normalizedRequestHash: requestArtifact.contentHash,
        artifact: requestArtifact,
      }),
    ).rejects.toThrow("not bound to the active command attempt");
    for (const override of [
      { timeoutMs: 999 },
      { maxOutputTokens: 99 },
      { reasoning: "high" },
    ]) {
      await expect(
        authority.registerPreparedProviderRequest({
          attempt,
          providerRequest: { ...providerRequest, ...override },
          normalizedRequestHash: requestArtifact.contentHash,
          artifact: requestArtifact,
        }),
      ).rejects.toThrow("not bound to the active command attempt");
    }

    const repairPrompt = await store.stageArtifact(Buffer.from("repair"), {
      artifactId: "artifact_repair_prompt",
      kind: "other",
      mediaType: "text/plain",
      createdBy: "system:test",
      provenance: {
        method: "human_submitted",
      },
    });
    const invalidResponse = await store.stageArtifact(Buffer.from("invalid"), {
      artifactId: "artifact_invalid_response",
      kind: "provider_response",
      mediaType: "application/json",
      createdBy: "pid:provider",
      provenance: {
        method: "provider_generated",
        sourceArtifactIds: ["artifact_source"],
        commandId: "command_provider",
        attemptId: "attempt_provider_1",
      },
    });
    await authority.registerArtifact(repairPrompt);
    await authority.registerArtifact(invalidResponse);
    const database = (authority as unknown as { database: DatabaseSync })
      .database;
    database
      .prepare(
        `UPDATE command_attempts
            SET status = 'failed', failure_class = 'schema_invalid',
                result_artifact_id = ?
          WHERE attempt_id = ?`,
      )
      .run(invalidResponse.artifactId, attempt.attemptId);
    database
      .prepare(
        "UPDATE logical_commands SET status = 'failed' WHERE command_id = ?",
      )
      .run(attempt.commandId);
    database.prepare("DELETE FROM mutation_lease WHERE singleton = 1").run();

    const repairAttemptRequest = {
      runId: "run_provider_request",
      commandId: "command_provider",
      attemptId: "attempt_provider_2",
      correlationId: "correlation_provider_1",
      ownerProcess: "pid:provider",
      configurationArtifactId: "artifact_configuration",
      policy,
      attemptKind: "schema_repair",
      schemaRepair: {
        promptArtifactId: repairPrompt.artifactId,
        promptContentHash: repairPrompt.contentHash,
        outputSchemaArtifactId: "artifact_schema",
        outputSchemaContentHash: providerRequest.outputSchemaContentHash,
        invalidResponseArtifactId: invalidResponse.artifactId,
        invalidResponseContentHash: invalidResponse.contentHash,
      },
    } as const;
    await expect(
      authority.beginAttempt({
        ...repairAttemptRequest,
        schemaRepair: {
          ...repairAttemptRequest.schemaRepair,
          unexpected: "metadata",
        },
      } as unknown as BeginAttemptRequest),
    ).rejects.toThrow("Schema repair policy is invalid");
    const repairAttempt = await authority.beginAttempt(repairAttemptRequest);
    expect(repairAttempt.status).toBe("started");
    if (repairAttempt.status !== "started") {
      throw new Error("repair attempt must start");
    }
    const repairRequest = {
      ...providerRequest,
      role: "schema_repair" as const,
      systemPromptArtifactId: repairPrompt.artifactId,
      systemPromptContentHash: repairPrompt.contentHash,
      systemPrompt: "repair",
      inputArtifacts: [
        ...providerRequest.inputArtifacts,
        {
          artifactId: invalidResponse.artifactId,
          kind: "invalid_response",
          content: "invalid",
          contentHash: invalidResponse.contentHash,
        },
      ],
      timeoutMs:
        executionConfiguration.providerRequestSettings.schemaRepair.timeoutMs,
    };
    const providerPreflight: ProviderPreflight = {
      resolve: () => ({
        canonicalModelId: "planner",
        structuredOutput: true,
        contextWindowTokens: 100_000,
        maxOutputTokens: 10_000,
      }),
      schemaSupported: () => true,
      countInputTokens: () => 10,
    };
    const failedRawBytes = Buffer.from(
      canonicalJson({
        id: "response_invalid",
        model: "planner",
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "not-json" }],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    );
    const adapter = new OpenAiResponsesAdapter(
      {
        send: () =>
          Promise.resolve({
            status: 200,
            headers: { "x-request-id": "request_invalid" },
            body: failedRawBytes,
          }),
      },
      () => "secret",
      providerPreflight,
    );
    const preparedRepair = adapter.prepare(repairRequest);
    const repairRequestArtifact = await store.stageArtifact(
      preparedRepair.redactedRequestBytes,
      {
        artifactId: "artifact_provider_repair_request",
        kind: "provider_request",
        mediaType: "application/json",
        schemaId: "provider-request-recording.v1",
        createdBy: "pid:provider",
        provenance: {
          method: "application_generated",
          purpose: "provider_request",
          sourceArtifactIds: [
            repairPrompt.artifactId,
            "artifact_schema",
            "artifact_source",
            invalidResponse.artifactId,
          ],
          commandId: "command_provider",
          attemptId: repairAttempt.attemptId,
        },
      },
    );
    const invalidResponseAliasId = "artifact_invalid_response_alias";
    const aliasedRepairArtifact = await store.stageArtifact(
      Buffer.from('{"request":"repair-alias"}'),
      {
        artifactId: "artifact_provider_repair_request_alias",
        kind: "provider_request",
        mediaType: "application/json",
        schemaId: "provider-request-recording.v1",
        createdBy: "pid:provider",
        provenance: {
          method: "application_generated",
          purpose: "provider_request",
          sourceArtifactIds: [
            repairPrompt.artifactId,
            "artifact_schema",
            "artifact_source",
            invalidResponseAliasId,
          ],
          commandId: "command_provider",
          attemptId: repairAttempt.attemptId,
        },
      },
    );
    await expect(
      authority.registerPreparedProviderRequest({
        attempt: repairAttempt,
        providerRequest: {
          ...repairRequest,
          inputArtifacts: [
            ...providerRequest.inputArtifacts,
            {
              artifactId: invalidResponseAliasId,
              kind: "invalid_response",
              content: "invalid",
              contentHash: invalidResponse.contentHash,
            },
          ],
        },
        normalizedRequestHash: aliasedRepairArtifact.contentHash,
        artifact: aliasedRepairArtifact,
      }),
    ).rejects.toThrow("does not contain the failed response");
    await expect(
      authority.registerPreparedProviderRequest({
        attempt: repairAttempt,
        providerRequest: repairRequest,
        normalizedRequestHash: repairRequestArtifact.contentHash,
        artifact: repairRequestArtifact,
      }),
    ).resolves.toBe("claimed");

    const repairExecution = await preparedRepair.dispatch();
    expect(repairExecution.kind).toBe("schema_invalid");
    if (repairExecution.kind !== "schema_invalid") {
      throw new Error("repair execution must be schema-invalid");
    }
    const failedResponse = await store.stageArtifact(
      repairExecution.recording.rawResponseBytes ?? new Uint8Array(),
      {
        artifactId: "artifact_repair_failed_response",
        kind: "provider_response",
        mediaType: "application/json",
        createdBy: "pid:provider",
        provenance: {
          method: "provider_generated",
          sourceArtifactIds: [repairRequestArtifact.artifactId],
          commandId: repairAttempt.commandId,
          attemptId: repairAttempt.attemptId,
        },
      },
    );
    const failedUsage = await store.stageArtifact(
      repairExecution.recording.nativeUsageBytes ?? new Uint8Array(),
      {
        artifactId: "artifact_repair_failed_usage",
        kind: "native_usage",
        mediaType: "application/json",
        createdBy: "pid:provider",
        provenance: {
          method: "provider_generated",
          sourceArtifactIds: [repairRequestArtifact.artifactId],
          commandId: repairAttempt.commandId,
          attemptId: repairAttempt.attemptId,
        },
      },
    );
    const failureRequest = {
      runId: repairAttempt.runId,
      expectedStateVersion: 1,
      completion: {
        runId: repairAttempt.runId,
        commandId: repairAttempt.commandId,
        attemptId: repairAttempt.attemptId,
        ownerProcess: "pid:provider",
        correlationId: repairAttempt.correlationId,
        requestArtifactId: repairRequestArtifact.artifactId,
        requestContentHash: repairRequestArtifact.contentHash,
        outcomeArtifact: failedResponse,
        nativeUsageArtifact: failedUsage,
        execution: repairExecution,
      },
      executionPolicy: policy,
    };
    await expect(
      completeProviderFailure(authority, failureRequest),
    ).resolves.toMatchObject({
      status: "failed",
      failureClass: "schema_invalid",
      recovery: "schema_repair",
      recoveryBounds: { repairLimit: 2, repairsUsed: 1 },
    });
    expect(
      database
        .prepare(
          "SELECT status, failure_class FROM command_attempts WHERE attempt_id = ?",
        )
        .get(repairAttempt.attemptId),
    ).toEqual({ status: "failed", failure_class: "schema_invalid" });
    expect(
      authority
        .listAuditEntries()
        .slice(-2)
        .map(({ factType }) => factType),
    ).toEqual(["command_attempt_completed", "budget_reconciled"]);
    const auditCount = authority.listAuditEntries().length;
    await expect(
      completeProviderFailure(authority, failureRequest),
    ).resolves.toMatchObject({
      status: "failed",
      failureClass: "schema_invalid",
      recovery: "schema_repair",
    });
    expect(authority.listAuditEntries()).toHaveLength(auditCount);
  });

  it("atomically reserves budget, acquires the lease, and starts one attempt", async () => {
    const path = await databasePath();
    const authority = await openAuthority(path, {
      now: () => "2026-08-19T00:00:00.000Z",
    });
    await commitTransition<TestState>(authority, {
      runId: "run_execute",
      expectedStateVersion: 0,
      transition: () => transitionResult("run_execute", 1, "command_execute"),
    });
    const policy = ExecutionPolicy.fromConfiguration({
      runId: "run_execute",
      configurationArtifactId: "artifact_configuration",
      configuration: executionConfiguration,
      expectedContentHash: executionConfigurationHash,
    });

    await expect(
      authority.beginAttempt({
        runId: "run_execute",
        commandId: "command_execute",
        attemptId: "attempt_execute_1",
        correlationId: "correlation_execute_1",
        ownerProcess: "pid:123",
        configurationArtifactId: "artifact_configuration",
        policy,
        attemptKind: "initial",
      }),
    ).resolves.toMatchObject({
      attemptNumber: 1,
      triggeringStateVersion: 1,
      lease: { ownerProcess: "pid:123" },
      reservation: { calls: 0, inputTokens: 0, outputTokens: 0 },
    });
    expect(
      authority
        .listAuditEntries()
        .slice(-2)
        .map(({ factType }) => factType),
    ).toEqual(["command_attempt_started", "budget_reserved"]);
    await expect(
      authority.beginAttempt({
        runId: "run_execute",
        commandId: "command_execute",
        attemptId: "attempt_execute_2",
        correlationId: "correlation_execute_2",
        ownerProcess: "pid:123",
        configurationArtifactId: "artifact_configuration",
        policy,
        attemptKind: "initial",
      }),
    ).rejects.toThrow("Mutation lease is unavailable");

    const store = await ContentAddressedArtifactStore.open(
      resolve(path, "../.."),
    );
    const result = await store.stageArtifact(
      renderSourceRegistrationReport({
        sourceArtifactId: "artifact_source",
        sourceBytes: Buffer.from("source"),
        configurationArtifactId: "artifact_configuration",
        configurationBytes: Buffer.from(canonicalJson(executionConfiguration)),
        policyHash: "a".repeat(64),
      }).bytes,
      {
        artifactId: "artifact_result",
        kind: "other",
        mediaType: "text/markdown; charset=utf-8",
        createdBy: "system:test",
        provenance: {
          method: "application_generated",
          purpose: "source_registration",
          sourceArtifactIds: ["artifact_source", "artifact_configuration"],
          commandId: "command_execute",
          attemptId: "attempt_execute_1",
        },
      },
    );
    const invalidResult = await store.stageArtifact(Buffer.from("forged"), {
      ...result,
      artifactId: "artifact_invalid_result",
    });
    const usageBytes = Buffer.from(
      canonicalJson({
        commandId: "command_execute",
        attemptId: "attempt_execute_1",
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsdMicros: 0,
      }),
    );
    const usage = await store.stageArtifact(usageBytes, {
      artifactId: "artifact_usage",
      kind: "native_usage",
      mediaType: "application/json",
      createdBy: "system:test",
      provenance: {
        method: "application_generated",
        purpose: "local_usage",
        sourceArtifactIds: ["artifact_source", "artifact_configuration"],
        commandId: "command_execute",
        attemptId: "attempt_execute_1",
      },
    });
    const invalidUsage = await store.stageArtifact(
      Buffer.from(
        JSON.stringify(
          {
            commandId: "command_execute",
            attemptId: "attempt_execute_1",
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsdMicros: 0,
          },
          null,
          2,
        ),
      ),
      {
        ...usage,
        artifactId: "artifact_invalid_usage",
      },
    );
    await expect(
      authority.completeAttempt({
        runId: "run_execute",
        commandId: "command_execute",
        attemptId: "attempt_execute_1",
        correlationId: "correlation_execute_1",
        ownerProcess: "pid:123",
        resultArtifact: invalidResult,
        nativeUsageArtifact: usage,
        actualUsage: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
        providerEvidence: {},
      }),
    ).rejects.toThrow("deterministic output");
    await expect(
      authority.completeAttempt({
        runId: "run_execute",
        commandId: "command_execute",
        attemptId: "attempt_execute_1",
        correlationId: "correlation_execute_1",
        ownerProcess: "pid:123",
        resultArtifact: result,
        nativeUsageArtifact: invalidUsage,
        actualUsage: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
        providerEvidence: {},
      }),
    ).rejects.toThrow("usage evidence");
    await expect(
      authority.completeAttempt({
        runId: "run_execute",
        commandId: "command_execute",
        attemptId: "attempt_execute_1",
        correlationId: "correlation_execute_1",
        ownerProcess: "pid:123",
        resultArtifact: result,
        nativeUsageArtifact: usage,
        actualUsage: {
          calls: 1,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
        providerEvidence: {},
      }),
    ).rejects.toThrow("usage evidence");
    await expect(
      authority.completeAttempt({
        runId: "run_execute",
        commandId: "command_execute",
        attemptId: "attempt_execute_1",
        correlationId: "correlation_execute_1",
        ownerProcess: "pid:123",
        resultArtifact: result,
        nativeUsageArtifact: usage,
        actualUsage: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
        providerEvidence: {},
      }),
    ).resolves.toMatchObject({ acceptedAsLogicalResult: true });
    await expect(
      authority.completeAttempt({
        runId: "run_execute",
        commandId: "command_execute",
        attemptId: "attempt_execute_1",
        correlationId: "correlation_execute_1",
        ownerProcess: "pid:123",
        resultArtifact: result,
        nativeUsageArtifact: usage,
        actualUsage: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
        providerEvidence: {},
      }),
    ).resolves.toMatchObject({ acceptedAsLogicalResult: true });
    expect(
      authority
        .listAuditEntries()
        .slice(-2)
        .map(({ factType }) => factType),
    ).toEqual(["command_attempt_completed", "budget_reconciled"]);
    authority.close();

    const reopened = await openAuthority(path);
    await expect(
      reopened.beginAttempt({
        runId: "run_execute",
        commandId: "command_execute",
        attemptId: "attempt_execute_noop",
        correlationId: "correlation_execute_noop",
        ownerProcess: "pid:456",
        configurationArtifactId: "artifact_configuration",
        policy,
        attemptKind: "initial",
      }),
    ).resolves.toEqual({
      status: "already_succeeded",
      runId: "run_execute",
      commandId: "command_execute",
      acceptedAttemptId: "attempt_execute_1",
    });
    reopened.close();
  });

  it("accepts the public pure-domain transition without an adapter DTO", async () => {
    const path = await databasePath();
    const authority = await openAuthority(path);
    const sourceHash = createHash("sha256").update("source").digest("hex");
    const configurationHash = executionConfigurationHash;
    const input: RunStarted = {
      type: "RunStarted",
      runId: "run_domain",
      expectedStateVersion: 0,
      sourceArtifactId: "artifact_source",
      sourceContentHash: sourceHash,
      sourceProvenancePath: "/project/requirements.md",
      sourceObjectVerified: true,
      configurationArtifactId: "artifact_configuration",
      configurationContentHash: configurationHash,
      auditChainVerified: true,
      databaseIntegrityVerified: true,
      schemaCompatible: true,
      mutationLeaseAvailable: true,
      renderCommandId: "command_render_source",
      actor: { kind: "human", displayName: "Tigran", osAccount: "tig" },
    };
    const policy = {
      policyHash: "a".repeat(64),
      plannerAssignment: { provider: "openai" as const, modelId: "gpt-pinned" },
      reviewerAssignment: {
        provider: "anthropic" as const,
        modelId: "claude-pinned",
      },
    };

    await commitTransition<NonterminalRunState>(authority, {
      runId: input.runId,
      expectedStateVersion: 0,
      transition: (previousState) => transition(previousState, input, policy),
    });

    const store = await ContentAddressedArtifactStore.open(
      resolve(path, "../.."),
    );
    const ledgerBytes = Buffer.from(
      canonicalJson({
        schema_version: 1,
        ledger_id: "ledger_v1",
        version: 1,
        source_artifact_id: "artifact_source",
        requirements: [
          {
            requirement_id: "req_1",
            display_id: "REQ-001",
            statement: "The factory persists atomically.",
            status: "active",
            source_ranges: [{ start_byte: 0, end_byte: 10 }],
            lineage_roots: ["req_1"],
            predecessor_ids: [],
          },
        ],
        source_exclusions: [],
      }),
    );
    const ledger = await store.stageArtifact(ledgerBytes, {
      artifactId: "artifact_ledger",
      kind: "requirements_ledger",
      mediaType: "application/json",
      schemaId: "requirements-ledger.v1",
      createdBy: "human:tig",
      provenance: {
        method: "human_submitted",
        sourceArtifactIds: ["artifact_source"],
      },
    });
    await authority.registerArtifact(ledger);
    const ledgerInput: LedgerSubmitted = {
      type: "LedgerSubmitted",
      runId: input.runId,
      expectedStateVersion: 1,
      ledgerVersionId: "ledger_v1",
      ledgerArtifactId: ledger.artifactId,
      ledgerContentHash: ledger.contentHash,
      ledgerObjectVerified: true,
      ledgerSchemaValid: true,
      sourceReferencesValid: true,
      auditChainVerified: true,
      databaseIntegrityVerified: true,
      schemaCompatible: true,
      mutationLeaseAvailable: true,
      validateCommandId: "command_validate_ledger",
      actor: input.actor,
    };
    await commitTransition<NonterminalRunState>(authority, {
      runId: input.runId,
      expectedStateVersion: 1,
      validatedProjection: ValidatedProjection.fromLedgerArtifact({
        bytes: ledgerBytes,
        contentHash: ledger.contentHash,
        stateVersion: 2,
        ledgerVersionId: ledgerInput.ledgerVersionId,
        sourceArtifactId: input.sourceArtifactId,
        schema: requirementsLedgerSchema,
      }),
      transition: (previousState) =>
        transition(previousState, ledgerInput, policy),
    });

    expect(authority.loadRun(input.runId)).toEqual(
      expect.objectContaining({ state: "draft", stateVersion: 2 }),
    );
    expect(
      authority.listAuditEntries().map(({ factType }) => factType),
    ).toEqual([
      "run_started",
      "source_registered",
      "command_planned",
      "ledger_submitted",
      "command_planned",
    ]);
    authority.close();
    const reopened = await openAuthority(path);
    expect(
      reopened.loadRun<NonterminalRunState>(input.runId)?.stateVersion,
    ).toBe(2);
    reopened.close();
    const raw = new DatabaseSync(path, { readOnly: true });
    expect(
      raw.prepare("SELECT count(*) AS count FROM requirements").get(),
    ).toEqual({ count: 1 });
    raw.close();
  });

  it("atomically persists state, commands, and a verifiable audit chain", async () => {
    const path = await databasePath();
    const authority = await openAuthority(path, {
      now: () => "2026-08-19T00:00:00.000Z",
    });
    await commitTransition<TestState>(authority, {
      runId: "run_one",
      expectedStateVersion: 0,
      causationId: "input_one",
      correlationId: "correlation_one",
      transition: () => transitionResult("run_one", 1),
    });
    expect(authority.loadRun<TestState>("run_one")?.stateVersion).toBe(1);
    expect(authority.listCommands("run_one")).toHaveLength(1);
    await expect(authority.verifyIntegrity()).resolves.toBeUndefined();
    authority.close();
  });

  it("invalidates the transaction capability after the atomic callback", async () => {
    const path = await databasePath();
    const authority = await openAuthority(path);
    let retained: AuthorityTransaction | undefined;
    await authority.transaction((transaction) => {
      retained = transaction;
      transaction.persist(
        { runId: "run_one", expectedStateVersion: 0 },
        transitionResult("run_one", 1),
      );
    });
    expect(() => retained?.loadRun("run_one")).toThrow(
      "transaction is no longer active",
    );
    authority.close();
  });

  it("rolls back the complete transition on an invalid command key", async () => {
    const path = await databasePath();
    const authority = await openAuthority(path);
    await commitTransition<TestState>(authority, {
      runId: "run_one",
      expectedStateVersion: 0,
      transition: () => transitionResult("run_one", 1),
    });
    await expect(
      commitTransition<TestState>(authority, {
        runId: "run_one",
        expectedStateVersion: 1,
        transition: () =>
          transitionResult("run_one", 2, "command_2", "f".repeat(64)),
      }),
    ).rejects.toThrow("authority invariants");
    expect(authority.loadRun<TestState>("run_one")?.stateVersion).toBe(1);
    expect(authority.listAuditEntries()).toHaveLength(1);
    const unknown = transitionResult("run_one", 2, "command_unknown");
    unknown.commands[0] = {
      ...unknown.commands[0]!,
      commandType: "unknown_effect",
    };
    const unknownBody = Object.fromEntries(
      Object.entries(unknown.commands[0]).filter(
        ([key]) => key !== "commandId" && key !== "commandKey",
      ),
    );
    unknown.commands[0].commandKey = createHash("sha256")
      .update(canonicalJson(unknownBody))
      .digest("hex");
    await expect(
      commitTransition<TestState>(authority, {
        runId: "run_one",
        expectedStateVersion: 1,
        transition: () => unknown,
      }),
    ).rejects.toThrow("authority invariants");
    authority.close();
  });

  it("rejects stale writes and a second active run", async () => {
    const path = await databasePath();
    const authority = await openAuthority(path);
    await commitTransition<TestState>(authority, {
      runId: "run_one",
      expectedStateVersion: 0,
      transition: () => transitionResult("run_one", 1),
    });
    await expect(
      commitTransition<TestState>(authority, {
        runId: "run_one",
        expectedStateVersion: 0,
        transition: () => transitionResult("run_one", 2),
      }),
    ).rejects.toThrow(StaleStateError);
    await expect(
      commitTransition<TestState>(authority, {
        runId: "run_two",
        expectedStateVersion: 0,
        transition: () => transitionResult("run_two", 1, "command_other"),
      }),
    ).rejects.toThrow();
    expect(authority.loadRun<TestState>("run_two")).toBeNull();
    authority.close();
  });

  it("quarantines audit or authoritative-state tampering", async () => {
    const path = await databasePath();
    const authority = await openAuthority(path);
    await commitTransition<TestState>(authority, {
      runId: "run_one",
      expectedStateVersion: 0,
      transition: () => transitionResult("run_one", 1),
    });
    authority.close();

    const raw = new DatabaseSync(path);
    raw
      .prepare("UPDATE runs SET state_version = 9 WHERE run_id = 'run_one'")
      .run();
    raw.close();

    const reopened = await openAuthority(path);
    await expect(reopened.verifyIntegrity()).rejects.toThrow(
      AuthorityIntegrityError,
    );
    expect(reopened.readOnlyReason()).toContain("disagrees with audit");
    await expect(
      commitTransition<TestState>(reopened, {
        runId: "run_one",
        expectedStateVersion: 9,
        transition: () => transitionResult("run_one", 10),
      }),
    ).rejects.toThrow("read-only");
    reopened.close();
  });

  it("quarantines a missing state snapshot or artifact body", async () => {
    const snapshotPath = await databasePath();
    const snapshotAuthority = await openAuthority(snapshotPath);
    await commitTransition<TestState>(snapshotAuthority, {
      runId: "run_one",
      expectedStateVersion: 0,
      transition: () => transitionResult("run_one", 1),
    });
    snapshotAuthority.close();
    const raw = new DatabaseSync(snapshotPath);
    raw
      .prepare("DELETE FROM run_state_snapshots WHERE run_id = 'run_one'")
      .run();
    raw.close();
    const snapshotStore = await ContentAddressedArtifactStore.open(
      resolve(snapshotPath, "../.."),
    );
    const missingSnapshot = SqliteAuthority.open(snapshotPath, {
      artifactStore: snapshotStore,
    });
    await expect(missingSnapshot.verifyIntegrity()).rejects.toThrow(
      "snapshot is missing",
    );
    expect(missingSnapshot.readOnlyReason()).toContain("snapshot is missing");
    missingSnapshot.close();

    const objectPath = await databasePath();
    const objectAuthority = await openAuthority(objectPath);
    const objectHash = createHash("sha256").update("source").digest("hex");
    objectAuthority.close();
    await unlink(
      join(resolve(objectPath, "../.."), ".factory", "objects", objectHash),
    );
    const objectStore = await ContentAddressedArtifactStore.open(
      resolve(objectPath, "../.."),
    );
    const missingObject = SqliteAuthority.open(objectPath, {
      artifactStore: objectStore,
    });
    await expect(missingObject.verifyIntegrity()).rejects.toThrow(
      "missing or corrupt",
    );
    expect(missingObject.readOnlyReason()).toContain("missing or corrupt");
    missingObject.close();
  });

  it("rejects changed immutable artifact provenance", async () => {
    const path = await databasePath();
    const authority = await openAuthority(path);
    const store = await ContentAddressedArtifactStore.open(
      resolve(path, "../.."),
    );
    const descriptor = await store.stageArtifact(Buffer.from("source"), {
      artifactId: "artifact_source",
      kind: "raw_requirements",
      mediaType: "application/octet-stream",
      createdBy: "human:different",
      provenance: { method: "human_submitted" },
    });
    await expect(authority.registerArtifact(descriptor)).rejects.toThrow(
      "different metadata",
    );
    authority.close();
  });

  it("keeps validated projection data immutable and rejects schema drift", () => {
    const valid = {
      schema_version: 1,
      ledger_id: "ledger_v1",
      version: 1,
      source_artifact_id: "artifact_source",
      requirements: [
        {
          requirement_id: "req_1",
          display_id: "REQ-001",
          statement: "Persist atomically.",
          status: "active",
          source_ranges: [{ start_byte: 0, end_byte: 1 }],
          lineage_roots: ["req_1"],
          predecessor_ids: [],
        },
      ],
      source_exclusions: [],
    };
    const bytes = Buffer.from(canonicalJson(valid));
    const capability = ValidatedProjection.fromLedgerArtifact({
      schema: requirementsLedgerSchema,
      bytes,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      stateVersion: 2,
      ledgerVersionId: "ledger_v1",
      sourceArtifactId: "artifact_source",
    });
    const exposed = capability.toPersistenceData();
    expect(() => {
      exposed.requirements?.push({
        requirementId: "req_forged",
        displayId: "REQ-X",
        status: "active",
        statement: "forged",
        sourceRanges: [],
        lineageRoots: [],
        predecessorIds: [],
      });
    }).toThrow();
    expect(capability.toPersistenceData().requirements).toHaveLength(1);

    const invalidBytes = Buffer.from(
      canonicalJson({ ...valid, credential: "opaque-secret" }),
    );
    expect(() =>
      ValidatedProjection.fromLedgerArtifact({
        schema: requirementsLedgerSchema,
        bytes: invalidBytes,
        contentHash: createHash("sha256").update(invalidBytes).digest("hex"),
        stateVersion: 2,
        ledgerVersionId: "ledger_v1",
        sourceArtifactId: "artifact_source",
      }),
    ).toThrow("normative JSON schema");
  });

  it("binds plan coverage and review references to supplied artifacts", () => {
    const plan = {
      schema_version: 1,
      plan_id: "plan_v1",
      version: 1,
      title: "Plan",
      summary: "Summary",
      components: [
        {
          component_id: "component_api",
          name: "API",
          responsibility: "Serve requests",
        },
      ],
      sections: [
        {
          section_id: "section_api",
          kind: "component",
          title: "API",
          body: "Build it.",
          component_ids: ["component_api"],
          requirement_ids: ["req_1"],
        },
      ],
      requirement_coverage: [
        {
          requirement_id: "req_1",
          section_ids: ["section_api"],
          justification: "Implemented here",
        },
      ],
      section_transitions: [
        {
          kind: "new",
          from_section_ids: [],
          to_section_ids: ["section_api"],
          reason: "Initial plan",
        },
      ],
    };
    const planBytes = Buffer.from(canonicalJson(plan));
    expect(() =>
      ValidatedProjection.fromPlanArtifact({
        bytes: Buffer.from(
          canonicalJson({ ...plan, requirement_coverage: [] }),
        ),
        contentHash: createHash("sha256")
          .update(
            Buffer.from(canonicalJson({ ...plan, requirement_coverage: [] })),
          )
          .digest("hex"),
        stateVersion: 3,
        planVersionId: "plan_v1",
        allowedRequirementIds: ["req_1"],
        schema: planSchema,
      }),
    ).toThrow("coverage is incomplete");
    expect(() =>
      ValidatedProjection.fromPlanArtifact({
        bytes: planBytes,
        contentHash: createHash("sha256").update(planBytes).digest("hex"),
        stateVersion: 3,
        planVersionId: "plan_v1",
        allowedRequirementIds: ["req_1"],
        schema: planSchema,
      }),
    ).not.toThrow();
    expect(() =>
      ValidatedProjection.fromPlanArtifact({
        bytes: planBytes,
        contentHash: createHash("sha256").update(planBytes).digest("hex"),
        stateVersion: 3,
        planVersionId: "plan_v1",
        allowedRequirementIds: ["req_1"],
        schema: {
          type: "object",
          required: ["pinned_only_field"],
        },
      }),
    ).toThrow("normative JSON schema");

    const policyHash = "a".repeat(64);
    const review = {
      schema_version: 1,
      review_id: "review_v1",
      review_kind: "baseline",
      plan_artifact_id: "artifact_plan",
      policy_hash: policyHash,
      prior_findings: [],
      new_concerns: [
        {
          rule_id: "rule_architecture",
          category: "architecture",
          severity: "high",
          component_ids: ["component_api"],
          requirement_ids: ["req_1"],
          title: "Concern",
          description: "Needs work",
          evidence: [
            {
              artifact_id: "artifact_plan",
              section_ids: ["section_api"],
              explanation: "The section is incomplete",
            },
          ],
        },
      ],
      summary: "One concern",
    };
    const reviewBytes = Buffer.from(canonicalJson(review));
    const reviewInput = {
      bytes: reviewBytes,
      contentHash: createHash("sha256").update(reviewBytes).digest("hex"),
      stateVersion: 4,
      policyHash,
      expectedPlanArtifactId: "artifact_plan",
      allowedComponentIds: ["component_api"],
      allowedRequirementIds: ["req_1"],
      allowedSectionIds: ["section_api"],
      suppliedEvidenceArtifactIds: ["artifact_plan"],
      expectedPriorFindingIds: [],
      findings: [{ findingId: "finding_1", observationId: "observation_1" }],
      schema: reviewSchema,
    };
    expect(() =>
      ValidatedProjection.fromBaselineReviewArtifact({
        ...reviewInput,
        expectedPlanArtifactId: "artifact_other",
      }),
    ).toThrow("not bound");
    expect(() =>
      ValidatedProjection.fromBaselineReviewArtifact({
        ...reviewInput,
        allowedComponentIds: [],
      }),
    ).toThrow("controlled references");
    expect(() =>
      ValidatedProjection.fromBaselineReviewArtifact({
        ...reviewInput,
        suppliedEvidenceArtifactIds: [],
      }),
    ).toThrow("controlled references");
    expect(() =>
      ValidatedProjection.fromBaselineReviewArtifact({
        ...reviewInput,
        schema: {
          type: "object",
          required: ["pinned_only_field"],
        },
      }),
    ).toThrow("normative JSON schema");
  });

  it("backs up and migrates a populated schema-v1 database", async () => {
    const path = await databasePath();
    await mkdir(resolve(path, ".."), { recursive: true });
    const raw = new DatabaseSync(path);
    raw.exec(await readFile(resolve("database/schema.v1.sql"), "utf8"));
    raw
      .prepare(
        `INSERT INTO workspaces
          (workspace_id, created_at, audit_chain_head, next_audit_sequence)
         VALUES ('workspace_local', '2026-01-01T00:00:00.000Z', ?, 1)`,
      )
      .run("0".repeat(64));
    for (const artifactId of ["artifact_source", "artifact_configuration"]) {
      const contentHash = createHash("sha256").update(artifactId).digest("hex");
      raw
        .prepare(
          `INSERT INTO artifacts
            (artifact_id, kind, content_hash, byte_length, media_type,
             metadata_json, created_at)
           VALUES (?, 'other', ?, 0, 'application/octet-stream', '{}',
                   '2026-01-01T00:00:00.000Z')`,
        )
        .run(artifactId, contentHash);
      const objects = resolve(path, "../objects");
      await mkdir(objects, { recursive: true });
      await writeFile(resolve(objects, contentHash), artifactId);
    }
    raw
      .prepare(
        `INSERT INTO runs
          (run_id, workspace_id, state, state_version, source_artifact_id,
           configuration_artifact_id, policy_hash, created_at)
         VALUES ('run_legacy', 'workspace_local', 'draft', 1,
                 'artifact_source', 'artifact_configuration', ?,
                 '2026-01-01T00:00:00.000Z')`,
      )
      .run("a".repeat(64));
    const auditWithoutHash = {
      auditEntryId: "run_legacy:audit:1",
      sequence: 1,
      runId: "run_legacy",
      stateVersionBefore: 0,
      stateVersionAfter: 1,
      factType: "run_started",
      schemaVersion: 1,
      actor: { kind: "human", actorId: "human:test", osAccount: "test" },
      reason: "legacy run",
      evidence: [],
      recordedAt: "2026-01-01T00:00:00.000Z",
      payload: {},
      previousEntryHash: "0".repeat(64),
    };
    const auditHash = createHash("sha256")
      .update(canonicalJson(auditWithoutHash))
      .digest("hex");
    raw
      .prepare(
        `INSERT INTO audit_entries
          (audit_entry_id, workspace_id, run_id, sequence,
           state_version_before, state_version_after, fact_type, schema_version,
           actor_json, reason, evidence_json, recorded_at, payload_json,
           previous_entry_hash, entry_hash)
         VALUES (?, 'workspace_local', 'run_legacy', 1, 0, 1, 'run_started', 1,
                 ?, 'legacy run', '[]', ?, '{}', ?, ?)`,
      )
      .run(
        auditWithoutHash.auditEntryId,
        canonicalJson(auditWithoutHash.actor),
        auditWithoutHash.recordedAt,
        auditWithoutHash.previousEntryHash,
        auditHash,
      );
    raw
      .prepare(
        `UPDATE workspaces SET audit_chain_head = ?, next_audit_sequence = 2
         WHERE workspace_id = 'workspace_local'`,
      )
      .run(auditHash);
    raw.close();

    const authority = SqliteAuthority.open(path, {
      now: () => "2026-01-02T00:00:00.000Z",
    });
    authority.close();
    const migrated = new DatabaseSync(path);
    expect(
      migrated.prepare("SELECT schema_version FROM schema_metadata").get(),
    ).toEqual({ schema_version: 2 });
    expect(
      migrated
        .prepare(
          "SELECT state_version FROM run_state_snapshots WHERE run_id = 'run_legacy'",
        )
        .get(),
    ).toEqual({ state_version: 1 });
    const history = migrated
      .prepare("SELECT backup_manifest_path FROM migration_history")
      .get() as { backup_manifest_path: string };
    migrated.close();
    const manifest = JSON.parse(
      await readFile(history.backup_manifest_path, "utf8"),
    ) as { fromSchemaVersion: number; databaseHash: string };
    expect(manifest.fromSchemaVersion).toBe(1);
    expect(manifest.databaseHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});
