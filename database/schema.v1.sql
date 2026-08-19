PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE schema_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL,
  migrated_at TEXT NOT NULL
);

CREATE TABLE workspaces (
  workspace_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  read_only_reason TEXT,
  audit_chain_head TEXT NOT NULL CHECK (length(audit_chain_head) = 64),
  next_audit_sequence INTEGER NOT NULL CHECK (next_audit_sequence >= 1)
);

CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  media_type TEXT NOT NULL,
  schema_id TEXT,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  UNIQUE (content_hash, kind)
);

CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  parent_run_id TEXT REFERENCES runs(run_id),
  state TEXT NOT NULL CHECK (state IN ('draft','requirements_approved','planning','baseline_review','remediation','closure','qualified','qualified_with_waivers','approved','approved_with_waivers','halted','cancelled')),
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  blocked_reason TEXT,
  source_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  configuration_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 64),
  policy_locked_at TEXT,
  created_at TEXT NOT NULL,
  terminal_at TEXT,
  terminal_manifest_artifact_id TEXT REFERENCES artifacts(artifact_id),
  state_json TEXT NOT NULL CHECK (json_valid(state_json))
);

CREATE UNIQUE INDEX one_nonterminal_run
ON runs(workspace_id)
WHERE state NOT IN ('approved','approved_with_waivers','halted','cancelled');

CREATE TABLE ledger_versions (
  ledger_version_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  version INTEGER NOT NULL CHECK (version >= 1),
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  coverage_artifact_id TEXT REFERENCES artifacts(artifact_id),
  validation_status TEXT NOT NULL CHECK (validation_status IN ('pending','valid','invalid')),
  approved_at TEXT,
  approved_by_actor_id TEXT,
  UNIQUE (run_id, version)
);

CREATE TABLE requirements (
  ledger_version_id TEXT NOT NULL REFERENCES ledger_versions(ledger_version_id),
  requirement_id TEXT NOT NULL,
  display_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','removed','replaced')),
  statement TEXT NOT NULL,
  source_ranges_json TEXT NOT NULL CHECK (json_valid(source_ranges_json)),
  lineage_roots_json TEXT NOT NULL CHECK (json_valid(lineage_roots_json)),
  predecessor_ids_json TEXT NOT NULL CHECK (json_valid(predecessor_ids_json)),
  PRIMARY KEY (ledger_version_id, requirement_id)
);

CREATE TABLE source_exclusions (
  exclusion_id TEXT PRIMARY KEY,
  ledger_version_id TEXT NOT NULL REFERENCES ledger_versions(ledger_version_id),
  source_range_json TEXT NOT NULL CHECK (json_valid(source_range_json)),
  reason TEXT NOT NULL,
  approved_by_actor_id TEXT NOT NULL,
  approved_at TEXT NOT NULL
);

CREATE TABLE plan_versions (
  plan_version_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  version INTEGER NOT NULL CHECK (version >= 1),
  structured_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  rendered_artifact_id TEXT REFERENCES artifacts(artifact_id),
  ledger_version_id TEXT NOT NULL REFERENCES ledger_versions(ledger_version_id),
  provenance TEXT NOT NULL CHECK (provenance IN ('planner','human')),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, version)
);

CREATE TABLE plan_sections (
  plan_version_id TEXT NOT NULL REFERENCES plan_versions(plan_version_id),
  section_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  normalized_hash TEXT NOT NULL CHECK (length(normalized_hash) = 64),
  component_ids_json TEXT NOT NULL CHECK (json_valid(component_ids_json)),
  requirement_ids_json TEXT NOT NULL CHECK (json_valid(requirement_ids_json)),
  PRIMARY KEY (plan_version_id, section_id)
);

CREATE TABLE section_transitions (
  section_transition_id TEXT PRIMARY KEY,
  plan_version_id TEXT NOT NULL REFERENCES plan_versions(plan_version_id),
  kind TEXT NOT NULL CHECK (kind IN ('preserved','retitled','split','merged','retired','new')),
  from_ids_json TEXT NOT NULL CHECK (json_valid(from_ids_json)),
  to_ids_json TEXT NOT NULL CHECK (json_valid(to_ids_json)),
  reason TEXT NOT NULL
);

