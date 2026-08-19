import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../../domain/canonical-json.js";
import type {
  PersistableAuditFact,
  ValidatedProjection,
} from "../../application/authority-port.js";

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
      const storedLedger = database
        .prepare(
          `SELECT run_id, artifact_id FROM ledger_versions
           WHERE ledger_version_id = ?`,
        )
        .get(ledgerVersionId) as
        { run_id: string; artifact_id: string } | undefined;
      if (
        storedLedger === undefined ||
        storedLedger.run_id !== runId ||
        storedLedger.artifact_id !== artifactId
      ) {
        throw new TypeError(
          "Ledger projection conflicts with authoritative state",
        );
      }
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
        const storedExclusion = database
          .prepare(
            `SELECT ledger_version_id, source_range_json, reason
             FROM source_exclusions WHERE exclusion_id = ?`,
          )
          .get(string(exclusion.exclusionId)) as
          | {
              ledger_version_id: string;
              source_range_json: string;
              reason: string;
            }
          | undefined;
        if (
          storedExclusion === undefined ||
          storedExclusion.ledger_version_id !== ledgerVersionId ||
          storedExclusion.source_range_json !==
            canonicalJson(exclusion.sourceRange) ||
          storedExclusion.reason !== exclusion.reason
        ) {
          throw new TypeError(
            "Source-exclusion projection conflicts with authoritative state",
          );
        }
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
          `INSERT INTO plan_versions
            (plan_version_id, run_id, version, structured_artifact_id,
             rendered_artifact_id, ledger_version_id, provenance, created_at)
           VALUES (?, ?,
             (SELECT COALESCE(MAX(version), 0) + 1 FROM plan_versions WHERE run_id = ?),
             ?, ?, ?, ?, ?)
           ON CONFLICT(plan_version_id) DO UPDATE SET
             rendered_artifact_id = COALESCE(
               plan_versions.rendered_artifact_id,
               excluded.rendered_artifact_id
             )
           WHERE plan_versions.run_id = excluded.run_id
             AND plan_versions.structured_artifact_id = excluded.structured_artifact_id
             AND plan_versions.ledger_version_id = excluded.ledger_version_id
             AND plan_versions.provenance = excluded.provenance
             AND (plan_versions.rendered_artifact_id IS NULL
                  OR excluded.rendered_artifact_id IS NULL
                  OR plan_versions.rendered_artifact_id = excluded.rendered_artifact_id)`,
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
      const storedPlan = database
        .prepare(
          `SELECT run_id, structured_artifact_id, rendered_artifact_id,
                  ledger_version_id, provenance
           FROM plan_versions WHERE plan_version_id = ?`,
        )
        .get(planVersionId) as
        | {
            run_id: string;
            structured_artifact_id: string;
            rendered_artifact_id: string | null;
            ledger_version_id: string;
            provenance: string;
          }
        | undefined;
      const expectedRendered =
        rendered === null ? null : string(rendered.artifactId);
      if (
        storedPlan === undefined ||
        storedPlan.run_id !== runId ||
        storedPlan.structured_artifact_id !== planArtifactId ||
        storedPlan.ledger_version_id !== ledgerVersionId ||
        storedPlan.provenance !==
          (origin.kind === "human" ? "human" : "planner") ||
        (expectedRendered !== null &&
          storedPlan.rendered_artifact_id !== expectedRendered)
      ) {
        throw new TypeError(
          "Plan projection conflicts with authoritative state",
        );
      }
    }
  }

  const findings = Array.isArray(state.activeFindings)
    ? state.activeFindings
    : [];
  const baselineReview = object(state.baselineReview);
  if (
    baselineReview !== null &&
    facts.some(({ type }) => type === "review_accepted")
  ) {
    const planVersionId = string(baselineReview.planVersionId);
    database
      .prepare(
        `INSERT INTO gates
          (gate_id, run_id, gate_type, status, evidence_artifact_id, evaluated_at)
         VALUES (?, ?, 'baseline', ?, ?, ?)`,
      )
      .run(
        `${runId}:gate:baseline:${String(planVersionId)}`,
        runId,
        state.state === "remediation" ? "failed" : "passed",
        string(baselineReview.artifactId),
        recordedAt,
      );
  }
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

