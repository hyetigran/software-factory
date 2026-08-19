# Audit Entry Protocol v1

The audit journal is an immutable, tamper-evident explanation of authoritative transactional state. It is not an event store and is never replayed to reconstruct state.

## Envelope

```ts
interface AuditEntry<T> {
  auditEntryId: string;
  sequence: number;
  runId: string;
  stateVersionBefore: number;
  stateVersionAfter: number;
  factType: AuditFactType;
  schemaVersion: 1;
  actor: ActorReference;
  reason?: string;
  evidence: EvidenceReference[];
  causationId?: string;
  correlationId?: string;
  recordedAt: string;
  payload: T;
  previousEntryHash: string;
  entryHash: string;
}
```

`recordedAt` is informational. `sequence`, state versions, causation, and correlation determine order.

## Hashing

1. Canonically serialize every field except `entryHash` as UTF-8 JSON.
2. Compute `entryHash = SHA-256(serialized bytes)`.
3. The first workspace entry uses 64 lowercase zeroes for `previousEntryHash`.
4. Each later entry references the immediately preceding workspace entry hash.
5. Store the chain head in workspace metadata in the same transaction.

Verification checks canonical decoding, contiguous sequence, previous hash, recomputed hash, monotonic state versions, and agreement between the final chain head and workspace metadata.

## Actor reference

```ts
type ActorReference =
  | { kind: "human"; displayName: string; osAccount: string }
  | { kind: "system"; component: string; version: string }
  | { kind: "planner" | "reviewer"; provider: string; modelId: string };
```

Models are evidence producers, not authorities for human-only actions.

## Evidence reference

Evidence references use stable artifact, requirement, section, finding, observation, command, attempt, waiver, gate, or policy IDs plus content hashes where applicable. Large or sensitive bodies never appear inline.

## Fact catalog

| Fact type                       | Required payload                                             |
| ------------------------------- | ------------------------------------------------------------ |
| `run_started`                   | source artifact, configuration hash, parent run if any       |
| `source_registered`             | artifact ID, content hash, provenance path                   |
| `ledger_submitted`              | ledger version and artifact hash                             |
| `source_exclusion_approved`     | source range and reason                                      |
| `ledger_validation_completed`   | command, ledger version, coverage result, validation flags   |
| `ledger_approved`               | ledger version, coverage report, human actor                 |
| `downstream_invalidated`        | cause and affected artifact/gate IDs                         |
| `planning_requested`            | plan purpose and Planner assignment                          |
| `plan_version_accepted`         | plan artifact, section transition map, provenance            |
| `external_edit_detected`        | expected and observed hashes, preserved artifact             |
| `projection_restored`           | projection kind, verified render hash, restored working hash |
| `review_accepted`               | review artifact, cycle, policy, model, observation IDs       |
| `finding_created`               | finding ID and initial observation                           |
| `finding_transitioned`          | prior and next status, controlling evidence                  |
| `reconciliation_ambiguous`      | candidate finding IDs and reason                             |
| `remediation_proposed`          | finding claims, plan version, changed sections               |
| `waiver_granted`                | finding, exact evidence versions, reason                     |
| `waiver_invalidated`            | waiver and changed evidence                                  |
| `waiver_reaffirmed`             | waiver, current evidence, human actor                        |
| `independence_override_granted` | normal policy, override, reason                              |
| `plan_qualified`                | gate evidence and waiver set                                 |
| `plan_rejected`                 | reason and resulting planning purpose                        |
| `plan_approved`                 | plan version, manifest, waiver acknowledgments               |
| `command_planned`               | command ID, key, type, reservation                           |
| `command_attempt_started`       | command and attempt IDs, correlation ID                      |
| `command_attempt_completed`     | result and native-usage artifact IDs                         |
| `command_attempt_unknown`       | known dispatch evidence and reserved usage                   |
| `duplicate_call_possible`       | related attempts and accounting                              |
| `result_discarded`              | attempt, reason, accepted result if any                      |
| `budget_reserved`               | command and resource maxima                                  |
| `budget_reconciled`             | reservation and provider-native actuals                      |
| `budget_reduced`                | old and new ceilings                                         |
| `rerun_authorized`              | decision, command, attempt, correlation, reason              |
| `hard_bound_reached`            | resource, ceiling, actual, reserved                          |
| `cancellation_requested`        | human actor and in-flight attempt if any                     |
| `run_cancelled`                 | terminal manifest reference                                  |
| `run_halted`                    | reason, bounds, unresolved findings, manifest                |
| `child_run_created`             | parent, child, inherited evidence, changed conditions        |
| `integrity_failure_detected`    | check type and diagnostic evidence                           |
| `migration_completed`           | from/to schema, backup manifest, migration IDs               |
| `purge_completed`               | explicit targets, hashes, confirmation actor                 |

The readiness review must reject implementation-only fact types that lack domain or operational audit value.

## Atomicity

Audit entries caused by an accepted domain input are inserted in the same SQLite transaction as authoritative state and planned commands. Operational attempt entries are inserted in the same transaction as the attempt record they describe. Neither side may commit independently.

## Versioning and corruption

Fact schemas are append-only and versioned. Readers may up-convert payloads in memory but never rewrite historical entries. Unknown required versions make the workspace read-only.

Chain verification failure blocks all mutation. Diagnostics and export remain available. Recovery requires a verified backup or a child run created from independently verified immutable artifacts; the chain is never automatically repaired.
