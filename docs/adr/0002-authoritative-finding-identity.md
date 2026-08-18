---
status: accepted
---

# Keep finding IDs authoritative and use fingerprints only for reconciliation

The orchestrator assigns every persistent finding a stable ID. Controlled fingerprints may identify reconciliation candidates across reviews and revisions, but they are neither primary keys nor uniqueness constraints because distinct concerns can share the same rule, requirement, and component tuple.

## Consequences

Review output must account for prior findings explicitly. A unique, policy-valid fingerprint match may support automatic reconciliation; ambiguous matches require explicit reviewer reconciliation or human disposition. Reviewer prose remains outside identity computation.
