# 02 — Dispatch remediation verification with full diff context

**What to build:** A planned `verify_remediation` command becomes a recorded, dispatchable Reviewer request. The executor gains a specification for the command type, the application computes a deterministic diff between the prior and revised canonical plans and registers it as content-addressed evidence (the "full diff context" the Reviewer evaluates), and the exact request — claims, remediation artifact, revised plan, diff — is recorded before dispatch under the pinned reviewer request policy.

**Blocked by:** 01 — Settle Planner remediation output into the run.

**Status:** ready-for-agent

- [ ] The provider command specification accepts `verify_remediation` and rejects malformed payloads, keeping parity with the existing command payload validator
- [ ] The prior-vs-revised plan diff is deterministic (same inputs → same bytes and hash) and is registered as an input artifact of the recorded request
- [ ] The recorded request binds the pinned reviewer prompt, schema, budgets, and timeout exactly; any deviation is a different logical command, not an execution-time choice
- [ ] A run that has settled a remediation proposal produces a verifiable recorded verify request end-to-end against the SQLite authority
