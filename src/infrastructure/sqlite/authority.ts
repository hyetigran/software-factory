import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../../domain/canonical-json.js";
import type { StagedArtifactDescriptor } from "../artifacts/object-store.js";
import type { ContentAddressedArtifactStore } from "../artifacts/object-store.js";

const ZERO_HASH = "0".repeat(64);

type JsonObject = Record<string, unknown>;

export type PersistableCommand = {
  commandId: string;
  commandKey: string;
  commandType: string;
  schemaVersion: number;
  runId: string;
  triggeringStateVersion: number;
  purposeId: string;
  prerequisiteCommandIds?: string[];
  inputArtifactHashes: string[];
  policyHash: string;
  provider?: "openai" | "anthropic" | "manual" | "local";
  modelId?: string;
  budgetReservation: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsdMicros: number;
  };
  payload: object;
};

export type PersistableAuditFact = {
  type: string;
  actor: object;
  reason?: string;
  evidence: unknown[];
  payload: object;
};

export type PersistableTransition<TState extends object> = {
  nextState: TState;
  commands: PersistableCommand[];
  auditFacts: PersistableAuditFact[];
};

export type CommitTransitionRequest<TState extends object> = {
  runId: string;
  expectedStateVersion: number;
  transition: (previousState: TState | null) => PersistableTransition<TState>;
  causationId?: string;
  correlationId?: string;
};

export type AuditEntry = {
  auditEntryId: string;
  sequence: number;
  runId: string;
  stateVersionBefore: number;
  stateVersionAfter: number;
  factType: string;
  schemaVersion: 1;
  actor: object;
  reason?: string;
  evidence: unknown[];
  causationId?: string;
  correlationId?: string;
  recordedAt: string;
  payload: object;
  previousEntryHash: string;
  entryHash: string;
};

export class AuthorityIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthorityIntegrityError";
  }
}

export class StaleStateError extends Error {
  constructor(runId: string, expected: number, actual: number | null) {
    super(
      `Run ${runId} expected state version ${expected}, actual ${actual ?? "missing"}`,
    );
    this.name = "StaleStateError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function commandIsValid(command: PersistableCommand): boolean {
  const commandWithoutIdentity = Object.fromEntries(
    Object.entries(command).filter(
      ([key]) => key !== "commandId" && key !== "commandKey",
    ),
  );
  return (
    command.schemaVersion === 1 &&
    command.commandId.length > 0 &&
    command.commandType.length > 0 &&
    command.purposeId.length > 0 &&
    /^[a-f0-9]{64}$/u.test(command.policyHash) &&
    command.inputArtifactHashes.every((hash) => /^[a-f0-9]{64}$/u.test(hash)) &&
    Object.values(command.budgetReservation).every(
      (value) => Number.isInteger(value) && value >= 0,
    ) &&
    sha256(canonicalJson(commandWithoutIdentity)) === command.commandKey
  );
}

function stateIsTerminal(state: JsonObject): boolean {
  return ["approved", "approved_with_waivers", "halted", "cancelled"].includes(
    String(state.state),
  );
}

function parseObject(value: string): JsonObject {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AuthorityIntegrityError("Authoritative JSON must be an object");
  }
  return parsed as JsonObject;
}

type AuditRow = Record<string, string | number | null>;

function auditEntryFromRow(row: AuditRow): AuditEntry {
  return {
    auditEntryId: String(row.audit_entry_id),
    sequence: Number(row.sequence),
    runId: String(row.run_id),
    stateVersionBefore: Number(row.state_version_before),
    stateVersionAfter: Number(row.state_version_after),
    factType: String(row.fact_type),
    schemaVersion: 1,
    actor: parseObject(String(row.actor_json)),
    ...(row.reason === null ? {} : { reason: String(row.reason) }),
    evidence: JSON.parse(String(row.evidence_json)) as unknown[],
    ...(row.causation_id === null
      ? {}
      : { causationId: String(row.causation_id) }),
    ...(row.correlation_id === null
      ? {}
      : { correlationId: String(row.correlation_id) }),
    recordedAt: String(row.recorded_at),
    payload: parseObject(String(row.payload_json)),
    previousEntryHash: String(row.previous_entry_hash),
    entryHash: String(row.entry_hash),
  };
}

