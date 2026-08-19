import type { ProviderRequestPolicy } from "../domain/index.js";
import type { AcceptedProviderCompletion } from "./complete-provider-attempt.js";
import type { AcceptedProviderFailure } from "./complete-provider-failure.js";
import type {
  CompleteProviderFailureEvidence,
  CompleteProviderAttemptEvidence,
  CompletedCommandAttempt,
  ExecutionPolicy,
  ProviderFailureDisposition,
} from "./execution-port.js";

export type PersistableCommand = {
  commandId: string;
  commandKey: string;
  commandType: string;
  schemaVersion: number;
  runId: string;
  triggeringStateVersion: number;
  purposeId: string;
  prerequisiteCommandIds?: string[];
  inputArtifactHashes: string[];
  policyHash: string;
  provider?: "openai" | "anthropic" | "manual" | "local";
  modelId?: string;
  budgetReservation: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsdMicros: number;
  };
  providerRequestPolicy?: ProviderRequestPolicy;
  payload: object;
};

export type PersistableAuditFact = {
  type: string;
  actor: object;
  reason?: string;
  evidence: unknown[];
  payload: object;
};

export type PersistableTransition<TState extends object> = {
  nextState: TState;
  commands: PersistableCommand[];
  auditFacts: PersistableAuditFact[];
};

export type PersistTransitionRequest = {
  runId: string;
  expectedStateVersion: number;
  causationId?: string;
  correlationId?: string;
  validatedProjection?: ValidatedProjection;
  stagedArtifacts?: StagedArtifactRegistration[];
};

export type ValidatedProjectionData = {
  validator: "deterministic-authority-projection-v1";
  stateVersion: number;
  ledgerVersionId?: string;
  ledgerContentHash?: string;
  planVersionId?: string;
  planContentHash?: string;
  reviewContentHash?: string;
  reviewedPlanArtifactId?: string;
  coveredRequirementIds?: string[];
  reviewEvidenceArtifactIds?: string[];
  reviewedPriorFindingIds?: string[];
  schemaValid: boolean;
  controlledIdsValid: boolean;
  referencesComplete: boolean;
  identitiesUnique: boolean;
  requirements?: Array<{
    requirementId: string;
    displayId: string;
    status: "active" | "removed" | "replaced";
    statement: string;
    sourceRanges: unknown[];
    lineageRoots: string[];
    predecessorIds: string[];
  }>;
  planSections?: Array<{
    sectionId: string;
    kind: string;
    title: string;
    normalizedHash: string;
    componentIds: string[];
    requirementIds: string[];
  }>;
  sectionTransitions?: Array<{
    transitionId: string;
    kind: "preserved" | "retitled" | "split" | "merged" | "retired" | "new";
    fromIds: string[];
    toIds: string[];
    reason: string;
  }>;
  findingFingerprints?: Array<{
    findingId: string;
    fingerprint: string;
    policyHash: string;
  }>;
  observationAssociations?: Array<{
    observationId: string;
    componentIds: string[];
    requirementIds: string[];
  }>;
};

const validatedProjectionBrand = Symbol("ValidatedProjection");

function schema(name: string): unknown {
  return JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), `../../schemas/${name}`),
      "utf8",
    ),
  ) as unknown;
}

function immutableCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (nested: unknown): void => {
    if (nested === null || typeof nested !== "object") return;
    Object.freeze(nested);
    Object.values(nested).forEach(freeze);
  };
  freeze(copy);
  return copy;
}

export class ValidatedProjection {
  readonly [validatedProjectionBrand] = true;

  private constructor(private readonly value: ValidatedProjectionData) {}

