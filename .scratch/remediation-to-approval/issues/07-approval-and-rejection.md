# 07 — Human approval and rejection of qualified plans

**What to build:** From a qualified plan, an explicit human decision ends the run: `PlanApproved` moves `qualified` → `approved` (with the qualification evidence displayed to the approver), and `qualified_with_waivers` → `approved_with_waivers` only after every active waiver is individually acknowledged; both plan the terminal export. `PlanRejected` with a nonempty reason returns the run to planning while budgets remain, and halts with a terminal report when they don't. Approval is never automatic and never reachable from baseline review alone.

**Blocked by:** 06 — Closure review verdict and qualification.

**Status:** ready-for-agent

- [ ] Approval requires a human actor and recorded evidence display; a missing waiver acknowledgment blocks the waiver variant
- [ ] Rejection with budget remaining plans a fresh revision under the pinned policy; rejection with budgets exhausted halts
- [ ] Approved and approved-with-waivers are distinct terminal outcomes with distinct audit facts, including waived-risk acknowledgments
- [ ] No input sequence reaches an approved state without passing through a qualified state first
