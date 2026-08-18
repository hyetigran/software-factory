# Software Factory — Milestone 1 Product Requirements Document

**Status:** Draft — under design review
**Version:** 1.0
**Product:** Local Software Factory CLI
**Milestone:** Requirements-to-approved-plan walking skeleton
**Primary user:** A single developer operating locally

## 1. Executive Summary

The Software Factory is a local command-line application that automates a currently manual workflow for turning raw product requirements into an independently reviewed, approved implementation plan.

The first milestone will coordinate a planning model and an independent reviewing model, preserve every artifact and decision, maintain a persistent findings ledger, run bounded remediation and closure-review loops, and recover safely after interruption.

Milestone 1 intentionally stops at an approved plan or an evidence-rich halt report. It does not generate architecture, tickets, or code. Those stages will be added only after the requirements-to-plan loop works on a real project.

The product is deliberately local and operationally simple:

- TypeScript on Node.js
- Command-line interface
- SQLite for run state and event history
- Markdown and JSON artifacts stored in the project
- Project-local provider recordings
- No web application, server, cloud deployment, or multi-user support

## 2. Problem Statement

The current workflow requires repeated manual handoffs among requirements, a planning model, an independent review model, local documentation-review skills, issue generation, and an implementation agent. The manual process works, but it has several weaknesses:

- Copying artifacts between tools is repetitive and error-prone.
- Review findings can drift, disappear, be duplicated, or be reclassified without an audit trail.
- A planner can claim to have resolved an issue without independent verification.
- A crash or interrupted session does not have a formal recovery protocol.
- Human edits can invalidate downstream artifacts without the workflow noticing.
- Model aliases, prompt changes, and provider behavior can alter review outcomes silently.
- Retry loops can consume unbounded time, tokens, and money.
- The user cannot reliably reconstruct why a plan passed, failed, or halted.

The software factory must automate the workflow without hiding these uncertainties behind orchestration terminology. It must make every decision inspectable and every external action recoverable.

## 3. Product Goal

Create a reliable local workflow that accepts a real requirements document and reaches one of two honest outcomes:

1. **Approved plan** — the plan has passed the configured review and closure gates.
2. **Halt report** — the workflow stopped within configured budgets and produced enough evidence for a human to determine whether the plan or the reviewer is unstable.

## 4. Success Criteria

Milestone 1 is successful when it can:

1. Process a real, non-synthetic requirements document end to end.
2. Preserve the original requirements as immutable source material.
3. Accept a manually authored or reviewed requirements ledger.
4. Generate a structured plan and a readable Markdown projection.
5. Perform an independent baseline review.
6. Maintain finding identity across wording changes, plan rewrites, requirement lineage changes, and remediation cycles.
7. Prevent a planner from certifying its own remediation.
8. Bound transport retries, schema repairs, remediation cycles, closure reviews, provider calls, token use, and spend.
9. Stop and resume without losing findings, duplicating completed logical commands, changing reconstructed state, or duplicating artifact identities.
10. End with an approved plan or an evidence-rich halt report.

## 5. User and Operating Environment

### 5.1 Primary user

A single developer who:

- Supplies requirements.
- Reviews and approves the requirements ledger.
- Chooses model providers and exact model snapshots.
- Inspects plans and findings.
- Approves waivers or exceptional severity changes.
- Starts, resumes, retries, and cancels runs.

### 5.2 Operating environment

- Local workstation
- Node.js runtime
- Git-managed project directory
- SQLite database stored inside the project’s `.factory/` directory
- Provider credentials supplied through environment variables or an operating-system credential store

## 6. Product Principles

1. **Plain software over buzzwords.** The system is a CLI, state machine, event log, adapters, and files.
2. **Decision and execution are separate.** Workflow decisions must be testable without APIs or file writes.
3. **The event history is authoritative.** Current-state tables and reports are rebuildable projections.
4. **Semantic identity outlives prose.** Requirement, section, component, finding, artifact, and command identities must not depend on mutable wording.
5. **The reviewer verifies remediation.** The planner may propose a fix but cannot close its own finding.
6. **Subjective and objective evidence are labeled.** A model judgment must not masquerade as a deterministic rule.
7. **All loops terminate.** Exhausted budgets produce a halt report rather than an indefinite retry.
8. **A real vertical workflow comes before horizontal framework features.**

