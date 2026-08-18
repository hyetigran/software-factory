# Software Factory — Milestone 1 Product Requirements

**Status:** Approved design baseline
**Version:** 2.0
**Product:** Local Software Factory CLI
**Milestone:** Requirements-to-approved-plan walking skeleton
**Primary user:** A single developer operating locally

## 1. Product hypothesis

Milestone 1 must prove that a real requirements document can reliably become a traceable, independently reviewed implementation plan. The product is a local command-line workflow, not a general automation platform.

The workflow succeeds only when it produces one of four honest terminal outcomes:

- **Approved:** every required gate passed and the human accepted the plan.
- **Approved with waivers:** every gate passed partly through explicit human risk acceptance, and the human acknowledged those waivers again at approval.
- **Halted:** a declared bound was exhausted or a condition requires changed inputs, policy, models, or budgets.
- **Cancelled:** the human stopped the run.

A baseline review alone produces a provisional baseline-reviewed plan. It is never described as qualified or approved.

## 2. User problem

The current manual workflow requires repeated transfers among requirements, planning models, review models, and local documents. That process loses evidence and makes it difficult to answer:

- Which source statement justified a plan decision?
- Did a finding disappear because it was fixed, omitted, merged, waived, or renamed?
- Did the reviewer independently verify the Planner's remediation claim?
- Did a retry repeat a provider call or accept duplicate work?
- Which model, prompt, taxonomy, schema, and budget produced an outcome?
- Can an interrupted run continue without inventing or losing state?
- Did the review improve the plan, or merely add activity?

The Software Factory makes these questions inspectable while keeping every loop and external action bounded.

## 3. Milestone goal and success

Milestone 1 is successful when:

1. A real requirements document reaches an approved plan or evidence-rich terminal report.
2. Transactional state survives interruption without losing an accepted transition or accepting a duplicate logical result.
3. Requirements, plan sections, findings, observations, waivers, commands, artifacts, and human decisions retain stable identity and provenance.
4. A Planner cannot certify its own remediation.
5. Every retry, repair, remediation, closure cycle, provider call, token, and charge is bounded and reported.
6. Strict replay returns recorded provider results without network access.
7. Review-quality evaluation meets the thresholds in section 16.

## 4. User and supported environment

The primary user supplies source requirements, authors or reviews the requirements ledger, selects providers and pinned models, inspects evidence, approves exclusions and waivers, and accepts or rejects the final plan.

Milestone 1 supports:

- macOS and Linux;
- active and maintenance Node.js LTS releases;
- one project per workspace;
- many historical runs but only one nonterminal run;
- UTF-8 Markdown source documents up to 1 MiB, subject to model-context preflight;
- OpenAI and Anthropic production adapters; and
- a versioned npm package exposing one CLI executable.

Automated chunking is excluded. Inputs that cannot fit the selected model context fail preflight without truncation.

## 5. Product principles

1. **The approved ledger is normative.** Raw requirements are immutable provenance used to validate coverage, not a second planning contract.
2. **Human authority is explicit.** Humans approve source exclusions, waivers, independence overrides, exceptional reclassifications, and final plans.
3. **Review authority is separated.** The Planner proposes; the Reviewer evaluates; the orchestrator owns identities and lifecycle transitions.
4. **Transactional state is authoritative.** An immutable audit journal explains accepted transitions but does not reconstruct current state.
5. **Structured artifacts are canonical.** Markdown is a readable projection, not a second source of truth.
6. **Stable identity outlives wording.** Mutable prose never serves as a primary key.
7. **Every loop terminates.** Exhaustion produces evidence rather than an indefinite retry.
8. **Local-first is not offline-only.** Operational state and recordings remain local by default; live calls disclose content to configured providers.
9. **Evidence types stay distinct.** Deterministic facts, model judgments, and human decisions are labeled.
10. **A vertical product precedes a framework.** General workflow, plug-in, distributed, and code-generation features are deferred.

## 6. Milestone workflow

```text
Register immutable raw requirements
  -> submit and validate requirements ledger
  -> approve coverage and source exclusions
  -> generate or submit canonical structured plan
  -> render anchored Markdown
  -> independent baseline review
  -> bounded remediation and verification
  -> bounded full-document closure review
  -> qualified or qualified_with_waivers
  -> explicit human approval or rejection
  -> approved plan, halt report, or cancellation report
```

## 7. Scope

### Included

