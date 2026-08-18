# Milestone 1 Acceptance-Test Matrix

**Status:** Readiness baseline
**PRD:** v2.0
**Architecture:** v2.0

This matrix defines required executable evidence. Test paths are commitments for implementation; `pending` means the test does not exist yet, not that the requirement is optional.

## Requirement coverage

| Requirement | Evidence ID | Required test evidence | Planned path | Status |
|---|---|---|---|---|
| PRD-001 immutable source | E-SOURCE-001 | Modify/delete external file after registration; stored bytes and hash remain unchanged | `tests/integration/source-registration.test.ts` | pending |
| PRD-002 manual ledger | E-LEDGER-001 | Valid JSON accepted; Markdown and coverage projections deterministic | `tests/integration/ledger-submission.test.ts` | pending |
| PRD-003 complete coverage | E-LEDGER-002 | Gaps, overlaps, bad ranges, reused IDs, and unapproved exclusions block approval | `tests/domain/requirements-gate.test.ts` | pending |
| PRD-004 ledger revision | E-LINEAGE-001 | Revision invalidates downstream gates and remaps split/merge lineage without deleting history | `tests/domain/ledger-revision.test.ts` | pending |
| PRD-005 generated plan | E-PLAN-001 | Planner output validates and covers every active requirement | `tests/contracts/planner.test.ts` | pending |
| PRD-006 human plan | E-PLAN-002 | Human JSON accepted; incomplete section transition maps rejected | `tests/integration/plan-submission.test.ts` | pending |
| PRD-007 projections | E-PLAN-003 | Rendering deterministic; external edit preserved and blocks downstream work | `tests/integration/plan-rendering.test.ts` | pending |
| PRD-008 independent roles | E-REVIEW-001 | Same-provider default rejected; explicit override recorded and reported | `tests/domain/independence-policy.test.ts` | pending |
| PRD-009 baseline review | E-REVIEW-002 | Complete inputs sent; schema/taxonomy violations rejected | `tests/contracts/reviewer.test.ts` | pending |
| PRD-010 finding identity | E-FINDING-001 | Fingerprint collision creates ambiguous candidates and never merges IDs silently | `tests/domain/finding-reconciliation.test.ts` | pending |
| PRD-011 observations | E-FINDING-002 | Multiple observations retain exact plan, policy, model, severity, and wording history | `tests/integration/finding-history.test.ts` | pending |
| PRD-012 remediation | E-REVIEW-003 | Planner claim alone cannot close; only accepted Reviewer evidence triggers policy transition | `tests/domain/remediation-authority.test.ts` | pending |
| PRD-013 closure | E-REVIEW-004 | Full plan reviewed; new blockers reopen bounded remediation; exhaustion halts | `tests/domain/closure-loop.test.ts` | pending |
| PRD-014 waivers | E-WAIVER-001 | Any severity can be waived; relevant change makes waiver stale; acknowledgment required | `tests/domain/waiver-lifecycle.test.ts` | pending |
| PRD-015 qualification | E-GATE-001 | Baseline cannot approve; qualification and human approval remain distinct; rejection replans | `tests/domain/approval-gate.test.ts` | pending |
| PRD-016 terminal runs | E-RUN-001 | Halt/cancel terminal; child structurally shares verified artifacts and declares changes | `tests/domain/terminal-child-run.test.ts` | pending |
| PRD-017 pinned policy | E-POLICY-001 | Policy locks at first provider call; ceiling increase and unavailable model require child/halt | `tests/domain/policy-lock.test.ts` | pending |
| PRD-018 atomic transitions | E-TXN-001 | Fault injection proves state, commands, and audit entries commit or roll back together | `tests/integration/atomic-transition.test.ts` | pending |
| PRD-019 logical result | E-CMD-001 | Duplicate physical calls yield at most one accepted result and all usage remains counted | `tests/crash/unknown-outcome.test.ts` | pending |
| PRD-020 failure classes | E-CMD-002 | Transport, schema, refusal, truncation, substantive, and integrity failures route differently | `tests/domain/failure-routing.test.ts` | pending |
| PRD-021 corruption/migration | E-INTEGRITY-001 | Broken chain blocks mutation; verified backup/migration/restore succeeds | `tests/integration/migration-integrity.test.ts` | pending |
| PRD-022 provider evidence | E-PROVIDER-001 | Raw/normalized request, IDs, model, native usage, and status stored without credentials | `tests/contracts/provider-evidence.test.ts` | pending |
| PRD-023 replay/rerun | E-REPLAY-001 | Strict replay cannot open network; miss fails; rerun is fresh, explicit, and budgeted | `tests/integration/replay-rerun.test.ts` | pending |
| PRD-024 privacy boundary | E-PRIVACY-001 | First live call needs acknowledgment; storage minimized; telemetry off; secrets absent | `tests/security/provider-boundary.test.ts` | pending |
| PRD-025 CLI contract | E-CLI-001 | Every command has human/JSON output and stable exit class; reads work during lease | `tests/cli/public-contract.test.ts` | pending |
| PRD-026 terminal export | E-REPORT-001 | All four terminal outcomes validate against manifest schema and reference required evidence | `tests/integration/terminal-export.test.ts` | pending |

