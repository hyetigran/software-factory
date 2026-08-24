# 03 — Waiver lifecycle for findings

**What to build:** A human can waive any active finding of any severity with a nonempty reason while the exact evidence versions they saw are pinned to the waiver (`WaiverGranted`); can reaffirm a waiver against current evidence (`WaiverReaffirmed`); and a change to any evidence the waiver references makes it stale automatically (`RelevantEvidenceChanged`), requiring reaffirmation before it counts again. Gate recomputation reflects waiver state, and only a human actor can grant or reaffirm — the Planner cannot waive its own findings.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Any severity can be waived; the waiver records the human actor, reason, and the exact artifact versions displayed at grant time
- [ ] A relevant evidence change invalidates the waiver without deleting its history; a stale waiver does not satisfy any "unwaived blockers" guard until reaffirmed
- [ ] Non-human actors are rejected for grant and reaffirm; audit facts record grant, invalidation, and reaffirmation with their controlling evidence
- [ ] Waiver state survives on the run state so downstream closure and remediation guards can distinguish waived from unwaived blockers