## 7. Milestone 1 Scope

### 7.1 Included workflow

```text
Raw requirements
    ↓
Manual requirements ledger submission
    ↓
Human requirements approval
    ↓
Structured plan generation
    ↓
Anchored Markdown rendering
    ↓
Independent baseline review
    ↓
Persistent findings ledger
    ↓
Bounded remediation loop
    ↓
Bounded full-document closure loop
    ↓
Approved plan or halt report
```

### 7.2 Included capabilities

- Project initialization
- Run creation and status inspection
- Raw requirements registration
- Manual requirements-ledger submission
- Human requirements approval
- Structured plan generation
- Stable plan-section identity
- Independent baseline review
- Persistent findings and review observations
- Remediation claims and independent verification
- Diff-based remediation review
- Full-document closure review
- Explicit pass/fail gates
- Event history and crash recovery
- Artifact versioning and human-edit detection
- Provider request recording and strict replay seam
- Separate retry and spend budgets
- Read-only inspection during long-running provider calls
- Final plan approval or halt reporting

### 7.3 Explicit non-goals

Milestone 1 will not include:

- Automated architecture generation
- Cursor skill automation
- GitHub issue generation or publication
- Codex CLI or Claude Code implementation
- Product-repository modification
- Product build, lint, test, or security execution
- Web application or desktop GUI
- Background server
- Cloud hosting
- Multiple users
- Distributed workers or queues
- Parallel effects
- A generalized workflow language
- A plug-in marketplace
- A generalized dependency graph
- Cross-run cache lookup
- An evaluation dashboard

## 8. Definitions

### 8.1 Artifact

An immutable version of an input or output, such as raw requirements, a requirements ledger, a structured plan, a rendered plan, a review result, a findings projection, or a halt report.

### 8.2 Worker

A role that performs one task, such as planning or reviewing. In implementation, a worker is invoked through an adapter.

### 8.3 Adapter

A boundary that performs an external or nondeterministic action, including an LLM request, filesystem operation, clock read, or human submission.

### 8.4 Gate

A decision that determines whether the workflow can advance. A gate consumes evidence from deterministic checks, model judgments, ledger policy, or human decisions.

### 8.5 Finding

A persistent semantic concern identified during review.

### 8.6 Finding observation

The appearance or evaluation of a finding against a specific artifact version in a specific review cycle.

### 8.7 Closure review

A full-document review performed after all known blocking findings have been resolved or waived. It protects against local remediations introducing global inconsistencies or against prior reviewer omissions.

### 8.8 Logical command

A stable instruction caused by a specific event and input state, regardless of how many physical execution attempts are needed.

## 9. Functional Requirements

### REQ-001 — Initialize a factory workspace

The user shall be able to initialize a project-local factory workspace.

The workspace shall contain, at minimum:

```text
.factory/
    state.db
    objects/
    cassettes/
    locks/
    exports/
docs/factory/
```

### REQ-002 — Start a run from raw requirements

The user shall be able to start a run by supplying a raw requirements file.

The factory shall:

- Preserve the raw requirements as immutable source material.
- Compute and record a content hash.
- Assign the run a stable identity.
- Record the configuration, prompt versions, rubric versions, model snapshots, and budgets that apply to the run.

### REQ-003 — Accept a manual requirements ledger

Milestone 1 shall use a manual adapter for requirements normalization.

The user shall be able to submit a structured requirements ledger containing:

- Stable requirement ID
- Human-readable display ID
- Requirement statement
- Status
- Source artifact reference
- Source ranges
- Lineage roots

### REQ-004 — Approve requirements before planning

The factory shall not generate a plan until the requirements ledger has passed deterministic validation and received explicit human approval.

Deterministic checks shall include:

- Schema validity
- Unique active requirement IDs
- No reuse of retired IDs
- Source support for every active requirement
- Mapping or explicit exclusion of relevant source spans

### REQ-005 — Preserve requirement lineage

The persisted requirement protocol shall support:

- Update
- Removal
- Replacement
- Split
- Merge

Split and merge successors shall preserve lineage roots so downstream finding identity can survive requirement restructuring.

Polished split-and-merge user experience may be deferred, but the identity protocol must exist in Milestone 1.

### REQ-006 — Generate a structured implementation plan

The planning worker shall return schema-valid structured data rather than free-form Markdown.

