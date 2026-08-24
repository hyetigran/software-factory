import { createHash } from "node:crypto";

import type {
  AdvancedRunState,
  BudgetReservation,
  RemediationClaimVerdict,
  RemediationReviewAccepted,
  VerifiedArtifactInput,
} from "../domain/index.js";
import { waivedFindingIds } from "../domain/index.js";
import { assertJsonSchema } from "./json-schema-validator.js";
import type { RemediationCompletionEvidence } from "./remediation-claims.js";
import type { ResolvedConfigurationSnapshot } from "./stage-configuration.js";

type ReviewDocument = {
  reviewId: string;
  reviewKind: string;
  planArtifactId: string;
  policyHash: string;
  dispositions: Map<string, string>;
};

function parseReviewDocument(bytes: Uint8Array): ReviewDocument | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const document = parsed as Record<string, unknown>;
  const priorFindings = Array.isArray(document.prior_findings)
    ? document.prior_findings
    : null;
  if (priorFindings === null) return null;
  const dispositions = new Map<string, string>();
  for (const entry of priorFindings) {
    if (entry === null || typeof entry !== "object") return null;
    const finding = entry as Record<string, unknown>;
    if (
      typeof finding.finding_id !== "string" ||
      typeof finding.disposition !== "string" ||
      dispositions.has(finding.finding_id)
    ) {
      return null;
    }
    dispositions.set(finding.finding_id, finding.disposition);
  }
  return {
    reviewId: typeof document.review_id === "string" ? document.review_id : "",
    reviewKind:
      typeof document.review_kind === "string" ? document.review_kind : "",
    planArtifactId:
      typeof document.plan_artifact_id === "string"
        ? document.plan_artifact_id
        : "",
    policyHash:
      typeof document.policy_hash === "string" ? document.policy_hash : "",
    dispositions,
  };
}

function diffClaims(
  bytes: Uint8Array,
): Array<{ claimId: string; findingId: string }> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const claims = (parsed as Record<string, unknown>).claims;
  if (!Array.isArray(claims)) return null;
  const references: Array<{ claimId: string; findingId: string }> = [];
  for (const entry of claims) {
    if (entry === null || typeof entry !== "object") return null;
    const claim = entry as Record<string, unknown>;
    if (
      typeof claim.claimId !== "string" ||
      typeof claim.findingId !== "string"
    ) {
      return null;
    }
    references.push({ claimId: claim.claimId, findingId: claim.findingId });
  }
  return references;
}

