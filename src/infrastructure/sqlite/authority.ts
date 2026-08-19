import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../../domain/canonical-json.js";
import type {
  AuthorityPort,
  AuthorityTransaction,
  PersistableCommand,
  PersistableTransition,
  PersistTransitionRequest,
  StagedArtifactRegistration,
  ValidatedProjectionData,
} from "../../application/authority-port.js";
import type {
  BeginAttemptRequest,
  BeginAttemptOutcome,
  CommandExecutionPort,
  CompleteAttemptRequest,
  CompletedCommandAttempt,
} from "../../application/execution-port.js";
import { commandIsValid } from "../../application/command-validation.js";
import { artifactRegistrationIsValid } from "../../application/artifact-port.js";
import { decideAttemptPolicy } from "../../application/attempt-policy.js";
import type { StagedArtifactDescriptor } from "../artifacts/object-store.js";
import type { ContentAddressedArtifactStore } from "../artifacts/object-store.js";
import {
  persistValidatedProjection,
  projectAuthoritativeState,
} from "./projections.js";
import { SqliteMigration } from "./migration.js";
import { decodeAuditEntry, type AuditRow } from "./audit-codec.js";
import { appendAuditEntries } from "./audit-journal.js";

const ZERO_HASH = "0".repeat(64);

type JsonObject = Record<string, unknown>;

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

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function stateIsTerminal(state: JsonObject): boolean {
  return ["approved", "approved_with_waivers", "halted", "cancelled"].includes(
    String(state.state),
  );
}

function reviewProjectionIsComplete(
  state: JsonObject,
  projection: ValidatedProjectionData,
): boolean {
  const findings = Array.isArray(state.activeFindings)
    ? (state.activeFindings as Array<Record<string, unknown>>)
    : [];
  const findingIds = findings.map(({ findingId }) => String(findingId));
  const observationIds = findings.map(({ latestObservationId }) =>
    String(latestObservationId),
  );
  const projectedFindingIds =
    projection.findingFingerprints?.map(({ findingId }) => findingId) ?? [];
  const projectedObservationIds =
    projection.observationAssociations?.map(
      ({ observationId }) => observationId,
    ) ?? [];
  return (
    projectedFindingIds.length === findingIds.length &&
    projectedObservationIds.length === observationIds.length &&
    new Set(projectedFindingIds).size === findingIds.length &&
    new Set(projectedObservationIds).size === observationIds.length &&
    findingIds.every((id) => projectedFindingIds.includes(id)) &&
    observationIds.every((id) => projectedObservationIds.includes(id))
  );
}

function parseObject(value: string): JsonObject {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AuthorityIntegrityError("Authoritative JSON must be an object");
  }
  return parsed as JsonObject;
}

function auditEntryFromRow(row: AuditRow): AuditEntry {
  return decodeAuditEntry(row, (message) => {
    throw new AuthorityIntegrityError(message);
  });
}

