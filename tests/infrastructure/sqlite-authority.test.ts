import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, readFile, rm, unlink } from "node:fs/promises";
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
    commandType: "render_source_registration_report",
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
    payload: { sourceArtifactId: "artifact_source" },
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
      }),
    ).toThrow("coverage is incomplete");
    expect(() =>
      ValidatedProjection.fromPlanArtifact({
        bytes: planBytes,
        contentHash: createHash("sha256").update(planBytes).digest("hex"),
        stateVersion: 3,
        planVersionId: "plan_v1",
        allowedRequirementIds: ["req_1"],
      }),
    ).not.toThrow();

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
      findings: [{ findingId: "finding_1", observationId: "observation_1" }],
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
      raw
        .prepare(
          `INSERT INTO artifacts
            (artifact_id, kind, content_hash, byte_length, media_type,
             metadata_json, created_at)
           VALUES (?, 'other', ?, 0, 'application/octet-stream', '{}',
                   '2026-01-01T00:00:00.000Z')`,
        )
        .run(artifactId, createHash("sha256").update(artifactId).digest("hex"));
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