The plan shall include:

- Title and summary
- Scope
- Proposed approach
- Major components
- Data and API considerations where applicable
- Error handling
- Security considerations
- Testing approach
- Dependencies
- Risks
- Implementation sequence
- Requirement coverage with justification
- Stable component references
- Structured sections

### REQ-007 — Render human-readable anchored Markdown

The factory shall render the canonical structured plan into Markdown.

The orchestrator, not the model, shall own persistent section identities and insert section markers into the projection.

A model shall not be relied upon to preserve invisible HTML comments during rewrites.

### REQ-008 — Preserve section continuity

Every plan revision shall account for each previous section identity as one of:

- Preserved
- Retitled
- Merged
- Split
- Retired
- Newly created

A deterministic continuity check shall reject silent identity loss or ID reuse.

A human deletion of an anchor shall create a reconciliation condition rather than silently retiring the section.

### REQ-009 — Maintain a controlled component registry

The plan shall contain a small component registry with stable component IDs.

Reviewers shall select component IDs from this registry rather than inventing free-text component names.

The registry shall include reserved cross-cutting values such as:

- `SYSTEM`
- `CROSS_CUTTING`
- `PROCESS`

### REQ-010 — Perform an independent baseline review

After plan generation, the factory shall invoke an independently configured reviewer.

The reviewer shall receive:

- The approved requirements ledger
- The complete structured plan
- The rendered plan
- The review taxonomy
- The component registry
- Any prior recurrence context

The reviewer shall return structured output conforming to a versioned schema.

### REQ-011 — Maintain an orchestrator-owned findings ledger

The factory shall own finding IDs, fingerprints, and status transitions.

The reviewer shall not mint or modify semantic fingerprints.

The planner shall not resolve, retire, waive, or reclassify findings.

### REQ-012 — Separate findings from observations

A persistent finding shall represent the semantic concern.

A finding observation shall record:

- Artifact version
- Review cycle
- Requirement references
- Section references
- Evidence
- Description
- Reviewer verdict

This separation shall allow a finding to survive plan rewrites and anchor changes.

### REQ-013 — Compute controlled semantic fingerprints

The orchestrator shall compute each fingerprint from controlled, versioned inputs:

- Review taxonomy version
- Rule ID
- Taxonomy-derived category ID
- Stable component ID
- Canonical requirement-lineage roots

Free-text descriptions, titles, anchors, and reviewer-authored labels shall not participate in identity.

### REQ-014 — Reconcile every existing finding

Every remediation or regenerated-plan review shall explicitly account for all prior unresolved or superseded-pending findings.

A schema-valid review shall not be accepted when an existing finding is omitted.

Resolved findings may be supplied to reviewers as compact recurrence stubs containing, at minimum:

- Finding ID
- Fingerprint
- One-line summary

### REQ-015 — Submit planner remediation claims

For each open finding, the planner shall submit:

- A remediation explanation
- The changed structured sections
- Relevant requirement references
- Relevant component references
- Any continuity intent

The planner’s claim shall not alter finding status by itself.

### REQ-016 — Independently verify remediation

The reviewer shall determine whether each remediation is:

- Accepted
- Rejected
- Still open
- Recurred
- No longer applicable

The orchestrator shall apply the resulting state transition according to policy.

### REQ-017 — Detect false-remediation evidence

When a planner claims to have changed a section whose normalized content hash did not change, the factory shall record this as evidence and include it in the remediation review.

This deterministic evidence shall not automatically prove failure because a valid fix may occur elsewhere; the reviewer shall judge the substance.

### REQ-018 — Run a full-document closure review

Once known blocking findings are cleared, the factory shall perform a full-document closure review.

Closure shall pass only when:

- No open critical findings remain.
- No open high findings remain.
- No prior finding was omitted.
- No new critical or high finding is created.
- Requirement coverage passes.
- The result is schema-valid.

### REQ-019 — Bound the closure loop

The closure loop shall have its own budget, separate from main remediation cycles.

The default workflow shall permit:

- Closure review 1
- One closure remediation when needed
- Closure review 2
- Pass or halt

A second failed closure review shall halt rather than restart an unbounded loop.

### REQ-020 — Keep baseline-omission classification as telemetry

A reviewer may classify a new issue as a probable baseline omission or as introduced by a later diff.

