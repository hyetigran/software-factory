import { createHash } from "node:crypto";

import { canonicalJson } from "../domain/canonical-json.js";
import type {
  AdvancedRunState,
  ArtifactEvidenceReference,
  BudgetReservation,
  RemediationClaimInput,
  RemediationClaimsValidation,
  RemediationGenerated,
  VerifiedArtifactInput,
} from "../domain/index.js";
import type { ResolvedConfigurationSnapshot } from "./stage-configuration.js";
import { validateSectionTransitions } from "./section-transitions.js";

export type DerivedRemediationClaims = {
  claims: RemediationClaimInput[];
  validation: RemediationClaimsValidation;
  changedSectionIds: string[];
};

function planSectionsByCanonicalContent(
  bytes: Uint8Array,
): Map<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const sections = (parsed as Record<string, unknown>).sections;
  if (!Array.isArray(sections)) return null;
  const byId = new Map<string, string>();
  for (const section of sections) {
    if (section === null || typeof section !== "object") return null;
    const sectionId = (section as Record<string, unknown>).section_id;
    if (typeof sectionId !== "string" || sectionId.length === 0) return null;
    if (byId.has(sectionId)) return null;
    byId.set(sectionId, canonicalJson(section));
  }
  return byId;
}

export function deriveRemediationClaims(input: {
  priorPlanBytes: Uint8Array;
  revisedPlanBytes: Uint8Array;
  remediationArtifact: Omit<ArtifactEvidenceReference, "kind">;
  blockingFindingIds: string[];
}): DerivedRemediationClaims {
  const validatedRemediationContentHash = createHash("sha256")
    .update(input.revisedPlanBytes)
    .digest("hex");
  const invalid = (): DerivedRemediationClaims => ({
    claims: [],
    changedSectionIds: [],
    validation: {
      validator: "deterministic-remediation-claims-v1",
      validatedRemediationContentHash,
      claimsMatchArtifact: false,
      changedSectionsDeclared: false,
    },
  });

  const priorSections = planSectionsByCanonicalContent(input.priorPlanBytes);
  const revisedSections = planSectionsByCanonicalContent(
    input.revisedPlanBytes,
  );
  if (priorSections === null || revisedSections === null) return invalid();

  const changedSectionIds = [
    ...new Set([...priorSections.keys(), ...revisedSections.keys()]),
  ]
    .filter(
      (sectionId) =>
        priorSections.get(sectionId) !== revisedSections.get(sectionId),
    )
    .sort();
  const evidence = [
    {
      kind: "artifact" as const,
      artifactId: input.remediationArtifact.artifactId,
      contentHash: input.remediationArtifact.contentHash,
    },
  ];

  return {
    claims: input.blockingFindingIds.map((findingId) => ({
      claimId: `claim_${findingId}`,
      findingId,
      changedSectionIds,
      evidence: evidence.map((reference) => ({ ...reference })),
    })),
    changedSectionIds,
    validation: {
      validator: "deterministic-remediation-claims-v1",
      validatedRemediationContentHash,
      claimsMatchArtifact:
        validatedRemediationContentHash ===
        input.remediationArtifact.contentHash,
      changedSectionsDeclared: changedSectionIds.length > 0,
    },
  };
}

export type RemediationCompletionEvidence = {
  commandId: string;
  attemptId: string;
  requestArtifactId: string;
  requestContentHash: string;
  outputArtifact: Omit<ArtifactEvidenceReference, "kind">;
  rawResponseArtifact: Omit<ArtifactEvidenceReference, "kind">;
  nativeUsageArtifact: Omit<ArtifactEvidenceReference, "kind">;
};

