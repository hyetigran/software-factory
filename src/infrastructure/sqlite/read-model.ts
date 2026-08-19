import { access, lstat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  WorkspaceOperationError,
  type AuditSummary,
  type ArtifactSummary,
  type FindingSummary,
  type GateSummary,
  type RunSummary,
  type UsageSummary,
} from "../../application/workspace-operations.js";
import { decodeAuditEntry, type AuditRow } from "./audit-codec.js";
import { verifySqliteAuthorityIntegrity } from "./authority-integrity.js";

function stringArray(value: string, field: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw new WorkspaceOperationError(
      "INTEGRITY_ERROR",
      `${field} must be an array of strings`,
    );
  }
  return parsed;
}

function arrayValue(value: string, field: string): unknown[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new WorkspaceOperationError(
      "INTEGRITY_ERROR",
      `${field} must be an array`,
    );
  }
  return parsed;
}

function containsString(value: unknown, expected: string): boolean {
  if (value === expected) return true;
  if (Array.isArray(value))
    return value.some((item) => containsString(item, expected));
  return value !== null && typeof value === "object"
    ? Object.values(value).some((item) => containsString(item, expected))
    : false;
}

export class SqliteReadModel {
  private constructor(private readonly database: DatabaseSync) {}

  static async open(projectRoot: string): Promise<SqliteReadModel> {
    const databasePath = join(projectRoot, ".factory", "state.db");
    try {
      const metadata = await lstat(databasePath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new WorkspaceOperationError(
          "INTEGRITY_ERROR",
          `Authority path is not a regular file: ${databasePath}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new WorkspaceOperationError(
          "WORKSPACE_NOT_FOUND",
          `Software Factory workspace not found: ${projectRoot}`,
          { projectRoot },
        );
      }
      throw error;
    }
    let database: DatabaseSync | undefined;
    try {
      let walExists = true;
      try {
        await access(`${databasePath}-wal`);
      } catch {
        walExists = false;
      }
      const openDatabase = (immutable: boolean) => {
        const location = immutable ? pathToFileURL(databasePath) : databasePath;
        if (location instanceof URL)
          location.searchParams.set("immutable", "1");
        return new DatabaseSync(location, { readOnly: true });
      };
      database = openDatabase(!walExists);
      database.exec("PRAGMA query_only = ON");
      database.exec("BEGIN");
      const readVersion = () =>
        database
          ?.prepare(
            "SELECT schema_version FROM schema_metadata WHERE singleton = 1",
          )
          .get() as { schema_version: number } | undefined;
      let version = readVersion();
      if (!walExists) {
        let walAppeared = false;
        try {
          await access(`${databasePath}-wal`);
          walAppeared = true;
        } catch {
          // The immutable snapshot was pinned while no WAL existed.
        }
        if (walAppeared) {
          database.exec("ROLLBACK");
          database.close();
          database = openDatabase(false);
          database.exec("PRAGMA query_only = ON");
          database.exec("BEGIN");
          version = readVersion();
        }
      }
      if (version?.schema_version !== 2) {
        throw new WorkspaceOperationError(
          "SCHEMA_INCOMPATIBLE",
          `Unsupported database schema version: ${version?.schema_version ?? "missing"}`,
          { schemaVersion: version?.schema_version ?? null },
        );
      }
      const workspace = database
        .prepare("SELECT workspace_id FROM workspaces")
        .get() as { workspace_id: string } | undefined;
      if (workspace === undefined) {
        throw new WorkspaceOperationError(
          "INTEGRITY_ERROR",
          "Workspace metadata is missing",
        );
      }
      verifySqliteAuthorityIntegrity(
        database,
        workspace.workspace_id,
        (message) => {
          throw new WorkspaceOperationError("INTEGRITY_ERROR", message);
        },
      );
      return new SqliteReadModel(database);
    } catch (error) {
      database?.close();
      if (error instanceof WorkspaceOperationError) throw error;
      throw new WorkspaceOperationError(
        "INTEGRITY_ERROR",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  close(): void {
    if (this.database.isTransaction) this.database.exec("ROLLBACK");
    this.database.close();
  }

  listRuns(): RunSummary[] {
    return (
      this.database
        .prepare(
          "SELECT run_id, state, state_version, created_at FROM runs ORDER BY created_at, run_id",
        )
        .all() as Array<{
        run_id: string;
        state: string;
        state_version: number;
        created_at: string;
      }>
    ).map((row) => ({
      runId: row.run_id,
      state: row.state,
      stateVersion: row.state_version,
      createdAt: row.created_at,
    }));
  }

  loadRun(runId: string): object | null {
    const row = this.database
      .prepare("SELECT state_json FROM run_state_snapshots WHERE run_id = ?")
      .get(runId) as { state_json: string } | undefined;
    if (row === undefined) return null;
    const parsed: unknown = JSON.parse(row.state_json);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new WorkspaceOperationError(
        "INTEGRITY_ERROR",
        `Run snapshot is invalid: ${runId}`,
      );
    }
    return parsed;
  }

  listAudit(runId?: string): AuditSummary[] {
    const rows = (
      runId === undefined
        ? this.database
            .prepare("SELECT * FROM audit_entries ORDER BY sequence")
            .all()
        : this.database
            .prepare(
              "SELECT * FROM audit_entries WHERE run_id = ? ORDER BY sequence",
            )
            .all(runId)
    ) as AuditRow[];
    return rows.map((row) =>
      decodeAuditEntry(row, (message) => {
        throw new WorkspaceOperationError("INTEGRITY_ERROR", message);
      }),
    );
  }

  listArtifacts(
    runId?: string,
  ): Array<Omit<ArtifactSummary, "objectVerified">> {
    const rows = this.database
      .prepare("SELECT * FROM artifacts ORDER BY created_at, artifact_id")
      .all() as Array<{
      artifact_id: string;
      kind: string;
      content_hash: string;
      byte_length: number;
      media_type: string;
      schema_id: string | null;
      metadata_json: string;
      created_at: string;
    }>;
    const summaries = rows.map((row) => {
      const metadata: unknown = JSON.parse(row.metadata_json);
      if (
        metadata === null ||
        typeof metadata !== "object" ||
        Array.isArray(metadata)
      ) {
        throw new WorkspaceOperationError(
          "INTEGRITY_ERROR",
          `Artifact metadata is invalid: ${row.artifact_id}`,
        );
      }
      return {
        artifactId: row.artifact_id,
        kind: row.kind,
        contentHash: row.content_hash,
        byteLength: row.byte_length,
        mediaType: row.media_type,
        schemaId: row.schema_id,
        metadata,
        createdAt: row.created_at,
      };
    });
    if (runId === undefined) return summaries;

    const artifactIds = new Set(
      summaries.map((artifact) => artifact.artifactId),
    );
    const referenced = new Set<string>();
    const collect = (value: unknown): void => {
      if (typeof value === "string") {
        if (artifactIds.has(value)) referenced.add(value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(collect);
      } else if (value !== null && typeof value === "object") {
        Object.values(value).forEach(collect);
      }
    };
    const directRows = this.database
      .prepare(
        `SELECT source_artifact_id AS artifact_id FROM runs WHERE run_id = ?
         UNION SELECT configuration_artifact_id FROM runs WHERE run_id = ?
         UNION SELECT terminal_manifest_artifact_id FROM runs WHERE run_id = ?
         UNION SELECT artifact_id FROM ledger_versions WHERE run_id = ?
         UNION SELECT coverage_artifact_id FROM ledger_versions WHERE run_id = ?
         UNION SELECT structured_artifact_id FROM plan_versions WHERE run_id = ?
         UNION SELECT rendered_artifact_id FROM plan_versions WHERE run_id = ?
         UNION SELECT review_artifact_id FROM observations WHERE run_id = ?
         UNION SELECT evidence_artifact_id FROM gates WHERE run_id = ?
         UNION SELECT result_artifact_id FROM command_attempts
           JOIN logical_commands USING (command_id) WHERE logical_commands.run_id = ?
         UNION SELECT native_usage_artifact_id FROM command_attempts
           JOIN logical_commands USING (command_id) WHERE logical_commands.run_id = ?`,
      )
      .all(
        runId,
        runId,
        runId,
        runId,
        runId,
        runId,
        runId,
        runId,
        runId,
        runId,
        runId,
      ) as Array<{ artifact_id: string | null }>;
    directRows.forEach((row) => {
      if (row.artifact_id !== null) referenced.add(row.artifact_id);
    });
    const jsonRows = this.database
      .prepare(
        `SELECT state_json AS document FROM run_state_snapshots WHERE run_id = ?
         UNION ALL SELECT specification_json FROM logical_commands WHERE run_id = ?
         UNION ALL SELECT evidence_json FROM audit_entries WHERE run_id = ?
         UNION ALL SELECT payload_json FROM audit_entries WHERE run_id = ?
         UNION ALL SELECT evidence_json FROM human_decisions WHERE run_id = ?
         UNION ALL SELECT evidence_json FROM observations WHERE run_id = ?`,
      )
      .all(runId, runId, runId, runId, runId, runId) as Array<{
      document: string;
    }>;
    jsonRows.forEach((row) => collect(JSON.parse(row.document)));
    for (const artifact of summaries) {
      const provenance = (artifact.metadata as { provenance?: unknown })
        .provenance;
      if (
        provenance !== null &&
        typeof provenance === "object" &&
        !Array.isArray(provenance) &&
        (provenance as { commandId?: unknown }).commandId !== undefined
      ) {
        const commandId = (provenance as { commandId: unknown }).commandId;
        if (
          typeof commandId === "string" &&
          this.database
            .prepare(
              "SELECT 1 FROM logical_commands WHERE run_id = ? AND command_id = ?",
            )
            .get(runId, commandId) !== undefined
        ) {
          referenced.add(artifact.artifactId);
        }
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const artifact of summaries) {
        if (!referenced.has(artifact.artifactId)) continue;
        const before = referenced.size;
        collect(artifact.metadata);
        changed ||= referenced.size !== before;
      }
    }
    return summaries.filter((artifact) => referenced.has(artifact.artifactId));
  }

  listFindings(runId: string): FindingSummary[] {
    const rows = this.database
      .prepare(
        `SELECT findings.*, finding_fingerprints.fingerprint,
                finding_fingerprints.policy_hash, finding_fingerprints.created_at AS fingerprint_created_at
         FROM findings LEFT JOIN finding_fingerprints USING (finding_id)
         WHERE findings.run_id = ?
         ORDER BY findings.created_at, findings.finding_id,
                  finding_fingerprints.created_at, finding_fingerprints.policy_hash`,
      )
      .all(runId) as Array<{
      finding_id: string;
      status: string;
      current_severity: string;
      created_at: string;
      updated_at: string;
      fingerprint: string | null;
      policy_hash: string | null;
      fingerprint_created_at: string | null;
    }>;
    const findings = new Map<string, FindingSummary>();
    for (const row of rows) {
      const findingId = row.finding_id;
      const finding = findings.get(findingId) ?? {
        findingId,
        status: row.status,
        severity: row.current_severity,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        fingerprints: [],
        observations: [],
        waivers: [],
        history: [],
      };
      if (
        row.fingerprint !== null &&
        row.policy_hash !== null &&
        row.fingerprint_created_at !== null
      ) {
        finding.fingerprints.push({
          fingerprint: row.fingerprint,
          policyHash: row.policy_hash,
          createdAt: row.fingerprint_created_at,
        });
      }
      findings.set(findingId, finding);
    }
    const observations = this.database
      .prepare(
        "SELECT * FROM observations WHERE run_id = ? ORDER BY created_at, observation_id",
      )
      .all(runId) as Array<Record<string, string | null>>;
    for (const row of observations) {
      const findingId = row.finding_id;
      if (findingId === null || findingId === undefined) continue;
      const finding = findings.get(findingId);
      if (finding === undefined) continue;
      finding.observations.push({
        observationId: String(row.observation_id),
        reviewArtifactId: String(row.review_artifact_id),
        planVersionId: String(row.plan_version_id),
        reviewKind: String(row.review_kind),
        disposition: String(row.disposition),
        severity: String(row.severity),
        ruleId: String(row.rule_id),
        componentIds: stringArray(
          String(row.component_ids_json),
          "Observation component IDs",
        ),
        requirementIds: stringArray(
          String(row.requirement_ids_json),
          "Observation requirement IDs",
        ),
        evidence: arrayValue(String(row.evidence_json), "Observation evidence"),
        createdAt: String(row.created_at),
      });
    }
    const waivers = this.database
      .prepare(
        "SELECT * FROM waivers WHERE run_id = ? ORDER BY granted_at, waiver_id",
      )
      .all(runId) as Array<Record<string, string | null>>;
    for (const row of waivers) {
      const findingId = row.finding_id;
      const finding =
        findingId === null || findingId === undefined
          ? undefined
          : findings.get(findingId);
      if (finding === undefined) continue;
      finding.waivers.push({
        waiverId: String(row.waiver_id),
        status: String(row.status),
        reason: String(row.reason),
        evidenceHash: String(row.evidence_hash),
        grantedByActorId: String(row.granted_by_actor_id),
        grantedAt: String(row.granted_at),
        reaffirmedAt: row.reaffirmed_at ?? null,
      });
    }
    const audit = this.listAudit(runId);
    for (const finding of findings.values()) {
      finding.history = audit.filter((entry) =>
        containsString(entry, finding.findingId),
      );
    }
    return [...findings.values()];
  }

  loadUsage(runId: string): UsageSummary {
    const entries = (
      this.database
        .prepare(
          "SELECT * FROM usage_ledger WHERE run_id = ? ORDER BY created_at, usage_entry_id",
        )
        .all(runId) as Array<{
        usage_entry_id: string;
        command_id: string | null;
        attempt_id: string | null;
        kind: string;
        calls: number;
        input_tokens: number;
        output_tokens: number;
        cost_usd_micros: number;
        native_usage_artifact_id: string | null;
        created_at: string;
      }>
    ).map((row) => ({
      usageEntryId: row.usage_entry_id,
      commandId: row.command_id,
      attemptId: row.attempt_id,
      kind: row.kind,
      calls: row.calls,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsdMicros: row.cost_usd_micros,
      nativeUsageArtifactId: row.native_usage_artifact_id,
      createdAt: row.created_at,
    }));
    return {
      entries,
      actualAndConservative: entries.reduce(
        (total, entry) =>
          entry.kind === "actual" || entry.kind === "conservative_charge"
            ? {
                calls: total.calls + entry.calls,
                inputTokens: total.inputTokens + entry.inputTokens,
                outputTokens: total.outputTokens + entry.outputTokens,
                costUsdMicros: total.costUsdMicros + entry.costUsdMicros,
              }
            : total,
        { calls: 0, inputTokens: 0, outputTokens: 0, costUsdMicros: 0 },
      ),
      outstandingReserved: entries.reduce(
        (total, entry) => {
          const sign =
            entry.kind === "reservation"
              ? 1
              : entry.kind === "release"
                ? -1
                : 0;
          return {
            calls: total.calls + sign * entry.calls,
            inputTokens: total.inputTokens + sign * entry.inputTokens,
            outputTokens: total.outputTokens + sign * entry.outputTokens,
            costUsdMicros: total.costUsdMicros + sign * entry.costUsdMicros,
          };
        },
        { calls: 0, inputTokens: 0, outputTokens: 0, costUsdMicros: 0 },
      ),
      effectiveConsumption: entries.reduce(
        (total, entry) => {
          const sign =
            entry.kind === "actual" ||
            entry.kind === "conservative_charge" ||
            entry.kind === "reservation"
              ? 1
              : entry.kind === "release"
                ? -1
                : 0;
          return {
            calls: total.calls + sign * entry.calls,
            inputTokens: total.inputTokens + sign * entry.inputTokens,
            outputTokens: total.outputTokens + sign * entry.outputTokens,
            costUsdMicros: total.costUsdMicros + sign * entry.costUsdMicros,
          };
        },
        { calls: 0, inputTokens: 0, outputTokens: 0, costUsdMicros: 0 },
      ),
    };
  }

  listGates(runId: string): GateSummary[] {
    return (
      this.database
        .prepare(
          "SELECT * FROM gates WHERE run_id = ? ORDER BY evaluated_at, gate_id",
        )
        .all(runId) as Array<{
        gate_id: string;
        gate_type: string;
        status: string;
        evidence_artifact_id: string | null;
        evaluated_at: string;
      }>
    ).map((row) => ({
      gateId: row.gate_id,
      gateType: row.gate_type,
      status: row.status,
      evidenceArtifactId: row.evidence_artifact_id,
      evaluatedAt: row.evaluated_at,
    }));
  }
}
