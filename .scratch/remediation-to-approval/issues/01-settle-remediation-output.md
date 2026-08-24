# 01 — Settle Planner remediation output into the run

**What to build:** When a `generate_remediation` provider attempt is accepted, the run advances on its own: the application deterministically validates the Planner's structured remediation output — claims match the artifact, every blocking finding is addressed, each claim carries evidence references (closes the spec gap: the Planner returns "the finding IDs addressed, and evidence"), and the revised plan's section transition map preserves continuity — then submits `RemediationGenerated` to the domain, which installs the revised plan and plans the `verify_remediation` command.

**Blocked by:** None — can start immediately.

**Status:** done (one criterion partially deferred — see Comments)

- [x] An accepted `generate_remediation` attempt produces a `RemediationGenerated` input with the `deterministic-remediation-claims-v1` validation computed by the application, not asserted by the caller
- [x] Remediation claims carry per-claim evidence references drawn from the remediation artifact, and the domain rejects claims whose evidence is absent
- [ ] Claims that miss a blocking finding, reference an unknown finding, or fail the deterministic artifact match are rejected and route to the schema-repair/failure policy rather than advancing state
- [x] After settlement the run is in `remediation` with the revised plan current and a planned `verify_remediation` command, proven against the SQLite authority

## Comments

Landed in `feat(executor): settle planner remediation proposals`. The application derives claims and section-transition continuity deterministically (`deriveRemediationClaims`, `validateSectionTransitions`) and assembles the whole domain input (`buildRemediationGenerated`); the domain additionally requires per-claim evidence bound to the supplied remediation/plan artifacts; settlement accepts `RemediationGenerated` through `completeProviderAttempt`; the SQLite authority test proves state advance, current-plan replacement, the planned `verify_remediation` command, and the audit chain.

Third criterion is half-met: invalid claims are rejected and never advance state (tested at the domain seam), but the wiring that converts a failed deterministic validation into the schema-repair/`ProviderOutcomeFailed` path belongs to the executor dispatch loop — carried into tickets 02 and 05.
