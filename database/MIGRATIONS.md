# SQLite Migration and Backup Protocol

## Version ownership

`schema_metadata.schema_version` is the authoritative database schema version. Migration files are immutable, sequential, and named `NNNN_description.sql`. The initial schema is version 1.

An older CLI may inspect a newer database only when its readers explicitly support that version. It may never mutate it.

## Pre-migration gate

Before migration:

1. Acquire the workspace mutation lease with no provider command in flight.
2. Run `PRAGMA integrity_check` and foreign-key checks.
3. Verify the complete audit chain and stored chain head.
4. Enumerate every referenced artifact hash.
5. Verify every object exists and hashes correctly.
6. Create a SQLite online backup in `.factory/backups/<backup-id>/state.db`.
7. Write and verify a JSON manifest containing database hash, schema version, object hashes, CLI version, and audit-chain head.

Any failure leaves the original workspace unchanged and read-only when integrity is uncertain.

## Migration transaction

Each version step runs in its own immediate transaction. The migration updates schema objects, transforms authoritative rows, validates invariants, updates `schema_metadata`, and appends `migration_completed` audit evidence atomically.

Historical audit entries and artifact bodies are never rewritten. Readers may convert old payload schemas in memory.

## Post-migration verification

Run integrity, foreign-key, audit-chain, object-reference, unique-command, one-active-run, and state-version checks. Release the lease only after all pass.

## Restore

Restore occurs into a new temporary workspace path. Verify the backup manifest, database hash, schema compatibility, audit chain, and every referenced object before atomically selecting it as active. The failed workspace remains preserved for diagnostics.

## Rollback

There are no down migrations. A failed migration rolls back its transaction. Recovery restores the verified pre-migration backup rather than attempting to reverse historical transformations.