This classification shall be recorded for trend analysis only and shall not change gate behavior.

### REQ-021 — Label evidence types

Every gate rule shall declare its evidence type:

- Deterministic
- LLM judgment
- Ledger policy
- Human decision

A gate report shall display these types so the user can distinguish mechanically verified facts from subjective judgments.

### REQ-022 — Preserve an append-only event history

Every meaningful state transition shall be represented as a versioned event.

The raw event history shall be immutable.

Current-state tables and exported ledgers shall be rebuildable projections.

### REQ-023 — Persist trigger events and planned commands atomically

An incoming triggering event and all `CommandPlanned` events caused by it shall be appended in one SQLite transaction.

If the transaction fails, neither the trigger nor its planned child commands shall persist.

No provider call or long-running filesystem effect shall occur inside this transaction.

### REQ-024 — Use deterministic logical command identity

A command key shall be derived from:

- Run ID
- Triggering event sequence
- Command type
- Command ordinal
- Input digest

The command key shall support:

- External idempotency markers
- Provider idempotency where available
- Duplicate detection
- Replay assertions
- Correlation of physical attempts

The key shall be defense-in-depth; atomic event-and-plan persistence shall provide primary crash safety.

### REQ-025 — Separate logical commands from physical attempts

One logical command may have multiple physical attempts when a response is lost, a transport fails, or the user forces a retry.

Every attempt shall remain correlated with its logical command.

### REQ-026 — Reconstruct state by replay

Replaying the event history under a compatible engine and upcaster chain shall reconstruct the same current state and logical commands.

The pure decision and state-transition functions shall not read clocks, random values, environment variables, files, databases, or networks.

### REQ-027 — Version event schemas

Every event type shall carry a schema version.

Old events shall be interpreted through pure upcasters.

A run without a safe upcast path shall become read-only rather than being resumed under ambiguous semantics.

### REQ-028 — Permit one mutating process

Only one mutating CLI process may operate on a project at a time.

A project-level writer lock shall protect mutating commands.

### REQ-029 — Keep read-only inspection available

Read-only commands such as `status`, `inspect`, `events`, `artifacts`, and `findings` shall remain available while a long provider call is in progress.

The writer lock shall not block read-only database access.

### REQ-030 — Permit one in-flight effectful command

Milestone 1 shall allow only one effectful command in `started` state at a time.

Parallel execution is out of scope.

### REQ-031 — Version every artifact

The factory shall never silently overwrite an artifact.

Each human edit, model output, deterministic render, or regeneration shall create a new immutable artifact version with recorded provenance.

### REQ-032 — Detect human edits and invalidate downstream decisions

Before executing a dependent stage, the factory shall verify canonical working-file hashes.

An external edit shall:

1. Produce an `ArtifactExternallyModified` event.
2. Register a new human-origin artifact version.
3. Apply Milestone 1’s hardcoded invalidation rules.
4. Preserve the findings ledger and apply explicit lifecycle transitions.

### REQ-033 — Use hardcoded Milestone 1 invalidation rules

Milestone 1 shall use a simple fixed invalidation table rather than a generalized graph.

At minimum:

- Raw requirements changes invalidate requirements approval, plan, reviews, and final approval.
- Requirements-ledger changes invalidate plan, reviews, and final approval.
- Plan changes invalidate reviews and final approval.
- Review prompt, rubric, taxonomy, or model changes invalidate review results and final approval while preserving the plan.
- Gate-policy changes invalidate gate decisions and final approval while preserving evidence.

### REQ-034 — Preserve findings during invalidation and regeneration

Invalidation shall not delete finding identity or history.

When a plan lineage is regenerated:

- Open findings become `superseded_pending`.
- Resolved findings remain resolved and enter a recurrence watchlist.
- The next baseline review reconciles prior findings.

### REQ-035 — Remap findings through requirement lineage

Finding-to-requirement associations shall be mechanically remapped through requirement lineage.

A finding referencing a removed requirement without a successor shall become orphaned.

An orphaned critical or high finding shall block approval until a human maps, waives, or retires it with a reason.

### REQ-036 — Record and replay provider interactions

All provider calls shall occur behind adapters with a recording seam.

A cassette request identity shall include:

