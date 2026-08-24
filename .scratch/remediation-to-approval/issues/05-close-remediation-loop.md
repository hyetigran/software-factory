# 05 — Close the remediation loop end-to-end

**What to build:** An accepted `verify_remediation` provider attempt is settled by the executor into a validated `RemediationReviewAccepted` input and submitted to the domain, so the full loop — remediation generated → verification dispatched → verdict settled → next cycle or closure — runs against the SQLite authority without manual state construction. This is the tracer bullet proving the remediation workflow works as one path, not as isolated transitions.

**Blocked by:** 02 — Dispatch remediation verification with full diff context; 04 — Reviewer verdict on remediation claims.

**Status:** ready-for-agent

- [ ] An accepted verify attempt produces a `RemediationReviewAccepted` input whose deterministic validations are computed by the application from the recorded response
- [ ] One integration test drives a run from an accepted remediation proposal through verification to the next remediation cycle, and another to closure, entirely through the authority
- [ ] Usage reconciliation, attempt settlement, and audit-chain continuity hold across the loop exactly as they do for baseline review
- [ ] Verification responses that fail schema or reconciliation route to the repair/failure policy instead of advancing state
