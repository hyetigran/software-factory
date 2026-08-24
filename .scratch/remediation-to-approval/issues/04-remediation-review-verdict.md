# 04 — Reviewer verdict on remediation claims

**What to build:** The `RemediationReviewAccepted` domain transition, covering all three protocol routes: unwaived blockers remain and cycle budget remains → the next remediation cycle is planned; no unwaived blockers remain → a closure review is planned; blockers remain and the cycle budget is exhausted → the run halts with a terminal report. Finding lifecycle transitions (a blocker closing, staying open, or reopening) happen only on accepted Reviewer evidence — a Planner claim alone can never close a finding.

**Blocked by:** 03 — Waiver lifecycle for findings.

**Status:** ready-for-agent

- [ ] All three routes are implemented with their guards, planned follow-up commands, and audit facts per the state-transition and audit-entry protocols
- [ ] Finding transitions cite the accepted Reviewer evidence as controlling; inputs claiming closure without it are rejected
- [ ] Remediation cycle ceilings are enforced: the exhaustion route halts before exceeding the accepted ceiling, never after
- [ ] Waived blockers do not count toward the "unwaived blockers remain" guard; stale waivers do count as unwaived
