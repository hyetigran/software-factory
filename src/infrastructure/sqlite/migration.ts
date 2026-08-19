import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../../domain/canonical-json.js";
import { decodeAuditEntry, type AuditRow } from "./audit-codec.js";

const ZERO_HASH = "0".repeat(64);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export class SqliteMigration {
  constructor(
    private readonly database: DatabaseSync,
    private readonly databasePath: string,
    private readonly now: () => string,
    private readonly workspaceId: string,
    private readonly fail: (message: string, options?: ErrorOptions) => never,
    private readonly verifyAuditChainCallback: () => void,
  ) {}

  private verifyLegacyAuthority(): void {
    const busy = this.database
      .prepare(
        `SELECT
          (SELECT count(*) FROM mutation_lease) AS leases,
          (SELECT count(*) FROM logical_commands WHERE status = 'running') AS commands,
          (SELECT count(*) FROM command_attempts WHERE status = 'started') AS attempts`,
      )
      .get() as { leases: number; commands: number; attempts: number };
    if (busy.leases > 0 || busy.commands > 0 || busy.attempts > 0) {
      this.fail("Migration requires an idle mutation lease");
    }
    const metadata = this.database
      .prepare(
        "SELECT next_audit_sequence, audit_chain_head FROM workspaces WHERE workspace_id = ?",
      )
      .get(this.workspaceId) as
      { next_audit_sequence: number; audit_chain_head: string } | undefined;
    const rows = this.database
      .prepare(
        "SELECT * FROM audit_entries WHERE workspace_id = ? ORDER BY sequence",
      )
      .all(this.workspaceId) as AuditRow[];
    let previousHash = ZERO_HASH;
    const versions = new Map<string, number>();
    for (const [index, row] of rows.entries()) {
      const entry = decodeAuditEntry(row, (message) => this.fail(message));
      const { entryHash, ...withoutHash } = entry;
      if (
        entry.sequence !== index + 1 ||
        entry.previousEntryHash !== previousHash ||
        sha256(canonicalJson(withoutHash)) !== entryHash ||
        (versions.get(entry.runId) ?? 0) !== entry.stateVersionBefore
      ) {
        this.fail("Legacy audit chain verification failed");
      }
      versions.set(entry.runId, entry.stateVersionAfter);
      previousHash = entryHash;
    }
    const runs = this.database
      .prepare("SELECT run_id, state_version FROM runs")
      .all() as Array<{ run_id: string; state_version: number }>;
    if (
      metadata === undefined ||
      metadata.audit_chain_head !== previousHash ||
      metadata.next_audit_sequence !== rows.length + 1 ||
      runs.some((run) => versions.get(run.run_id) !== run.state_version)
    ) {
      this.fail("Legacy authority disagrees with its audit chain");
    }
  }

  private verifyPostMigrationObjectsAndIndexes(
    expectedObjectHashes: string[],
  ): void {
    const currentHashes = (
      this.database
        .prepare("SELECT content_hash FROM artifacts ORDER BY content_hash")
        .all() as Array<{ content_hash: string }>
    ).map(({ content_hash }) => content_hash);
    if (canonicalJson(currentHashes) !== canonicalJson(expectedObjectHashes)) {
      this.fail("Migration changed the referenced-object manifest");
    }
    for (const contentHash of currentHashes) {
      const bytes = readFileSync(
        resolve(dirname(this.databasePath), "objects", contentHash),
      );
      if (sha256(bytes) !== contentHash) {
        this.fail(`Post-migration object verification failed: ${contentHash}`);
      }
    }
    const duplicateCommands = this.database
      .prepare(
        `SELECT 1 FROM logical_commands
         GROUP BY run_id, command_key HAVING count(*) > 1 LIMIT 1`,
      )
      .get();
    const activeRuns = this.database
      .prepare(
        `SELECT 1 FROM runs
         WHERE state NOT IN ('approved','approved_with_waivers','halted','cancelled')
         GROUP BY workspace_id HAVING count(*) > 1 LIMIT 1`,
      )
      .get();
    if (duplicateCommands !== undefined || activeRuns !== undefined) {
      this.fail("Post-migration uniqueness verification failed");
    }
  }

  migrate(): void {
    const initialized = this.database
      .prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_metadata'",
      )
      .get();
    const newlyInitialized = initialized === undefined;
    if (newlyInitialized) {
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
    if (newlyInitialized) {
      this.database.exec(
        readFileSync(
          resolve(
            dirname(fileURLToPath(import.meta.url)),
            "../../../database/migrations/0002_run_state_snapshots.sql",
          ),
          "utf8",
        ),
      );
      this.database
        .prepare(
          `INSERT INTO workspaces
            (workspace_id, created_at, audit_chain_head, next_audit_sequence)
           VALUES (?, ?, ?, 1)`,
        )
        .run(this.workspaceId, this.now(), ZERO_HASH);
      version = { schema_version: 2 };
    }
    if (version?.schema_version === 1) {
      const migrationLeasePath = resolve(
        dirname(this.databasePath),
        "migration.lock",
      );
      writeFileSync(
        migrationLeasePath,
        canonicalJson({
          ownerProcess: process.pid,
          acquiredAt: this.now(),
          fromSchemaVersion: 1,
          toSchemaVersion: 2,
        }),
        { mode: 0o600, flag: "wx", flush: true },
      );
      const leaseDirectoryHandle = openSync(dirname(migrationLeasePath), "r");
      try {
        fsyncSync(leaseDirectoryHandle);
      } finally {
        closeSync(leaseDirectoryHandle);
      }
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.verifyLegacyAuthority();
        const integrity = this.database
          .prepare("PRAGMA integrity_check")
          .all() as Array<{ integrity_check: string }> | undefined;
        const foreignKeys = this.database
          .prepare("PRAGMA foreign_key_check")
          .all();
        if (
          integrity?.length !== 1 ||
          integrity[0]?.integrity_check !== "ok" ||
          foreignKeys.length > 0
        ) {
          this.fail("Schema v1 failed the pre-migration integrity gate");
        }
        const backupId = `schema-1-to-2-${this.now().replaceAll(/[^0-9A-Za-z]/gu, "")}`;
        const backupDirectory = resolve(
          dirname(this.databasePath),
          "backups",
          backupId,
        );
        mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
        const backupPath = resolve(backupDirectory, "state.db");
        const objectHashes = (
          this.database
            .prepare("SELECT content_hash FROM artifacts ORDER BY content_hash")
            .all() as Array<{ content_hash: string }>
        ).map(({ content_hash }) => content_hash);
        for (const contentHash of objectHashes) {
          const objectPath = resolve(
            dirname(this.databasePath),
            "objects",
            contentHash,
          );
          let bytes: Buffer;
          try {
            bytes = readFileSync(objectPath);
          } catch (error) {
            this.fail(`Migration object is missing: ${contentHash}`, {
              cause: error,
            });
          }
          if (sha256(bytes) !== contentHash) {
            this.fail(`Migration object is corrupt: ${contentHash}`);
          }
        }
        this.database.exec("COMMIT");
        this.database.exec(
          `VACUUM main INTO '${backupPath.replaceAll("'", "''")}'`,
        );
        this.database.exec("BEGIN IMMEDIATE");
        if (!existsSync(migrationLeasePath)) {
          this.fail("Migration mutation lease was lost");
        }
        const backupBytes = readFileSync(backupPath);
        const chain = this.database
          .prepare(
            "SELECT audit_chain_head FROM workspaces WHERE workspace_id = ?",
          )
          .get(this.workspaceId) as { audit_chain_head: string } | undefined;
        const manifestPath = resolve(backupDirectory, "manifest.json");
        const executingCliVersion = (
          JSON.parse(
            readFileSync(
              resolve(
                dirname(fileURLToPath(import.meta.url)),
                "../../../package.json",
              ),
              "utf8",
            ),
          ) as { version: string }
        ).version;
        const manifest = canonicalJson({
          backupId,
          databaseHash: sha256(backupBytes),
          fromSchemaVersion: 1,
          objectHashes,
          auditChainHead: chain?.audit_chain_head ?? ZERO_HASH,
          cliVersion: executingCliVersion,
          createdAt: this.now(),
        });
        writeFileSync(manifestPath, manifest, { mode: 0o600, flag: "wx" });
        const verifiedManifest = JSON.parse(
          readFileSync(manifestPath, "utf8"),
        ) as {
          backupId: string;
          databaseHash: string;
          fromSchemaVersion: number;
          objectHashes: string[];
          auditChainHead: string;
          cliVersion: string;
        };
        if (
          verifiedManifest.backupId !== backupId ||
          verifiedManifest.fromSchemaVersion !== 1 ||
          verifiedManifest.auditChainHead !==
            (chain?.audit_chain_head ?? ZERO_HASH) ||
          canonicalJson(verifiedManifest.objectHashes) !==
            canonicalJson(objectHashes) ||
          verifiedManifest.cliVersion !== executingCliVersion ||
          sha256(readFileSync(backupPath)) !== verifiedManifest.databaseHash
        ) {
          this.fail("Migration backup verification failed");
        }
        const moduleDirectory = dirname(fileURLToPath(import.meta.url));
        const migrationPath = resolve(
          moduleDirectory,
          "../../../database/migrations/0002_run_state_snapshots.sql",
        );
        this.database.exec(readFileSync(migrationPath, "utf8"));
        this.database
          .prepare(
            `INSERT INTO migration_history
            (migration_id, from_schema_version, to_schema_version,
             backup_manifest_path, completed_at)
           VALUES (?, 1, 2, ?, ?)`,
          )
          .run("0002_run_state_snapshots", manifestPath, this.now());
        const workspace = this.database
          .prepare(
            `SELECT next_audit_sequence, audit_chain_head FROM workspaces
             WHERE workspace_id = ?`,
          )
          .get(this.workspaceId) as
          | {
              next_audit_sequence: number;
              audit_chain_head: string;
            }
          | undefined;
        if (workspace !== undefined) {
          let sequence = workspace.next_audit_sequence;
          let previousEntryHash = workspace.audit_chain_head;
          const runs = this.database
            .prepare("SELECT run_id, state_version FROM runs ORDER BY run_id")
            .all() as Array<{ run_id: string; state_version: number }>;
          for (const run of runs) {
            const withoutHash = {
              auditEntryId: `${run.run_id}:audit:${sequence}`,
              sequence,
              runId: run.run_id,
              stateVersionBefore: run.state_version,
              stateVersionAfter: run.state_version,
              factType: "migration_completed",
              schemaVersion: 1 as const,
              actor: {
                kind: "system",
                component: "sqlite_migration",
                version: verifiedManifest.cliVersion,
              },
              reason: "Migrated authoritative database schema",
              evidence: [],
              recordedAt: this.now(),
              payload: {
                fromSchemaVersion: 1,
                toSchemaVersion: 2,
                backupManifestPath: manifestPath,
                migrationIds: ["0002_run_state_snapshots"],
              },
              previousEntryHash,
            };
            const entryHash = sha256(canonicalJson(withoutHash));
            this.database
              .prepare(
                `INSERT INTO audit_entries
                  (audit_entry_id, workspace_id, run_id, sequence,
                   state_version_before, state_version_after, fact_type,
                   schema_version, actor_json, reason, evidence_json,
                   recorded_at, payload_json, previous_entry_hash, entry_hash)
                 VALUES (?, ?, ?, ?, ?, ?, 'migration_completed', 1, ?, ?,
                         '[]', ?, ?, ?, ?)`,
              )
              .run(
                withoutHash.auditEntryId,
                this.workspaceId,
                run.run_id,
                sequence,
                run.state_version,
                run.state_version,
                canonicalJson(withoutHash.actor),
                withoutHash.reason,
                withoutHash.recordedAt,
                canonicalJson(withoutHash.payload),
                previousEntryHash,
                entryHash,
              );
            previousEntryHash = entryHash;
            sequence += 1;
          }
          this.database
            .prepare(
              `UPDATE workspaces SET next_audit_sequence = ?, audit_chain_head = ?
               WHERE workspace_id = ?`,
            )
            .run(sequence, previousEntryHash, this.workspaceId);
        }
        this.verifyAuditChainCallback();
        this.verifyPostMigrationObjectsAndIndexes(objectHashes);
        const postIntegrity = this.database
          .prepare("PRAGMA integrity_check")
          .all() as Array<{ integrity_check: string }>;
        if (
          postIntegrity.length !== 1 ||
          postIntegrity[0]?.integrity_check !== "ok" ||
          this.database.prepare("PRAGMA foreign_key_check").all().length > 0
        ) {
          this.fail("Post-migration integrity verification failed");
        }
        this.database.exec("COMMIT");
        unlinkSync(migrationLeasePath);
        const leaseDirectoryHandle = openSync(dirname(migrationLeasePath), "r");
        try {
          fsyncSync(leaseDirectoryHandle);
        } finally {
          closeSync(leaseDirectoryHandle);
        }
      } catch (error) {
        try {
          this.database.exec("ROLLBACK");
        } catch {
          // The preflight may fail before a transaction is active.
        }
        // Keep the durable lease on failure for diagnosis and explicit recovery.
        throw error;
      }
      version = this.database
        .prepare(
          "SELECT schema_version FROM schema_metadata WHERE singleton = 1",
        )
        .get() as { schema_version: number } | undefined;
    }
    if (version?.schema_version !== 2) {
      this.fail(
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
}
