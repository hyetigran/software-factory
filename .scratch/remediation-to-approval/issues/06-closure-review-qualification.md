# 06 — Closure review verdict and qualification

**What to build:** The `ClosureReviewAccepted` domain transition, covering all four protocol routes: new blockers found with remediation and closure budget remaining → remediation reopens; new blockers with the relevant budget exhausted → the run halts with a terminal report; no unwaived blockers and no active waivers → `qualified`; no unwaived blockers with valid active waivers → `qualified_with_waivers`. Qualification renders its report and remains distinct from approval — no closure outcome ever reaches an approved state.

**Blocked by:** 03 — Waiver lifecycle for findings.

**Status:** ready-for-agent

- [ ] All four routes are implemented with guards, planned commands, and audit facts per the state-transition and audit-entry protocols
- [ ] Reopened remediation is bounded: closure-cycle and remediation-cycle ceilings are both respected, and exhaustion halts
- [ ] The waiver route requires every relied-upon waiver to be active and non-stale; a stale waiver blocks qualification
- [ ] Qualified states are reachable only through closure — no baseline-only or remediation-only path can produce them