  static fromLedgerArtifact(input: {
    bytes: Uint8Array;
    contentHash: string;
    stateVersion: number;
    ledgerVersionId: string;
    sourceArtifactId: string;
    schema?: unknown;
  }): ValidatedProjection {
    const observedHash = createHash("sha256").update(input.bytes).digest("hex");
    if (observedHash !== input.contentHash) {
      throw new TypeError(
        "Ledger projection hash does not match artifact bytes",
      );
    }
    const parsed: unknown = JSON.parse(
      Buffer.from(input.bytes).toString("utf8"),
    );
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new TypeError("Ledger projection requires a valid ledger object");
    }
    const ledger = parsed as Record<string, unknown>;
    assertJsonSchema(
      parsed,
      input.schema ?? schema("requirements-ledger.v1.schema.json"),
    );
    if (
      ledger.ledger_id !== input.ledgerVersionId ||
      ledger.source_artifact_id !== input.sourceArtifactId ||
      !Array.isArray(ledger.requirements) ||
      ledger.requirements.length === 0
    ) {
      throw new TypeError("Ledger artifact does not satisfy projection schema");
    }
    const requirements = ledger.requirements.map((value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("Ledger requirement is invalid");
      }
      const requirement = value as Record<string, unknown>;
      if (
        typeof requirement.requirement_id !== "string" ||
        typeof requirement.display_id !== "string" ||
        typeof requirement.statement !== "string" ||
        !["active", "removed", "replaced"].includes(
          String(requirement.status),
        ) ||
        !Array.isArray(requirement.source_ranges) ||
        !Array.isArray(requirement.lineage_roots) ||
        (requirement.predecessor_ids !== undefined &&
          !Array.isArray(requirement.predecessor_ids))
      ) {
        throw new TypeError("Ledger requirement is invalid");
      }
      return {
        requirementId: requirement.requirement_id,
        displayId: requirement.display_id,
        status: requirement.status as "active" | "removed" | "replaced",
        statement: requirement.statement,
        sourceRanges: requirement.source_ranges,
        lineageRoots: requirement.lineage_roots as string[],
        predecessorIds: (requirement.predecessor_ids ?? []) as string[],
      };
    });
    const requirementIds = new Set(
      requirements.map(({ requirementId }) => requirementId),
    );
    if (
      requirementIds.size !== requirements.length ||
      requirements.some(
        ({ lineageRoots, predecessorIds }) =>
          lineageRoots.some((id) => !requirementIds.has(id)) ||
          predecessorIds.some((id) => !requirementIds.has(id)),
      )
    ) {
      throw new TypeError("Ledger identity and lineage references are invalid");
    }
    return new ValidatedProjection(
      immutableCopy({
        validator: "deterministic-authority-projection-v1",
        stateVersion: input.stateVersion,
        ledgerVersionId: input.ledgerVersionId,
        ledgerContentHash: input.contentHash,
        schemaValid: true,
        controlledIdsValid: true,
        referencesComplete: true,
        identitiesUnique: requirementIds.size === requirements.length,
        requirements,
      }),
    );
  }

  static fromPlanArtifact(input: {
    bytes: Uint8Array;
    contentHash: string;
    stateVersion: number;
    planVersionId: string;
    allowedRequirementIds: string[];
  }): ValidatedProjection {
    if (
      createHash("sha256").update(input.bytes).digest("hex") !==
      input.contentHash
    ) {
      throw new TypeError("Plan projection hash does not match artifact bytes");
    }
    const parsed: unknown = JSON.parse(
      Buffer.from(input.bytes).toString("utf8"),
    );
    assertJsonSchema(parsed, schema("plan.v1.schema.json"));
    const plan = parsed as Record<string, unknown>;
    if (plan.plan_id !== input.planVersionId) {
      throw new TypeError("Plan artifact identity does not match projection");
    }
    const components = plan.components as Array<Record<string, unknown>>;
    const sections = plan.sections as Array<Record<string, unknown>>;
    const transitions = plan.section_transitions as Array<
      Record<string, unknown>
    >;
    const coverage = plan.requirement_coverage as Array<
      Record<string, unknown>
    >;
    const componentIds = new Set(
      components.map(({ component_id }) => String(component_id)),
    );
    const requirementIds = new Set(input.allowedRequirementIds);
    const planSections = sections.map((section) => ({
      sectionId: String(section.section_id),
      kind: String(section.kind),
      title: String(section.title),
      normalizedHash: createHash("sha256")
        .update(JSON.stringify(section))
        .digest("hex"),
      componentIds: section.component_ids as string[],
      requirementIds: section.requirement_ids as string[],
    }));
    if (
      planSections.some(
        (section) =>
          section.componentIds.some((id) => !componentIds.has(id)) ||
          section.requirementIds.some((id) => !requirementIds.has(id)),
      )
    ) {
      throw new TypeError("Plan controlled references are invalid");
    }
    const sectionIds = new Set(planSections.map(({ sectionId }) => sectionId));
    const coveredRequirementIds = coverage.map(({ requirement_id }) =>
      String(requirement_id),
    );
    if (
      new Set(input.allowedRequirementIds).size !==
        input.allowedRequirementIds.length ||
      coveredRequirementIds.length !== input.allowedRequirementIds.length ||
      new Set(coveredRequirementIds).size !== coveredRequirementIds.length ||
      input.allowedRequirementIds.some(
        (id) => !coveredRequirementIds.includes(id),
      ) ||
      coverage.some(({ section_ids }) =>
        (section_ids as string[]).some((id) => !sectionIds.has(id)),
      )
    ) {
      throw new TypeError("Plan requirement coverage is incomplete");
    }
    const sectionTransitions = transitions.map((transition, index) => ({
      transitionId: `transition_${index}_${createHash("sha256").update(JSON.stringify(transition)).digest("hex").slice(0, 16)}`,
      kind: transition.kind as
        "preserved" | "retitled" | "split" | "merged" | "retired" | "new",
      fromIds: transition.from_section_ids as string[],
      toIds: transition.to_section_ids as string[],
      reason: String(transition.reason),
    }));
    const cardinalityValid = sectionTransitions.every(
      ({ kind, fromIds, toIds }) => {
        if (kind === "preserved" || kind === "retitled")
          return fromIds.length === 1 && toIds.length === 1;
        if (kind === "split") return fromIds.length === 1 && toIds.length >= 2;
        if (kind === "merged") return fromIds.length >= 2 && toIds.length === 1;
        if (kind === "retired")
          return fromIds.length === 1 && toIds.length === 0;
        return fromIds.length === 0 && toIds.length === 1;
      },
    );
    if (!cardinalityValid)
      throw new TypeError("Plan transition cardinality is invalid");
    return new ValidatedProjection(
      immutableCopy({
        validator: "deterministic-authority-projection-v1",
        stateVersion: input.stateVersion,
        planVersionId: input.planVersionId,
        planContentHash: input.contentHash,
        schemaValid: true,
        controlledIdsValid: true,
        referencesComplete: true,
        identitiesUnique:
          new Set(planSections.map(({ sectionId }) => sectionId)).size ===
          planSections.length,
        planSections,
        sectionTransitions,
        coveredRequirementIds,
      }),
    );
  }

  static fromBaselineReviewArtifact(input: {
    bytes: Uint8Array;
    contentHash: string;
    stateVersion: number;
    policyHash: string;
    expectedPlanArtifactId: string;
    allowedComponentIds: string[];
    allowedRequirementIds: string[];
    allowedSectionIds: string[];
    suppliedEvidenceArtifactIds: string[];
    expectedPriorFindingIds: string[];
    findings: Array<{ findingId: string; observationId: string }>;
  }): ValidatedProjection {
    if (
      createHash("sha256").update(input.bytes).digest("hex") !==
      input.contentHash
    ) {
      throw new TypeError(
        "Review projection hash does not match artifact bytes",
      );
    }
    const parsed: unknown = JSON.parse(
      Buffer.from(input.bytes).toString("utf8"),
    );
    assertJsonSchema(parsed, schema("review.v1.schema.json"));
    const review = parsed as Record<string, unknown>;
    const concerns = review.new_concerns as Array<Record<string, unknown>>;
    const reviewedPriorFindingIds = (
      review.prior_findings as Array<Record<string, unknown>>
    ).map(({ finding_id }) => String(finding_id));
    if (
      review.review_kind !== "baseline" ||
      review.policy_hash !== input.policyHash ||
      review.plan_artifact_id !== input.expectedPlanArtifactId ||
      concerns.length !== input.findings.length
    ) {
      throw new TypeError("Review artifact is not bound to reconciliation");
    }
    const componentIds = new Set(input.allowedComponentIds);
    const requirementIds = new Set(input.allowedRequirementIds);
    const sectionIds = new Set(input.allowedSectionIds);
    const evidenceIds = new Set(input.suppliedEvidenceArtifactIds);
    if (
      concerns.some(
        (concern) =>
          (concern.component_ids as string[]).some(
            (id) => !componentIds.has(id),
          ) ||
          (concern.requirement_ids as string[]).some(
            (id) => !requirementIds.has(id),
          ) ||
          (concern.evidence as Array<Record<string, unknown>>).some(
            (evidence) =>
              !evidenceIds.has(String(evidence.artifact_id)) ||
              (evidence.section_ids as string[]).some(
                (id) => !sectionIds.has(id),
              ),
          ),
      )
    ) {
      throw new TypeError("Review controlled references are invalid");
    }
    if (
      reviewedPriorFindingIds.length !== input.expectedPriorFindingIds.length ||
      new Set(reviewedPriorFindingIds).size !==
        reviewedPriorFindingIds.length ||
      input.expectedPriorFindingIds.some(
        (id) => !reviewedPriorFindingIds.includes(id),
      )
    ) {
      throw new TypeError("Review does not account for every prior finding");
    }
    const findingFingerprints = concerns.map((concern, index) => ({
      findingId: input.findings[index]!.findingId,
      fingerprint: createHash("sha256")
        .update(
          JSON.stringify({
            ruleId: concern.rule_id,
            componentIds: concern.component_ids,
            requirementIds: concern.requirement_ids,
            title: concern.title,
          }),
        )
        .digest("hex"),
      policyHash: input.policyHash,
    }));
    const observationAssociations = concerns.map((concern, index) => ({
      observationId: input.findings[index]!.observationId,
      componentIds: concern.component_ids as string[],
      requirementIds: concern.requirement_ids as string[],
    }));
    const findingIds = input.findings.map(({ findingId }) => findingId);
    const observationIds = input.findings.map(
      ({ observationId }) => observationId,
    );
    return new ValidatedProjection(
      immutableCopy({
        validator: "deterministic-authority-projection-v1",
        stateVersion: input.stateVersion,
        reviewContentHash: input.contentHash,
        reviewedPlanArtifactId: input.expectedPlanArtifactId,
        reviewEvidenceArtifactIds: [
          ...new Set(
            concerns.flatMap((concern) =>
              (concern.evidence as Array<Record<string, unknown>>).map(
                ({ artifact_id }) => String(artifact_id),
              ),
            ),
          ),
        ],
        reviewedPriorFindingIds,
        schemaValid: true,
        controlledIdsValid: true,
        referencesComplete: true,
        identitiesUnique:
          new Set(findingIds).size === findingIds.length &&
          new Set(observationIds).size === observationIds.length,
        findingFingerprints,
        observationAssociations,
      }),
    );
  }

  toPersistenceData(): ValidatedProjectionData {
    if (this[validatedProjectionBrand] !== true) {
      throw new TypeError("Projection validation capability is invalid");
    }
    return immutableCopy(this.value);
  }
}

export interface AuthorityTransaction {
  loadRun<TState extends object>(runId: string): TState | null;
  settleProviderCompletion(
    completion: CompleteProviderAttemptEvidence,
  ):
    | { status: "eligible" }
    | { status: "settled"; completion: CompletedCommandAttempt };
  persistProviderCompletion<TState extends object>(
    completion: AcceptedProviderCompletion,
  ): PersistableTransition<TState>;
  settleProviderFailure(
    completion: CompleteProviderFailureEvidence,
    policy: ExecutionPolicy,
  ):
    | { status: "eligible" }
    | { status: "settled"; disposition: ProviderFailureDisposition };
  persistProviderFailure(
    failure: AcceptedProviderFailure,
  ): ProviderFailureDisposition | PersistableTransition<object>;
  persist<TState extends object>(
    request: PersistTransitionRequest,
    result: PersistableTransition<TState>,
  ): void;
}

export interface AuthorityPort {
  transaction<T>(work: (transaction: AuthorityTransaction) => T): Promise<T>;
}
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertJsonSchema } from "./json-schema-validator.js";
import type { StagedArtifactRegistration } from "./artifact-port.js";
export type { StagedArtifactRegistration } from "./artifact-port.js";
