# State Transition Protocol v1

This protocol is normative for the pure `transition(previousState, input, policy)` function. Any transition not listed here is rejected as `INVALID_TRANSITION` without changing state.

## States

| State | Meaning |
|---|---|
| `draft` | Run exists; requirements are not approved. |
| `requirements_approved` | One ledger version and its exclusions are approved. |
| `planning` | A canonical plan is being generated or revised. |
| `baseline_review` | The first full review of a plan version is pending or executing. |
| `remediation` | Blocking findings require Planner changes and Reviewer verification. |
| `closure` | No unwaived blockers remain; full-document closure is pending. |
| `qualified` | Closure passed without active waivers; human decision is pending. |
| `qualified_with_waivers` | Closure passed using active waivers; human decision is pending. |
| `approved` | Human accepted a qualified plan. Terminal. |
| `approved_with_waivers` | Human acknowledged active waivers and accepted the plan. Terminal. |
| `halted` | A bound or unrecoverable condition ended the run. Terminal. |
| `cancelled` | Human cancellation ended the run. Terminal. |

At most one run per workspace may be in a nonterminal state.

## Common invariants

Every accepted input requires:

- matching `run_id` and expected `state_version`;
- an actor authorized for the input type;
- verified audit-chain head and database integrity;
- no incompatible schema version;
- no conflicting mutation lease;
- pinned policy after the first provider-backed command; and
- sufficient unreserved budget before planning an effectful command.

Each accepted transition increments `state_version` exactly once and emits at least one audit fact. State, commands, and audit entries commit atomically.

## Transition table

