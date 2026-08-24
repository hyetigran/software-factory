# 03 — Waiver lifecycle for findings

**What to build:** A human can waive any active finding of any severity with a nonempty reason while the exact evidence versions they saw are pinned to the waiver (`WaiverGranted`); can reaffirm a waiver against current evidence (`WaiverReaffirmed`); and a change to any evidence the waiver references makes it stale automatically (`RelevantEvidenceChanged`), requiring reaffirmation before it counts again. Gate recomputation reflects waiver state, and only a human actor can grant or reaffirm — the Planner cannot waive its own findings.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Any severity can be waived; the waiver records the human actor, reason, and the exact artifact versions displayed at grant time
- [x] A relevant evidence change invalidates the waiver without deleting its history; a stale waiver does not satisfy any "unwaived blockers" guard until reaffirmed
- [x] Non-human actors are rejected for grant and reaffirm; audit facts record grant, invalidation, and reaffirmation with their controlling evidence
- [x] Waiver state survives on the run state so downstream closure and remediation guards can distinguish waived from unwaived blockers

## Comments

Landed in `feat(workflow): waive findings with pinned evidence`. Three transitions (`WaiverGranted`, `WaiverReaffirmed`, `RelevantEvidenceChanged`) on any nonterminal state, state otherwise unchanged; waivers live on the run state and project into the existing `waivers` table (status, evidence hash, reaffirmed_at). Grant pins the exact displayed evidence (must cover the finding's evidence and the current plan) and works for any severity (critical tested); invalidation records the superseding change on the waiver without deleting anything; reaffirmation requires a human reason and the *current* version of every changed artifact — re-displaying the exact evidence the invalidation flagged is rejected (review catch). Non-human actors are rejected at runtime, not just by type. `waivedFindingIds` (active-only) is the exported seam tickets 04/06 use for their "unwaived blockers" guards — the consumption side lands there by design. Protocol note: the state-transition table's waiver rows said "recompute gate" but no such command type exists in the command protocol; the rows now read "none (gates derive from waiver state)" — gate rows are written by the verdict transitions.