CREATE TABLE findings (
  finding_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  status TEXT NOT NULL CHECK (status IN ('open','resolved','waived','uncertain','orphaned','retired')),
  current_severity TEXT NOT NULL CHECK (current_severity IN ('critical','high','medium','low')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE finding_fingerprints (
  finding_id TEXT NOT NULL REFERENCES findings(finding_id),
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (finding_id, fingerprint, policy_hash)
);

CREATE INDEX fingerprint_candidates ON finding_fingerprints(fingerprint, policy_hash);

CREATE TABLE observations (
  observation_id TEXT PRIMARY KEY,
  finding_id TEXT REFERENCES findings(finding_id),
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  review_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  plan_version_id TEXT NOT NULL REFERENCES plan_versions(plan_version_id),
  review_kind TEXT NOT NULL CHECK (review_kind IN ('baseline','remediation','closure')),
  disposition TEXT NOT NULL CHECK (disposition IN ('new','reproduced','resolved','uncertain')),
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  rule_id TEXT NOT NULL,
  component_ids_json TEXT NOT NULL CHECK (json_valid(component_ids_json)),
  requirement_ids_json TEXT NOT NULL CHECK (json_valid(requirement_ids_json)),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE waivers (
  waiver_id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(finding_id),
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  status TEXT NOT NULL CHECK (status IN ('active','stale','revoked')),
  reason TEXT NOT NULL,
  evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
  granted_by_actor_id TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  reaffirmed_at TEXT
);

CREATE TABLE gates (
  gate_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  gate_type TEXT NOT NULL CHECK (gate_type IN ('requirements','baseline','remediation','closure','human_approval')),
  status TEXT NOT NULL CHECK (status IN ('pending','passed','passed_with_waivers','failed','stale')),
  evidence_artifact_id TEXT REFERENCES artifacts(artifact_id),
  evaluated_at TEXT NOT NULL
);

CREATE TABLE logical_commands (
  command_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  command_key TEXT NOT NULL CHECK (length(command_key) = 64),
  command_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  triggering_state_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','running','succeeded','failed','unknown','cancelled')),
  specification_json TEXT NOT NULL CHECK (json_valid(specification_json)),
  accepted_attempt_id TEXT REFERENCES command_attempts(attempt_id),
  planned_at TEXT NOT NULL,
  UNIQUE (run_id, command_key)
);

CREATE TABLE command_attempts (
  attempt_id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES logical_commands(command_id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  status TEXT NOT NULL CHECK (status IN ('started','completed','failed','unknown','discarded')),
  correlation_id TEXT NOT NULL,
  provider_request_id TEXT,
  provider_response_id TEXT,
  failure_class TEXT,
  result_artifact_id TEXT REFERENCES artifacts(artifact_id),
  native_usage_artifact_id TEXT REFERENCES artifacts(artifact_id),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (command_id, attempt_number)
);

CREATE TABLE usage_ledger (
  usage_entry_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  command_id TEXT REFERENCES logical_commands(command_id),
  attempt_id TEXT REFERENCES command_attempts(attempt_id),
  kind TEXT NOT NULL CHECK (kind IN ('reservation','actual','release','conservative_charge')),
  calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd_micros INTEGER NOT NULL DEFAULT 0,
  native_usage_artifact_id TEXT REFERENCES artifacts(artifact_id),
  created_at TEXT NOT NULL
);

CREATE TABLE mutation_lease (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  command_id TEXT NOT NULL REFERENCES logical_commands(command_id),
  attempt_id TEXT REFERENCES command_attempts(attempt_id),
  owner_process TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL
);

CREATE TABLE human_decisions (
  decision_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  decision_type TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  os_account TEXT NOT NULL,
  reason TEXT,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE audit_entries (
  audit_entry_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  sequence INTEGER NOT NULL,
  state_version_before INTEGER NOT NULL,
  state_version_after INTEGER NOT NULL,
  fact_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  actor_json TEXT NOT NULL CHECK (json_valid(actor_json)),
  reason TEXT,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  causation_id TEXT,
  correlation_id TEXT,
  recorded_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  previous_entry_hash TEXT NOT NULL CHECK (length(previous_entry_hash) = 64),
  entry_hash TEXT NOT NULL CHECK (length(entry_hash) = 64),
  UNIQUE (workspace_id, sequence),
  UNIQUE (workspace_id, entry_hash)
);

CREATE TABLE integrity_checks (
  integrity_check_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
  status TEXT NOT NULL CHECK (status IN ('passed','failed')),
  details_artifact_id TEXT REFERENCES artifacts(artifact_id),
  checked_at TEXT NOT NULL
);

INSERT INTO schema_metadata(singleton, schema_version, migrated_at)
VALUES (1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
