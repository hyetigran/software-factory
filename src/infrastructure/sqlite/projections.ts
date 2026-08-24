import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson } from "../../domain/canonical-json.js";
import type {
  PersistableAuditFact,
  ValidatedProjectionData,
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

  const waivers = Array.isArray(state.waivers) ? state.waivers : [];
  for (const waiverValue of waivers) {
    const waiver = object(waiverValue);
    if (waiver === null) continue;
    const waiverId = string(waiver.waiverId);
    const findingId = string(waiver.findingId);
    const reason = string(waiver.reason);
    const status =
      waiver.status === "active" || waiver.status === "stale"
        ? (waiver.status as string)
        : null;
    const actor = object(waiver.actor);
    if (
      waiverId === null ||
      findingId === null ||
      reason === null ||
      status === null ||
      actor === null
    ) {
      continue;
    }
    const evidenceHash = createHash("sha256")
      .update(canonicalJson(waiver.evidence ?? []))
      .digest("hex");
    const reaffirmed = facts.some(
      ({ type, payload }) =>
        type === "waiver_reaffirmed" &&
        (payload as State).waiverId === waiverId,
    );
    database
      .prepare(
        `INSERT INTO waivers
          (waiver_id, finding_id, run_id, status, reason, evidence_hash,
           granted_by_actor_id, granted_at, reaffirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(waiver_id) DO UPDATE SET
           status = excluded.status,
           reason = excluded.reason,
           evidence_hash = excluded.evidence_hash,
           reaffirmed_at = COALESCE(excluded.reaffirmed_at, waivers.reaffirmed_at)`,
      )
      .run(
        waiverId,
        findingId,
        runId,
        status,
        reason,
        evidenceHash,
        `${String(actor.displayName)}:${String(actor.osAccount)}`,
        recordedAt,
        reaffirmed ? recordedAt : null,
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
        typeof (fact.payload as State).decisionId === "string"
          ? String((fact.payload as State).decisionId)
          : `${runId}:${String(state.stateVersion)}:${fact.type}:${index}`,
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
  previousState: State | null,
  state: State,
  projection: ValidatedProjectionData,
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
    (projection.reviewedPlanArtifactId !== undefined &&
      projection.reviewedPlanArtifactId !==
        object(baselineReview?.plan)?.artifactId) ||
    !projection.schemaValid ||
    !projection.controlledIdsValid ||
    !projection.referencesComplete ||
    !projection.identitiesUnique
  ) {
    throw new TypeError("Validated projection is not bound to accepted state");
  }
  if (projection.reviewContentHash !== undefined) {
    const priorFindingIds = new Set(
      (Array.isArray(previousState?.activeFindings)
        ? (previousState.activeFindings as Array<Record<string, unknown>>)
        : []
      ).map(({ findingId }) => String(findingId)),
    );
    if (
      projection.reviewedPriorFindingIds === undefined ||
      projection.reviewedPriorFindingIds.length !== priorFindingIds.size ||
      projection.reviewedPriorFindingIds.some((id) => !priorFindingIds.has(id))
    ) {
      throw new TypeError(
        "Review prior findings do not match authoritative state",
      );
    }
    const reviewContext = object(previousState?.reviewContext);
    const suppliedEvidence = new Set<string>();
    const addArtifact = (value: unknown): void => {
      const artifact = object(value);
      if (typeof artifact?.artifactId === "string")
        suppliedEvidence.add(artifact.artifactId);
    };
    [
      previousState?.currentLedger,
      previousState?.currentPlan,
      reviewContext?.prompt,
      reviewContext?.schema,
      reviewContext?.taxonomy,
      reviewContext?.componentRegistry,
      reviewContext?.policy,
    ].forEach(addArtifact);
    (Array.isArray(reviewContext?.evidence)
      ? reviewContext.evidence
      : []
    ).forEach(addArtifact);
    if (
      projection.reviewEvidenceArtifactIds?.some(
        (id) => !suppliedEvidence.has(id),
      )
    ) {
      throw new TypeError("Review cites evidence not supplied to the reviewer");
    }
  }
  const requirementIds =
    projection.requirements === undefined
      ? new Set(
          (
            database
              .prepare(
                `SELECT requirement_id FROM requirements
                 WHERE ledger_version_id = ?`,
              )
              .all(String(currentLedger?.versionId)) as Array<{
              requirement_id: string;
            }>
          ).map(({ requirement_id }) => requirement_id),
        )
      : new Set(
          projection.requirements.map(({ requirementId }) => requirementId),
        );
  const sectionIds = new Set(
    (projection.planSections ?? []).map(({ sectionId }) => sectionId),
  );
  if (
    (projection.requirements !== undefined &&
      requirementIds.size !== projection.requirements.length) ||
    sectionIds.size !== (projection.planSections?.length ?? 0) ||
    (projection.planSections ?? []).some(({ requirementIds: references }) =>
      references.some((id) => !requirementIds.has(id)),
    )
  ) {
    throw new TypeError("Validated projection identities are incomplete");
  }
  if (
    projection.planVersionId !== undefined &&
    (projection.coveredRequirementIds === undefined ||
      projection.coveredRequirementIds.length !== requirementIds.size ||
      new Set(projection.coveredRequirementIds).size !== requirementIds.size ||
      projection.coveredRequirementIds.some((id) => !requirementIds.has(id)))
  ) {
    throw new TypeError(
      "Plan coverage does not match the authoritative ledger",
    );
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
    const transitions = projection.sectionTransitions ?? [];
    const transitionIds = transitions.map(({ transitionId }) => transitionId);
    const targetIds = transitions.flatMap(({ toIds }) => toIds);
    const currentSectionIds = new Set(
      (projection.planSections ?? []).map(({ sectionId }) => sectionId),
    );
    const knownSectionIds = new Set(
      (
        database
          .prepare(
            `SELECT section_id FROM plan_sections
             WHERE plan_version_id = (
               SELECT plan_version_id FROM plan_versions
               WHERE run_id = ? AND version < (
                 SELECT version FROM plan_versions WHERE plan_version_id = ?
               )
               ORDER BY version DESC LIMIT 1
             )`,
          )
          .all(runId, projection.planVersionId) as Array<{
          section_id: string;
        }>
      ).map(({ section_id }) => section_id),
    );
    if (
      new Set(transitionIds).size !== transitionIds.length ||
      new Set(targetIds).size !== targetIds.length ||
      targetIds.length !== currentSectionIds.size ||
      targetIds.some((id) => !currentSectionIds.has(id)) ||
      transitions.some(({ fromIds }) =>
        fromIds.some((id) => !knownSectionIds.has(id)),
      ) ||
      (knownSectionIds.size > 0 &&
        (new Set(transitions.flatMap(({ fromIds }) => fromIds)).size !==
          knownSectionIds.size ||
          [...knownSectionIds].some(
            (id) =>
              transitions.filter(({ fromIds }) => fromIds.includes(id))
                .length !== 1,
          )))
    ) {
      throw new TypeError("Section-transition projection is incomplete");
    }
    for (const transition of transitions) {
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
  const authoritativeRequirementIds = new Set(
    (
      database
        .prepare(
          `SELECT requirement_id FROM requirements
           WHERE ledger_version_id = ?`,
        )
        .all(String(currentLedger?.versionId)) as Array<{
        requirement_id: string;
      }>
    ).map(({ requirement_id }) => requirement_id),
  );
  const authoritativeComponentIds = new Set<string>();
  const planVersionId = String(currentPlan?.versionId);
  const componentRows = database
    .prepare(
      `SELECT component_ids_json FROM plan_sections WHERE plan_version_id = ?`,
    )
    .all(planVersionId) as Array<{ component_ids_json: string }>;
  componentRows.forEach(({ component_ids_json }) => {
    (JSON.parse(component_ids_json) as string[]).forEach((id) =>
      authoritativeComponentIds.add(id),
    );
  });
  for (const association of projection.observationAssociations ?? []) {
    if (
      association.requirementIds.some(
        (id) => !authoritativeRequirementIds.has(id),
      ) ||
      association.componentIds.some((id) => !authoritativeComponentIds.has(id))
    ) {
      throw new TypeError("Observation controlled association is invalid");
    }
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