export function buildRemediationReviewAccepted(input: {
  state: Extract<AdvancedRunState, { state: "remediation" }>;
  completion: RemediationCompletionEvidence;
  configuration: ResolvedConfigurationSnapshot;
  responseBytes: Uint8Array;
  reviewSchema: { bytes: Uint8Array; contentHash: string };
  diffArtifactBytes: Uint8Array;
  diffArtifactContentHash: string;
  claimIds: string[];
  nextCommandId: string;
  remediationPromptArtifactId: string;
  remediationSchemaArtifactId: string;
  availableBudget: BudgetReservation;
  exhaustion: RemediationReviewAccepted["exhaustionReport"];
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
}): RemediationReviewAccepted {
  if (
    createHash("sha256").update(input.reviewSchema.bytes).digest("hex") !==
      input.reviewSchema.contentHash ||
    input.reviewSchema.contentHash !==
      input.configuration.artifactHashes.reviewSchema
  ) {
    throw new TypeError("Review schema is not the pinned review schema");
  }

  const validatedReviewContentHash = createHash("sha256")
    .update(input.responseBytes)
    .digest("hex");
  const reviewArtifact: VerifiedArtifactInput = {
    artifactId: input.completion.outputArtifact.artifactId,
    contentHash: input.completion.outputArtifact.contentHash,
    verified:
      validatedReviewContentHash ===
      input.completion.outputArtifact.contentHash,
  };
  const document = parseReviewDocument(input.responseBytes);
  const schemaValid = (() => {
    if (document === null) return false;
    try {
      assertJsonSchema(
        JSON.parse(Buffer.from(input.responseBytes).toString("utf8")),
        JSON.parse(Buffer.from(input.reviewSchema.bytes).toString("utf8")),
      );
      return true;
    } catch {
      return false;
    }
  })();

  const diffBytesVerified =
    createHash("sha256").update(input.diffArtifactBytes).digest("hex") ===
    input.diffArtifactContentHash;
  const claims = diffClaims(input.diffArtifactBytes) ?? [];
  const claimIdsMatch =
    diffBytesVerified &&
    claims.length === input.claimIds.length &&
    new Set(claims.map(({ claimId }) => claimId)).size === claims.length &&
    claims.every(({ claimId }) => input.claimIds.includes(claimId));
  const blocking = new Set(input.state.blockingFindingIds);
  const verdicts: RemediationClaimVerdict[] = claims.map(
    ({ claimId, findingId }) => ({
      claimId,
      findingId,
      disposition:
        document?.dispositions.get(findingId) === "resolved"
          ? "resolved"
          : "unresolved",
    }),
  );
  const claimsAccountedFor =
    document !== null &&
    claimIdsMatch &&
    claims.every(({ findingId }) => document.dispositions.has(findingId));
  const controlledIdsValid =
    document !== null &&
    document.reviewKind === "remediation" &&
    document.policyHash === input.state.policyHash &&
    document.planArtifactId === input.state.currentPlan.artifactId &&
    [...document.dispositions.keys()].every((findingId) =>
      blocking.has(findingId),
    );

  const resolved = new Set(
    verdicts
      .filter(({ disposition }) => disposition === "resolved")
      .map(({ findingId }) => findingId),
  );
  const waived = waivedFindingIds(input.state.waivers);
  const unwaivedBlocking = input.state.blockingFindingIds.filter(
    (findingId) => !resolved.has(findingId) && !waived.has(findingId),
  );
  const cyclesUsed = input.state.activeReview.cycle;
  const ceiling = input.configuration.hardCeilings.remediationCycles;
  const route =
    unwaivedBlocking.length === 0
      ? "closure"
      : cyclesUsed < ceiling
        ? "remediation"
        : "halt";
  const nextBudget =
    route === "remediation"
      ? input.configuration.providerRequestBudgets.remediation
      : input.configuration.providerRequestBudgets.reviewer;
  const nextSettings =
    route === "remediation"
      ? input.configuration.providerRequestSettings.remediation
      : input.configuration.providerRequestSettings.reviewer;

  return {
    type: "RemediationReviewAccepted",
    runId: input.state.runId,
    expectedStateVersion: input.state.stateVersion,
    reviewId: document?.reviewId ?? "",
    reviewPurposeId: input.state.activeReview.reviewPurposeId,
    originatingCommandId: input.state.activeReview.commandId,
    reviewArtifact,
    reviewRequestArtifact: {
      artifactId: input.completion.requestArtifactId,
      contentHash: input.completion.requestContentHash,
      verified: true,
    },
    providerUsageArtifact: {
      artifactId: input.completion.nativeUsageArtifact.artifactId,
      contentHash: input.completion.nativeUsageArtifact.contentHash,
      verified: true,
    },
    acceptedAttempt: {
      validator: "accepted-provider-attempt-v1",
      commandId: input.completion.commandId,
      attemptId: input.completion.attemptId,
      requestArtifactId: input.completion.requestArtifactId,
      requestContentHash: input.completion.requestContentHash,
      responseArtifactId: input.completion.outputArtifact.artifactId,
      responseContentHash: input.completion.outputArtifact.contentHash,
      rawResponseArtifactId: input.completion.rawResponseArtifact.artifactId,
      rawResponseContentHash: input.completion.rawResponseArtifact.contentHash,
      nativeUsageArtifactId: input.completion.nativeUsageArtifact.artifactId,
      nativeUsageContentHash: input.completion.nativeUsageArtifact.contentHash,
    },
    outputValid: document !== null && schemaValid,
    verdicts,
    verdictValidation: {
      validator: "deterministic-remediation-verdict-v1",
      validatedReviewContentHash,
      schemaValid,
      claimsAccountedFor,
      controlledIdsValid,
    },
    reviewedPlanVersionId: input.state.currentPlan.versionId,
    reviewedPlanContentHash: input.state.currentPlan.contentHash,
    reviewedPolicyHash: input.state.policyHash,
    remediationCycleCeiling: ceiling,
    remediationCyclesUsed: cyclesUsed,
    nextCommandId: input.nextCommandId,
    nextCommandBudgetMaximum: nextBudget,
    nextCommandTimeoutMs: nextSettings.timeoutMs,
    nextCommandReasoning: nextSettings.reasoning,
    nextCommandRequestPolicyResolved: true,
    remediationPromptArtifact: {
      artifactId: input.remediationPromptArtifactId,
      contentHash: input.configuration.artifactHashes.remediationPrompt,
      verified: true,
    },
    remediationSchemaArtifact: {
      artifactId: input.remediationSchemaArtifactId,
      contentHash: input.configuration.artifactHashes.remediationSchema,
      verified: true,
    },
    availableBudget: input.availableBudget,
    exhaustionReport: route === "halt" ? input.exhaustion : null,
    auditChainVerified: input.auditChainVerified,
    databaseIntegrityVerified: input.databaseIntegrityVerified,
    schemaCompatible: input.schemaCompatible,
    mutationLeaseAvailable: input.mutationLeaseAvailable,
    actor: {
      kind: "reviewer",
      provider: input.state.activeReview.reviewerAssignment.provider,
      modelId: input.state.activeReview.reviewerAssignment.modelId,
    },
  };
}
