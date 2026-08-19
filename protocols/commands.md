# Command Protocol v1

Commands describe effects selected by the pure transition and executed by the application outside the accepting SQLite transaction.

## Logical command envelope

```ts
interface PlannedCommand<T> {
  commandId: string;
  commandKey: string;
  commandType: CommandType;
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: number;
  prerequisiteCommandIds?: string[];
  purposeId: string;
  inputArtifactHashes: string[];
  policyHash: string;
  provider?: "openai" | "anthropic" | "manual" | "local";
  modelId?: string;
  budgetReservation: BudgetReservation;
  providerRequestPolicy?: {
    configurationArtifactId: string;
    configurationContentHash: string;
    policyHash: string;
    role: "planner" | "reviewer";
    promptArtifactId: string;
    promptContentHash: string;
    outputSchemaArtifactId: string;
    outputSchemaContentHash: string;
    maxOutputTokens: number;
    timeoutMs: number;
    reasoning: string | null;
    providerStorage: "minimize";
  };
  payload: T;
}
```

Every provider-backed command carries `providerRequestPolicy`; local and cancellation commands omit it. The executor requires exact equality with this policy before recording or dispatching a request. A smaller output limit, different timeout/reasoning setting, alternate controlled artifact, or changed storage behavior is a different logical command, not an execution-time choice.

`commandKey` is the SHA-256 hash of canonical JSON containing every field above except `commandId` and `budgetReservation`'s mutable reconciliation fields. A database uniqueness constraint on `(run_id, command_key)` prevents duplicate logical planning.

A command with `prerequisiteCommandIds` is ineligible until every referenced logical command has one accepted successful result. Before dispatch, the executor resolves any prerequisite-produced artifact references, verifies their hashes, and includes them in the exact recorded request. `baseline_review` uses this mechanism to consume the verified Markdown produced by its `render_plan` prerequisite; a command ID alone is never treated as the rendered artifact.

## Command types

| Command                             | Effect                                                       | Success input                                   |
| ----------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| `render_source_registration_report` | deterministic source-registration receipt                    | operational evidence only; no domain transition |
| `validate_ledger`                   | deterministic schema, coverage, identity, and lineage checks | `LedgerValidationCompleted`                     |
| `render_ledger`                     | deterministic Markdown and coverage projection               | `LedgerRendered`                                |
| `render_ledger_approval`            | deterministic ledger-approval receipt with coverage evidence | operational evidence only; no domain transition |
| `generate_plan`                     | Planner provider request                                     | `PlanGenerated`                                 |
| `render_plan`                       | deterministic anchored Markdown                              | `PlanRendered`                                  |
| `baseline_review`                   | full Reviewer evaluation                                     | `ReviewAccepted`                                |
| `generate_remediation`              | Planner revision and claims                                  | `RemediationGenerated`                          |
| `verify_remediation`                | Reviewer evaluates claims and full diff context              | `RemediationReviewAccepted`                     |
| `closure_review`                    | full Reviewer evaluation after blockers clear                | `ClosureReviewAccepted`                         |
| `repair_schema`                     | same provider repairs invalid structured response            | original success input                          |
| `export_terminal`                   | manifest, report, and eligible plan projections              | `TerminalExportCompleted`                       |
| `attempt_provider_cancel`           | best-effort cancellation where supported                     | operational evidence only                       |
| `backup_workspace`                  | SQLite backup and referenced-object manifest                 | `BackupCompleted`                               |
| `verify_integrity`                  | database, object, and audit-chain checks                     | `IntegrityCheckCompleted`                       |

## Physical attempts

Every execution inserts an attempt before dispatch:

```ts
interface CommandAttempt {
  attemptId: string;
  commandId: string;
  attemptNumber: number;
  status: "started" | "completed" | "failed" | "unknown" | "discarded";
  correlationId: string;
  providerRequestId?: string;
  providerResponseId?: string;
  startedAt: string;
  completedAt?: string;
  failureClass?: FailureClass;
  nativeUsageArtifactId?: string;
  resultArtifactId?: string;
}
```

There may be many physical attempts but at most one accepted logical result. Accepting a result requires the command's triggering state version still to be current or explicitly expected by its transition.

## Execution protocol

1. Verify workspace integrity, prerequisite completion, resolved artifact hashes, and command eligibility.
2. Atomically acquire the mutation lease and reserve maximum permitted usage.
3. Insert a `started` physical attempt and commit.
4. Build the exact request and persist its redacted recording artifact.
5. Dispatch outside any SQLite transaction.
6. Stage and verify response and native-usage artifacts.
7. In one transaction, complete the attempt and submit the outcome input to the domain transition.
8. Reconcile reserved versus actual usage.
9. Release the lease after all resulting state, commands, and audit entries commit.

No adapter may make workflow decisions or directly update domain tables.

## Retry and rerun

- A retry continues the same logical command after a retryable failure or unknown outcome.
- A schema repair continues the same logical command and consumes only repair and provider budgets.
  Before the repair attempt starts, its immutable overlay binds the configured schema-repair prompt, the original command's output schema, and the immediately preceding schema-invalid response. `command_attempt_started` records that overlay; provider-request registration must reproduce it exactly while preserving the original logical command key.
- A strict replay creates a physical attempt sourced from a matching local recording and performs no network call.
- A rerun is an explicit human-authorized fresh call. If a successful logical result already exists, the new result is evidence only unless a new child run or new logical command expects it.
- Normal execution with an existing accepted result is a no-op.

All physical calls count toward call, token, and cost ceilings. Retry does not erase earlier usage.

## Mutation lease

The lease identifies workspace, owner process, logical command, physical attempt, heartbeat, and acquisition time. A stale heartbeat permits recovery investigation, not blind takeover. Read-only commands never require the lease.

## Unknown outcome

When dispatch may have occurred but no response was committed, mark the attempt `unknown`. Recovery checks local cassettes and provider correlation evidence. If unresolved and budgets allow, it may create another attempt using the same application correlation key while recording possible duplicate generation and billing.

## Cancellation

Cancellation immediately makes the run terminal in an atomic transition. An in-flight attempt remains evidence. The executor requests provider cancellation when available; any later response is staged and marked discarded and cannot submit a state-changing input.

## Budget reservation

Before dispatch, reserve a conservative maximum for calls, input tokens, output tokens, and cost. Dispatch is forbidden when actual plus reserved plus proposed maximum exceeds any hard ceiling. On completion, convert the reservation to provider-native actual usage; on unknown outcome, retain the reservation until reconciled or charge the configured conservative maximum.
