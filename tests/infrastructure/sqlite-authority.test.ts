import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  AuthorityTransaction,
  PersistableTransition,
} from "../../src/application/authority-port.js";
import { ValidatedProjection } from "../../src/application/authority-port.js";
import { commitTransition } from "../../src/application/commit-transition.js";
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
  configurationArtifactId: string;
  policyHash: string;
  policyLocked: boolean;
};

const directories: string[] = [];

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
    ["artifact_configuration", "other", Buffer.from("configuration")],
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
    commandType: "verify_integrity",
    schemaVersion: 1,
    runId,
    triggeringStateVersion: stateVersion,
    purposeId: `purpose_${stateVersion}`,
    inputArtifactHashes: [createHash("sha256").update("source").digest("hex")],
    policyHash: "a".repeat(64),
    provider: "local" as const,
    budgetReservation: {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicros: 0,
    },
    payload: {},
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
      configurationArtifactId: "artifact_configuration",
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

describe("SQLite authority", () => {
  it("accepts the public pure-domain transition without an adapter DTO", async () => {
    const path = await databasePath();
    const authority = await openAuthority(path);
    const sourceHash = createHash("sha256").update("source").digest("hex");
    const configurationHash = createHash("sha256")
      .update("configuration")
      .digest("hex");
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
      renderCommandId: "command_render_ledger",
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
        bytes: invalidBytes,
        contentHash: createHash("sha256").update(invalidBytes).digest("hex"),
        stateVersion: 2,
        ledgerVersionId: "ledger_v1",
        sourceArtifactId: "artifact_source",
      }),
    ).toThrow("normative JSON schema");
  });
});
