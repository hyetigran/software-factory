# 04 — Reviewer verdict on remediation claims

**What to build:** The `RemediationReviewAccepted` domain transition, covering all three protocol routes: unwaived blockers remain and cycle budget remains → the next remediation cycle is planned; no unwaived blockers remain → a closure review is planned; blockers remain and the cycle budget is exhausted → the run halts with a terminal report. Finding lifecycle transitions (a blocker closing, staying open, or reopening) happen only on accepted Reviewer evidence — a Planner claim alone can never close a finding.

**Blocked by:** 03 — Waiver lifecycle for findings.

**Status:** done

- [x] All three routes are implemented with their guards, planned follow-up commands, and audit facts per the state-transition and audit-entry protocols
- [x] Finding transitions cite the accepted Reviewer evidence as controlling; inputs claiming closure without it are rejected
- [x] Remediation cycle ceilings are enforced: the exhaustion route halts before exceeding the accepted ceiling, never after
- [x] Waived blockers do not count toward the "unwaived blockers remain" guard; stale waivers do count as unwaived

## Comments

Landed in `feat(workflow): judge remediation claims within cycle bounds`. `RemediationReviewAccepted` routes on unwaived blockers (active waivers excluded, stale count as unwaived) and the cycle budget: next `generate_remediation` cycle (unwaived targets only), `closure_review`, or a budget-classified terminal halt whose export carries the run's waiver ids. Findings resolve only through the accepted verify evidence — `finding_transitioned` facts cite the verify command and review artifact, and are emitted even on the exhaustion halt (review catch; the terminal fact tuple gained a leading rest). The cycle ceiling is pinned on `PinnedRunPolicy.cycleCeilings`, not caller-supplied (review catch), and a waiver going stale now restores its blocker to the remediation working set so it can't slip past later cycles (review catch — the cross-cycle leak). Known limits, deliberate: verdict claim ids are checked for coverage against blocking findings, not against the proposed claim ids (the domain doesn't retain them; the verify command payload and application bind them — executor wiring in ticket 05 can cross-check); finding *reopening* is the closure review's job (ticket 06). Audit mapping: the protocol's "remediation evaluated"/"blockers cleared" phrases map to `review_accepted` + `finding_transitioned` + `command_planned` from the fact catalog, mirroring the baseline rows.