- Workspace initialization and project configuration
- Raw-requirements registration in immutable content-addressed storage
- Versioned manual requirements-ledger submission
- Deterministic coverage, lineage, and schema validation
- Human approval of ledgers and source exclusions
- Structured plan generation and human structured-plan submission
- Stable plan-section and component identity
- Markdown rendering and external-edit detection
- OpenAI and Anthropic adapters
- Independent baseline, remediation, and closure review
- Persistent findings, observations, reconciliation, waivers, and severity history
- Transactional state, planned commands, mutation leases, and hash-chained audit entries
- Bounded retry, repair, remediation, closure, call, token, and cost policies
- Content-addressed artifacts and project-local provider recordings
- Strict replay and explicit live rerun
- Terminal reports, machine-readable manifests, inspection, and export
- Crash recovery, migration backup, corruption detection, and read-only diagnostics
- A separate review-quality evaluation harness

### Excluded

- Automated requirements normalization
- Automated chunking or summarization of oversized inputs
- Architecture or ticket generation
- Repository modification, code generation, build, lint, test, or security execution
- GitHub publication
- Web, desktop, or background-server interfaces
- Cloud-hosted orchestration, remote databases, queues, or distributed workers
- Multiple users, parallel mutations, or parallel provider effects
- Generalized workflow languages, dependency graphs, or plug-in marketplaces
- Cross-run semantic caches
- Application-level encryption or managed encryption keys
- Windows support

## 8. Requirements source and ledger

### PRD-001 — Register immutable source

Starting a run copies the exact source bytes into content-addressed storage and records their hash and original path. The run never rereads the external path as authoritative input.

Changed raw requirements start a new child run linked to the prior run. They never mutate an existing run.

### PRD-002 — Accept a manual ledger

The user submits versioned, schema-valid JSON containing stable requirement identity, display ID, statement, lifecycle status, source ranges, and lineage roots. The factory renders a Markdown review projection and deterministic source-coverage report.

### PRD-003 — Require complete coverage

Every relevant source span must map to an active requirement or a human-approved source exclusion with a reason. Planning is blocked until schema, identity, lineage, and mapping checks pass and the human approves the ledger.

### PRD-004 — Support ledger revision

A revised ledger creates a new version in the same active run, requires renewed approval, and invalidates downstream qualification. Findings remain historical, remap mechanically through lineage where possible, and require human disposition when blocking associations become ambiguous or orphaned.

## 9. Canonical plan

### PRD-005 — Generate structured plans

The Planner consumes only the approved requirements ledger as normative input and returns schema-valid structured data covering scope, approach, components, data and API considerations, failure handling, security, testing, dependencies, risks, sequence, and justified requirement coverage.

### PRD-006 — Permit human structured submissions

The user may submit a schema-valid structured plan without using the Planner. A submission preserves existing section IDs and supplies an explicit transition map for preserved, retitled, split, merged, retired, and new sections. The orchestrator validates continuity and assigns IDs only to declared new sections.

### PRD-007 — Render projections

The factory deterministically renders anchored Markdown from the canonical structured plan. An external Markdown edit is preserved as an artifact, blocks downstream progression, and must be reconciled by restoring a verified render or submitting canonical structured JSON.

## 10. Independent review and findings

### PRD-008 — Enforce independent roles

The Planner and Reviewer use different providers by default and normally use models from the configured frontier-model allowlist. OpenAI and Anthropic roles are configurable per run. A human may explicitly override the independence policy; the reduced independence appears in every gate and terminal report.

### PRD-009 — Perform baseline review

The Reviewer receives the approved ledger, canonical plan, rendered plan, controlled component registry, review policy, and evidence references. It returns structured observations under the pinned schema and taxonomy.

### PRD-010 — Keep finding identity authoritative

The orchestrator assigns stable finding IDs. A fingerprint made from controlled policy fields proposes reconciliation candidates but is neither a primary key nor a uniqueness constraint. Reviewer prose never determines identity.

The Reviewer may reference supplied IDs and classify each prior finding as reproduced, resolved, or uncertain. It reports new concerns without minting IDs. Ambiguous reconciliation requires explicit Reviewer accounting or human disposition.

### PRD-011 — Separate findings and observations

A finding is the persistent concern. An observation is one evaluation of that concern against one artifact version in one review cycle. All wording, severity, evidence, and status history remains inspectable.

### PRD-012 — Verify remediation independently

The Planner submits a claim, affected requirement and section IDs, and evidence for each proposed remediation. A claim cannot change finding status. The Reviewer verifies the revised artifact and the orchestrator applies policy-controlled transitions.

