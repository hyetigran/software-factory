export type AuditRow = Record<string, string | number | null>;

function objectJson(
  value: string,
  invalid: (message: string) => never,
): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return invalid("Audit actor and payload JSON must be objects");
  }
  return parsed as Record<string, unknown>;
}

function arrayJson(
  value: string,
  invalid: (message: string) => never,
): unknown[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    return invalid("Audit evidence JSON must be an array");
  }
  return parsed;
}

export function decodeAuditEntry(
  row: AuditRow,
  invalid: (message: string) => never,
) {
  return {
    auditEntryId: String(row.audit_entry_id),
    sequence: Number(row.sequence),
    runId: String(row.run_id),
    stateVersionBefore: Number(row.state_version_before),
    stateVersionAfter: Number(row.state_version_after),
    factType: String(row.fact_type),
    schemaVersion: 1 as const,
    actor: objectJson(String(row.actor_json), invalid),
    ...(row.reason === null ? {} : { reason: String(row.reason) }),
    evidence: arrayJson(String(row.evidence_json), invalid),
    ...(row.causation_id === null
      ? {}
      : { causationId: String(row.causation_id) }),
    ...(row.correlation_id === null
      ? {}
      : { correlationId: String(row.correlation_id) }),
    recordedAt: String(row.recorded_at),
    payload: objectJson(String(row.payload_json), invalid),
    previousEntryHash: String(row.previous_entry_hash),
    entryHash: String(row.entry_hash),
  };
}