## Milestone acceptance criteria

| Criterion | Evidence IDs | Pass condition | Status |
|---|---|---|---|
| AC-01 full real workflow | E2E-REAL-001 | Real source reaches explicit approval with complete manifest | pending |
| AC-02 baseline labeling | E-GATE-001 | No baseline-only path reaches qualified/approved | pending |
| AC-03 revision lineage | E-LINEAGE-001, E-FINDING-002 | Qualification invalidated; history preserved and traceable | pending |
| AC-04 edit reconciliation | E-PLAN-003 | Direct edit blocks until verified restore or canonical submit | pending |
| AC-05 separated authority | E-REVIEW-003, E-WAIVER-001 | Planner cannot close/waive/approve | pending |
| AC-06 collision safety | E-FINDING-001 | No ambiguous automatic merge | pending |
| AC-07 waiver outcome | E-WAIVER-001, E-GATE-001 | Distinct state and approval acknowledgment | pending |
| AC-08 crash safety | E-CMD-001, CRASH-MATRIX-001 | Every boundary has explainable recovery and one logical result | pending |
| AC-09 transaction atomicity | E-TXN-001 | Fault injection yields all-or-nothing commit | pending |
| AC-10 integrity gates | E-INTEGRITY-001 | Missing object, broken chain, unsafe schema block mutation | pending |
| AC-11 replay isolation | E-REPLAY-001 | Network spy observes zero calls in strict replay | pending |
| AC-12 failure routing | E-CMD-002 | Every failure class reaches specified policy | pending |
| AC-13 concurrent inspection | E-CLI-001 | Status/findings/audit reads complete during provider lease | pending |
| AC-14 bounded execution | BUDGET-MATRIX-001 | Every loop/resource halts before exceeding accepted ceiling | pending |
| AC-15 manifest completeness | E-REPORT-001 | Schema plus semantic assertions pass for all outcomes | pending |
| AC-16 quality thresholds | EVAL-SEEDED-001, EVAL-BLIND-001 | PRD section 16 sample sizes and thresholds all pass | pending |

## Crash-boundary matrix

`CRASH-MATRIX-001` must kill and restart the process at these boundaries:

1. Before and after object temporary write, verification, and rename.
2. Before and after accepted-transition commit.
3. Before and after lease acquisition and attempt insertion.
4. Before provider dispatch, after possible dispatch, and after response receipt.
5. Before and after response-object finalize and outcome commit.
6. Before and after cancellation transition and late response arrival.
7. Before and during migration, backup-manifest write, and restore selection.

Every case asserts state version, command/attempt status, audit-chain validity, object references, usage reservation, lease recovery, and terminal/report behavior.

## Budget matrix

`BUDGET-MATRIX-001` covers each ceiling independently and in combination: live calls, physical attempts, transport retries, schema repairs, remediation cycles, closure cycles, input tokens, output tokens, and cost. It also covers unknown-outcome conservative charging, reservation release, exact-boundary dispatch, ceiling reduction, and forbidden increase.

## Evaluation evidence

`EVAL-SEEDED-001` contains at least five cases, 20 planted defects, and 20 planted non-defects. It must detect all critical/high defects, at least 80% overall defects, and produce false findings on no more than 10% of planted non-defects.

`EVAL-BLIND-001` contains three real documents and anonymized baseline/factory plans scored by a non-author using `config/review-rubric.v1.md`. Factory plans must receive a higher aggregate score; ties do not pass.

## Release gate

Milestone 1 cannot be called accepted while any AC row is pending or failed. Individual increments may ship internal previews with their incomplete evidence explicitly reported.
