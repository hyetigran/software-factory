import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../../domain/canonical-json.js";
import { decodeAuditEntry, type AuditRow } from "./audit-codec.js";

const ZERO_HASH = "0".repeat(64);

function fail(invalid: (message: string) => never, message: string): never {
  return invalid(message);
}

export function verifySqliteAuthorityIntegrity(
  database: DatabaseSync,
  workspaceId: string,
  invalid: (message: string) => never,
): void {
  const result = database.prepare("PRAGMA integrity_check").get() as
    { integrity_check: string } | undefined;
  if (result?.integrity_check !== "ok") {
    fail(
      invalid,
      `SQLite integrity check failed: ${result?.integrity_check ?? "no result"}`,
    );
  }
  if (database.prepare("PRAGMA foreign_key_check").get() !== undefined) {
    fail(invalid, "SQLite foreign-key check failed");
  }

  const metadata = database
    .prepare(
      `SELECT next_audit_sequence, audit_chain_head
       FROM workspaces WHERE workspace_id = ?`,
    )
    .get(workspaceId) as
    { next_audit_sequence: number; audit_chain_head: string } | undefined;
  if (metadata === undefined) fail(invalid, "Workspace metadata is missing");

  const rows = database
    .prepare(
      "SELECT * FROM audit_entries WHERE workspace_id = ? ORDER BY sequence",
    )
    .all(workspaceId) as AuditRow[];
  let previousHash = ZERO_HASH;
  const versionsByRun = new Map<string, { before: number; after: number }>();
  for (const [index, row] of rows.entries()) {
    if (row.sequence !== index + 1) {
      fail(invalid, "Audit sequence is not contiguous");
    }
    const entry = decodeAuditEntry(row, invalid);
    const { entryHash, ...withoutHash } = entry;
    const prior = versionsByRun.get(entry.runId);
    const versionsContinue =
      prior === undefined
        ? entry.stateVersionBefore === 0
        : (entry.stateVersionBefore === prior.before &&
            entry.stateVersionAfter === prior.after) ||
          entry.stateVersionBefore === prior.after;
    const computedHash = createHash("sha256")
      .update(canonicalJson(withoutHash))
      .digest("hex");
    if (
      entry.sequence !== row.sequence ||
      entry.previousEntryHash !== previousHash ||
      !versionsContinue ||
      entry.stateVersionAfter < entry.stateVersionBefore ||
      computedHash !== entryHash
    ) {
      fail(
        invalid,
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
    fail(invalid, "Audit chain head does not match metadata");
  }

  const runs = database
    .prepare(
      `SELECT runs.run_id, runs.state, runs.state_version,
              run_state_snapshots.state_version AS snapshot_state_version,
              run_state_snapshots.state_json
       FROM runs LEFT JOIN run_state_snapshots USING (run_id)`,
    )
    .all() as Array<{
    run_id: string;
    state: string;
    state_version: number;
    snapshot_state_version: number | null;
    state_json: string | null;
  }>;
  for (const run of runs) {
    if (run.state_json === null) {
      fail(invalid, `Authoritative run snapshot is missing: ${run.run_id}`);
    }
    let state: unknown;
    try {
      state = JSON.parse(run.state_json);
    } catch {
      fail(invalid, `Authoritative run snapshot is invalid: ${run.run_id}`);
    }
    if (state === null || typeof state !== "object" || Array.isArray(state)) {
      fail(invalid, `Authoritative run snapshot is invalid: ${run.run_id}`);
    }
    const snapshot = state as Record<string, unknown>;
    const audited = versionsByRun.get(run.run_id);
    if (
      audited === undefined ||
      audited.after !== run.state_version ||
      run.snapshot_state_version !== run.state_version ||
      snapshot.runId !== run.run_id ||
      snapshot.state !== run.state ||
      snapshot.stateVersion !== run.state_version
    ) {
      fail(
        invalid,
        `Authoritative run state disagrees with audit: ${run.run_id}`,
      );
    }
  }
}