### PRD-013 — Require closure review

When no unwaived blocking findings remain, a full-document review checks for global inconsistency, regressions, and previously omitted concerns. Closure has its own bounded budget. Failure never restarts an unbounded baseline loop.

### PRD-014 — Support explicit waivers

The human may waive any severity with a reason. A waiver accepts risk without claiming resolution and is invalidated by relevant requirement, plan-section, evidence, or review-policy changes.

A gate satisfied through a waiver produces `qualified_with_waivers`. Final approval displays every active waiver and requires distinct acknowledgment of unresolved risk.

## 11. Run lifecycle and human decisions

### PRD-015 — Distinguish qualification and approval

Passing every required deterministic, remediation, and closure gate produces `qualified` or `qualified_with_waivers`. Only explicit human acceptance produces `approved`.

If the human rejects a qualified plan and budgets remain, the factory records the reason, resumes planning in the same run, and repeats affected review and closure stages.

### PRD-016 — Make halt and cancellation terminal

A halted or cancelled run never resumes. Further work starts a child run that references immutable parent evidence and declares changed inputs, policy, models, or budgets without copying content.

Cancellation during a call records the request, attempts provider cancellation, retains any eventual response as evidence, and never applies that response to workflow state.

### PRD-017 — Pin policy and budgets

Built-in defaults, project configuration, and explicit CLI overrides resolve into a complete run configuration. Secrets are excluded. The review policy becomes immutable before the first provider-backed command.

After execution begins, a policy, model, prompt, schema, rubric, or budget increase requires a child run. Unused ceilings may be reduced for safety. A missing pinned model halts the run rather than selecting a floating alias.

## 12. Reliability and recovery

### PRD-018 — Commit accepted transitions atomically

Authoritative state, planned commands, and corresponding audit entries commit together or not at all. Provider calls and long filesystem work never occur inside a SQLite transaction.

### PRD-019 — Preserve one logical result

Logical command identity remains stable across physical attempts. Unknown external outcomes may be retried with the same application correlation key. Because synchronous providers do not guarantee idempotency, the factory reports possible duplicate calls while accepting at most one logical result.

Every physical call, token, and charge counts against hard budgets.

### PRD-020 — Classify failures

- Deterministic validation requires user correction.
- Transient transport failures use bounded retry.
- Schema-invalid outputs use separately bounded repair attempts.
- Refusal is a provider/content-policy outcome.
- Truncation is a limit or budget outcome.
- Substantive review failure uses remediation.
- Unknown external outcome uses recovery reconciliation.

### PRD-021 — Detect corruption and migrate safely

Audit entries are hash-chained and ordered by monotonic sequence and state version; wall-clock timestamps are informational. Failed verification enters read-only diagnostic mode.

Schema migration creates a verified backup of SQLite plus a manifest of every referenced object hash, runs numbered transactional migrations, and refuses mutation from a CLI older than the database schema.

## 13. Provider behavior and privacy

### PRD-022 — Record provider evidence

Adapters record normalized and raw requests, endpoint and behavior-affecting API metadata, requested and returned models, response and HTTP request IDs, provider-native usage, completion/refusal status, and raw responses. Credential values are never recorded.

### PRD-023 — Distinguish replay and rerun

Strict replay returns a matching local recording without network access and fails on a missing recording. A rerun performs a fresh provider call, may differ despite a pinned model, produces a new physical attempt, and consumes budget.

### PRD-024 — Disclose the network boundary

Before the first live run, the user acknowledges which content is transmitted to configured providers and that provider retention policies apply. Adapters minimize provider-side storage where supported. Optional SDK telemetry is disabled by default.

Operational state, artifacts, and recordings remain local by default, use restrictive filesystem permissions, and are Git-ignored. Built-in encryption is not promised; the CLI prominently documents reliance on OS account and filesystem protection.

Credentials may come only from environment variables or OS credential-store references and never appear in resolved configuration, SQLite, artifacts, logs, recordings, or exports.

## 14. CLI and reporting

### PRD-025 — Support human and automated use

Every command has human-readable output, stable exit-code classes, and a `--json` form. Read-only inspection remains available while a provider command holds the logical mutation lease.

The minimum command families are:

- initialize and configure;
- start, inspect, list, cancel, and create child runs;
- submit, validate, approve, reject, waive, and reconcile;
- execute next work, retry, rerun, and strict replay;
- inspect state, audit entries, artifacts, findings, usage, and gates; and
- export terminal reports and deliberate shareable artifacts.

