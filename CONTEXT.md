# Software Factory

The Software Factory context covers a local workflow that turns source requirements into an independently reviewed implementation plan while preserving the evidence behind every decision.

## Language

**Raw requirements**:
The immutable bytes registered for one run before their statements have been normalized into individually traceable requirements. The original external path is provenance only; the run uses its content-addressed stored copy.
_Avoid_: Requirements ledger, approved requirements

**Requirements ledger**:
A versioned, reviewable set of uniquely identified requirements derived from one run's raw requirements, including source references, lifecycle status, and lineage. Once approved, it is the sole normative requirements input for planning and review; a revised ledger must be approved again before downstream work can qualify.
_Avoid_: Raw requirements, requirements document

**Source exclusion**:
A human-approved, reasoned decision that a specific raw-requirements span is intentionally outside the requirements ledger. Every relevant source span must map to a requirement or a source exclusion.
_Avoid_: Missing coverage, implicit omission

**Run**:
One traceable attempt to turn a single immutable raw-requirements artifact into an approved plan or halt report. Changed raw requirements begin a new run linked to the prior run.
_Avoid_: Ledger version, provider attempt

**Child run**:
A new run linked to a prior terminal run that reuses immutable evidence while explicitly recording changed inputs, review policy, or budgets.
_Avoid_: Resumed run, mutated run

**Planner**:
The worker that proposes or revises an implementation plan from an approved requirements ledger.
_Avoid_: Reviewer

**Reviewer**:
The worker that evaluates plans and independently verifies remediation claims using a different provider from the Planner. It normally uses a model from the configured frontier-model allowlist; an explicit run-level override may relax that preference. It references supplied finding IDs but does not create them or apply lifecycle transitions.
_Avoid_: Planner, self-reviewer

**Baseline-reviewed plan**:
A provisional plan that has completed independent baseline review but has not passed remediation and closure gates and therefore cannot be qualified or approved.
_Avoid_: Qualified plan, approved plan

**Qualified plan**:
A plan that has passed every configured deterministic, review, remediation, and closure gate but has not yet received final human acceptance.
_Avoid_: Approved plan, final plan

**Qualified plan with waivers**:
A qualified plan whose gates passed partly through explicit human acceptance of one or more unresolved findings.
_Avoid_: Fully resolved plan, approved plan

**Approved plan**:
A qualified plan that the user has explicitly accepted as the successful outcome of a run.
_Avoid_: Qualified plan, automatically approved plan

**Waiver**:
A human acceptance of a finding's stated risk without claiming that the concern was fixed. A waiver requires a reason, remains visible in the final report, and must be reaffirmed after relevant requirements, plan sections, review policy, or evidence change.
_Avoid_: Resolution, dismissal, deletion

**Human actor**:
The project-configured display identity, accompanied by operating-system account metadata, attributed to consequential decisions such as approvals, waivers, overrides, and rejections.
_Avoid_: Anonymous user, model worker

**Finding**:
A persistent semantic concern with an orchestrator-assigned identity that survives observations, revisions, and wording changes.
_Avoid_: Finding observation, fingerprint, review comment

**Finding observation**:
A Reviewer's evaluation of a finding against a specific artifact version in a specific review cycle, or a newly reported concern awaiting an orchestrator-assigned finding identity.
_Avoid_: Finding, finding status

**Finding fingerprint**:
A controlled, versioned tuple used to propose reconciliation candidates for a finding. It is evidence for identity matching, not an identity or uniqueness constraint.
_Avoid_: Finding ID, semantic primary key

**Review policy**:
The exact versioned taxonomy, gate rules, model-independence requirements, prompts, schemas, rubrics, and related review configuration pinned by content hash before a run's first provider-backed command. Later policy changes require a child run.
_Avoid_: Latest project configuration, reviewer prompt

**Audit entry**:
An immutable, hash-chained record of an accepted domain transition, including actor, reason, evidence references, and before/after state versions. Audit entries explain authoritative state but do not reconstruct it.
_Avoid_: Domain event, event-store record, state snapshot

**External edit**:
A change to a rendered working file outside the canonical structured-plan submission workflow. Its bytes are preserved as evidence, but it cannot affect qualification until reconciled through a canonical submission or restoration.
_Avoid_: Plan revision, canonical plan

**Terminal report**:
The human-readable report and machine-readable manifest exported when a run is approved, halted, or cancelled, identifying its inputs, policy, providers, budgets, evidence, findings, waivers, decisions, lineage, and outcome.
_Avoid_: Console log, database export

**Logical result**:
The single accepted outcome of a provider-backed instruction, even when interruption or recovery causes more than one physical provider call.
_Avoid_: Provider call, attempt

**Strict replay**:
Offline return of an exact project-local provider recording without a network call.
_Avoid_: Rerun, regeneration

**Rerun**:
A fresh live provider invocation for a previously issued logical command. It may produce different output and incur new usage even when the declared model identity is unchanged.
_Avoid_: Strict replay, deterministic reproduction

**Halted run**:
A terminal run that exhausted a declared bound or encountered a condition requiring changed inputs, policy, or budgets. Further work begins in a child run.
_Avoid_: Paused run, failed attempt, resumable run

**Cancelled run**:
A terminal run stopped by the user. Results arriving after cancellation are retained as evidence but cannot change workflow state.
_Avoid_: Halted run, paused run

**Local-first**:
Operational state and recordings remain project-local by default. Live provider calls transmit disclosed request content to configured providers under their retention policies, with provider-side storage minimized where supported.
_Avoid_: Offline-only, zero-retention guarantee
