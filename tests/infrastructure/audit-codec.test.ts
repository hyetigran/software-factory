import { describe, expect, it } from "vitest";

import { decodeAuditEntry } from "../../src/infrastructure/sqlite/audit-codec.js";

const row = {
  audit_entry_id: "audit_1",
  sequence: 1,
  run_id: "run_1",
  state_version_before: 0,
  state_version_after: 1,
  fact_type: "run_started",
  actor_json: '{"kind":"system"}',
  reason: null,
  evidence_json: "[]",
  causation_id: null,
  correlation_id: null,
  recorded_at: "2026-01-01T00:00:00.000Z",
  payload_json: "{}",
  previous_entry_hash: "0".repeat(64),
  entry_hash: "1".repeat(64),
};

describe("audit codec", () => {
  it.each([
    ["actor_json", "[]"],
    ["payload_json", "null"],
    ["evidence_json", "{}"],
  ])("rejects invalid %s before chain verification", (field, value) => {
    expect(() =>
      decodeAuditEntry({ ...row, [field]: value }, (message) => {
        throw new TypeError(message);
      }),
    ).toThrow();
  });
});