### PRD-026 — Export terminal evidence

Every terminal run exports a human-readable report and machine-readable manifest. The manifest identifies input and artifact hashes, resolved configuration and policy hashes, providers and models, budgets and actual usage, gate evidence, findings and waivers, human actors and decisions, lineage, and outcome. Large or sensitive payloads are referenced by artifact identity rather than embedded.

## 15. Nonfunctional requirements

- Excluding provider latency, normal inspection and state-transition commands target p95 below 500 ms for supported workloads.
- One logical mutation lease and one effectful command are allowed at a time.
- Read operations use independent SQLite connections and never require a long-lived write transaction.
- Normal commands delete no immutable history. Explicit purge may remove verified unreferenced objects or entire terminal runs after confirmation.
- `.factory/` operational state, objects, cassettes, locks, and credentials are Git-ignored. Deliberate exports and product documentation may be committed.
- Generated or user-provided artifact text is untrusted data and never directly authorizes shell execution.
- No inbound network listener or undisclosed outbound telemetry exists.

## 16. Quality evaluation

Evaluation is a separate harness built on public application interfaces, not a production run stage.

Milestone acceptance requires:

- at least five seeded cases containing at least 20 planted defects and 20 planted non-defects;
- detection of 100% of planted critical/high defects;
- at least 80% detection across all planted defects;
- false findings on no more than 10% of planted non-defects;
- three real requirements documents compared with unrevised baseline plans; and
- a higher blinded human rubric score for factory plans.

The versioned rubric covers correctness, completeness, traceability, feasibility, risk handling, and clarity. A scorer must not have authored either compared plan; the primary user may administer but cannot be the sole scorer when they authored a plan.

## 17. Delivery sequence

### Increment 1 — Baseline-reviewed vertical slice

Register source, submit and approve a ledger, generate a structured plan, render Markdown, run an independent baseline review, persist evidence, and export a provisional result. This increment cannot approve a plan.

### Increment 2 — Qualification and approval

Add finding reconciliation, remediation claims, independent verification, closure review, waivers, rejection, final human approval, and terminal reports.

### Increment 3 — Recovery and security hardening

Add unknown-outcome recovery, mutation leases, migration backups, audit-chain verification, corruption diagnostics, cancellation, child runs, privacy acknowledgment, and deletion safeguards.

### Increment 4 — Replay and evaluation

Add strict replay, explicit rerun, seeded evaluation, blinded real-plan comparison, and acceptance evidence.

## 18. Architecture-readiness gate

Implementation begins only after the repository contains mutually consistent versions of:

- this PRD and the architecture document;
- accepted ADRs;
- a state-transition table;
- an audit-entry and command catalog;
- versioned JSON schemas;
- the default review taxonomy and component registry;
- OpenAI and Anthropic adapter contracts; and
- an acceptance-test matrix.

Exact model IDs, taxonomy contents, component values, repair and cycle counts, token/cost defaults, cassette retention, and the executable package name must be selected and recorded in those readiness artifacts. Conservative budget defaults require explicit user acceptance before the first live run.

## 19. Acceptance criteria

Milestone 1 is accepted when all of the following are demonstrated:

1. A supported source document can complete the full workflow through explicit human approval.
2. A baseline-only result cannot be mislabeled qualified or approved.
3. Ledger revisions invalidate downstream qualification while preserving lineage and finding history.
4. Direct Markdown edits block progression until reconciled canonically.
5. The Planner cannot change finding status, waive risk, or approve its own work.
6. Ambiguous finding fingerprints never silently merge concerns.
7. Waived blockers produce a distinct state and require renewed acknowledgment.
8. Crash tests at every command boundary preserve one accepted logical result and honest physical-call accounting.
9. State and audit entries never commit independently.
10. Missing artifacts, broken audit chains, and unsafe schema versions block mutation.
11. Strict replay never performs a live call; rerun is explicit and budgeted.
12. Provider refusal, truncation, schema failure, transport failure, and substantive failure follow distinct policies.
13. Read-only inspection remains available during provider calls.
14. Every loop and provider resource stops at its accepted bound.
15. Terminal manifests contain the evidence required by PRD-026.
16. The quality-evaluation thresholds in section 16 pass.

## 20. Document authority

This PRD defines product behavior, externally meaningful guarantees, constraints, acceptance criteria, and non-goals. Architecture must conform or explicitly propose a PRD change. Implementation details belong in architecture documents and ADRs.