export class SqliteAuthority implements AuthorityPort, CommandExecutionPort {
  private constructor(
    private readonly database: DatabaseSync,
    private readonly databasePath: string,
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
      databasePath,
      now,
      "workspace_local",
      options.artifactStore,
    );
    try {
      new SqliteMigration(
        database,
        databasePath,
        now,
        "workspace_local",
        (message, errorOptions) => {
          throw new AuthorityIntegrityError(message, errorOptions);
        },
        () => authority.verifyAuditChain(),
      ).migrate();
    } catch (error) {
      database.close();
      throw error;
    }
    return authority;
  }

  close(): void {
    this.database.close();
  }

  async registerArtifact(descriptor: StagedArtifactDescriptor): Promise<void> {
    this.assertWritable();
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
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.assertWritable();
      this.persistArtifactMetadata(descriptor);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async verifyIntegrity(): Promise<void> {
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
      if (this.artifactStore === undefined) {
        throw new AuthorityIntegrityError(
          "Integrity verification requires a bound artifact store",
        );
      }
      const artifacts = this.database
        .prepare("SELECT artifact_id, content_hash, byte_length FROM artifacts")
        .all() as Array<{
        artifact_id: string;
        content_hash: string;
        byte_length: number;
      }>;
      for (const artifact of artifacts) {
        let bytes: Buffer;
        try {
          bytes = await this.artifactStore.readVerified(artifact.content_hash);
        } catch (error) {
          throw new AuthorityIntegrityError(
            `Registered artifact body is missing or corrupt: ${artifact.artifact_id}`,
            { cause: error },
          );
        }
        if (bytes.byteLength !== artifact.byte_length) {
          throw new AuthorityIntegrityError(
            `Registered artifact length is invalid: ${artifact.artifact_id}`,
          );
        }
      }
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
    if (existsSync(resolve(dirname(this.databasePath), "migration.lock"))) {
      throw new AuthorityIntegrityError(
        "Workspace is read-only while schema migration owns the lease",
      );
    }
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
         LEFT JOIN run_state_snapshots USING (run_id)`,
      )
      .all() as Array<{
      run_id: string;
      state: string;
      state_version: number;
      snapshot_state_version: number;
      state_json: string | null;
    }>;
    for (const run of runs) {
      if (run.state_json === null) {
        throw new AuthorityIntegrityError(
          `Authoritative run snapshot is missing: ${run.run_id}`,
        );
      }
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

  async transaction<T>(
    work: (transaction: AuthorityTransaction) => T,
  ): Promise<T> {
    this.assertWritable();
    await this.verifyIntegrity();
    this.database.exec("BEGIN IMMEDIATE");
    let active = true;
    let persisted = false;
    const assertActive = (): void => {
      if (!active) throw new Error("Authority transaction is no longer active");
    };
    const transaction: AuthorityTransaction = {
      loadRun: <TState extends object>(runId: string): TState | null => {
        assertActive();
        return this.loadRun<TState>(runId);
      },
      persist: <TState extends object>(
        request: PersistTransitionRequest,
        result: PersistableTransition<TState>,
      ): void => {
        assertActive();
        if (persisted) {
          throw new Error("Authority transaction accepts exactly one input");
        }
        this.persistAcceptedTransition(request, result);
        persisted = true;
      },
    };
    try {
      this.verifyAuditChain();
      const result = work(transaction);
      if (result !== null && typeof result === "object" && "then" in result) {
        throw new TypeError(
          "Authority transaction callback must be synchronous",
        );
      }
      if (!persisted) {
        throw new Error(
          "Authority transaction requires exactly one accepted input",
        );
      }
      this.database.exec("COMMIT");
      active = false;
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      active = false;
      if (error instanceof AuthorityIntegrityError) {
        this.quarantine(error.message);
      }
      throw error;
    }
  }

  async beginAttempt(
    request: BeginAttemptRequest,
  ): Promise<BeginAttemptOutcome> {
    this.assertWritable();
    await this.verifyIntegrity();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.assertWritable();
      this.verifyAuditChain();
      const row = this.database
        .prepare(
          `SELECT c.run_id, c.status, c.triggering_state_version,
                  c.accepted_attempt_id, c.specification_json,
                  r.state_version, r.configuration_artifact_id,
                  s.state_json, a.content_hash AS configuration_content_hash
             FROM logical_commands c
             JOIN runs r ON r.run_id = c.run_id
             JOIN run_state_snapshots s ON s.run_id = r.run_id
             JOIN artifacts a ON a.artifact_id = r.configuration_artifact_id
            WHERE c.command_id = ?`,
        )
        .get(request.commandId) as
        | {
            run_id: string;
            status: string;
            triggering_state_version: number;
            accepted_attempt_id: string | null;
            specification_json: string;
            state_version: number;
            configuration_artifact_id: string;
            configuration_content_hash: string;
            state_json: string;
          }
        | undefined;
      if (row === undefined)
        throw new TypeError("Logical command does not exist");
      const state = parseObject(row.state_json);
      const command = parseObject(row.specification_json) as PersistableCommand;
      if (
        row.run_id !== request.runId ||
        request.policy.runId !== request.runId ||
        row.configuration_artifact_id !== request.configurationArtifactId ||
        request.policy.configurationArtifactId !==
          request.configurationArtifactId ||
        state.configurationContentHash !== request.policy.configurationHash ||
        row.configuration_content_hash !== request.policy.configurationHash ||
        command.policyHash !== request.policy.configuration.policyHash ||
        !commandIsValid(command)
      ) {
        throw new TypeError("Logical command is not eligible for execution");
      }
      if (
        command.runId !== row.run_id ||
        command.triggeringStateVersion !== row.triggering_state_version
      ) {
        throw new AuthorityIntegrityError(
          "Logical command relational identity disagrees with its envelope",
        );
      }
      if (
        row.accepted_attempt_id !== null &&
        request.attemptKind !== "human_rerun"
      ) {
        this.database.exec("COMMIT");
        return {
          status: "already_succeeded",
          runId: request.runId,
          commandId: request.commandId,
          acceptedAttemptId: row.accepted_attempt_id,
        };
      }
      const unresolvedInputHash = command.inputArtifactHashes.find(
        (hash) =>
          this.database
            .prepare("SELECT 1 FROM artifacts WHERE content_hash = ?")
            .get(hash) === undefined,
      );
      if (unresolvedInputHash !== undefined) {
        throw new TypeError("Logical command input artifact is unavailable");
      }
      const prerequisites = command.prerequisiteCommandIds ?? [];
      const resolvedPrerequisiteArtifacts = prerequisites.map((commandId) => {
        const prerequisite = this.database
          .prepare(
            `SELECT c.status, c.accepted_attempt_id, a.result_artifact_id,
                    r.content_hash
               FROM logical_commands c
               LEFT JOIN command_attempts a ON a.attempt_id = c.accepted_attempt_id
               LEFT JOIN artifacts r ON r.artifact_id = a.result_artifact_id
              WHERE c.command_id = ? AND c.run_id = ?`,
          )
          .get(commandId, request.runId) as
          | {
              status: string;
              accepted_attempt_id: string | null;
              result_artifact_id: string | null;
              content_hash: string | null;
            }
          | undefined;
        if (
          prerequisite?.status !== "succeeded" ||
          prerequisite.accepted_attempt_id === null ||
          prerequisite.result_artifact_id === null ||
          prerequisite.content_hash === null
        ) {
          throw new TypeError("Logical command prerequisites are incomplete");
        }
        return {
          commandId,
          attemptId: prerequisite.accepted_attempt_id,
          artifactId: prerequisite.result_artifact_id,
          contentHash: prerequisite.content_hash,
        };
      });
      const lease = this.database
        .prepare("SELECT command_id FROM mutation_lease WHERE singleton = 1")
        .get() as { command_id: string } | undefined;
      if (lease !== undefined)
        throw new TypeError("Mutation lease is unavailable");
      const attemptCounts = this.database
        .prepare(
          `SELECT count(*) AS run_attempts,
                  sum(CASE WHEN a.command_id = ? THEN 1 ELSE 0 END) AS command_attempts
             FROM command_attempts a
             JOIN logical_commands c ON c.command_id = a.command_id
            WHERE c.run_id = ?`,
        )
        .get(request.commandId, request.runId) as {
        run_attempts: number;
        command_attempts: number | null;
      };
      const lastAttempt = this.database
        .prepare(
          `SELECT attempt_id, status, failure_class, correlation_id
             FROM command_attempts
            WHERE command_id = ? ORDER BY attempt_number DESC LIMIT 1`,
        )
        .get(request.commandId) as
        | {
            attempt_id: string;
            status: string;
            failure_class: string | null;
            correlation_id: string;
          }
        | undefined;
      const priorAttempts = attemptCounts.command_attempts ?? 0;
      const recoveryCounts = this.database
        .prepare(
          `SELECT
             sum(CASE WHEN json_extract(payload_json, '$.attemptKind') = 'transport_retry' THEN 1 ELSE 0 END) AS retries,
             sum(CASE WHEN json_extract(payload_json, '$.attemptKind') = 'schema_repair' THEN 1 ELSE 0 END) AS repairs
           FROM audit_entries
           WHERE run_id = ? AND fact_type = 'command_attempt_started'
             AND json_extract(payload_json, '$.commandId') = ?`,
        )
        .get(request.runId, request.commandId) as {
        retries: number | null;
        repairs: number | null;
      };
      const humanRerunAuthorized =
        request.humanAuthorizationId !== undefined &&
        (() => {
          const decision = this.database
            .prepare(
              `SELECT 1 FROM human_decisions
                WHERE decision_id = ? AND run_id = ?
                  AND decision_type = 'rerun_authorized'
                  AND json_extract(evidence_json, '$[0].kind') = 'rerun_authorization'
                  AND json_extract(evidence_json, '$[0].commandId') = ?
                  AND json_extract(evidence_json, '$[0].attemptId') = ?
                  AND json_extract(evidence_json, '$[0].correlationId') = ?`,
            )
            .get(
              request.humanAuthorizationId,
              request.runId,
              request.commandId,
              request.attemptId,
              request.correlationId,
            );
          if (decision === undefined) return false;
          const alreadyUsed = this.database
            .prepare(
              `SELECT 1 FROM audit_entries
                WHERE run_id = ? AND fact_type = 'command_attempt_started'
                  AND json_extract(payload_json, '$.humanAuthorizationId') = ?
                LIMIT 1`,
            )
            .get(request.runId, request.humanAuthorizationId);
          return alreadyUsed === undefined;
        })();
      const strictReplayVerified =
        request.strictReplay !== undefined &&
        this.recordingManifestMatches(request.strictReplay, command);
      const decision = decideAttemptPolicy(
        request,
        {
          logicalStatus: row.status,
          acceptedAttemptId: row.accepted_attempt_id,
          triggeringStateVersion: row.triggering_state_version,
          currentStateVersion: row.state_version,
          commandType: command.commandType,
          commandReservation: command.budgetReservation,
          priorAttempts,
          transportRetries: recoveryCounts.retries ?? 0,
          schemaRepairs: recoveryCounts.repairs ?? 0,
          runAttempts: attemptCounts.run_attempts,
          ...(lastAttempt === undefined
            ? {}
            : {
                lastAttempt: {
                  attemptId: lastAttempt.attempt_id,
                  status: lastAttempt.status,
                  failureClass: lastAttempt.failure_class,
                  correlationId: lastAttempt.correlation_id,
                },
              }),
          humanRerunAuthorized,
          strictReplayVerified,
        },
        request.policy,
      );
      if (decision.noOpAcceptedAttemptId !== undefined) {
        this.database.exec("COMMIT");
        return {
          status: "already_succeeded",
          runId: request.runId,
          commandId: request.commandId,
          acceptedAttemptId: decision.noOpAcceptedAttemptId,
        };
      }
      const usage = this.database
        .prepare(
          `SELECT
             coalesce(sum(CASE WHEN kind = 'release' THEN -calls ELSE calls END), 0) calls,
             coalesce(sum(CASE WHEN kind = 'release' THEN -input_tokens ELSE input_tokens END), 0) input_tokens,
             coalesce(sum(CASE WHEN kind = 'release' THEN -output_tokens ELSE output_tokens END), 0) output_tokens,
             coalesce(sum(CASE WHEN kind = 'release' THEN -cost_usd_micros ELSE cost_usd_micros END), 0) cost
           FROM usage_ledger WHERE run_id = ?`,
        )
        .get(request.runId) as {
        calls: number;
        input_tokens: number;
        output_tokens: number;
        cost: number;
      };
      const reservation = decision.reservation;
      if (
        usage.calls + reservation.calls > request.policy.ceilings.calls ||
        usage.input_tokens + reservation.inputTokens >
          request.policy.ceilings.inputTokens ||
        usage.output_tokens + reservation.outputTokens >
          request.policy.ceilings.outputTokens ||
        usage.cost + reservation.costUsdMicros >
          request.policy.ceilings.costUsdMicros
      ) {
        throw new TypeError(
          "Command reservation exceeds a hard budget ceiling",
        );
      }
      const startedAt = this.now();
      const attemptNumber = (attemptCounts.command_attempts ?? 0) + 1;
      this.database
        .prepare(
          `INSERT INTO command_attempts
             (attempt_id, command_id, attempt_number, status, correlation_id, started_at)
           VALUES (?, ?, ?, 'started', ?, ?)`,
        )
        .run(
          request.attemptId,
          request.commandId,
          attemptNumber,
          request.correlationId,
          startedAt,
        );
      this.database
        .prepare(
          `INSERT INTO usage_ledger
             (usage_entry_id, run_id, command_id, attempt_id, kind,
              calls, input_tokens, output_tokens, cost_usd_micros, created_at)
           VALUES (?, ?, ?, ?, 'reservation', ?, ?, ?, ?, ?)`,
        )
        .run(
          `${request.attemptId}:reservation`,
          request.runId,
          request.commandId,
          request.attemptId,
          reservation.calls,
          reservation.inputTokens,
          reservation.outputTokens,
          reservation.costUsdMicros,
          startedAt,
        );
      this.database
        .prepare(
          `INSERT INTO mutation_lease
             (singleton, command_id, attempt_id, owner_process, acquired_at, heartbeat_at)
           VALUES (1, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.commandId,
          request.attemptId,
          request.ownerProcess,
          startedAt,
          startedAt,
        );
      if (row.accepted_attempt_id === null) {
        this.database
          .prepare(
            "UPDATE logical_commands SET status = 'running' WHERE command_id = ?",
          )
          .run(request.commandId);
      }
      appendAuditEntries({
        database: this.database,
        workspaceId: this.workspaceId,
        runId: request.runId,
        stateVersionBefore: row.state_version,
        stateVersionAfter: row.state_version,
        correlationId: request.correlationId,
        facts: [
          {
            type: "command_attempt_started",
            actor: { kind: "system", component: "executor", version: "0.0.0" },
            reason: "Begin an eligible physical command attempt",
            evidence: [
              ...(request.humanAuthorizationId === undefined
                ? []
                : [
                    {
                      kind: "human_decision",
                      decisionId: request.humanAuthorizationId,
                    },
                  ]),
              ...(request.strictReplay === undefined
                ? []
                : [
                    {
                      kind: "artifact",
                      artifactId:
                        request.strictReplay.recordingManifestArtifactId,
                    },
                  ]),
            ],
            payload: {
              commandId: request.commandId,
              attemptId: request.attemptId,
              attemptNumber,
              correlationId: request.correlationId,
              attemptKind: request.attemptKind,
              humanAuthorizationId: request.humanAuthorizationId ?? null,
              recordingManifestArtifactId:
                request.strictReplay?.recordingManifestArtifactId ?? null,
            },
          },
          {
            type: "budget_reserved",
            actor: { kind: "system", component: "executor", version: "0.0.0" },
            reason: "Reserve the command maximum before dispatch",
            evidence: [],
            payload: { commandId: request.commandId, reservation },
          },
          ...(decision.duplicateCallPossible &&
          decision.priorAttemptId !== undefined
            ? [
                {
                  type: "duplicate_call_possible",
                  actor: {
                    kind: "system",
                    component: "executor",
                    version: "0.0.0",
                  },
                  reason:
                    "Retrying an unresolved provider outcome may duplicate generation and billing",
                  evidence: [],
                  payload: {
                    commandId: request.commandId,
                    priorAttemptId: decision.priorAttemptId,
                    newAttemptId: request.attemptId,
                    correlationId: request.correlationId,
                    reservation,
                  },
                },
              ]
            : []),
        ],
        now: this.now,
      });
      this.database.exec("COMMIT");
      return {
        status: "started",
        runId: request.runId,
        commandId: request.commandId,
        attemptId: request.attemptId,
        attemptNumber,
        triggeringStateVersion: row.triggering_state_version,
        correlationId: request.correlationId,
        reservation,
        lease: {
          ownerProcess: request.ownerProcess,
          acquiredAt: startedAt,
          heartbeatAt: startedAt,
        },
        startedAt,
        resolvedPrerequisiteArtifacts,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (error instanceof AuthorityIntegrityError)
        this.quarantine(error.message);
      throw error;
    }
  }

  async completeAttempt(
    request: CompleteAttemptRequest,
  ): Promise<CompletedCommandAttempt> {
    this.assertWritable();
    await this.verifyIntegrity();
    this.verifyStagedArtifact(request.resultArtifact);
    this.verifyStagedArtifact(request.nativeUsageArtifact);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.assertWritable();
      this.verifyAuditChain();
      const row = this.database
        .prepare(
          `SELECT c.run_id, c.status AS command_status, c.accepted_attempt_id,
                  c.triggering_state_version, c.specification_json,
                  a.status AS attempt_status, a.correlation_id,
                  l.owner_process, l.attempt_id AS lease_attempt_id,
                  r.state_version
             FROM logical_commands c
             JOIN command_attempts a ON a.command_id = c.command_id
             JOIN runs r ON r.run_id = c.run_id
             LEFT JOIN mutation_lease l ON l.singleton = 1
            WHERE c.command_id = ? AND a.attempt_id = ?`,
        )
        .get(request.commandId, request.attemptId) as
        | {
            run_id: string;
            command_status: string;
            accepted_attempt_id: string | null;
            triggering_state_version: number;
            specification_json: string;
            attempt_status: string;
            correlation_id: string;
            owner_process: string | null;
            lease_attempt_id: string | null;
            state_version: number;
          }
        | undefined;
      if (
        row === undefined ||
        row.run_id !== request.runId ||
        row.attempt_status !== "started" ||
        row.correlation_id !== request.correlationId ||
        row.lease_attempt_id !== request.attemptId ||
        row.owner_process !== request.ownerProcess
      ) {
        throw new TypeError("Command attempt completion is not eligible");
      }
      const command = parseObject(row.specification_json) as PersistableCommand;
      if (!commandIsValid(command)) {
        throw new AuthorityIntegrityError(
          "Logical command envelope is invalid during completion",
        );
      }
      const reservation = command.budgetReservation;
      const actual = request.actualUsage;
      if (
        actual.calls > reservation.calls ||
        actual.inputTokens > reservation.inputTokens ||
        actual.outputTokens > reservation.outputTokens ||
        actual.costUsdMicros > reservation.costUsdMicros
      ) {
        throw new TypeError("Actual usage exceeds the reserved maximum");
      }
      this.persistArtifactMetadata(request.resultArtifact);
      this.persistArtifactMetadata(request.nativeUsageArtifact);
      const completedAt = this.now();
      this.database
        .prepare(
          `UPDATE command_attempts
              SET status = 'completed', provider_request_id = ?,
                  provider_response_id = ?, result_artifact_id = ?,
                  native_usage_artifact_id = ?, completed_at = ?
            WHERE attempt_id = ?`,
        )
        .run(
          request.providerEvidence.providerRequestId ?? null,
          request.providerEvidence.providerResponseId ?? null,
          request.resultArtifact.artifactId,
          request.nativeUsageArtifact.artifactId,
          completedAt,
          request.attemptId,
        );
      const acceptedAsLogicalResult = row.accepted_attempt_id === null;
      if (acceptedAsLogicalResult) {
        this.database
          .prepare(
            `UPDATE logical_commands
                SET status = 'succeeded', accepted_attempt_id = ?
              WHERE command_id = ?`,
          )
          .run(request.attemptId, request.commandId);
      }
      for (const [kind, usage] of [
        ["release", reservation],
        ["actual", actual],
      ] as const) {
        this.database
          .prepare(
            `INSERT INTO usage_ledger
               (usage_entry_id, run_id, command_id, attempt_id, kind,
                calls, input_tokens, output_tokens, cost_usd_micros,
                native_usage_artifact_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            `${request.attemptId}:${kind}`,
            request.runId,
            request.commandId,
            request.attemptId,
            kind,
            usage.calls,
            usage.inputTokens,
            usage.outputTokens,
            usage.costUsdMicros,
            request.nativeUsageArtifact.artifactId,
            completedAt,
          );
      }
      appendAuditEntries({
        database: this.database,
        workspaceId: this.workspaceId,
        runId: request.runId,
        stateVersionBefore: row.state_version,
        stateVersionAfter: row.state_version,
        correlationId: request.correlationId,
        facts: [
          {
            type: "command_attempt_completed",
            actor: { kind: "system", component: "executor", version: "0.0.0" },
            reason: "Persist the verified physical command result",
            evidence: [
              {
                kind: "artifact",
                artifactId: request.resultArtifact.artifactId,
                contentHash: request.resultArtifact.contentHash,
              },
              {
                kind: "artifact",
                artifactId: request.nativeUsageArtifact.artifactId,
                contentHash: request.nativeUsageArtifact.contentHash,
              },
            ],
            payload: {
              commandId: request.commandId,
              attemptId: request.attemptId,
              resultArtifactId: request.resultArtifact.artifactId,
              nativeUsageArtifactId: request.nativeUsageArtifact.artifactId,
              acceptedAsLogicalResult,
              providerEvidence: request.providerEvidence,
            },
          },
          {
            type: "budget_reconciled",
            actor: { kind: "system", component: "executor", version: "0.0.0" },
            reason: "Replace the conservative reservation with actual usage",
            evidence: [
              {
                kind: "artifact",
                artifactId: request.nativeUsageArtifact.artifactId,
                contentHash: request.nativeUsageArtifact.contentHash,
              },
            ],
            payload: { commandId: request.commandId, reservation, actual },
          },
        ],
        now: this.now,
      });
      this.database
        .prepare("DELETE FROM mutation_lease WHERE singleton = 1")
        .run();
      this.database.exec("COMMIT");
      return {
        status: "completed",
        runId: request.runId,
        commandId: request.commandId,
        attemptId: request.attemptId,
        acceptedAsLogicalResult,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (error instanceof AuthorityIntegrityError)
        this.quarantine(error.message);
      throw error;
    }
  }

  private persistAcceptedTransition<TState extends object>(
    request: PersistTransitionRequest,
    result: PersistableTransition<TState>,
  ): void {
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
    for (const artifact of request.stagedArtifacts ?? []) {
      this.verifyStagedArtifact(artifact);
      this.persistArtifactMetadata(artifact);
    }
    const factTypes = new Set(result.auditFacts.map(({ type }) => type));
    const projection = request.validatedProjection?.toPersistenceData();
    if (
      (factTypes.has("ledger_submitted") &&
        (projection?.ledgerVersionId === undefined ||
          projection.ledgerContentHash === undefined ||
          projection.requirements === undefined ||
          projection.requirements.length === 0)) ||
      (factTypes.has("plan_version_accepted") &&
        (projection?.planVersionId === undefined ||
          projection.planContentHash === undefined ||
          projection.planSections === undefined ||
          projection.planSections.length === 0 ||
          projection.sectionTransitions === undefined ||
          projection.sectionTransitions.length === 0)) ||
      (factTypes.has("review_accepted") &&
        (projection?.reviewContentHash === undefined ||
          projection.findingFingerprints === undefined ||
          projection.observationAssociations === undefined ||
          !reviewProjectionIsComplete(nextState, projection)))
    ) {
      throw new TypeError(
        "Accepted transition requires a bound deterministic projection",
      );
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
    projectAuthoritativeState(
      this.database,
      request.runId,
      nextState,
      result.auditFacts,
      this.now(),
    );

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
    if (projection !== undefined) {
      persistValidatedProjection(
        this.database,
        request.runId,
        previousState as Record<string, unknown> | null,
        nextState,
        projection,
        this.now(),
      );
    }

    appendAuditEntries({
      database: this.database,
      workspaceId: this.workspaceId,
      runId: request.runId,
      stateVersionBefore: actualVersion,
      stateVersionAfter: nextVersion,
      ...(request.causationId === undefined
        ? {}
        : { causationId: request.causationId }),
      ...(request.correlationId === undefined
        ? {}
        : { correlationId: request.correlationId }),
      facts: result.auditFacts,
      now: this.now,
    });
  }

  private verifyStagedArtifact(artifact: StagedArtifactRegistration): void {
    if (
      this.artifactStore === undefined ||
      artifact.schemaVersion !== 1 ||
      !artifactRegistrationIsValid(artifact)
    ) {
      throw new AuthorityIntegrityError(
        `Staged artifact registration is invalid: ${artifact.artifactId}`,
      );
    }
    let handle: number | undefined;
    try {
      handle = openSync(
        this.artifactStore === undefined
          ? ""
          : join(this.artifactStore.workspace.objects, artifact.contentHash),
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      const stat = fstatSync(handle);
      const bytes = readFileSync(handle);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (
        !stat.isFile() ||
        stat.size !== artifact.byteLength ||
        hash !== artifact.contentHash
      ) {
        throw new AuthorityIntegrityError(
          `Staged artifact body is invalid: ${artifact.artifactId}`,
        );
      }
    } catch (error) {
      if (error instanceof AuthorityIntegrityError) throw error;
      throw new AuthorityIntegrityError(
        `Staged artifact body is unavailable: ${artifact.artifactId}`,
        { cause: error },
      );
    } finally {
      if (handle !== undefined) closeSync(handle);
    }
  }

  private recordingManifestMatches(
    replay: NonNullable<BeginAttemptRequest["strictReplay"]>,
    command: PersistableCommand,
  ): boolean {
    const artifact = this.database
      .prepare(
        `SELECT content_hash, schema_id FROM artifacts
          WHERE artifact_id = ? AND kind = 'other'`,
      )
      .get(replay.recordingManifestArtifactId) as
      { content_hash: string; schema_id: string | null } | undefined;
    return (
      artifact?.schema_id === "software-factory/provider-recording.v1" &&
      artifact.content_hash === replay.recordingManifestContentHash &&
      replay.commandKey === command.commandKey &&
      this.database
        .prepare(
          `SELECT 1 FROM artifacts WHERE artifact_id = ? AND content_hash = ?`,
        )
        .get(replay.responseArtifactId, replay.responseContentHash) !==
        undefined
    );
  }

  private persistArtifactMetadata(
    descriptor: StagedArtifactRegistration,
  ): void {
    const metadataJson = canonicalJson({
      createdBy: descriptor.createdBy,
      provenance: descriptor.provenance,
      schemaVersion: descriptor.schemaVersion,
    });
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
        metadataJson,
        this.now(),
      );
    const stored = this.database
      .prepare(
        `SELECT kind, content_hash, byte_length, media_type, schema_id, metadata_json
           FROM artifacts WHERE artifact_id = ?`,
      )
      .get(descriptor.artifactId) as
      | {
          kind: string;
          content_hash: string;
          byte_length: number;
          media_type: string;
          schema_id: string | null;
          metadata_json: string;
        }
      | undefined;
    if (
      stored === undefined ||
      stored.kind !== descriptor.kind ||
      stored.content_hash !== descriptor.contentHash ||
      stored.byte_length !== descriptor.byteLength ||
      stored.media_type !== descriptor.mediaType ||
      stored.schema_id !== (descriptor.schemaId ?? null) ||
      stored.metadata_json !== metadataJson
    ) {
      throw new AuthorityIntegrityError(
        `Artifact identity is already bound to different metadata: ${descriptor.artifactId}`,
      );
    }
  }
}