- Adapter and adapter version
- Provider
- Exact model snapshot
- System-prompt hash
- User-prompt hash
- Input artifact hashes
- Tool configuration
- Output-schema version
- Generation parameters

Project-derived cassettes shall remain under `.factory/cassettes/` and be ignored by Git by default.

### REQ-037 — Fail strict replay on an unrecorded request

In strict replay mode:

- A matching cassette shall return its recorded response.
- A missing cassette shall fail with `UNRECORDED_REQUEST`.
- Replay shall never silently call a live provider.

### REQ-038 — Provide a separate live-evaluation mode

A changed prompt, rubric, schema, taxonomy, or model snapshot creates a new request and cannot be evaluated by an old cassette.

The product shall therefore support a distinct live-evaluation mode for seeded cases.

Replay tests verify software behavior against known responses. Live evaluations verify semantic behavior of changed requests.

### REQ-039 — Pin model identity

The factory shall record:

- Provider
- Requested model identifier
- Returned model identifier when available
- Prompt hash
- Rubric hash
- Output-schema version
- Provider request ID

Floating aliases shall be rejected for reproducible production workflows when an exact snapshot is available.

A model-identity change shall invalidate semantic baselines and relevant cached decisions.

### REQ-040 — Enforce independent budgets

The factory shall support separate configurable budgets for:

- Transport retries per call
- Schema repairs per call
- Main remediation cycles
- Closure reviews
- Provider calls per run
- Input tokens per run
- Output tokens per run
- Total cost per run

Schema-invalid output shall not consume a substantive remediation cycle.

### REQ-041 — Halt before knowingly exceeding a hard budget

Before planning a provider command, the decision engine shall compare recorded and reserved usage against configured ceilings.

When the next command could exceed a hard ceiling, the factory shall halt rather than dispatch the command.

### REQ-042 — Generate a churn-aware halt report

A halted review run shall produce structured JSON and readable Markdown reports containing:

- Halt reason
- Open and orphaned findings
- New findings per cycle
- Resolved and reopened findings
- Findings recurring across plan generations
- Severity-reclassification attempts
- Baseline-omission classifications
- Remediation claims and rejected remediations
- Retry and review-budget use
- Provider calls, tokens, and cost
- Schema and transport failures
- Model, prompt, rubric, and taxonomy versions
- Recommended human decisions

### REQ-043 — Provide explicit CLI operations

Milestone 1 shall support, at minimum:

```bash
factory init
factory start <requirements-file>
factory submit <artifact-file>
factory approve <stage>
factory reject <stage>
factory resume
factory retry <command-or-stage>
factory retry <command-or-stage> --force
factory cancel
factory status
factory inspect <subject>
factory events
factory artifacts
```

### REQ-044 — Define retry behavior against existing successful work

A normal retry with unchanged logical command identity and an existing successful result shall be a no-op.

A deliberate rerun shall require `--force` and shall produce auditable `ForceRetryRequested` and `CacheBypassed` events.

Generalized cross-run memoization may be implemented later using identity fields persisted from Milestone 1.

### REQ-045 — Protect credentials and proprietary content

The factory shall not write provider credentials to:

- Events
- Logs
- Artifacts
- Prompts
- Cassettes
- Debug exports

Requirements, plans, findings, provider recordings, and halt reports shall remain local unless the user explicitly exports or commits them.

### REQ-046 — Treat artifact contents as untrusted data

Prompt construction shall clearly separate factory instructions, taxonomies, and schemas from user-provided or model-generated artifact content.

Model-generated text shall never directly authorize shell execution in Milestone 1.

## 10. Gate Requirements

### 10.1 Requirements gate

The requirements stage passes when:

- The ledger is schema-valid.
- Active IDs are unique.
- Retired IDs are not reused.
- Every active requirement has source support.
- Relevant source content is mapped or explicitly excluded.
- Human approval is recorded.

### 10.2 Baseline review gate

The baseline result is accepted as valid evidence when:

- The review schema is valid.
- Every referenced requirement, section, rule, category, and component exists.
- Every prior unresolved finding is reconciled.
- Fingerprints are computed by the orchestrator.

The workflow advances to remediation or closure based on the resulting ledger state.

### 10.3 Remediation gate

A remediation cycle completes when:

- Every open finding has a remediation claim.
- Section continuity validates.
- The reviewer accounts for every existing finding.
- No silent severity downgrade occurs.
- New findings are added with cycle attribution.

