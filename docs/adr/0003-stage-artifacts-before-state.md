---
status: accepted
---

# Stage content-addressed artifacts before committing state

Artifact bodies will be written and hash-verified in content-addressed storage before SQLite commits any authoritative reference or related state transition. SQLite and the filesystem cannot share a transaction, so this ordering prefers harmless unreferenced objects over authoritative records that point to missing content.

## Consequences

A crash before the SQLite commit may leave an unreferenced object. Cleanup may report and explicitly purge such objects, but normal commands never delete referenced immutable artifacts or historical evidence.
