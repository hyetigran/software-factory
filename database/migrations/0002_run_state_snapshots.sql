CREATE TABLE run_state_snapshots (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id),
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  state_json TEXT NOT NULL CHECK (json_valid(state_json))
);

INSERT INTO run_state_snapshots (run_id, state_version, state_json)
SELECT run_id,
       state_version,
       json_object(
         'runId', run_id,
         'stateVersion', state_version,
         'state', state,
         'sourceArtifactId', source_artifact_id,
         'configurationArtifactId', configuration_artifact_id,
         'policyHash', policy_hash,
         'policyLocked', policy_locked_at IS NOT NULL,
         'migratedFromSchemaVersion', 1
       )
FROM runs;

CREATE TABLE migration_history (
  migration_id TEXT PRIMARY KEY,
  from_schema_version INTEGER NOT NULL,
  to_schema_version INTEGER NOT NULL,
  backup_manifest_path TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

UPDATE schema_metadata
SET schema_version = 2,
    migrated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE singleton = 1 AND schema_version = 1;
