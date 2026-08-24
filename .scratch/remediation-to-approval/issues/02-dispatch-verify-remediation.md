# 02 — Dispatch remediation verification with full diff context

**What to build:** A planned `verify_remediation` command becomes a recorded, dispatchable Reviewer request. The executor gains a specification for the command type, the application computes a deterministic diff between the prior and revised canonical plans and registers it as content-addressed evidence (the "full diff context" the Reviewer evaluates), and the exact request — claims, remediation artifact, revised plan, diff — is recorded before dispatch under the pinned reviewer request policy.

**Blocked by:** 01 — Settle Planner remediation output into the run.

**Status:** done

- [x] The provider command specification accepts `verify_remediation` and rejects malformed payloads, keeping parity with the existing command payload validator
- [x] The prior-vs-revised plan diff is deterministic (same inputs → same bytes and hash) and is registered as an input artifact of the recorded request
- [x] The recorded request binds the pinned reviewer prompt, schema, budgets, and timeout exactly; any deviation is a different logical command, not an execution-time choice
- [x] A run that has settled a remediation proposal produces a verifiable recorded verify request end-to-end against the SQLite authority

## Comments

Landed in `feat(executor): dispatch remediation verification requests`. `verify_remediation` moved into the declarative provider command specification (bespoke validator case removed); the domain command now names exactly the dispatchable input set — prior plan, revised plan, remediation output, diff, reviewer prompt, review schema — so the executor's exact-hash-set check passes, and the payload carries `priorPlanArtifactId`, `diffArtifactId`, and `independence`. `deriveRemediationDiff` produces the canonical claims-plus-changed-sections diff document; `buildRemediationGenerated` pins its hash into the command and returns the bytes so callers stage the artifact before the transition commits (ADR-0003 ordering, caught in review). The SQLite test drives settle → begin attempt → build request → register recorded request, and proves a timeout deviation is rejected as a different logical command. Deliberate trim, per protocol ("Reviewer evaluates claims and full diff context"): the verify request does not carry taxonomy/review-policy/ledger, unlike baseline/closure reviews.