### 10.4 Closure gate

The plan passes when:

- No unresolved critical or high findings remain.
- No prior finding is omitted.
- The full-document closure review creates no new critical or high finding.
- Requirement coverage is present and judged sufficient.
- All required deterministic checks pass.
- Any required human decision is recorded.

## 11. Review Taxonomy Requirements

The review taxonomy shall be versioned and shall define controlled rules and categories.

The initial taxonomy should cover at least:

- Requirement omission
- Requirement contradiction
- Scope ambiguity
- Missing acceptance criteria
- Data integrity
- Security and privacy
- Authentication and authorization
- Error handling
- Reliability and recovery
- Rollback strategy
- Observability
- Performance
- Testing sufficiency
- Deployment and migration
- Dependency risk
- Maintainability

Rules should be narrow enough that one semantic fingerprint represents one concern class.

## 12. Artifact Requirements

Milestone 1 shall produce or register the following artifacts as applicable:

```text
raw-requirements.md
requirements-ledger.json
plan.json
plan.md
plan-anchor-map.json
baseline-review.json
remediation-response.json
remediation-review.json
closure-review.json
findings-ledger.json
review-report.md
halt-report.json
halt-report.md
run-export.json
```

Every artifact shall record:

- Artifact ID
- Type
- Schema version
- Content hash
- Origin
- Producer
- Input artifact identities and hashes
- Prompt, rubric, taxonomy, model, worker, and tool versions where applicable
- Creation event sequence

## 13. Nonfunctional Requirements

### NFR-001 — Recoverability

The product shall recover from termination between completed commands without losing committed state.

### NFR-002 — Deterministic core

Given the same compatible state and event, the pure core shall emit the same state transition and command specifications.

### NFR-003 — Traceability

The user shall be able to trace:

```text
Source requirement
→ Requirement identity
→ Plan section
→ Review finding
→ Review observation
→ Remediation
→ Gate decision
→ Final approval or halt
```

### NFR-004 — Explainability

Every workflow decision shall have inspectable evidence and an identified evidence type.

### NFR-005 — Local privacy

No inbound network listener shall exist. Network calls shall be limited to explicitly configured provider adapters.

### NFR-006 — Operational simplicity

The product shall not require a server, container platform, external database, message queue, or cloud service.

### NFR-007 — Bounded resource use

A run shall never intentionally exceed configured call, token, cost, or cycle budgets.

### NFR-008 — Compatibility policy

Historical runs shall remain readable. Resumption shall require a complete, safe upcast path for all events.

### NFR-009 — Read availability

Read-only inspection shall remain available during long-running effects.

### NFR-010 — Audit integrity

Historical events and artifact versions shall not be silently rewritten.

## 14. Default Budget Configuration

Initial defaults may be:

```yaml
budgets:
  transport_retries_per_call: 2
  schema_repairs_per_call: 2
  main_remediation_cycles: 3
  closure_reviews: 2
  provider_calls_per_run: 12
  input_tokens_per_run: 300000
  output_tokens_per_run: 60000
  cost_ceiling_usd: 100
```

These are configurable defaults, not architectural constants.

## 15. Testing and Validation Requirements

### 15.1 Pure transition tests

Tests shall feed synthetic events and states into the decision and state-transition functions without network, database, filesystem, clock, or randomness.

### 15.2 Transaction tests

Tests shall verify that a trigger event and all resulting planned commands commit or roll back together.

### 15.3 Kill-and-restart tests

The process shall be terminated at multiple boundaries, including:

- Before transactional commit
- After transactional commit
- After command start
- During a provider call
- After artifact creation but before success-event submission
- After result-event submission

The following properties must hold:

1. No finding is lost.
2. No completed logical command is re-planned.
3. Replayed state remains identical.
4. No artifact version is duplicated under a new identity.

### 15.4 Priority ledger protocol tests

The highest-priority tests shall cover:

1. Omitted existing finding
2. Silent severity downgrade
3. Duplicate finding expressed with different prose
4. Legitimate new finding during remediation
5. Resolved finding recurring after rewrite
6. Requirement split preserving finding identity
7. Component display-name change preserving finding identity
8. Orphaned blocker requiring human disposition
9. Closure finding a missed blocker
10. Closure budget exhaustion
11. False-remediation claim with unchanged cited section
12. Reviewer incorrectly accepting false remediation
13. Stable section identity through rewrite
14. Missing Markdown marker creating reconciliation rather than silent retirement

