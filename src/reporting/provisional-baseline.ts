import {
  DomainTransitionError,
  type ActiveFinding,
  type ActiveReview,
  type ArtifactEvidenceReference,
  type NonterminalRunState,
  type ProviderModelAssignment,
  type ReviewContext,
} from "../domain/index.js";

export type ProvisionalBaselineExport = {
  outcome: "provisional_baseline_reviewed";
  qualified: false;
  approved: false;
  runId: string;
  stateVersion: number;
  currentStage: "remediation" | "closure";
  sourceArtifact: Omit<ArtifactEvidenceReference, "kind">;
  configurationArtifact: Omit<ArtifactEvidenceReference, "kind">;
  ledgerVersionId: string;
  ledgerArtifact: Omit<ArtifactEvidenceReference, "kind">;
  planVersionId: string;
  planArtifact: Omit<ArtifactEvidenceReference, "kind">;
  renderedPlanArtifact: Omit<ArtifactEvidenceReference, "kind">;
  reviewId: string;
  reviewArtifact: Omit<ArtifactEvidenceReference, "kind">;
  reviewCycle: number;
  policyHash: string;
  plannerAssignment: ProviderModelAssignment;
  reviewerAssignment: ProviderModelAssignment;
  independence: ActiveReview["independence"];
  reviewContext: ReviewContext;
  reviewRequestArtifact: Omit<ArtifactEvidenceReference, "kind">;
  providerUsageArtifact: Omit<ArtifactEvidenceReference, "kind">;
  findings: Array<
    Pick<
      ActiveFinding,
      | "findingId"
      | "latestObservationId"
      | "severity"
      | "ruleId"
      | "title"
      | "evidence"
    >
  >;
};

export function createProvisionalBaselineExport(
  state: NonterminalRunState,
): ProvisionalBaselineExport {
  if (state.state !== "remediation" && state.state !== "closure") {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "A provisional baseline export requires an accepted baseline review",
    );
  }

  const snapshot = state.baselineReview;
  return {
    outcome: "provisional_baseline_reviewed",
    qualified: false,
    approved: false,
    runId: state.runId,
    stateVersion: state.stateVersion,
    currentStage: state.state,
    sourceArtifact: snapshot.source,
    configurationArtifact: snapshot.configuration,
    ledgerVersionId: snapshot.ledgerVersionId,
    ledgerArtifact: snapshot.ledger,
    planVersionId: snapshot.planVersionId,
    planArtifact: snapshot.plan,
    renderedPlanArtifact: snapshot.renderedPlan,
    reviewId: snapshot.reviewId,
    reviewArtifact: {
      artifactId: snapshot.artifactId,
      contentHash: snapshot.contentHash,
    },
    reviewCycle: snapshot.cycle,
    policyHash: snapshot.policyHash,
    plannerAssignment: snapshot.plannerAssignment,
    reviewerAssignment: snapshot.reviewerAssignment,
    independence: snapshot.independence,
    reviewContext: snapshot.reviewContext,
    reviewRequestArtifact: snapshot.request,
    providerUsageArtifact: snapshot.usage,
    findings: snapshot.findings.map(
      ({
        findingId,
        latestObservationId,
        severity,
        ruleId,
        title,
        evidence,
      }) => ({
        findingId,
        latestObservationId,
        severity,
        ruleId,
        title,
        evidence,
      }),
    ),
  };
}
