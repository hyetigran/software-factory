import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../../domain/canonical-json.js";
import type { PersistableAuditFact } from "./authority.js";

type State = Record<string, unknown>;

function object(value: unknown): State | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as State)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function projectAuthoritativeState(
  database: DatabaseSync,
  runId: string,
  state: State,
  facts: PersistableAuditFact[],
  recordedAt: string,
): void {
  const ledger = object(state.currentLedger);
  if (ledger !== null) {
    const ledgerVersionId = string(ledger.versionId);
    const artifactId = string(ledger.artifactId);
    if (ledgerVersionId !== null && artifactId !== null) {
      database
        .prepare(
          `INSERT OR IGNORE INTO ledger_versions
             (ledger_version_id, run_id, version, artifact_id, validation_status)
           VALUES (?, ?,
             (SELECT COALESCE(MAX(version), 0) + 1 FROM ledger_versions WHERE run_id = ?),
             ?, 'pending')`,
        )
        .run(ledgerVersionId, runId, runId, artifactId);
      const approval = facts.find(({ type }) => type === "ledger_approved");
      if (approval !== undefined) {
        const payload = approval.payload as State;
        const actor = approval.actor as State;
        database
          .prepare(
            `UPDATE ledger_versions
             SET validation_status = 'valid', coverage_artifact_id = ?,
                 approved_at = ?, approved_by_actor_id = ?
             WHERE ledger_version_id = ?`,
          )
          .run(
            string(payload.coverageReportArtifactId),
            recordedAt,
            `${String(actor.displayName)}:${String(actor.osAccount)}`,
            ledgerVersionId,
          );
        database
          .prepare(
            `INSERT OR REPLACE INTO gates
              (gate_id, run_id, gate_type, status, evidence_artifact_id, evaluated_at)
             VALUES (?, ?, 'requirements', 'passed', ?, ?)`,
          )
          .run(
            string(payload.approvalGateId),
            runId,
            string(payload.coverageReportArtifactId),
            recordedAt,
          );
      }

      const exclusions = Array.isArray(state.sourceExclusions)
        ? state.sourceExclusions
        : [];
      for (const exclusionValue of exclusions) {
        const exclusion = object(exclusionValue);
        if (exclusion === null) continue;
        const fact = facts.find(
          ({ type, payload }) =>
            type === "source_exclusion_approved" &&
            (payload as State).exclusionId === exclusion.exclusionId,
        );
        if (fact === undefined) continue;
        const actor = fact.actor as State;
        database
          .prepare(
            `INSERT OR IGNORE INTO source_exclusions
              (exclusion_id, ledger_version_id, source_range_json, reason,
               approved_by_actor_id, approved_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            string(exclusion.exclusionId),
            ledgerVersionId,
            canonicalJson(exclusion.sourceRange),
            string(exclusion.reason),
            `${String(actor.displayName)}:${String(actor.osAccount)}`,
            recordedAt,
          );
      }
    }
  }

  const plan = object(state.currentPlan);
  if (plan !== null && ledger !== null) {
    const planVersionId = string(plan.versionId);
    const planArtifactId = string(plan.artifactId);
    const ledgerVersionId = string(ledger.versionId);
    const origin = object(plan.origin);
    if (
      planVersionId !== null &&
      planArtifactId !== null &&
      ledgerVersionId !== null &&
      origin !== null
    ) {
      const rendered = object(state.renderedPlan);
      database
        .prepare(
          `INSERT OR IGNORE INTO plan_versions
            (plan_version_id, run_id, version, structured_artifact_id,
             rendered_artifact_id, ledger_version_id, provenance, created_at)
           VALUES (?, ?,
             (SELECT COALESCE(MAX(version), 0) + 1 FROM plan_versions WHERE run_id = ?),
             ?, ?, ?, ?, ?)`,
        )
        .run(
          planVersionId,
          runId,
          runId,
          planArtifactId,
          rendered === null ? null : string(rendered.artifactId),
          ledgerVersionId,
          origin.kind === "human" ? "human" : "planner",
          recordedAt,
        );
    }
  }

  const findings = Array.isArray(state.activeFindings)
    ? state.activeFindings
    : [];
  const baselineReview = object(state.baselineReview);
  for (const findingValue of findings) {
    const finding = object(findingValue);
    if (finding === null) continue;
    const findingId = string(finding.findingId);
    const observationId = string(finding.latestObservationId);
    if (findingId === null || observationId === null) continue;
    database
      .prepare(
        `INSERT INTO findings
          (finding_id, run_id, status, current_severity, created_at, updated_at)
         VALUES (?, ?, 'open', ?, ?, ?)
         ON CONFLICT(finding_id) DO UPDATE SET
           status = excluded.status,
           current_severity = excluded.current_severity,
           updated_at = excluded.updated_at`,
      )
      .run(findingId, runId, string(finding.severity), recordedAt, recordedAt);
    const context = object(finding.latestObservationContext);
    if (baselineReview === null || context === null) continue;
    database
      .prepare(
        `INSERT OR IGNORE INTO observations
          (observation_id, finding_id, run_id, review_artifact_id,
           plan_version_id, review_kind, disposition, severity, rule_id,
           component_ids_json, requirement_ids_json, evidence_json, created_at)
         VALUES (?, ?, ?, ?, ?, 'baseline', 'new', ?, ?, '[]', '[]', ?, ?)`,
      )
      .run(
        observationId,
        findingId,
        runId,
        string(baselineReview.artifactId),
        string(context.planVersionId),
        string(finding.severity),
        string(finding.ruleId),
        canonicalJson(finding.evidence),
        recordedAt,
      );
  }

  facts.forEach((fact, index) => {
    const actor = fact.actor as State;
    if (actor.kind !== "human") return;
    database
      .prepare(
        `INSERT INTO human_decisions
          (decision_id, run_id, decision_type, actor_display_name, os_account,
           reason, evidence_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `${runId}:${String(state.stateVersion)}:${fact.type}:${index}`,
        runId,
        fact.type,
        String(actor.displayName),
        String(actor.osAccount),
        fact.reason ?? null,
        canonicalJson(fact.evidence),
        recordedAt,
      );
  });
}