| Current state | Input | Guard | Next state | Commands | Audit facts |
|---|---|---|---|---|---|
| none | `RunStarted` | no nonterminal run; source object verified | `draft` | render source registration report | run started; source registered |
| `draft` | `LedgerSubmitted` | schema and source references valid | `draft` | validate coverage; render ledger projection | ledger version submitted |
| `draft` | `SourceExclusionApproved` | span exists; reason nonempty; human actor | `draft` | recompute coverage | exclusion approved |
| `draft` | `LedgerApprovalRequested` | schema, lineage, identity, and coverage pass | `requirements_approved` | render approval evidence | ledger approved |
| `requirements_approved` | `PlanningRequested` | policy and budgets accepted | `planning` | generate plan | planning requested |
| `requirements_approved` | `PlanSubmitted` | canonical schema and section map valid | `baseline_review` | render plan; baseline review | human plan submitted |
| `planning` | `PlanGenerated` | output valid; artifact and section continuity valid | `baseline_review` | render plan; baseline review | plan version accepted |
| `planning` | `ProviderOutcomeFailed` | failure policy says terminal | `halted` | export terminal report | planning halted |
| `baseline_review` | `ReviewAccepted` | prior findings accounted for; output valid; blockers exist | `remediation` | plan remediation | baseline accepted; findings reconciled |
| `baseline_review` | `ReviewAccepted` | no blockers | `closure` | closure review | baseline accepted; closure requested |
| `baseline_review` | `ProviderOutcomeFailed` | retry/repair exhausted | `halted` | export terminal report | baseline halted |
| `remediation` | `RemediationGenerated` | claims and section map valid | `remediation` | verify remediation | remediation proposed |
| `remediation` | `RemediationReviewAccepted` | unwaived blockers remain; cycle budget remains | `remediation` | plan next remediation | remediation evaluated |
| `remediation` | `RemediationReviewAccepted` | no unwaived blockers | `closure` | closure review | blockers cleared; closure requested |
| `remediation` | `RemediationReviewAccepted` | blockers remain; cycle budget exhausted | `halted` | export terminal report | remediation budget exhausted |
| `closure` | `ClosureReviewAccepted` | new blockers; remediation and closure budget remain | `remediation` | plan remediation | closure failed; findings reconciled |
| `closure` | `ClosureReviewAccepted` | new blockers; relevant budget exhausted | `halted` | export terminal report | closure budget exhausted |
| `closure` | `ClosureReviewAccepted` | no unwaived blockers; no active waivers | `qualified` | render qualification report | plan qualified |
| `closure` | `ClosureReviewAccepted` | no unwaived blockers; active waivers valid | `qualified_with_waivers` | render qualification report | plan qualified with waivers |
| `qualified` | `PlanApproved` | human actor; evidence displayed | `approved` | export terminal report and plan | plan approved |
| `qualified_with_waivers` | `PlanApproved` | human actor; every waiver acknowledged | `approved_with_waivers` | export terminal report and plan | waived risks acknowledged; plan approved |
| `qualified` | `PlanRejected` | reason nonempty; budgets remain | `planning` | generate revision | qualified plan rejected |
| `qualified_with_waivers` | `PlanRejected` | reason nonempty; budgets remain | `planning` | generate revision | qualified plan rejected |
| `qualified` | `PlanRejected` | reason nonempty; budgets exhausted | `halted` | export terminal report | rejection recorded; budget exhausted |
| `qualified_with_waivers` | `PlanRejected` | reason nonempty; budgets exhausted | `halted` | export terminal report | rejection recorded; budget exhausted |
| any nonterminal | `LedgerSubmitted` | source unchanged; new ledger version valid | `draft` | validate coverage; render ledger projection | downstream qualification invalidated; ledger submitted |
| any nonterminal | `ExternalEditDetected` | working projection hash differs | unchanged, blocked | register external-edit artifact | external edit detected |
| any blocked by edit | `ProjectionRestored` | hash equals verified render | unchanged, unblocked | none | projection restored |
| any blocked by edit | `PlanSubmitted` | canonical plan and transition map valid | `baseline_review` | render plan; baseline review | external edit reconciled by submission |
| any nonterminal | `WaiverGranted` | human; finding active; reason nonempty | unchanged | recompute gate | finding waived |
| any nonterminal | `WaiverReaffirmed` | human; current evidence displayed | unchanged | recompute gate | waiver reaffirmed |
| any nonterminal | `RelevantEvidenceChanged` | active waiver references changed evidence | unchanged | recompute gate | waiver invalidated |
| `requirements_approved` | `IndependenceOverrideGranted` | human; reason nonempty; normal assignment matches pinned policy; before provider dispatch | `requirements_approved` | none | independence reduced by override |
| any nonterminal | `BudgetReduced` | new ceilings >= actual + reserved usage | unchanged | none | budget reduced |
| any nonterminal | `CancellationRequested` | human actor | `cancelled` | attempt provider cancel; export terminal report | cancellation requested; run cancelled |
| any nonterminal | `HardBoundReached` | applicable ceiling exhausted | `halted` | export terminal report | hard bound reached; run halted |
| any nonterminal | `PinnedModelUnavailable` | provider confirms unavailable | `halted` | export terminal report | pinned model unavailable |
| any nonterminal | `IntegrityFailureDetected` | chain, object, or database check fails | unchanged, workspace read-only | none | integrity failure detected where safe |
| terminal | `ChildRunRequested` | changed conditions declared; referenced objects verify | terminal plus new child `draft` | render child provenance | child run created |

## Commands never transition state by themselves

`CommandStarted`, lease heartbeats, and physical-attempt bookkeeping update operational command records but do not advance the domain state. Only a validated command outcome submitted as a domain input can advance the run.

## Failure routing

| Outcome | Route |
|---|---|
| deterministic validation | reject input; no retry command |
| transient transport | retry same logical command if attempt/call budgets remain |
| unknown provider outcome | reconcile recording; otherwise retry with duplicate-call warning |
| schema invalid | repair same logical command if repair budget remains |
| refusal | halt or await explicit human policy action; never schema-repair |
| truncation | halt or retry only under an already-permitted limit policy |
| substantive findings | remediation or closure transition |
| integrity failure | workspace read-only; no mutation |

## Policy and budget changes

Policy may change only before the first provider-backed command. After that boundary, changed prompts, schemas, taxonomy, rubrics, model assignments, or allowlists require a child run. Budget ceilings may decrease if they remain above actual plus reserved use; increases require a child run.
