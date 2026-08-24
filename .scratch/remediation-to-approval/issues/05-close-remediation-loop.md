# 05 — Close the remediation loop end-to-end

**What to build:** An accepted `verify_remediation` provider attempt is settled by the executor into a validated `RemediationReviewAccepted` input and submitted to the domain, so the full loop — remediation generated → verification dispatched → verdict settled → next cycle or closure — runs against the SQLite authority without manual state construction. This is the tracer bullet proving the remediation workflow works as one path, not as isolated transitions.

**Blocked by:** 02 — Dispatch remediation verification with full diff context; 04 — Reviewer verdict on remediation claims.

**Status:** done

- [x] An accepted verify attempt produces a `RemediationReviewAccepted` input whose deterministic validations are computed by the application from the recorded response
- [x] One integration test drives a run from an accepted remediation proposal through verification to the next remediation cycle, and another to closure, entirely through the authority
- [x] Usage reconciliation, attempt settlement, and audit-chain continuity hold across the loop exactly as they do for baseline review
- [x] Verification responses that fail schema or reconciliation route to the repair/failure policy instead of advancing state

## Comments

Landed in `feat(executor): settle verified remediation verdicts`. `buildRemediationReviewAccepted` derives verdicts from the recorded review response — a `resolved` disposition closes a claim; `reproduced` and `uncertain` keep it open, fail-closed — validates against the pinned review schema, binds the diff bytes by hash and cross-checks its claims against the command's claim ids (closing ticket 04's claim-binding deferral), verifies the review's context pins (kind, policy hash, plan artifact), and selects route-appropriate pinned budgets/settings. Settlement accepts `RemediationReviewAccepted`, including terminal halt results. The verdict fact is the new `remediation_evaluated` catalog entry (added to protocols/audit-entries.md — the transition table had promised it and the old `review_accepted` reuse both violated that fact's payload contract and dragged in the baseline projection machinery); verdict dispositions are now in the audit payload. `finding_transitioned` facts update the findings read model. The SQLite test drives the whole loop through the authority to both outcomes — unresolved verdict → second cycle → second proposal → resolved verdict → closure — with the audit tail and findings row asserted.

Known parity limits, deliberate: the builders have no production run-loop caller yet (true of every increment since ticket 01 — the CLI run loop is post-milestone-workflow wiring), sqlite-level `persistProviderCompletion` is exercised only via the stub-authority settlement tests exactly as baseline review is, and budget exhaustion with cycles remaining is the future `HardBoundReached` transition's job, not this verdict's.
