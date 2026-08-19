import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { PersistableAuditFact } from "../../application/authority-port.js";
import { canonicalJson } from "../../domain/canonical-json.js";

export function appendAuditEntries(input: {
  database: DatabaseSync;
  workspaceId: string;
  runId: string;
  stateVersionBefore: number;
  stateVersionAfter: number;
  causationId?: string;
  correlationId?: string;
  facts: PersistableAuditFact[];
  now: () => string;
}): void {
  const metadata = input.database
    .prepare(
      `SELECT next_audit_sequence, audit_chain_head
         FROM workspaces WHERE workspace_id = ?`,
    )
    .get(input.workspaceId) as {
    next_audit_sequence: number;
    audit_chain_head: string;
  };
  let sequence = metadata.next_audit_sequence - 1;
  let previousEntryHash = metadata.audit_chain_head;
  const insertAudit = input.database.prepare(`
    INSERT INTO audit_entries
      (audit_entry_id, workspace_id, run_id, sequence,
       state_version_before, state_version_after, fact_type, schema_version,
       actor_json, reason, evidence_json, causation_id, correlation_id,
       recorded_at, payload_json, previous_entry_hash, entry_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const fact of input.facts) {
    sequence += 1;
    const withoutHash = {
      auditEntryId: `${input.runId}:audit:${sequence}`,
      sequence,
      runId: input.runId,
      stateVersionBefore: input.stateVersionBefore,
      stateVersionAfter: input.stateVersionAfter,
      factType: fact.type,
      schemaVersion: 1 as const,
      actor: fact.actor,
      ...(fact.reason === undefined ? {} : { reason: fact.reason }),
      evidence: fact.evidence,
      ...(input.causationId === undefined
        ? {}
        : { causationId: input.causationId }),
      ...(input.correlationId === undefined
        ? {}
        : { correlationId: input.correlationId }),
      recordedAt: input.now(),
      payload: fact.payload,
      previousEntryHash,
    };
    const entryHash = createHash("sha256")
      .update(canonicalJson(withoutHash))
      .digest("hex");
    insertAudit.run(
      withoutHash.auditEntryId,
      input.workspaceId,
      input.runId,
      sequence,
      input.stateVersionBefore,
      input.stateVersionAfter,
      fact.type,
      canonicalJson(fact.actor),
      fact.reason ?? null,
      canonicalJson(fact.evidence),
      input.causationId ?? null,
      input.correlationId ?? null,
      withoutHash.recordedAt,
      canonicalJson(fact.payload),
      previousEntryHash,
      entryHash,
    );
    previousEntryHash = entryHash;
  }
  input.database
    .prepare(
      `UPDATE workspaces SET next_audit_sequence = ?, audit_chain_head = ?
        WHERE workspace_id = ?`,
    )
    .run(sequence + 1, previousEntryHash, input.workspaceId);
}
