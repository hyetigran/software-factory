BEGIN IMMEDIATE;

CREATE TABLE run_state_snapshots (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id),
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  state_json TEXT NOT NULL CHECK (json_valid(state_json))
);

UPDATE schema_metadata
SET schema_version = 2,
    migrated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE singleton = 1 AND schema_version = 1;

COMMIT;