export function buildRemediationGenerated(input: {
  state: Extract<AdvancedRunState, { state: "remediation" }>;
  completion: RemediationCompletionEvidence;
  configuration: ResolvedConfigurationSnapshot;
  priorPlanBytes: Uint8Array;
  revisedPlanBytes: Uint8Array;
  planArtifactId: string;
  sectionTransitionMapArtifactId: string;
  sectionTransitionMapBytes: Uint8Array;
  provenanceArtifact: VerifiedArtifactInput;
  outputValid: boolean;
  verifyCommandId: string;
  availableBudget: BudgetReservation;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
}): RemediationGenerated {
  if (
    createHash("sha256").update(input.priorPlanBytes).digest("hex") !==
    input.state.currentPlan.contentHash
  ) {
    throw new TypeError(
      "Prior plan bytes do not match the current plan of the run",
    );
  }
  const revisedPlanContentHash = createHash("sha256")
    .update(input.revisedPlanBytes)
    .digest("hex");
  const remediationArtifact: VerifiedArtifactInput = {
    artifactId: input.completion.outputArtifact.artifactId,
    contentHash: input.completion.outputArtifact.contentHash,
    verified:
      revisedPlanContentHash === input.completion.outputArtifact.contentHash,
  };
  const derived = deriveRemediationClaims({
    priorPlanBytes: input.priorPlanBytes,
    revisedPlanBytes: input.revisedPlanBytes,
    remediationArtifact: {
      artifactId: remediationArtifact.artifactId,
      contentHash: remediationArtifact.contentHash,
    },
    blockingFindingIds: input.state.blockingFindingIds,
  });
  const planVersionId = (() => {
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(input.revisedPlanBytes).toString("utf8"),
      );
      const planId =
        parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>).plan_id
          : undefined;
      return typeof planId === "string" ? planId : "";
    } catch {
      return "";
    }
  })();

  return {
    type: "RemediationGenerated",
    runId: input.state.runId,
    expectedStateVersion: input.state.stateVersion,
    remediationPurposeId: input.state.activePlanning.purposeId,
    originatingCommandId: input.state.activePlanning.commandId,
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
    remediationArtifact,
    remediationRequestArtifact: {
      artifactId: input.completion.requestArtifactId,
      contentHash: input.completion.requestContentHash,
      verified: true,
    },
    providerUsageArtifact: {
      artifactId: input.completion.nativeUsageArtifact.artifactId,
      contentHash: input.completion.nativeUsageArtifact.contentHash,
      verified: true,
    },
    outputValid: input.outputValid,
    claims: derived.claims,
    claimsValidation: derived.validation,
    planVersionId,
    planArtifact: {
      artifactId: input.planArtifactId,
      contentHash: revisedPlanContentHash,
      verified: true,
    },
    sectionTransitionValidation: validateSectionTransitions({
      priorPlanBytes: input.priorPlanBytes,
      planBytes: input.revisedPlanBytes,
      transitionMapBytes: input.sectionTransitionMapBytes,
    }),
    sectionTransitionMapArtifact: {
      artifactId: input.sectionTransitionMapArtifactId,
      contentHash: createHash("sha256")
        .update(input.sectionTransitionMapBytes)
        .digest("hex"),
      verified: true,
    },
    provenanceArtifact: input.provenanceArtifact,
    verifyCommandId: input.verifyCommandId,
    verifyBudgetMaximum: input.configuration.providerRequestBudgets.reviewer,
    verifyTimeoutMs:
      input.configuration.providerRequestSettings.reviewer.timeoutMs,
    verifyReasoning:
      input.configuration.providerRequestSettings.reviewer.reasoning,
    verifyRequestPolicyResolved: true,
    availableBudget: input.availableBudget,
    auditChainVerified: input.auditChainVerified,
    databaseIntegrityVerified: input.databaseIntegrityVerified,
    schemaCompatible: input.schemaCompatible,
    mutationLeaseAvailable: input.mutationLeaseAvailable,
    actor: {
      kind: "planner",
      provider: input.state.activePlanning.plannerAssignment.provider,
      modelId: input.state.activePlanning.plannerAssignment.modelId,
    },
  };
}
