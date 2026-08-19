import { access, lstat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  WorkspaceOperationError,
  type AuditSummary,
  type RunSummary,
} from "../../application/workspace-operations.js";
import { decodeAuditEntry, type AuditRow } from "./audit-codec.js";

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
      const location = walExists ? databasePath : pathToFileURL(databasePath);
      if (!walExists && location instanceof URL) {
        location.searchParams.set("immutable", "1");
      }
      database = new DatabaseSync(location, { readOnly: true });
      database.exec("PRAGMA query_only = ON");
      const version = database
        .prepare(
          "SELECT schema_version FROM schema_metadata WHERE singleton = 1",
        )
        .get() as { schema_version: number } | undefined;
      if (version?.schema_version !== 2) {
        throw new WorkspaceOperationError(
          "SCHEMA_INCOMPATIBLE",
          `Unsupported database schema version: ${version?.schema_version ?? "missing"}`,
          { schemaVersion: version?.schema_version ?? null },
        );
      }
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
}