export class SqliteAuthority {
  private constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => string,
    private readonly workspaceId: string,
    private readonly artifactStore?: ContentAddressedArtifactStore,
  ) {}

  static open(
    databasePath: string,
    options: {
      now?: () => string;
      artifactStore?: ContentAddressedArtifactStore;
    } = {},
  ): SqliteAuthority {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    const now = options.now ?? (() => new Date().toISOString());
    const authority = new SqliteAuthority(
      database,
      now,
      "workspace_local",
      options.artifactStore,
    );
    authority.migrate();
    return authority;
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    const initialized = this.database
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_metadata'",
      )
      .get();
    if (initialized === undefined) {
      const moduleDirectory = dirname(fileURLToPath(import.meta.url));
      const schemaPath = resolve(
        moduleDirectory,
        "../../../database/schema.v1.sql",
      );
      this.database.exec(readFileSync(schemaPath, "utf8"));
    }
    let version = this.database
      .prepare("SELECT schema_version FROM schema_metadata WHERE singleton = 1")
      .get() as { schema_version: number } | undefined;
    if (version?.schema_version === 1) {
      const runCount = this.database
        .prepare("SELECT count(*) AS count FROM runs")
        .get() as {
        count: number;
      };
      if (runCount.count > 0) {
        throw new AuthorityIntegrityError(
          "Schema v1 contains runs and requires the backup migration workflow",
        );
      }
      const moduleDirectory = dirname(fileURLToPath(import.meta.url));
      const migrationPath = resolve(
        moduleDirectory,
        "../../../database/migrations/0002_run_state_snapshots.sql",
      );
      this.database.exec(readFileSync(migrationPath, "utf8"));
      version = this.database
        .prepare(
          "SELECT schema_version FROM schema_metadata WHERE singleton = 1",
        )
        .get() as { schema_version: number } | undefined;
    }
    if (version?.schema_version !== 2) {
      throw new AuthorityIntegrityError(
        `Unsupported database schema version: ${version?.schema_version ?? "missing"}`,
      );
    }
    this.database
      .prepare(
        `INSERT OR IGNORE INTO workspaces
          (workspace_id, created_at, audit_chain_head, next_audit_sequence)
         VALUES (?, ?, ?, 1)`,
      )
      .run(this.workspaceId, this.now(), ZERO_HASH);
  }

  async registerArtifact(descriptor: StagedArtifactDescriptor): Promise<void> {
    if (this.artifactStore === undefined) {
      throw new TypeError(
        "Artifact registration requires a bound object store",
      );
    }
    const bytes = await this.artifactStore.readVerified(descriptor.contentHash);
    if (bytes.byteLength !== descriptor.byteLength) {
      throw new AuthorityIntegrityError(
        `Artifact byte length does not match staged object: ${descriptor.artifactId}`,
      );
    }
    this.database
      .prepare(
        `INSERT OR IGNORE INTO artifacts
          (artifact_id, kind, content_hash, byte_length, media_type,
           schema_id, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        descriptor.artifactId,
        descriptor.kind,
        descriptor.contentHash,
        descriptor.byteLength,
        descriptor.mediaType,
        descriptor.schemaId ?? null,
        canonicalJson({
          createdBy: descriptor.createdBy,
          provenance: descriptor.provenance,
          schemaVersion: descriptor.schemaVersion,
        }),
        this.now(),
      );
    const stored = this.database
      .prepare(
        `SELECT kind, content_hash, byte_length, media_type, schema_id
         FROM artifacts WHERE artifact_id = ?`,
      )
      .get(descriptor.artifactId) as
      | {
          kind: string;
          content_hash: string;
          byte_length: number;
          media_type: string;
          schema_id: string | null;
        }
      | undefined;
    if (
      stored === undefined ||
      stored.kind !== descriptor.kind ||
      stored.content_hash !== descriptor.contentHash ||
      stored.byte_length !== descriptor.byteLength ||
      stored.media_type !== descriptor.mediaType ||
      stored.schema_id !== (descriptor.schemaId ?? null)
    ) {
      throw new AuthorityIntegrityError(
        `Artifact identity is already bound to different metadata: ${descriptor.artifactId}`,
      );
    }
  }

  verifyIntegrity(): void {
    try {
      const result = this.database.prepare("PRAGMA integrity_check").get() as
        { integrity_check: string } | undefined;
      if (result?.integrity_check !== "ok") {
        throw new AuthorityIntegrityError(
          `SQLite integrity check failed: ${result?.integrity_check ?? "no result"}`,
        );
      }
      const foreignKeyFailure = this.database
        .prepare("PRAGMA foreign_key_check")
        .get();
      if (foreignKeyFailure !== undefined) {
        throw new AuthorityIntegrityError("SQLite foreign-key check failed");
      }
      this.verifyAuditChain();
    } catch (error) {
      if (error instanceof AuthorityIntegrityError) {
        this.quarantine(error.message);
      }
      throw error;
    }
  }

  private quarantine(reason: string): void {
    try {
      this.database
        .prepare(
          `UPDATE workspaces SET read_only_reason = ? WHERE workspace_id = ?`,
        )
        .run(reason, this.workspaceId);
    } catch {
      // A physically corrupt database may be unable to persist quarantine.
    }
  }

  readOnlyReason(): string | null {
    const row = this.database
      .prepare("SELECT read_only_reason FROM workspaces WHERE workspace_id = ?")
      .get(this.workspaceId) as { read_only_reason: string | null } | undefined;
    return row?.read_only_reason ?? null;
  }

  private assertWritable(): void {
    const reason = this.readOnlyReason();
    if (reason !== null) {
      throw new AuthorityIntegrityError(`Workspace is read-only: ${reason}`);
    }
  }

  verifyAuditChain(): void {
    const metadata = this.database
      .prepare(
        `SELECT next_audit_sequence, audit_chain_head
         FROM workspaces WHERE workspace_id = ?`,
      )
      .get(this.workspaceId) as
      { next_audit_sequence: number; audit_chain_head: string } | undefined;
    if (metadata === undefined) {
      throw new AuthorityIntegrityError("Workspace metadata is missing");
    }

    const rows = this.database
      .prepare(
        `SELECT * FROM audit_entries
         WHERE workspace_id = ? ORDER BY sequence`,
      )
      .all(this.workspaceId) as AuditRow[];
    let previousHash = ZERO_HASH;
    const versionsByRun = new Map<string, { before: number; after: number }>();
    for (const [index, row] of rows.entries()) {
      if (row.sequence !== index + 1) {
        throw new AuthorityIntegrityError("Audit sequence is not contiguous");
      }
      const entry = auditEntryFromRow(row);
      const { entryHash, ...withoutHash } = entry;
      const priorVersions = versionsByRun.get(entry.runId);
      const versionsContinue =
        priorVersions === undefined
          ? entry.stateVersionBefore === 0
          : (entry.stateVersionBefore === priorVersions.before &&
              entry.stateVersionAfter === priorVersions.after) ||
            entry.stateVersionBefore === priorVersions.after;
      if (
        entry.sequence !== row.sequence ||
        entry.previousEntryHash !== previousHash ||
        !versionsContinue ||
        entry.stateVersionAfter < entry.stateVersionBefore ||
        sha256(canonicalJson(withoutHash)) !== entryHash
      ) {
        throw new AuthorityIntegrityError(
          `Audit chain verification failed at sequence ${row.sequence}`,
        );
      }
      previousHash = entryHash;
      versionsByRun.set(entry.runId, {
        before: entry.stateVersionBefore,
        after: entry.stateVersionAfter,
      });
    }
    if (
      metadata.next_audit_sequence !== rows.length + 1 ||
      metadata.audit_chain_head !== previousHash
    ) {
      throw new AuthorityIntegrityError(
        "Audit chain head does not match metadata",
      );
    }
    const runs = this.database
      .prepare(
        `SELECT runs.run_id, runs.state, runs.state_version,
                run_state_snapshots.state_version AS snapshot_state_version,
                run_state_snapshots.state_json
         FROM runs
         JOIN run_state_snapshots USING (run_id)`,
      )
      .all() as Array<{
      run_id: string;
      state: string;
      state_version: number;
      snapshot_state_version: number;
      state_json: string;
    }>;
    for (const run of runs) {
      const state = parseObject(run.state_json);
      const audited = versionsByRun.get(run.run_id);
      if (
        audited === undefined ||
        audited.after !== run.state_version ||
        run.snapshot_state_version !== run.state_version ||
        state.runId !== run.run_id ||
        state.state !== run.state ||
        state.stateVersion !== run.state_version
      ) {
        throw new AuthorityIntegrityError(
          `Authoritative run state disagrees with audit: ${run.run_id}`,
        );
      }
    }
  }

  loadRun<TState extends object>(runId: string): TState | null {
    const row = this.database
      .prepare("SELECT state_json FROM run_state_snapshots WHERE run_id = ?")
      .get(runId) as { state_json: string } | undefined;
    return row === undefined
      ? null
      : (parseObject(row.state_json) as unknown as TState);
  }

  listCommands(runId: string): PersistableCommand[] {
    return this.database
      .prepare(
        "SELECT specification_json FROM logical_commands WHERE run_id = ? ORDER BY rowid",
      )
      .all(runId)
      .map((row) =>
        parseObject((row as { specification_json: string }).specification_json),
      ) as PersistableCommand[];
  }

  listAuditEntries(): AuditEntry[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM audit_entries
           WHERE workspace_id = ? ORDER BY sequence`,
        )
        .all(this.workspaceId) as AuditRow[]
    ).map(auditEntryFromRow);
  }

  commitTransition<TState extends object>(
    request: CommitTransitionRequest<TState>,
  ): PersistableTransition<TState> {
    this.assertWritable();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.verifyIntegrity();
      const previousState = this.loadRun<TState>(request.runId);
      const actualVersion =
        previousState === null
          ? 0
          : Number((previousState as Record<string, unknown>).stateVersion);
      if (actualVersion !== request.expectedStateVersion) {
        throw new StaleStateError(
          request.runId,
          request.expectedStateVersion,
          previousState === null ? null : actualVersion,
        );
      }

      const result = request.transition(previousState);
      const nextState = result.nextState as Record<string, unknown>;
      const nextVersion = Number(nextState.stateVersion);
      if (
        nextState.runId !== request.runId ||
        nextVersion !== actualVersion + 1 ||
        result.auditFacts.length === 0 ||
        result.commands.some(
          (command) =>
            command.runId !== request.runId ||
            command.triggeringStateVersion !== nextVersion ||
            !commandIsValid(command),
        )
      ) {
        throw new TypeError("Transition output violates authority invariants");
      }

      this.database
        .prepare(
          `INSERT INTO runs
             (run_id, workspace_id, parent_run_id, state, state_version,
              source_artifact_id, configuration_artifact_id, policy_hash,
              policy_locked_at, created_at, terminal_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(run_id) DO UPDATE SET
             state_version = excluded.state_version,
             state = excluded.state,
             policy_hash = excluded.policy_hash,
             policy_locked_at = COALESCE(runs.policy_locked_at, excluded.policy_locked_at),
             terminal_at = excluded.terminal_at`,
        )
        .run(
          request.runId,
          this.workspaceId,
          (nextState.parentRunId as string | undefined) ?? null,
          String(nextState.state),
          nextVersion,
          String(nextState.sourceArtifactId),
          String(nextState.configurationArtifactId),
          String(nextState.policyHash),
          nextState.policyLocked === true ? this.now() : null,
          this.now(),
          stateIsTerminal(nextState) ? this.now() : null,
        );
      this.database
        .prepare(
          `INSERT INTO run_state_snapshots (run_id, state_version, state_json)
           VALUES (?, ?, ?)
           ON CONFLICT(run_id) DO UPDATE SET
             state_version = excluded.state_version,
             state_json = excluded.state_json`,
        )
        .run(request.runId, nextVersion, canonicalJson(result.nextState));

      const insertCommand = this.database.prepare(`
        INSERT INTO logical_commands
          (command_id, run_id, command_key, command_type, schema_version,
           triggering_state_version, status, specification_json, planned_at)
        VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?)
      `);
      for (const command of result.commands) {
        insertCommand.run(
          command.commandId,
          command.runId,
          command.commandKey,
          command.commandType,
          command.schemaVersion,
          command.triggeringStateVersion,
          canonicalJson(command),
          this.now(),
        );
      }

      const metadata = this.database
        .prepare(
          `SELECT next_audit_sequence, audit_chain_head
           FROM workspaces WHERE workspace_id = ?`,
        )
        .get(this.workspaceId) as {
        next_audit_sequence: number;
        audit_chain_head: string;
      };
      let sequence = metadata.next_audit_sequence - 1;
      let previousEntryHash = metadata.audit_chain_head;
      const insertAudit = this.database.prepare(`
        INSERT INTO audit_entries
          (audit_entry_id, workspace_id, run_id, sequence,
           state_version_before, state_version_after, fact_type, schema_version,
           actor_json, reason, evidence_json, causation_id, correlation_id,
           recorded_at, payload_json, previous_entry_hash, entry_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const fact of result.auditFacts) {
        sequence += 1;
        const withoutHash = {
          auditEntryId: `${request.runId}:audit:${sequence}`,
          sequence,
          runId: request.runId,
          stateVersionBefore: actualVersion,
          stateVersionAfter: nextVersion,
          factType: fact.type,
          schemaVersion: 1 as const,
          actor: fact.actor,
          ...(fact.reason === undefined ? {} : { reason: fact.reason }),
          evidence: fact.evidence,
          ...(request.causationId === undefined
            ? {}
            : { causationId: request.causationId }),
          ...(request.correlationId === undefined
            ? {}
            : { correlationId: request.correlationId }),
          recordedAt: this.now(),
          payload: fact.payload,
          previousEntryHash,
        };
        const entryHash = sha256(canonicalJson(withoutHash));
        const entry: AuditEntry = { ...withoutHash, entryHash };
        insertAudit.run(
          entry.auditEntryId,
          this.workspaceId,
          request.runId,
          sequence,
          actualVersion,
          nextVersion,
          fact.type,
          canonicalJson(fact.actor),
          fact.reason ?? null,
          canonicalJson(fact.evidence),
          request.causationId ?? null,
          request.correlationId ?? null,
          entry.recordedAt,
          canonicalJson(fact.payload),
          previousEntryHash,
          entryHash,
        );
        previousEntryHash = entryHash;
      }
      this.database
        .prepare(
          `UPDATE workspaces
           SET next_audit_sequence = ?, audit_chain_head = ?
           WHERE workspace_id = ?`,
        )
        .run(sequence + 1, previousEntryHash, this.workspaceId);
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (error instanceof AuthorityIntegrityError) {
        this.quarantine(error.message);
      }
      throw error;
    }
  }
}
