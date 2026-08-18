---
status: accepted
---

# Use authoritative transactional state with an immutable audit journal

Milestone 1 will keep current workflow state in authoritative transactional SQLite tables and append every meaningful decision to an immutable audit journal. This replaces the draft architecture's proposal to reconstruct all state from an authoritative event stream: the journal preserves traceability, while avoiding event-upcasting and projection-rebuild obligations before the requirements-to-plan workflow has demonstrated value.

## Consequences

Every accepted domain transition records its actor, reason, evidence references, and before/after state versions. Large or sensitive payloads remain in immutable artifact storage and are referenced by identity and hash.

State changes and their audit entries must commit in the same SQLite transaction; neither may commit independently. Recovery verifies and continues from transactional state rather than recreating that state by replaying the journal.
