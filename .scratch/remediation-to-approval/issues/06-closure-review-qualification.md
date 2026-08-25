# 06 — Closure review verdict and qualification

**What to build:** The `ClosureReviewAccepted` domain transition, covering all four protocol routes: new blockers found with remediation and closure budget remaining → remediation reopens; new blockers with the relevant budget exhausted → the run halts with a terminal report; no unwaived blockers and no active waivers → `qualified`; no unwaived blockers with valid active waivers → `qualified_with_waivers`. Qualification renders its report and remains distinct from approval — no closure outcome ever reaches an approved state.

**Blocked by:** 03 — Waiver lifecycle for findings.

**Status:** done

- [x] All four routes are implemented with guards, planned commands, and audit facts per the state-transition and audit-entry protocols
- [x] Reopened remediation is bounded: closure-cycle and remediation-cycle ceilings are both respected, and exhaustion halts
- [x] The waiver route requires every relied-upon waiver to be active and non-stale; a stale waiver blocks qualification
- [x] Qualified states are reachable only through closure — no baseline-only or remediation-only path can produce them

## Comments

Landed in `feat(workflow): qualify plans through closure review`. `ClosureReviewAccepted` routes on unwaived blockers (from a full-document review with new-finding reconciliation) and both pinned cycle ceilings: reopen remediation targeting unwaived blockers, budget-classified terminal halt, `qualified`, or `qualified_with_waivers`. Qualification plans the new local `render_qualification_report` command (added to the command protocol) and emits `plan_qualified` with the gate id and waiver set; the qualified state carries the plan, findings, and a qualification record for ticket 07. Explicit `remediationCyclesCompleted`/`closureCyclesCompleted` counters thread through the loop. Review catches fixed pre-commit: the qualification gate no longer trusts the caller's blocking set alone — open critical/high findings must be blocking or actively waived, and a stale waiver's open finding cannot be omitted from the blocking set; relied-upon waivers are restricted to findings that still exist (an orphaned waiver no longer forces the waiver variant); closure headroom is asserted; the latent `export_terminal` validator gap that would have rejected remediation/closure halts at persistence is fixed; and the halt/next-remediation-cycle constructions that had reached three copies are extracted into shared builders. Deliberate mapping note: closure acceptance reuses the `review_accepted` fact (closure is a full review producing orchestrator-assigned findings, so the authority's review-projection contract applies when persisted).