### 15.5 Seeded live-evaluation cases

The initial live-evaluation corpus shall include:

- Missing rollback strategy
- Contradictory requirements
- Clean decoy
- Recurrence after rewrite
- False-remediation trap

The corpus shall use planted defects and planted non-defects so assertions are computable.

## 16. Milestone 1 Delivery Sequence

### Increment 1 — Walking skeleton

Implement:

- Versioned event envelope
- SQLite event store
- Transactional append-and-plan
- Pure decision and transition functions
- Mutation lock with read-only access
- One in-flight command
- Artifact identity and provenance
- Manual requirements submission
- Requirements approval
- Planner adapter
- Structured plan and rendered anchors
- Baseline reviewer
- Finding/observation ledger v0
- Plan approval
- Status and inspection commands
- Provider recording seam

A real requirements document must reach an approved plan or coherent halt.

### Increment 2 — Remediation and closure

Add:

- Planner remediation claims
- Structured plan diff
- Section continuity intents
- Remediation review
- Finding reconciliation
- Main and closure budgets
- Churn-aware halt reporting
- False-remediation tests

### Increment 3 — Automated requirements normalization

Add:

- Source-span proposals
- Update/new/removed reconciliation
- Human comparison view
- Split and merge workflows

### Increment 4 — Replay and seeded evaluation harness

Add:

- Strict replay runner
- Synthetic cassettes
- Live seeded-evaluation runner
- Approved baseline replacement
- Golden event transcripts

## 17. Milestone 1 Acceptance Criteria

Milestone 1 is complete when:

1. A real requirements document enters the factory.
2. The user submits and approves a requirements ledger.
3. The planner produces a schema-valid structured plan.
4. The factory renders stable plan-section identities.
5. The reviewer produces structured findings using controlled rule and component identifiers.
6. The orchestrator computes every fingerprint.
7. A planner cannot resolve its own finding.
8. Existing findings cannot disappear through reviewer omission.
9. Requirement lineage does not silently duplicate findings.
10. Plan regeneration preserves recurring concerns.
11. Triggering events and planned commands commit atomically.
12. Event replay reconstructs the same state.
13. Read-only inspection works during provider calls.
14. A second mutating process is rejected.
15. Review and closure loops terminate within budget.
16. Provider-call, token, and cost ceilings are enforced.
17. Strict replay fails on an unrecorded request.
18. Human edits create new artifact versions and invalidate the correct downstream decisions.
19. Kill-and-restart tests preserve all four recovery properties.
20. The run ends with an approved plan or evidence-rich halt report.

## 18. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Reviewer severity drift | Immutable discovery severity; explicit reclassification events and authority. |
| Findings churn | Persistent ledger, reconciliation requirements, recurrence matching, bounded closure. |
| Reviewer vocabulary changes | Controlled rule taxonomy, component registry, and orchestrator-computed fingerprints. |
| Requirement restructuring duplicates findings | Canonical lineage roots in fingerprint computation. |
| Plan anchors disappear during rewrite | Structured plan output and orchestrator-owned Markdown rendering. |
| Crash after event but before decisions | Atomic append of trigger event and resulting planned commands. |
| Provider response lost after remote completion | Stable logical command, recorded physical attempts, visible duplicate cost. |
| Prompt or model drift | Exact version recording, strict replay, and separate live seeded evaluation. |
| Runaway cost | Call, token, output, and cost ceilings checked before dispatch. |
| Framework work displaces useful workflow | Real requirements document through the walking skeleton before horizontal expansion. |

## 19. Deferred Decisions

The following must be selected before the first production run but do not block the product definition:

- Planning provider and exact model snapshot
- Independent-review provider and exact model snapshot
- Initial review taxonomy contents
- Initial component registry
- Run-level token and cost ceilings
- Git policy for human-facing artifacts
- Cassette-retention policy
- CLI package and executable name

## 20. Development Guardrail

> No horizontal infrastructure feature may be added unless the active vertical workflow requires it or it defines persisted identity or a cross-component protocol that cannot safely be introduced later.

The next implementation artifact after this PRD and its architecture is the event log of a real run—not another framework design document.