export function persistValidatedProjection(
  database: DatabaseSync,
  runId: string,
  state: State,
  projection: ValidatedProjection,
  recordedAt: string,
): void {
  const currentLedger = object(state.currentLedger);
  const currentPlan = object(state.currentPlan);
  const baselineReview = object(state.baselineReview);
  if (
    projection.validator !== "deterministic-authority-projection-v1" ||
    projection.stateVersion !== state.stateVersion ||
    (projection.ledgerVersionId !== undefined &&
      projection.ledgerVersionId !== currentLedger?.versionId) ||
    (projection.ledgerContentHash !== undefined &&
      projection.ledgerContentHash !== currentLedger?.contentHash) ||
    (projection.planVersionId !== undefined &&
      projection.planVersionId !== currentPlan?.versionId) ||
    (projection.planContentHash !== undefined &&
      projection.planContentHash !== currentPlan?.contentHash) ||
    (projection.reviewContentHash !== undefined &&
      projection.reviewContentHash !== baselineReview?.contentHash) ||
    !projection.schemaValid ||
    !projection.controlledIdsValid ||
    !projection.referencesComplete ||
    !projection.identitiesUnique
  ) {
    throw new TypeError("Validated projection is not bound to accepted state");
  }
  const requirementIds = new Set(
    (projection.requirements ?? []).map(({ requirementId }) => requirementId),
  );
  const sectionIds = new Set(
    (projection.planSections ?? []).map(({ sectionId }) => sectionId),
  );
  if (
    requirementIds.size !== (projection.requirements?.length ?? 0) ||
    sectionIds.size !== (projection.planSections?.length ?? 0) ||
    (projection.planSections ?? []).some(({ requirementIds: references }) =>
      references.some((id) => !requirementIds.has(id)),
    )
  ) {
    throw new TypeError("Validated projection identities are incomplete");
  }
  if (projection.ledgerVersionId !== undefined) {
    for (const requirement of projection.requirements ?? []) {
      database
        .prepare(
          `INSERT INTO requirements
            (ledger_version_id, requirement_id, display_id, status, statement,
             source_ranges_json, lineage_roots_json, predecessor_ids_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          projection.ledgerVersionId,
          requirement.requirementId,
          requirement.displayId,
          requirement.status,
          requirement.statement,
          canonicalJson(requirement.sourceRanges),
          canonicalJson(requirement.lineageRoots),
          canonicalJson(requirement.predecessorIds),
        );
    }
  }
  if (projection.planVersionId !== undefined) {
    for (const section of projection.planSections ?? []) {
      database
        .prepare(
          `INSERT INTO plan_sections
            (plan_version_id, section_id, kind, title, normalized_hash,
             component_ids_json, requirement_ids_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          projection.planVersionId,
          section.sectionId,
          section.kind,
          section.title,
          section.normalizedHash,
          canonicalJson(section.componentIds),
          canonicalJson(section.requirementIds),
        );
    }
    for (const transition of projection.sectionTransitions ?? []) {
      database
        .prepare(
          `INSERT INTO section_transitions
            (section_transition_id, plan_version_id, kind, from_ids_json,
             to_ids_json, reason)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          transition.transitionId,
          projection.planVersionId,
          transition.kind,
          canonicalJson(transition.fromIds),
          canonicalJson(transition.toIds),
          transition.reason,
        );
    }
  }
  for (const fingerprint of projection.findingFingerprints ?? []) {
    database
      .prepare(
        `INSERT INTO finding_fingerprints
          (finding_id, fingerprint, policy_hash, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        fingerprint.findingId,
        fingerprint.fingerprint,
        fingerprint.policyHash,
        recordedAt,
      );
  }
  for (const association of projection.observationAssociations ?? []) {
    const updated = database
      .prepare(
        `UPDATE observations
         SET component_ids_json = ?, requirement_ids_json = ?
         WHERE observation_id = ?`,
      )
      .run(
        canonicalJson(association.componentIds),
        canonicalJson(association.requirementIds),
        association.observationId,
      );
    if (updated.changes !== 1) {
      throw new TypeError(
        "Observation association targets an unknown observation",
      );
    }
  }
}
