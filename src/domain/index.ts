import { createHash } from "node:crypto";

import { canonicalJson } from "./canonical-json.js";

export type HumanActor = {
  kind: "human";
  displayName: string;
  osAccount: string;
};

export type SystemActor = {
  kind: "system";
  component: string;
  version: string;
};

export type ModelActor = {
  kind: "planner" | "reviewer";
  provider: string;
  modelId: string;
};

export type ArtifactEvidenceReference = {
  kind: "artifact";
  artifactId: string;
  contentHash: string;
};

export type CurrentLedger = {
  versionId: string;
  artifactId: string;
  contentHash: string;
  validationStatus: "pending" | "approved";
};

export type SourceRange = {
  startOffset: number;
  endOffset: number;
};

export type SourceExclusion = {
  exclusionId: string;
  sourceRange: SourceRange;
  reason: string;
};

type RunStateBase = {
  runId: string;
  stateVersion: number;
  sourceArtifactId: string;
  sourceContentHash: string;
  configurationArtifactId: string;
  configurationContentHash: string;
  policyHash: string;
  blockedReason: string | null;
  projectionBlock?: {
    projectionKind: "ledger" | "plan";
    expectedContentHash: string;
    editedArtifact: Omit<ArtifactEvidenceReference, "kind">;
  };
  sourceExclusions?: SourceExclusion[];
  reviewIndependenceOverride?: ReviewIndependenceOverride;
};

export type DraftRunState = RunStateBase & {
  state: "draft";
  policyLocked: boolean;
  currentLedger?: CurrentLedger;
};

type AdvancedStateBase = RunStateBase & {
  currentLedger: CurrentLedger & { validationStatus: "approved" };
  downstreamQualification: {
    artifacts: ArtifactEvidenceReference[];
    gateIds: string[];
  };
};

export type ProviderModelAssignment = {
  provider: "openai" | "anthropic";
  modelId: string;
};

export type ActivePlanning = {
  purposeId: string;
  commandId: string;
  plannerAssignment: ProviderModelAssignment;
};

export type CurrentPlan = {
  versionId: string;
  artifactId: string;
  contentHash: string;
  sectionTransitionMap: Omit<ArtifactEvidenceReference, "kind">;
  provenance: Omit<ArtifactEvidenceReference, "kind">;
  origin:
    | {
        kind: "planner";
        assignment: ProviderModelAssignment;
        originatingCommandId: string;
      }
    | { kind: "human"; actor: HumanActor };
};

export type ActiveReview = {
  cycle: number;
  commandId: string;
  renderCommandId: string;
  reviewerAssignment: ProviderModelAssignment;
  reviewPurposeId: string;
  independence:
    | { reduced: false }
    | {
        reduced: true;
        overrideEvidence: Omit<ArtifactEvidenceReference, "kind">;
      };
};

export type FindingSeverity = "critical" | "high" | "medium" | "low";

export type ActiveFinding = {
  findingId: string;
  status: "open";
  latestObservationId: string;
  severity: FindingSeverity;
  ruleId: string;
  title: string;
  evidence: ArtifactEvidenceReference[];
  latestObservationContext: {
    reviewId: string;
    ledgerVersionId: string;
    ledgerContentHash: string;
    planVersionId: string;
    planContentHash: string;
    policyHash: string;
    reviewerAssignment: ProviderModelAssignment;
    prompt: Omit<ArtifactEvidenceReference, "kind">;
    schema: Omit<ArtifactEvidenceReference, "kind">;
    cycle: number;
    originatingCommandId: string;
  };
};

export type ReviewContext = {
  prompt: Omit<ArtifactEvidenceReference, "kind">;
  schema: Omit<ArtifactEvidenceReference, "kind">;
  taxonomy: Omit<ArtifactEvidenceReference, "kind">;
  componentRegistry: Omit<ArtifactEvidenceReference, "kind">;
  policy: Omit<ArtifactEvidenceReference, "kind">;
  evidence: ArtifactEvidenceReference[];
};

export type AcceptedBaselineReview = {
  reviewId: string;
  artifactId: string;
  contentHash: string;
  cycle: number;
  source: Omit<ArtifactEvidenceReference, "kind">;
  configuration: Omit<ArtifactEvidenceReference, "kind">;
  ledgerVersionId: string;
  ledger: Omit<ArtifactEvidenceReference, "kind">;
  planVersionId: string;
  plan: Omit<ArtifactEvidenceReference, "kind">;
  renderedPlan: Omit<ArtifactEvidenceReference, "kind">;
  policyHash: string;
  planOrigin: CurrentPlan["origin"];
  plannerAssignment: ProviderModelAssignment | null;
  reviewerAssignment: ProviderModelAssignment;
  independence: ActiveReview["independence"];
  reviewContext: ReviewContext;
  request: Omit<ArtifactEvidenceReference, "kind">;
  usage: Omit<ArtifactEvidenceReference, "kind">;
  findings: ActiveFinding[];
  acceptedAttemptId: string;
};

export type ReviewIndependenceOverride = {
  normalReviewerAssignment: ProviderModelAssignment;
  overrideReviewerAssignment: ProviderModelAssignment;
  reason: string;
  evidence: Omit<ArtifactEvidenceReference, "kind">;
  actor: HumanActor;
};

export type AdvancedRunState = AdvancedStateBase &
  (
    | { state: "requirements_approved"; policyLocked: boolean }
    | { state: "planning"; policyLocked: true; activePlanning: ActivePlanning }
    | {
        state: "baseline_review";
        policyLocked: true;
        currentPlan: CurrentPlan;
        activeReview: ActiveReview;
        reviewContext: ReviewContext;
      }
    | {
        state: "remediation";
        policyLocked: true;
        currentPlan: CurrentPlan;
        activeFindings: ActiveFinding[];
        activeReview: ActiveReview;
        reviewContext: ReviewContext;
        renderedPlan: Omit<ArtifactEvidenceReference, "kind">;
        baselineReview: AcceptedBaselineReview;
        activePlanning: ActivePlanning;
      }
    | {
        state: "closure";
        policyLocked: true;
        currentPlan: CurrentPlan;
        activeFindings: ActiveFinding[];
        activeReview: ActiveReview;
        reviewContext: ReviewContext;
        renderedPlan: Omit<ArtifactEvidenceReference, "kind">;
        baselineReview: AcceptedBaselineReview;
      }
    | {
        state: "qualified" | "qualified_with_waivers";
        policyLocked: true;
      }
  );

export type NonterminalRunState = DraftRunState | AdvancedRunState;

export type HaltedRunState = RunStateBase & {
  state: "halted";
  policyLocked: boolean;
  haltedFrom: NonterminalRunState["state"];
  haltReason: string;
  failureEvidence: ArtifactEvidenceReference[];
  attemptIds: string[];
  unresolvedFindingIds: string[];
};

export type RunStarted = {
  type: "RunStarted";
  runId: string;
  expectedStateVersion: number;
  sourceArtifactId: string;
  sourceContentHash: string;
  sourceProvenancePath: string;
  sourceObjectVerified: boolean;
  configurationArtifactId: string;
  configurationContentHash: string;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  renderCommandId: string;
  actor: HumanActor;
};

export type PinnedRunPolicy = {
  policyHash: string;
  plannerAssignment: ProviderModelAssignment;
  reviewerAssignment: ProviderModelAssignment;
};

export type LedgerSubmitted = {
  type: "LedgerSubmitted";
  runId: string;
  expectedStateVersion: number;
  ledgerVersionId: string;
  ledgerArtifactId: string;
  ledgerContentHash: string;
  ledgerObjectVerified: boolean;
  ledgerSchemaValid: boolean;
  sourceReferencesValid: boolean;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  validateCommandId: string;
  renderCommandId: string;
  actor: HumanActor;
};

export type SourceExclusionApproved = {
  type: "SourceExclusionApproved";
  runId: string;
  expectedStateVersion: number;
  exclusionId: string;
  sourceRange: SourceRange;
  sourceRangeVerified: boolean;
  reason: string;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  validateCommandId: string;
  actor: HumanActor;
};

export type LedgerApprovalRequested = {
  type: "LedgerApprovalRequested";
  runId: string;
  expectedStateVersion: number;
  validatedStateVersion: number;
  validatedLedgerVersionId: string;
  validatedLedgerContentHash: string;
  validatedPolicyHash: string;
  ledgerSchemaValid: boolean;
  lineageValid: boolean;
  identityValid: boolean;
  coverageComplete: boolean;
  coverageReportArtifactId: string;
  coverageReportContentHash: string;
  coverageReportVerified: boolean;
  approvalGateId: string;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  renderCommandId: string;
  actor: HumanActor;
};

export type PlanningRequested = {
  type: "PlanningRequested";
  runId: string;
  expectedStateVersion: number;
  planPurposeId: string;
  plannerAssignment: ProviderModelAssignment;
  plannerModelAllowed: boolean;
  modelIdentityPinned: boolean;
  policyAccepted: boolean;
  budgetsAccepted: boolean;
  providerBoundaryAcknowledged: boolean;
  promptArtifactId: string;
  promptContentHash: string;
  promptArtifactVerified: boolean;
  outputSchemaArtifactId: string;
  outputSchemaContentHash: string;
  outputSchemaArtifactVerified: boolean;
  requestTimeoutMs: number;
  requestReasoning: string | null;
  requestPolicyResolved: boolean;
  budgetReservation: BudgetReservation;
  availableBudget: BudgetReservation;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  generateCommandId: string;
  actor: HumanActor;
};

export type VerifiedArtifactInput = {
  artifactId: string;
  contentHash: string;
  verified: boolean;
};

export type SectionTransitionValidation = {
  validator: "deterministic-section-transition-v1";
  validatedPlanContentHash: string;
  validatedTransitionMapContentHash: string;
  classificationsComplete: boolean;
  existingSectionIdsPreserved: boolean;
  onlyDeclaredNewSectionsAssignedIds: boolean;
};

export type PlanGenerated = {
  type: "PlanGenerated";
  runId: string;
  expectedStateVersion: number;
  planPurposeId: string;
  originatingCommandId: string;
  acceptedAttempt: AcceptedAttemptResolution;
  planVersionId: string;
  planArtifact: VerifiedArtifactInput;
  outputValid: boolean;
  sectionTransitionValidation: SectionTransitionValidation;
  sectionTransitionMapArtifact: VerifiedArtifactInput;
  provenanceArtifact: VerifiedArtifactInput;
  reviewerAssignment: ProviderModelAssignment;
  reviewerModelAllowed: boolean;
  reviewerModelIdentityPinned: boolean;
  reviewerAssignmentAuthorized: boolean;
  reviewPolicyArtifact: VerifiedArtifactInput;
  reviewerPromptArtifact: VerifiedArtifactInput;
  reviewSchemaArtifact: VerifiedArtifactInput;
  taxonomyArtifact: VerifiedArtifactInput;
  componentRegistryArtifact: VerifiedArtifactInput;
  reviewTimeoutMs: number;
  reviewReasoning: string | null;
  reviewRequestPolicyResolved: boolean;
  reviewBudgetMaximum: BudgetReservation;
  availableBudget: BudgetReservation;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  renderCommandId: string;
  reviewCommandId: string;
  actor: ModelActor & { kind: "planner" };
};

export type PlanSubmitted = {
  type: "PlanSubmitted";
  runId: string;
  expectedStateVersion: number;
  planVersionId: string;
  planArtifact: VerifiedArtifactInput;
  canonicalSchemaValid: boolean;
  sectionTransitionValidation: SectionTransitionValidation;
  sectionTransitionMapArtifact: VerifiedArtifactInput;
  provenanceArtifact: VerifiedArtifactInput;
  reviewerAssignment: ProviderModelAssignment;
  reviewerModelAllowed: boolean;
  reviewerModelIdentityPinned: boolean;
  reviewerAssignmentAuthorized: boolean;
  reviewPolicyArtifact: VerifiedArtifactInput;
  reviewerPromptArtifact: VerifiedArtifactInput;
  reviewSchemaArtifact: VerifiedArtifactInput;
  taxonomyArtifact: VerifiedArtifactInput;
  componentRegistryArtifact: VerifiedArtifactInput;
  reviewTimeoutMs: number;
  reviewReasoning: string | null;
  reviewRequestPolicyResolved: boolean;
  reviewBudgetMaximum: BudgetReservation;
  availableBudget: BudgetReservation;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  renderCommandId: string;
  reviewCommandId: string;
  actor: HumanActor;
};

export type IndependenceOverrideGranted = {
  type: "IndependenceOverrideGranted";
  runId: string;
  expectedStateVersion: number;
  normalReviewerAssignment: ProviderModelAssignment;
  overrideReviewerAssignment: ProviderModelAssignment;
  evidenceArtifactId: string;
  evidenceContentHash: string;
  evidenceVerified: boolean;
  beforeProviderDispatchVerified: boolean;
  reason: string;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  actor: HumanActor;
};

export type RerunAuthorized = {
  type: "RerunAuthorized";
  runId: string;
  expectedStateVersion: number;
  decisionId: string;
  commandId: string;
  attemptId: string;
  correlationId: string;
  reason: string;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  actor: HumanActor;
};

export type ReviewFindingInput = {
  findingId: string;
  observationId: string;
  severity: FindingSeverity;
  ruleId: string;
  title: string;
  evidence: ArtifactEvidenceReference[];
};

export type FindingReconciliationValidation = {
  validator: "deterministic-finding-reconciliation-v1";
  validatedReviewContentHash: string;
  priorFindingsAccountedFor: boolean;
  ambiguousCandidatesResolved: boolean;
  findingIdsAssignedByOrchestrator: boolean;
  observationIdsUnique: boolean;
  blockingFindingIds: string[];
};

export type ReviewOutputValidation = {
  validator: "deterministic-review-output-v1";
  validatedReviewContentHash: string;
  schemaValid: boolean;
  taxonomyValid: boolean;
  controlledIdsValid: boolean;
  evidenceReferencesSupplied: boolean;
};

export type AcceptedAttemptResolution = {
  validator: "accepted-provider-attempt-v1";
  commandId: string;
  attemptId: string;
  requestArtifactId: string;
  requestContentHash: string;
  responseArtifactId: string;
  responseContentHash: string;
  rawResponseArtifactId: string;
  rawResponseContentHash: string;
  nativeUsageArtifactId: string;
  nativeUsageContentHash: string;
};

export type RenderedPlanResolution = {
  validator: "verified-command-dependency-resolution-v1";
  renderCommandId: string;
  consumingReviewCommandId: string;
  renderedPlanContentHash: string;
  canonicalPlanContentHash: string;
};

export type ReviewAccepted = {
  type: "ReviewAccepted";
  runId: string;
  expectedStateVersion: number;
  reviewId: string;
  reviewPurposeId: string;
  originatingCommandId: string;
  reviewArtifact: VerifiedArtifactInput;
  reviewRequestArtifact: VerifiedArtifactInput;
  providerUsageArtifact: VerifiedArtifactInput;
  acceptedAttempt: AcceptedAttemptResolution;
  renderedPlanArtifact: VerifiedArtifactInput;
  renderedPlanResolution: RenderedPlanResolution;
  reviewedPlanVersionId: string;
  reviewedPlanContentHash: string;
  reviewedPolicyHash: string;
  reviewCycle: number;
  outputValid: boolean;
  outputValidation: ReviewOutputValidation;
  findings: ReviewFindingInput[];
  reconciliation: FindingReconciliationValidation;
  nextCommandId: string;
  nextCommandBudgetMaximum: BudgetReservation;
  nextCommandTimeoutMs: number;
  nextCommandReasoning: string | null;
  nextCommandRequestPolicyResolved: boolean;
  remediationPromptArtifact: VerifiedArtifactInput;
  remediationSchemaArtifact: VerifiedArtifactInput;
  availableBudget: BudgetReservation;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  actor: ModelActor & { kind: "reviewer" };
};

export type ProviderOutcomeFailed = {
  type: "ProviderOutcomeFailed";
  runId: string;
  expectedStateVersion: number;
  failedCommandId: string;
  failedPurposeId: string;
  retryRepairExhausted: boolean;
  failureClassification:
    "refusal" | "invalid_output" | "transport" | "provider_error" | "budget";
  terminalPolicyDecision: "halt";
  terminalPolicyDecisionArtifact: VerifiedArtifactInput;
  budgetReportArtifact: VerifiedArtifactInput;
  recoveryBounds: {
    retryLimit: number;
    repairLimit: number;
    retriesUsed: number;
    repairsUsed: number;
  };
  outcomeArtifact: VerifiedArtifactInput;
  diagnosticArtifact: VerifiedArtifactInput;
  attemptIds: string[];
  terminalReportCommandId: string;
  reason: string;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  actor: SystemActor;
};

export type ExternalEditDetected = {
  type: "ExternalEditDetected";
  runId: string;
  expectedStateVersion: number;
  projectionKind: "ledger" | "plan";
  expectedContentHash: string;
  editedArtifact: VerifiedArtifactInput;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  actor: SystemActor;
};

export type ProjectionRestored = {
  type: "ProjectionRestored";
  runId: string;
  expectedStateVersion: number;
  restoredContentHash: string;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  actor: SystemActor;
};

export type BudgetReservation = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
};

export type ProviderRequestPolicy = {
  configurationArtifactId: string;
  configurationContentHash: string;
  policyHash: string;
  role: "planner" | "reviewer";
  promptArtifactId: string;
  promptContentHash: string;
  outputSchemaArtifactId: string;
  outputSchemaContentHash: string;
  maxOutputTokens: number;
  timeoutMs: number;
  reasoning: string | null;
  providerStorage: "minimize";
};

export type RenderSourceRegistrationReport = {
  commandId: string;
  commandKey: string;
  commandType: "render_source_registration_report";
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: 1;
  purposeId: string;
  inputArtifactHashes: string[];
  policyHash: string;
  provider: "local";
  budgetReservation: BudgetReservation;
  payload: {
    sourceArtifactId: string;
  };
};

export type ValidateLedger = {
  commandId: string;
  commandKey: string;
  commandType: "validate_ledger";
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: number;
  purposeId: string;
  inputArtifactHashes: string[];
  policyHash: string;
  provider: "local";
  budgetReservation: BudgetReservation;
  payload: {
    ledgerVersionId: string;
    ledgerArtifactId: string;
    sourceArtifactId: string;
    sourceExclusions?: SourceExclusion[];
  };
};

export type RenderLedger = {
  commandId: string;
  commandKey: string;
  commandType: "render_ledger";
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: number;
  purposeId: string;
  inputArtifactHashes: string[];
  policyHash: string;
  provider: "local";
  budgetReservation: BudgetReservation;
  payload: {
    ledgerVersionId: string;
    ledgerArtifactId: string;
  };
};

export type RenderLedgerApproval = {
  commandId: string;
  commandKey: string;
  commandType: "render_ledger_approval";
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: number;
  purposeId: string;
  inputArtifactHashes: string[];
  policyHash: string;
  provider: "local";
  budgetReservation: BudgetReservation;
  payload: {
    ledgerVersionId: string;
    ledgerArtifactId: string;
    coverageReportArtifactId: string;
    coverageValidatedStateVersion: number;
    coverageValidatedPolicyHash: string;
    approvalGateId: string;
    sourceExclusions: SourceExclusion[];
    approvedBy: HumanActor;
  };
};

export type GeneratePlan = {
  commandId: string;
  commandKey: string;
  commandType: "generate_plan";
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: number;
  purposeId: string;
  inputArtifactHashes: string[];
  policyHash: string;
  provider: ProviderModelAssignment["provider"];
  modelId: string;
  budgetReservation: BudgetReservation;
  providerRequestPolicy: ProviderRequestPolicy;
  payload: {
    ledgerVersionId: string;
    ledgerArtifactId: string;
    promptArtifactId: string;
    outputSchemaArtifactId: string;
    providerStorage: "minimize";
  };
};

export type RenderPlan = {
  commandId: string;
  commandKey: string;
  commandType: "render_plan";
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: number;
  purposeId: string;
  inputArtifactHashes: string[];
  policyHash: string;
  provider: "local";
  budgetReservation: BudgetReservation;
  payload: {
    planVersionId: string;
    planArtifactId: string;
  };
};

export type BaselineReview = {
  commandId: string;
  commandKey: string;
  commandType: "baseline_review";
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: number;
  prerequisiteCommandIds: string[];
  purposeId: string;
  inputArtifactHashes: string[];
  policyHash: string;
  provider: ProviderModelAssignment["provider"];
  modelId: string;
  budgetReservation: BudgetReservation;
  providerRequestPolicy: ProviderRequestPolicy;
  payload: {
    ledgerVersionId: string;
    ledgerArtifactId: string;
    planVersionId: string;
    planArtifactId: string;
    renderPlanCommandId: string;
    reviewerPromptArtifactId: string;
    reviewSchemaArtifactId: string;
    taxonomyArtifactId: string;
    componentRegistryArtifactId: string;
    reviewPolicyArtifactId: string;
    evidenceArtifactIds: string[];
    independence: ActiveReview["independence"];
    providerStorage: "minimize";
  };
};

export type GenerateRemediation = {
  commandId: string;
  commandKey: string;
  commandType: "generate_remediation";
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: number;
  purposeId: string;
  inputArtifactHashes: string[];
  policyHash: string;
  provider: ProviderModelAssignment["provider"];
  modelId: string;
  budgetReservation: BudgetReservation;
  providerRequestPolicy: ProviderRequestPolicy;
  payload: {
    ledgerVersionId: string;
    planVersionId: string;
    planArtifactId: string;
    reviewArtifactId: string;
    promptArtifactId: string;
    outputSchemaArtifactId: string;
    blockingFindingIds: string[];
    providerStorage: "minimize";
  };
};

export type ClosureReview = {
  commandId: string;
  commandKey: string;
  commandType: "closure_review";
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: number;
  purposeId: string;
  inputArtifactHashes: string[];
  policyHash: string;
  provider: ProviderModelAssignment["provider"];
  modelId: string;
  budgetReservation: BudgetReservation;
  providerRequestPolicy: ProviderRequestPolicy;
  payload: {
    ledgerVersionId: string;
    planVersionId: string;
    planArtifactId: string;
    baselineReviewArtifactId: string;
    renderedPlanArtifactId: string;
    reviewerPromptArtifactId: string;
    reviewSchemaArtifactId: string;
    taxonomyArtifactId: string;
    componentRegistryArtifactId: string;
    reviewPolicyArtifactId: string;
    evidenceArtifactIds: string[];
    findingIds: string[];
    independence: ActiveReview["independence"];
    providerStorage: "minimize";
  };
};

export type ExportTerminal = {
  commandId: string;
  commandKey: string;
  commandType: "export_terminal";
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: number;
  purposeId: string;
  inputArtifactHashes: string[];
  policyHash: string;
  provider: "local";
  budgetReservation: BudgetReservation;
  payload: {
    haltedFrom: NonterminalRunState["state"];
    reason: string;
    failedCommandId: string;
    failureClassification: ProviderOutcomeFailed["failureClassification"];
    attemptIds: string[];
    evidenceArtifactIds: string[];
    unresolvedFindingIds: string[];
    sourceArtifactId: string;
    configurationArtifactId: string;
    ledgerArtifactId: string | null;
    planArtifactId: string | null;
    policyHash: string;
    plannerAssignment: ProviderModelAssignment;
    reviewerAssignment: ProviderModelAssignment;
    budgetReportArtifactId: string;
    recoveryBounds: ProviderOutcomeFailed["recoveryBounds"];
    independence: ActiveReview["independence"] | null;
    lineageArtifactIds: string[];
    waiverIds: string[];
    outcome: "halted";
  };
};

export type RunStartedFact = {
  type: "run_started";
  actor: HumanActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    sourceArtifactId: string;
    configurationHash: string;
    parentRunId: null;
    policyHash: string;
  };
};

export type SourceRegisteredFact = {
  type: "source_registered";
  actor: HumanActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    sourceArtifactId: string;
    contentHash: string;
    provenancePath: string;
  };
};

export type CommandPlannedFact = {
  type: "command_planned";
  actor: SystemActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    commandId: string;
    commandKey: string;
    commandType:
      | "render_source_registration_report"
      | "validate_ledger"
      | "render_ledger"
      | "render_ledger_approval"
      | "generate_plan"
      | "render_plan"
      | "baseline_review"
      | "generate_remediation"
      | "closure_review"
      | "export_terminal";
    reservation: BudgetReservation;
  };
};

export type LedgerSubmittedFact = {
  type: "ledger_submitted";
  actor: HumanActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    ledgerVersionId: string;
    ledgerArtifactId: string;
    contentHash: string;
  };
};

export type DownstreamInvalidatedFact = {
  type: "downstream_invalidated";
  actor: SystemActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    cause: {
      type: "ledger_revised";
      previousLedgerVersionId: string;
      nextLedgerVersionId: string;
    };
    affectedArtifactIds: string[];
    affectedGateIds: string[];
  };
};

export type SourceExclusionApprovedFact = {
  type: "source_exclusion_approved";
  actor: HumanActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: SourceExclusion;
};

export type LedgerApprovedFact = {
  type: "ledger_approved";
  actor: HumanActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    ledgerVersionId: string;
    coverageReportArtifactId: string;
    coverageReportContentHash: string;
    coverageValidatedStateVersion: number;
    coverageValidatedPolicyHash: string;
    approvalGateId: string;
    approvedBy: HumanActor;
  };
};

export type PlanningRequestedFact = {
  type: "planning_requested";
  actor: HumanActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    planPurposeId: string;
    plannerAssignment: ProviderModelAssignment;
    policyHash: string;
    budgetReservation: BudgetReservation;
  };
};

export type PlanVersionAcceptedFact = {
  type: "plan_version_accepted";
  actor: (ModelActor & { kind: "planner" }) | HumanActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    planVersionId: string;
    planArtifactId: string;
    planContentHash: string;
    sectionTransitionMapArtifactId: string;
    sectionTransitionMapContentHash: string;
    provenanceArtifactId: string;
    provenanceContentHash: string;
  };
};

export type ReviewAcceptedFact = {
  type: "review_accepted";
  actor: ModelActor & { kind: "reviewer" };
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    reviewId: string;
    reviewArtifactId: string;
    reviewContentHash: string;
    ledgerVersionId: string;
    ledgerContentHash: string;
    planVersionId: string;
    planContentHash: string;
    cycle: number;
    policyHash: string;
    reviewerAssignment: ProviderModelAssignment;
    promptArtifactId: string;
    promptContentHash: string;
    schemaArtifactId: string;
    schemaContentHash: string;
    originatingCommandId: string;
    observationIds: string[];
  };
};

export type FindingCreatedFact = {
  type: "finding_created";
  actor: SystemActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    findingId: string;
    initialObservationId: string;
    severity: FindingSeverity;
    ruleId: string;
  };
};

export type RunHaltedFact = {
  type: "run_halted";
  actor: SystemActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    haltedFrom: NonterminalRunState["state"];
    failedCommandId: string;
    failedPurposeId: string;
    failureClassification: ProviderOutcomeFailed["failureClassification"];
    attemptIds: string[];
    unresolvedFindingIds: string[];
    bounds: ProviderOutcomeFailed["recoveryBounds"];
    manifest: { producedByCommandId: string };
  };
};

export type IndependenceOverrideGrantedFact = {
  type: "independence_override_granted";
  actor: HumanActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    policyHash: string;
    normalReviewerAssignment: ProviderModelAssignment;
    overrideReviewerAssignment: ProviderModelAssignment;
    reason: string;
  };
};

export type RerunAuthorizedFact = {
  type: "rerun_authorized";
  actor: HumanActor;
  reason: string;
  evidence: Array<{
    kind: "rerun_authorization";
    commandId: string;
    attemptId: string;
    correlationId: string;
  }>;
  payload: {
    decisionId: string;
    commandId: string;
    attemptId: string;
    correlationId: string;
  };
};

export type ExternalEditFact = {
  type: "external_edit_detected" | "projection_restored";
  actor: SystemActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    projectionKind: "ledger" | "plan";
    expectedContentHash: string;
    actualContentHash: string;
  };
};

export type TransitionResult = {
  nextState: NonterminalRunState;
  commands: Array<
    | RenderSourceRegistrationReport
    | ValidateLedger
    | RenderLedger
    | RenderLedgerApproval
    | GeneratePlan
    | RenderPlan
    | BaselineReview
    | GenerateRemediation
    | ClosureReview
  >;
  auditFacts: Array<
    | RunStartedFact
    | SourceRegisteredFact
    | LedgerSubmittedFact
    | DownstreamInvalidatedFact
    | SourceExclusionApprovedFact
    | LedgerApprovedFact
    | PlanningRequestedFact
    | PlanVersionAcceptedFact
    | ReviewAcceptedFact
    | FindingCreatedFact
    | IndependenceOverrideGrantedFact
    | RerunAuthorizedFact
    | ExternalEditFact
    | CommandPlannedFact
  >;
};

export type TerminalTransitionResult = {
  nextState: HaltedRunState;
  commands: [ExportTerminal];
  auditFacts: [RunHaltedFact, CommandPlannedFact];
};

type LocalCommand =
  | RenderSourceRegistrationReport
  | ValidateLedger
  | RenderLedger
  | RenderLedgerApproval
  | RenderPlan
  | ExportTerminal;

type PlannedCommand =
  | LocalCommand
  | GeneratePlan
  | BaselineReview
  | GenerateRemediation
  | ClosureReview;

function zeroBudgetReservation(): BudgetReservation {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsdMicros: 0,
  };
}

function providerBudgetIsEligible(
  maximum: BudgetReservation,
  available: BudgetReservation,
): boolean {
  return (
    maximum.calls === 1 &&
    Number.isInteger(maximum.inputTokens) &&
    maximum.inputTokens > 0 &&
    Number.isInteger(maximum.outputTokens) &&
    maximum.outputTokens > 0 &&
    Number.isInteger(maximum.costUsdMicros) &&
    maximum.costUsdMicros > 0 &&
    Number.isInteger(available.calls) &&
    Number.isInteger(available.inputTokens) &&
    Number.isInteger(available.outputTokens) &&
    Number.isInteger(available.costUsdMicros) &&
    available.calls >= maximum.calls &&
    available.inputTokens >= maximum.inputTokens &&
    available.outputTokens >= maximum.outputTokens &&
    available.costUsdMicros >= maximum.costUsdMicros
  );
}

function providerRequestPolicy(
  role: ProviderRequestPolicy["role"],
  prompt: Omit<ArtifactEvidenceReference, "kind">,
  schema: Omit<ArtifactEvidenceReference, "kind">,
  budget: BudgetReservation,
  timeoutMs: number,
  reasoning: string | null,
  configuration: Omit<ArtifactEvidenceReference, "kind">,
  policyHash: string,
): ProviderRequestPolicy {
  return {
    configurationArtifactId: configuration.artifactId,
    configurationContentHash: configuration.contentHash,
    policyHash,
    role,
    promptArtifactId: prompt.artifactId,
    promptContentHash: prompt.contentHash,
    outputSchemaArtifactId: schema.artifactId,
    outputSchemaContentHash: schema.contentHash,
    maxOutputTokens: budget.outputTokens,
    timeoutMs,
    reasoning,
    providerStorage: "minimize",
  };
}

function providerRequestSettingsAreValid(
  timeoutMs: number,
  reasoning: string | null,
  resolved: boolean,
): boolean {
  return (
    resolved &&
    Number.isInteger(timeoutMs) &&
    timeoutMs > 0 &&
    (reasoning === null || reasoning.trim().length > 0)
  );
}

function providerModelAssignmentIsValid(
  assignment: ProviderModelAssignment,
): boolean {
  return (
    (assignment.provider === "openai" || assignment.provider === "anthropic") &&
    assignment.modelId.length > 0
  );
}

function providerModelAssignmentsEqual(
  left: ProviderModelAssignment,
  right: ProviderModelAssignment,
): boolean {
  return left.provider === right.provider && left.modelId === right.modelId;
}

function planCommand<T extends PlannedCommand>(
  commandId: string,
  commandWithoutIdentity: Omit<T, "commandId" | "commandKey">,
): T {
  return {
    commandId,
    commandKey: createHash("sha256")
      .update(canonicalJson(commandWithoutIdentity))
      .digest("hex"),
    ...commandWithoutIdentity,
  } as T;
}

function artifactEvidence(
  artifactId: string,
  contentHash: string,
): ArtifactEvidenceReference {
  return { kind: "artifact", artifactId, contentHash };
}

function verifiedArtifactInputIsValid(
  artifact: VerifiedArtifactInput,
): boolean {
  return (
    artifact.verified &&
    artifact.artifactId.length > 0 &&
    /^[a-f0-9]{64}$/.test(artifact.contentHash)
  );
}

function commandPlannedFact(
  command: PlannedCommand,
  reason: string,
  evidence: ArtifactEvidenceReference[],
): CommandPlannedFact {
  return {
    type: "command_planned",
    actor: {
      kind: "system",
      component: "domain-transition",
      version: "0.0.0",
    },
    reason,
    evidence,
    payload: {
      commandId: command.commandId,
      commandKey: command.commandKey,
      commandType: command.commandType,
      reservation: command.budgetReservation,
    },
  };
}

type DomainTransitionErrorCode = "INVALID_TRANSITION" | "PRECONDITION_FAILED";

export class DomainTransitionError extends Error {
  readonly code: DomainTransitionErrorCode;

  constructor(code: DomainTransitionErrorCode, message: string) {
    super(message);
    this.name = "DomainTransitionError";
    this.code = code;
  }
}

type NonterminalDomainInput =
  | RunStarted
  | LedgerSubmitted
  | SourceExclusionApproved
  | LedgerApprovalRequested
  | PlanningRequested
  | PlanGenerated
  | PlanSubmitted
  | ReviewAccepted
  | IndependenceOverrideGranted
  | RerunAuthorized
  | ExternalEditDetected
  | ProjectionRestored;

function editInputIsTrusted(
  previousState: NonterminalRunState | null,
  input: ExternalEditDetected | ProjectionRestored,
): previousState is NonterminalRunState {
  return (
    previousState !== null &&
    previousState.runId === input.runId &&
    previousState.stateVersion === input.expectedStateVersion &&
    input.auditChainVerified &&
    input.databaseIntegrityVerified &&
    input.schemaCompatible &&
    input.mutationLeaseAvailable &&
    input.actor.kind === "system" &&
    input.actor.component.length > 0 &&
    input.actor.version.length > 0
  );
}

function authorizeRerun(
  previousState: NonterminalRunState | null,
  input: RerunAuthorized,
): TransitionResult {
  if (
    previousState === null ||
    previousState.runId !== input.runId ||
    previousState.stateVersion !== input.expectedStateVersion ||
    input.decisionId.trim().length === 0 ||
    input.commandId.trim().length === 0 ||
    input.attemptId.trim().length === 0 ||
    input.correlationId.trim().length === 0 ||
    input.reason.trim().length === 0 ||
    !input.auditChainVerified ||
    !input.databaseIntegrityVerified ||
    !input.schemaCompatible ||
    !input.mutationLeaseAvailable ||
    input.actor.kind !== "human" ||
    input.actor.displayName.trim().length === 0 ||
    input.actor.osAccount.trim().length === 0
  ) {
    throw new DomainTransitionError(
      "PRECONDITION_FAILED",
      "Rerun authorization requires a matching run and explicit human authority",
    );
  }
  const authorization = {
    kind: "rerun_authorization" as const,
    commandId: input.commandId,
    attemptId: input.attemptId,
    correlationId: input.correlationId,
  };
  return {
    nextState: {
      ...previousState,
      stateVersion: previousState.stateVersion + 1,
    },
    commands: [],
    auditFacts: [
      {
        type: "rerun_authorized",
        actor: input.actor,
        reason: input.reason,
        evidence: [authorization],
        payload: {
          decisionId: input.decisionId,
          commandId: input.commandId,
          attemptId: input.attemptId,
          correlationId: input.correlationId,
        },
      },
    ],
  };
}

function recordExternalEdit(
  previousState: NonterminalRunState | null,
  input: ExternalEditDetected,
): TransitionResult {
  if (
    !editInputIsTrusted(previousState, input) ||
    previousState.projectionBlock !== undefined ||
    !input.editedArtifact.verified ||
    input.editedArtifact.artifactId.length === 0 ||
    !/^[a-f0-9]{64}$/u.test(input.expectedContentHash) ||
    !/^[a-f0-9]{64}$/u.test(input.editedArtifact.contentHash) ||
    input.expectedContentHash === input.editedArtifact.contentHash
  ) {
    throw new DomainTransitionError(
      "PRECONDITION_FAILED",
      "External edit requires verified mismatched projection evidence",
    );
  }
  const nextState: NonterminalRunState = {
    ...previousState,
    stateVersion: previousState.stateVersion + 1,
    blockedReason: "external_projection_edit",
    projectionBlock: {
      projectionKind: input.projectionKind,
      expectedContentHash: input.expectedContentHash,
      editedArtifact: {
        artifactId: input.editedArtifact.artifactId,
        contentHash: input.editedArtifact.contentHash,
      },
    },
  };
  return {
    nextState,
    commands: [],
    auditFacts: [
      {
        type: "external_edit_detected",
        actor: input.actor,
        reason: "Working projection differs from the verified render",
        evidence: [
          artifactEvidence(
            input.editedArtifact.artifactId,
            input.editedArtifact.contentHash,
          ),
        ],
        payload: {
          projectionKind: input.projectionKind,
          expectedContentHash: input.expectedContentHash,
          actualContentHash: input.editedArtifact.contentHash,
        },
      },
    ],
  };
}

function restoreProjection(
  previousState: NonterminalRunState | null,
  input: ProjectionRestored,
): TransitionResult {
  if (
    !editInputIsTrusted(previousState, input) ||
    previousState.projectionBlock === undefined ||
    input.restoredContentHash !==
      previousState.projectionBlock.expectedContentHash
  ) {
    throw new DomainTransitionError(
      "PRECONDITION_FAILED",
      "Projection restoration must match the verified render",
    );
  }
  const block = previousState.projectionBlock;
  const { projectionBlock: _removed, ...unblocked } = previousState;
  void _removed;
  return {
    nextState: {
      ...unblocked,
      stateVersion: previousState.stateVersion + 1,
      blockedReason: null,
    },
    commands: [],
    auditFacts: [
      {
        type: "projection_restored",
        actor: input.actor,
        reason: "Working projection matches the verified render",
        evidence: [],
        payload: {
          projectionKind: block.projectionKind,
          expectedContentHash: block.expectedContentHash,
          actualContentHash: input.restoredContentHash,
        },
      },
    ],
  };
}

export function transition(
  previousState: NonterminalRunState | null,
  input: ProviderOutcomeFailed,
  policy: PinnedRunPolicy,
): TerminalTransitionResult;
export function transition(
  previousState: NonterminalRunState | null,
  input: NonterminalDomainInput,
  policy: PinnedRunPolicy,
): TransitionResult;
export function transition(
  previousState: NonterminalRunState | null,
  input: NonterminalDomainInput | ProviderOutcomeFailed,
  policy: PinnedRunPolicy,
): TransitionResult | TerminalTransitionResult {
  if (
    previousState?.projectionBlock !== undefined &&
    input.type !== "ProjectionRestored" &&
    !(
      input.type === "PlanSubmitted" &&
      previousState.projectionBlock.projectionKind === "plan"
    )
  ) {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "External projection edit must be reconciled before progression",
    );
  }
  switch (input.type) {
    case "RunStarted":
      return startRun(previousState, input, policy);
    case "LedgerSubmitted":
      return submitLedger(previousState, input, policy);
    case "SourceExclusionApproved":
      return approveSourceExclusion(previousState, input, policy);
    case "LedgerApprovalRequested":
      return approveLedger(previousState, input, policy);
    case "PlanningRequested":
      return requestPlanning(previousState, input, policy);
    case "PlanGenerated":
      return acceptPlanForBaseline(previousState, input, policy);
    case "PlanSubmitted":
      return acceptPlanForBaseline(previousState, input, policy);
    case "ReviewAccepted":
      return acceptBaselineReview(previousState, input, policy);
    case "ProviderOutcomeFailed":
      return haltAfterProviderFailure(previousState, input, policy);
    case "IndependenceOverrideGranted":
      return grantIndependenceOverride(previousState, input, policy);
    case "RerunAuthorized":
      return authorizeRerun(previousState, input);
    case "ExternalEditDetected":
      return recordExternalEdit(previousState, input);
    case "ProjectionRestored":
      return restoreProjection(previousState, input);
    default:
      throw new DomainTransitionError(
        "INVALID_TRANSITION",
        `Unsupported transition: ${String((input as { type: unknown }).type)}`,
      );
  }
}

function startRun(
  previousState: NonterminalRunState | null,
  input: RunStarted,
  policy: PinnedRunPolicy,
): TransitionResult {
  if (previousState !== null) {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "RunStarted requires no existing run",
    );
  }

  if (
    input.expectedStateVersion !== 0 ||
    !input.sourceObjectVerified ||
    !input.auditChainVerified ||
    !input.databaseIntegrityVerified ||
    !input.schemaCompatible ||
    !input.mutationLeaseAvailable ||
    input.actor.kind !== "human" ||
    input.actor.displayName.length === 0 ||
    input.actor.osAccount.length === 0
  ) {
    throw new DomainTransitionError(
      "PRECONDITION_FAILED",
      "RunStarted requires verified source and workspace integrity",
    );
  }

  const budgetReservation = zeroBudgetReservation();
  const commandWithoutIdentity = {
    commandType: "render_source_registration_report" as const,
    schemaVersion: 1 as const,
    runId: input.runId,
    triggeringStateVersion: 1 as const,
    purposeId: `${input.runId}:source-registration`,
    inputArtifactHashes: [
      input.sourceContentHash,
      input.configurationContentHash,
    ],
    policyHash: policy.policyHash,
    provider: "local" as const,
    budgetReservation,
    payload: {
      sourceArtifactId: input.sourceArtifactId,
    },
  };
  const command = planCommand<RenderSourceRegistrationReport>(
    input.renderCommandId,
    commandWithoutIdentity,
  );
  const sourceEvidence = artifactEvidence(
    input.sourceArtifactId,
    input.sourceContentHash,
  );
  const configurationEvidence = artifactEvidence(
    input.configurationArtifactId,
    input.configurationContentHash,
  );

  return {
    nextState: {
      runId: input.runId,
      state: "draft",
      stateVersion: 1,
      sourceArtifactId: input.sourceArtifactId,
      sourceContentHash: input.sourceContentHash,
      configurationArtifactId: input.configurationArtifactId,
      configurationContentHash: input.configurationContentHash,
      policyHash: policy.policyHash,
      policyLocked: false,
      blockedReason: null,
    },
    commands: [command],
    auditFacts: [
      {
        type: "run_started",
        actor: input.actor,
        reason: "Start a run from verified immutable source",
        evidence: [sourceEvidence, configurationEvidence],
        payload: {
          configurationHash: input.configurationContentHash,
          parentRunId: null,
          policyHash: policy.policyHash,
          sourceArtifactId: input.sourceArtifactId,
        },
      },
      {
        type: "source_registered",
        actor: input.actor,
        reason: "Register the verified source artifact for this run",
        evidence: [sourceEvidence],
        payload: {
          contentHash: input.sourceContentHash,
          provenancePath: input.sourceProvenancePath,
          sourceArtifactId: input.sourceArtifactId,
        },
      },
      commandPlannedFact(
        command,
        "Plan the deterministic source registration report",
        [sourceEvidence],
      ),
    ],
  };
}

function submitLedger(
  previousState: NonterminalRunState | null,
  input: LedgerSubmitted,
  policy: PinnedRunPolicy,
): TransitionResult {
  if (
    previousState === null ||
    !isNonterminalState(previousState.state) ||
    previousState.runId !== input.runId
  ) {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "LedgerSubmitted requires the matching nonterminal run",
    );
  }

  if (
    previousState.stateVersion !== input.expectedStateVersion ||
    (previousState.policyLocked &&
      previousState.policyHash !== policy.policyHash) ||
    previousState.currentLedger?.versionId === input.ledgerVersionId ||
    !input.ledgerObjectVerified ||
    !input.ledgerSchemaValid ||
    !input.sourceReferencesValid ||
    !input.auditChainVerified ||
    !input.databaseIntegrityVerified ||
    !input.schemaCompatible ||
    !input.mutationLeaseAvailable ||
    input.actor.kind !== "human" ||
    typeof input.actor.displayName !== "string" ||
    input.actor.displayName.length === 0 ||
    typeof input.actor.osAccount !== "string" ||
    input.actor.osAccount.length === 0
  ) {
    throw new DomainTransitionError(
      "PRECONDITION_FAILED",
      "LedgerSubmitted requires valid ledger and workspace evidence",
    );
  }

  const reservation = zeroBudgetReservation();
  const nextStateVersion = previousState.stateVersion + 1;
  const validateWithoutIdentity = {
    commandType: "validate_ledger" as const,
    schemaVersion: 1 as const,
    runId: input.runId,
    triggeringStateVersion: nextStateVersion,
    purposeId: `${input.runId}:ledger:${input.ledgerVersionId}:validate`,
    inputArtifactHashes: [
      input.ledgerContentHash,
      previousState.sourceContentHash,
    ],
    policyHash: policy.policyHash,
    provider: "local" as const,
    budgetReservation: reservation,
    payload: {
      ledgerVersionId: input.ledgerVersionId,
      ledgerArtifactId: input.ledgerArtifactId,
      sourceArtifactId: previousState.sourceArtifactId,
      ...(previousState.sourceExclusions === undefined
        ? {}
        : { sourceExclusions: previousState.sourceExclusions }),
    },
  };
  const renderWithoutIdentity = {
    commandType: "render_ledger" as const,
    schemaVersion: 1 as const,
    runId: input.runId,
    triggeringStateVersion: nextStateVersion,
    purposeId: `${input.runId}:ledger:${input.ledgerVersionId}:render`,
    inputArtifactHashes: [input.ledgerContentHash],
    policyHash: policy.policyHash,
    provider: "local" as const,
    budgetReservation: reservation,
    payload: {
      ledgerVersionId: input.ledgerVersionId,
      ledgerArtifactId: input.ledgerArtifactId,
    },
  };
  const validateCommand = planCommand<ValidateLedger>(
    input.validateCommandId,
    validateWithoutIdentity,
  );
  const renderCommand = planCommand<RenderLedger>(
    input.renderCommandId,
    renderWithoutIdentity,
  );
  const ledgerEvidence = artifactEvidence(
    input.ledgerArtifactId,
    input.ledgerContentHash,
  );
  const sourceEvidence = artifactEvidence(
    previousState.sourceArtifactId,
    previousState.sourceContentHash,
  );
  const downstreamInvalidatedFact: DownstreamInvalidatedFact | null =
    previousState.state === "draft"
      ? null
      : {
          type: "downstream_invalidated",
          actor: {
            kind: "system",
            component: "domain-transition",
            version: "0.0.0",
          },
          reason: "Invalidate downstream qualification after ledger revision",
          evidence: [
            {
              kind: "artifact",
              artifactId: previousState.currentLedger.artifactId,
              contentHash: previousState.currentLedger.contentHash,
            },
            ...previousState.downstreamQualification.artifacts,
          ],
          payload: {
            cause: {
              type: "ledger_revised",
              previousLedgerVersionId: previousState.currentLedger.versionId,
              nextLedgerVersionId: input.ledgerVersionId,
            },
            affectedArtifactIds:
              previousState.downstreamQualification.artifacts.map(
                (artifact) => artifact.artifactId,
              ),
            affectedGateIds: previousState.downstreamQualification.gateIds,
          },
        };

  return {
    nextState: {
      runId: previousState.runId,
      state: "draft",
      stateVersion: nextStateVersion,
      sourceArtifactId: previousState.sourceArtifactId,
      sourceContentHash: previousState.sourceContentHash,
      configurationArtifactId: previousState.configurationArtifactId,
      configurationContentHash: previousState.configurationContentHash,
      policyHash: policy.policyHash,
      policyLocked: previousState.policyLocked,
      blockedReason: null,
      ...(previousState.sourceExclusions === undefined
        ? {}
        : { sourceExclusions: previousState.sourceExclusions }),
      currentLedger: {
        versionId: input.ledgerVersionId,
        artifactId: input.ledgerArtifactId,
        contentHash: input.ledgerContentHash,
        validationStatus: "pending",
      },
    },
    commands: [validateCommand, renderCommand],
    auditFacts: [
      ...(downstreamInvalidatedFact === null
        ? []
        : [downstreamInvalidatedFact]),
      {
        type: "ledger_submitted",
        actor: input.actor,
        reason: "Submit a requirements ledger for validation and review",
        evidence: [ledgerEvidence, sourceEvidence],
        payload: {
          ledgerVersionId: input.ledgerVersionId,
          ledgerArtifactId: input.ledgerArtifactId,
          contentHash: input.ledgerContentHash,
        },
      },
      commandPlannedFact(validateCommand, "Plan validate_ledger", [
        ledgerEvidence,
      ]),
      commandPlannedFact(renderCommand, "Plan render_ledger", [ledgerEvidence]),
    ],
  };
}

function approveSourceExclusion(
  previousState: NonterminalRunState | null,
  input: SourceExclusionApproved,
  policy: PinnedRunPolicy,
): TransitionResult {
  if (
    previousState === null ||
    previousState.state !== "draft" ||
    previousState.runId !== input.runId
  ) {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "SourceExclusionApproved requires the matching draft run",
    );
  }

  if (
    previousState.stateVersion !== input.expectedStateVersion ||
    previousState.currentLedger === undefined ||
    (previousState.policyLocked &&
      previousState.policyHash !== policy.policyHash) ||
    !input.sourceRangeVerified ||
    !Number.isInteger(input.sourceRange.startOffset) ||
    !Number.isInteger(input.sourceRange.endOffset) ||
    input.sourceRange.startOffset < 0 ||
    input.sourceRange.endOffset <= input.sourceRange.startOffset ||
    input.reason.trim().length === 0 ||
    previousState.sourceExclusions?.some(
      (exclusion) => exclusion.exclusionId === input.exclusionId,
    ) === true ||
    !input.auditChainVerified ||
    !input.databaseIntegrityVerified ||
    !input.schemaCompatible ||
    !input.mutationLeaseAvailable ||
    input.actor.kind !== "human" ||
    typeof input.actor.displayName !== "string" ||
    input.actor.displayName.length === 0 ||
    typeof input.actor.osAccount !== "string" ||
    input.actor.osAccount.length === 0
  ) {
    throw new DomainTransitionError(
      "PRECONDITION_FAILED",
      "SourceExclusionApproved requires a verified span, reason, ledger, and workspace evidence",
    );
  }

  const sourceExclusion: SourceExclusion = {
    exclusionId: input.exclusionId,
    sourceRange: input.sourceRange,
    reason: input.reason,
  };
  const sourceExclusions = [
    ...(previousState.sourceExclusions ?? []),
    sourceExclusion,
  ];
  const nextStateVersion = previousState.stateVersion + 1;
  const reservation = zeroBudgetReservation();
  const commandWithoutIdentity = {
    commandType: "validate_ledger" as const,
    schemaVersion: 1 as const,
    runId: input.runId,
    triggeringStateVersion: nextStateVersion,
    purposeId: `${input.runId}:ledger:${previousState.currentLedger.versionId}:validate:exclusion:${input.exclusionId}`,
    inputArtifactHashes: [
      previousState.currentLedger.contentHash,
      previousState.sourceContentHash,
    ],
    policyHash: policy.policyHash,
    provider: "local" as const,
    budgetReservation: reservation,
    payload: {
      ledgerVersionId: previousState.currentLedger.versionId,
      ledgerArtifactId: previousState.currentLedger.artifactId,
      sourceArtifactId: previousState.sourceArtifactId,
      sourceExclusions,
    },
  };
  const command = planCommand<ValidateLedger>(
    input.validateCommandId,
    commandWithoutIdentity,
  );
  const sourceEvidence = artifactEvidence(
    previousState.sourceArtifactId,
    previousState.sourceContentHash,
  );
  const ledgerEvidence = artifactEvidence(
    previousState.currentLedger.artifactId,
    previousState.currentLedger.contentHash,
  );

  return {
    nextState: {
      ...previousState,
      stateVersion: nextStateVersion,
      policyHash: policy.policyHash,
      sourceExclusions,
      currentLedger: {
        ...previousState.currentLedger,
        validationStatus: "pending",
      },
    },
    commands: [command],
    auditFacts: [
      {
        type: "source_exclusion_approved",
        actor: input.actor,
        reason: "Approve a source exclusion and recompute ledger coverage",
        evidence: [sourceEvidence, ledgerEvidence],
        payload: sourceExclusion,
      },
      commandPlannedFact(
        command,
        "Recompute ledger coverage after source exclusion approval",
        [sourceEvidence, ledgerEvidence],
      ),
    ],
  };
}

function approveLedger(
  previousState: NonterminalRunState | null,
  input: LedgerApprovalRequested,
  policy: PinnedRunPolicy,
): TransitionResult {
  if (
    previousState === null ||
    previousState.state !== "draft" ||
    previousState.runId !== input.runId
  ) {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "LedgerApprovalRequested requires the matching draft run",
    );
  }

  if (
    previousState.stateVersion !== input.expectedStateVersion ||
    previousState.currentLedger === undefined ||
    input.validatedStateVersion !== previousState.stateVersion ||
    input.validatedLedgerVersionId !== previousState.currentLedger.versionId ||
    input.validatedLedgerContentHash !==
      previousState.currentLedger.contentHash ||
    input.validatedPolicyHash !== policy.policyHash ||
    (previousState.policyLocked &&
      previousState.policyHash !== policy.policyHash) ||
    !input.ledgerSchemaValid ||
    !input.lineageValid ||
    !input.identityValid ||
    !input.coverageComplete ||
    !input.coverageReportVerified ||
    typeof input.coverageReportArtifactId !== "string" ||
    input.coverageReportArtifactId.trim().length === 0 ||
    typeof input.coverageReportContentHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(input.coverageReportContentHash) ||
    input.approvalGateId.trim().length === 0 ||
    !input.auditChainVerified ||
    !input.databaseIntegrityVerified ||
    !input.schemaCompatible ||
    !input.mutationLeaseAvailable ||
    input.actor.kind !== "human" ||
    typeof input.actor.displayName !== "string" ||
    input.actor.displayName.length === 0 ||
    typeof input.actor.osAccount !== "string" ||
    input.actor.osAccount.length === 0
  ) {
    throw new DomainTransitionError(
      "PRECONDITION_FAILED",
      "LedgerApprovalRequested requires validated coverage and human approval",
    );
  }

  const nextStateVersion = previousState.stateVersion + 1;
  const reservation = zeroBudgetReservation();
  const sourceExclusions = previousState.sourceExclusions ?? [];
  const commandWithoutIdentity = {
    commandType: "render_ledger_approval" as const,
    schemaVersion: 1 as const,
    runId: input.runId,
    triggeringStateVersion: nextStateVersion,
    purposeId: `${input.runId}:ledger:${previousState.currentLedger.versionId}:approval`,
    inputArtifactHashes: [
      previousState.currentLedger.contentHash,
      input.coverageReportContentHash,
      previousState.sourceContentHash,
    ],
    policyHash: policy.policyHash,
    provider: "local" as const,
    budgetReservation: reservation,
    payload: {
      ledgerVersionId: previousState.currentLedger.versionId,
      ledgerArtifactId: previousState.currentLedger.artifactId,
      coverageReportArtifactId: input.coverageReportArtifactId,
      coverageValidatedStateVersion: input.validatedStateVersion,
      coverageValidatedPolicyHash: input.validatedPolicyHash,
      approvalGateId: input.approvalGateId,
      sourceExclusions,
      approvedBy: input.actor,
    },
  };
  const command = planCommand<RenderLedgerApproval>(
    input.renderCommandId,
    commandWithoutIdentity,
  );
  const ledgerEvidence = artifactEvidence(
    previousState.currentLedger.artifactId,
    previousState.currentLedger.contentHash,
  );
  const coverageEvidence = artifactEvidence(
    input.coverageReportArtifactId,
    input.coverageReportContentHash,
  );
  const sourceEvidence = artifactEvidence(
    previousState.sourceArtifactId,
    previousState.sourceContentHash,
  );

  return {
    nextState: {
      ...previousState,
      state: "requirements_approved",
      stateVersion: nextStateVersion,
      policyHash: policy.policyHash,
      currentLedger: {
        ...previousState.currentLedger,
        validationStatus: "approved",
      },
      downstreamQualification: {
        artifacts: [coverageEvidence],
        gateIds: [input.approvalGateId],
      },
    },
    commands: [command],
    auditFacts: [
      {
        type: "ledger_approved",
        actor: input.actor,
        reason: "Approve the validated requirements ledger",
        evidence: [ledgerEvidence, coverageEvidence],
        payload: {
          ledgerVersionId: previousState.currentLedger.versionId,
          coverageReportArtifactId: input.coverageReportArtifactId,
          coverageReportContentHash: input.coverageReportContentHash,
          coverageValidatedStateVersion: input.validatedStateVersion,
          coverageValidatedPolicyHash: input.validatedPolicyHash,
          approvalGateId: input.approvalGateId,
          approvedBy: input.actor,
        },
      },
      commandPlannedFact(command, "Render ledger approval evidence", [
        ledgerEvidence,
        coverageEvidence,
        sourceEvidence,
      ]),
    ],
  };
}

function requestPlanning(
  previousState: NonterminalRunState | null,
  input: PlanningRequested,
  policy: PinnedRunPolicy,
): TransitionResult {
  if (
    previousState === null ||
    previousState.state !== "requirements_approved" ||
    previousState.runId !== input.runId
  ) {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "PlanningRequested requires an approved requirements ledger",
    );
  }

  const budgetEligible = providerBudgetIsEligible(
    input.budgetReservation,
    input.availableBudget,
  );
  const sha256 = /^[a-f0-9]{64}$/;
  const actor = input.actor;
  const actorAuthorized =
    actor.kind === "human" &&
    typeof actor.displayName === "string" &&
    actor.displayName.length > 0 &&
    typeof actor.osAccount === "string" &&
    actor.osAccount.length > 0;

  if (
    input.expectedStateVersion !== previousState.stateVersion ||
    policy.policyHash !== previousState.policyHash ||
    !input.policyAccepted ||
    !input.budgetsAccepted ||
    !input.providerBoundaryAcknowledged ||
    !input.plannerModelAllowed ||
    !input.modelIdentityPinned ||
    !input.promptArtifactVerified ||
    !input.outputSchemaArtifactVerified ||
    !providerRequestSettingsAreValid(
      input.requestTimeoutMs,
      input.requestReasoning,
      input.requestPolicyResolved,
    ) ||
    input.planPurposeId.length === 0 ||
    input.plannerAssignment.modelId.length === 0 ||
    (input.plannerAssignment.provider !== "openai" &&
      input.plannerAssignment.provider !== "anthropic") ||
    input.promptArtifactId.length === 0 ||
    input.outputSchemaArtifactId.length === 0 ||
    !sha256.test(input.promptContentHash) ||
    !sha256.test(input.outputSchemaContentHash) ||
    !input.auditChainVerified ||
    !input.databaseIntegrityVerified ||
    !input.schemaCompatible ||
    !input.mutationLeaseAvailable ||
    !actorAuthorized ||
    !budgetEligible
  ) {
    throw new DomainTransitionError(
      "PRECONDITION_FAILED",
      "PlanningRequested requires accepted policy, verified provider inputs, and sufficient available budget",
    );
  }

  const nextStateVersion = previousState.stateVersion + 1;
  const commandWithoutIdentity = {
    commandType: "generate_plan" as const,
    schemaVersion: 1 as const,
    runId: input.runId,
    triggeringStateVersion: nextStateVersion,
    purposeId: input.planPurposeId,
    inputArtifactHashes: [
      previousState.currentLedger.contentHash,
      input.promptContentHash,
      input.outputSchemaContentHash,
    ],
    policyHash: policy.policyHash,
    provider: input.plannerAssignment.provider,
    modelId: input.plannerAssignment.modelId,
    budgetReservation: input.budgetReservation,
    providerRequestPolicy: providerRequestPolicy(
      "planner",
      {
        artifactId: input.promptArtifactId,
        contentHash: input.promptContentHash,
      },
      {
        artifactId: input.outputSchemaArtifactId,
        contentHash: input.outputSchemaContentHash,
      },
      input.budgetReservation,
      input.requestTimeoutMs,
      input.requestReasoning,
      {
        artifactId: previousState.configurationArtifactId,
        contentHash: previousState.configurationContentHash,
      },
      policy.policyHash,
    ),
    payload: {
      ledgerVersionId: previousState.currentLedger.versionId,
      ledgerArtifactId: previousState.currentLedger.artifactId,
      promptArtifactId: input.promptArtifactId,
      outputSchemaArtifactId: input.outputSchemaArtifactId,
      providerStorage: "minimize" as const,
    },
  };
  const command = planCommand<GeneratePlan>(
    input.generateCommandId,
    commandWithoutIdentity,
  );
  const evidence = [
    artifactEvidence(
      previousState.currentLedger.artifactId,
      previousState.currentLedger.contentHash,
    ),
    artifactEvidence(input.promptArtifactId, input.promptContentHash),
    artifactEvidence(
      input.outputSchemaArtifactId,
      input.outputSchemaContentHash,
    ),
  ];
  return {
    nextState: {
      ...previousState,
      state: "planning",
      stateVersion: nextStateVersion,
      policyLocked: true,
      activePlanning: {
        purposeId: input.planPurposeId,
        commandId: input.generateCommandId,
        plannerAssignment: input.plannerAssignment,
      },
    },
    commands: [command],
    auditFacts: [
      {
        type: "planning_requested",
        actor: input.actor,
        reason: "Request a plan from the assigned Planner",
        evidence,
        payload: {
          planPurposeId: input.planPurposeId,
          plannerAssignment: input.plannerAssignment,
          policyHash: policy.policyHash,
          budgetReservation: input.budgetReservation,
        },
      },
      commandPlannedFact(
        command,
        "Generate plan with the assigned Planner",
        evidence,
      ),
    ],
  };
}

function grantIndependenceOverride(
  previousState: NonterminalRunState | null,
  input: IndependenceOverrideGranted,
  policy: PinnedRunPolicy,
): TransitionResult {
  if (
    previousState === null ||
    previousState.state !== "requirements_approved" ||
    previousState.runId !== input.runId
  ) {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "IndependenceOverrideGranted requires a matching nonterminal run",
    );
  }

  if (
    input.expectedStateVersion !== previousState.stateVersion ||
    policy.policyHash !== previousState.policyHash ||
    !providerModelAssignmentsEqual(
      input.normalReviewerAssignment,
      policy.reviewerAssignment,
    ) ||
    previousState.reviewIndependenceOverride !== undefined ||
    !providerModelAssignmentIsValid(input.normalReviewerAssignment) ||
    !providerModelAssignmentIsValid(input.overrideReviewerAssignment) ||
    providerModelAssignmentsEqual(
      input.normalReviewerAssignment,
      input.overrideReviewerAssignment,
    ) ||
    !input.evidenceVerified ||
    !input.beforeProviderDispatchVerified ||
    input.evidenceArtifactId.length === 0 ||
    !/^[a-f0-9]{64}$/.test(input.evidenceContentHash) ||
    input.reason.trim().length === 0 ||
    !input.auditChainVerified ||
    !input.databaseIntegrityVerified ||
    !input.schemaCompatible ||
    !input.mutationLeaseAvailable ||
    input.actor.kind !== "human" ||
    input.actor.displayName.length === 0 ||
    input.actor.osAccount.length === 0
  ) {
    throw new DomainTransitionError(
      "PRECONDITION_FAILED",
      "IndependenceOverrideGranted requires verified human authority before provider dispatch",
    );
  }

  const evidence = artifactEvidence(
    input.evidenceArtifactId,
    input.evidenceContentHash,
  );
  return {
    nextState: {
      ...previousState,
      stateVersion: previousState.stateVersion + 1,
      reviewIndependenceOverride: {
        normalReviewerAssignment: input.normalReviewerAssignment,
        overrideReviewerAssignment: input.overrideReviewerAssignment,
        reason: input.reason,
        evidence: {
          artifactId: input.evidenceArtifactId,
          contentHash: input.evidenceContentHash,
        },
        actor: input.actor,
      },
    },
    commands: [],
    auditFacts: [
      {
        type: "independence_override_granted",
        actor: input.actor,
        reason: input.reason,
        evidence: [evidence],
        payload: {
          policyHash: policy.policyHash,
          normalReviewerAssignment: input.normalReviewerAssignment,
          overrideReviewerAssignment: input.overrideReviewerAssignment,
          reason: input.reason,
        },
      },
    ],
  };
}

function acceptPlanForBaseline(
  previousState: NonterminalRunState | null,
  input: PlanGenerated | PlanSubmitted,
  policy: PinnedRunPolicy,
): TransitionResult {
  if (
    previousState === null ||
    previousState.runId !== input.runId ||
    !(
      (input.type === "PlanGenerated" && previousState.state === "planning") ||
      (input.type === "PlanSubmitted" &&
        (previousState.state === "requirements_approved" ||
          (previousState.projectionBlock?.projectionKind === "plan" &&
            "currentLedger" in previousState &&
            previousState.currentLedger.validationStatus === "approved")))
    )
  ) {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "Plan acceptance requires the matching run and input state",
    );
  }
  if (previousState.state === "draft") {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "Plan acceptance requires an approved requirements ledger",
    );
  }

  const artifactsValid = [
    input.planArtifact,
    input.sectionTransitionMapArtifact,
    input.provenanceArtifact,
    input.reviewerPromptArtifact,
    input.reviewSchemaArtifact,
    input.taxonomyArtifact,
    input.componentRegistryArtifact,
    input.reviewPolicyArtifact,
  ].every(verifiedArtifactInputIsValid);
  const budgetEligible = providerBudgetIsEligible(
    input.reviewBudgetMaximum,
    input.availableBudget,
  );
  const actorAuthorized =
    input.type === "PlanGenerated"
      ? input.actor.kind === "planner" &&
        input.actor.provider === policy.plannerAssignment.provider &&
        input.actor.modelId === policy.plannerAssignment.modelId &&
        previousState.state === "planning" &&
        providerModelAssignmentsEqual(
          previousState.activePlanning.plannerAssignment,
          policy.plannerAssignment,
        )
      : input.actor.kind === "human" &&
        input.actor.displayName.length > 0 &&
        input.actor.osAccount.length > 0;
  const reviewerValid = providerModelAssignmentIsValid(
    input.reviewerAssignment,
  );
  const override = previousState.reviewIndependenceOverride;
  const expectedReviewerAssignment =
    input.type === "PlanGenerated" && override !== undefined
      ? override.overrideReviewerAssignment
      : policy.reviewerAssignment;
  const reviewerAssignmentMatchesPolicy = providerModelAssignmentsEqual(
    input.reviewerAssignment,
    expectedReviewerAssignment,
  );
  const providerIndependenceSatisfied =
    input.type === "PlanSubmitted" ||
    input.reviewerAssignment.provider !== policy.plannerAssignment.provider ||
    override !== undefined;
  const reducedIndependence =
    input.type === "PlanGenerated" && override !== undefined;
  const sectionTransitionValidation = input.sectionTransitionValidation;
  const sectionTransitionValid =
    sectionTransitionValidation.validator ===
      "deterministic-section-transition-v1" &&
    sectionTransitionValidation.validatedPlanContentHash ===
      input.planArtifact.contentHash &&
    sectionTransitionValidation.validatedTransitionMapContentHash ===
      input.sectionTransitionMapArtifact.contentHash &&
    sectionTransitionValidation.classificationsComplete &&
    sectionTransitionValidation.existingSectionIdsPreserved &&
    sectionTransitionValidation.onlyDeclaredNewSectionsAssignedIds;
  const plannerAttemptValid =
    input.type === "PlanSubmitted" ||
    (input.acceptedAttempt.validator === "accepted-provider-attempt-v1" &&
      input.acceptedAttempt.commandId === input.originatingCommandId &&
      input.acceptedAttempt.attemptId.length > 0 &&
      input.acceptedAttempt.requestArtifactId.length > 0 &&
      /^[a-f0-9]{64}$/u.test(input.acceptedAttempt.requestContentHash) &&
      input.acceptedAttempt.responseArtifactId.length > 0 &&
      /^[a-f0-9]{64}$/u.test(input.acceptedAttempt.responseContentHash) &&
      input.acceptedAttempt.rawResponseArtifactId.length > 0 &&
      /^[a-f0-9]{64}$/u.test(input.acceptedAttempt.rawResponseContentHash) &&
      input.acceptedAttempt.nativeUsageArtifactId.length > 0 &&
      /^[a-f0-9]{64}$/u.test(input.acceptedAttempt.nativeUsageContentHash));

  if (
    input.expectedStateVersion !== previousState.stateVersion ||
    policy.policyHash !== previousState.policyHash ||
    (input.type === "PlanGenerated" &&
      (previousState.state !== "planning" ||
        input.planPurposeId !== previousState.activePlanning.purposeId ||
        input.originatingCommandId !==
          previousState.activePlanning.commandId)) ||
    input.planVersionId.length === 0 ||
    !(input.type === "PlanGenerated"
      ? input.outputValid
      : input.canonicalSchemaValid) ||
    !sectionTransitionValid ||
    !plannerAttemptValid ||
    !input.reviewerModelAllowed ||
    !input.reviewerModelIdentityPinned ||
    !input.reviewerAssignmentAuthorized ||
    !providerRequestSettingsAreValid(
      input.reviewTimeoutMs,
      input.reviewReasoning,
      input.reviewRequestPolicyResolved,
    ) ||
    !reviewerValid ||
    !reviewerAssignmentMatchesPolicy ||
    !providerIndependenceSatisfied ||
    input.reviewPolicyArtifact.contentHash !== policy.policyHash ||
    !artifactsValid ||
    !input.auditChainVerified ||
    !input.databaseIntegrityVerified ||
    !input.schemaCompatible ||
    !input.mutationLeaseAvailable ||
    !actorAuthorized ||
    !budgetEligible ||
    input.renderCommandId.length === 0 ||
    input.reviewCommandId.length === 0 ||
    input.renderCommandId === input.reviewCommandId
  ) {
    throw new DomainTransitionError(
      "PRECONDITION_FAILED",
      "Plan acceptance requires verified canonical output, section continuity, and an authorized baseline review",
    );
  }

  const nextStateVersion = previousState.stateVersion + 1;
  const reviewPurposeId = `${input.runId}:plan:${input.planVersionId}:baseline:1`;
  const independence: ActiveReview["independence"] =
    reducedIndependence && override !== undefined
      ? {
          reduced: true,
          overrideEvidence: {
            artifactId: override.evidence.artifactId,
            contentHash: override.evidence.contentHash,
          },
        }
      : { reduced: false };
  const renderCommand = planCommand<RenderPlan>(input.renderCommandId, {
    commandType: "render_plan",
    schemaVersion: 1,
    runId: input.runId,
    triggeringStateVersion: nextStateVersion,
    purposeId: `${input.runId}:plan:${input.planVersionId}:render`,
    inputArtifactHashes: [input.planArtifact.contentHash],
    policyHash: policy.policyHash,
    provider: "local",
    budgetReservation: zeroBudgetReservation(),
    payload: {
      planVersionId: input.planVersionId,
      planArtifactId: input.planArtifact.artifactId,
    },
  });
  const reviewCommand = planCommand<BaselineReview>(input.reviewCommandId, {
    commandType: "baseline_review",
    schemaVersion: 1,
    runId: input.runId,
    triggeringStateVersion: nextStateVersion,
    prerequisiteCommandIds: [input.renderCommandId],
    purposeId: reviewPurposeId,
    inputArtifactHashes: [
      previousState.currentLedger.contentHash,
      input.planArtifact.contentHash,
      input.sectionTransitionMapArtifact.contentHash,
      input.provenanceArtifact.contentHash,
      input.reviewerPromptArtifact.contentHash,
      input.reviewSchemaArtifact.contentHash,
      input.taxonomyArtifact.contentHash,
      input.componentRegistryArtifact.contentHash,
      input.reviewPolicyArtifact.contentHash,
      ...previousState.downstreamQualification.artifacts.map(
        ({ contentHash }) => contentHash,
      ),
    ],
    policyHash: policy.policyHash,
    provider: input.reviewerAssignment.provider,
    modelId: input.reviewerAssignment.modelId,
    budgetReservation: input.reviewBudgetMaximum,
    providerRequestPolicy: providerRequestPolicy(
      "reviewer",
      {
        artifactId: input.reviewerPromptArtifact.artifactId,
        contentHash: input.reviewerPromptArtifact.contentHash,
      },
      {
        artifactId: input.reviewSchemaArtifact.artifactId,
        contentHash: input.reviewSchemaArtifact.contentHash,
      },
      input.reviewBudgetMaximum,
      input.reviewTimeoutMs,
      input.reviewReasoning,
      {
        artifactId: previousState.configurationArtifactId,
        contentHash: previousState.configurationContentHash,
      },
      policy.policyHash,
    ),
    payload: {
      ledgerVersionId: previousState.currentLedger.versionId,
      ledgerArtifactId: previousState.currentLedger.artifactId,
      planVersionId: input.planVersionId,
      planArtifactId: input.planArtifact.artifactId,
      renderPlanCommandId: input.renderCommandId,
      reviewerPromptArtifactId: input.reviewerPromptArtifact.artifactId,
      reviewSchemaArtifactId: input.reviewSchemaArtifact.artifactId,
      taxonomyArtifactId: input.taxonomyArtifact.artifactId,
      componentRegistryArtifactId: input.componentRegistryArtifact.artifactId,
      reviewPolicyArtifactId: input.reviewPolicyArtifact.artifactId,
      evidenceArtifactIds: [
        input.sectionTransitionMapArtifact.artifactId,
        input.provenanceArtifact.artifactId,
        input.taxonomyArtifact.artifactId,
        ...previousState.downstreamQualification.artifacts.map(
          ({ artifactId }) => artifactId,
        ),
      ],
      independence,
      providerStorage: "minimize",
    },
  });
  const planEvidence = artifactEvidence(
    input.planArtifact.artifactId,
    input.planArtifact.contentHash,
  );
  const transitionMapEvidence = artifactEvidence(
    input.sectionTransitionMapArtifact.artifactId,
    input.sectionTransitionMapArtifact.contentHash,
  );
  const provenanceEvidence = artifactEvidence(
    input.provenanceArtifact.artifactId,
    input.provenanceArtifact.contentHash,
  );
  const reviewEvidence = [
    artifactEvidence(
      previousState.currentLedger.artifactId,
      previousState.currentLedger.contentHash,
    ),
    planEvidence,
    transitionMapEvidence,
    provenanceEvidence,
    artifactEvidence(
      input.reviewerPromptArtifact.artifactId,
      input.reviewerPromptArtifact.contentHash,
    ),
    artifactEvidence(
      input.reviewSchemaArtifact.artifactId,
      input.reviewSchemaArtifact.contentHash,
    ),
    artifactEvidence(
      input.taxonomyArtifact.artifactId,
      input.taxonomyArtifact.contentHash,
    ),
    artifactEvidence(
      input.componentRegistryArtifact.artifactId,
      input.componentRegistryArtifact.contentHash,
    ),
    artifactEvidence(
      input.reviewPolicyArtifact.artifactId,
      input.reviewPolicyArtifact.contentHash,
    ),
    ...previousState.downstreamQualification.artifacts,
  ];
  if (independence.reduced) {
    reviewEvidence.push(
      artifactEvidence(
        independence.overrideEvidence.artifactId,
        independence.overrideEvidence.contentHash,
      ),
    );
  }

  const { projectionBlock: _projectionBlock, ...reconciledState } =
    previousState;
  void _projectionBlock;

  return {
    nextState: {
      ...reconciledState,
      state: "baseline_review",
      stateVersion: nextStateVersion,
      policyLocked: true,
      blockedReason: null,
      currentPlan: {
        versionId: input.planVersionId,
        artifactId: input.planArtifact.artifactId,
        contentHash: input.planArtifact.contentHash,
        sectionTransitionMap: {
          artifactId: input.sectionTransitionMapArtifact.artifactId,
          contentHash: input.sectionTransitionMapArtifact.contentHash,
        },
        provenance: {
          artifactId: input.provenanceArtifact.artifactId,
          contentHash: input.provenanceArtifact.contentHash,
        },
        origin:
          input.type === "PlanGenerated"
            ? {
                kind: "planner",
                assignment: policy.plannerAssignment,
                originatingCommandId: input.originatingCommandId,
              }
            : { kind: "human", actor: input.actor },
      },
      activeReview: {
        cycle: 1,
        commandId: input.reviewCommandId,
        renderCommandId: input.renderCommandId,
        reviewerAssignment: input.reviewerAssignment,
        reviewPurposeId,
        independence,
      },
      reviewContext: {
        prompt: {
          artifactId: input.reviewerPromptArtifact.artifactId,
          contentHash: input.reviewerPromptArtifact.contentHash,
        },
        schema: {
          artifactId: input.reviewSchemaArtifact.artifactId,
          contentHash: input.reviewSchemaArtifact.contentHash,
        },
        taxonomy: {
          artifactId: input.taxonomyArtifact.artifactId,
          contentHash: input.taxonomyArtifact.contentHash,
        },
        componentRegistry: {
          artifactId: input.componentRegistryArtifact.artifactId,
          contentHash: input.componentRegistryArtifact.contentHash,
        },
        policy: {
          artifactId: input.reviewPolicyArtifact.artifactId,
          contentHash: input.reviewPolicyArtifact.contentHash,
        },
        evidence: reviewEvidence,
      },
    },
    commands: [renderCommand, reviewCommand],
    auditFacts: [
      {
        type: "plan_version_accepted",
        actor: input.actor,
        reason:
          input.type === "PlanGenerated"
            ? "Accept the verified Planner output for baseline review"
            : "Accept the human-submitted canonical plan for baseline review",
        evidence: [planEvidence, transitionMapEvidence, provenanceEvidence],
        payload: {
          planVersionId: input.planVersionId,
          planArtifactId: input.planArtifact.artifactId,
          planContentHash: input.planArtifact.contentHash,
          sectionTransitionMapArtifactId:
            input.sectionTransitionMapArtifact.artifactId,
          sectionTransitionMapContentHash:
            input.sectionTransitionMapArtifact.contentHash,
          provenanceArtifactId: input.provenanceArtifact.artifactId,
          provenanceContentHash: input.provenanceArtifact.contentHash,
        },
      },
      commandPlannedFact(renderCommand, "Render the accepted plan", [
        planEvidence,
      ]),
      commandPlannedFact(
        reviewCommand,
        "Run independent baseline review",
        reviewEvidence,
      ),
    ],
  };
}

type BaselineReviewState = Extract<
  AdvancedRunState,
  { state: "baseline_review" }
>;

type ReconciledBaselineFindings = {
  findingIds: string[];
  observationIds: string[];
  blockingIds: Set<string>;
};

function reconcileBaselineFindings(
  state: BaselineReviewState,
  input: ReviewAccepted,
): ReconciledBaselineFindings | null {
  const reconciliation = input.reconciliation;
  const findingIds = input.findings.map(({ findingId }) => findingId);
  const observationIds = input.findings.map(
    ({ observationId }) => observationId,
  );
  const uniqueFindingIds = new Set(findingIds);
  const uniqueObservationIds = new Set(observationIds);
  const blockingIds = new Set(reconciliation.blockingFindingIds);
  const suppliedEvidenceKeys = new Set(
    [
      ...state.reviewContext.evidence,
      artifactEvidence(
        input.renderedPlanArtifact.artifactId,
        input.renderedPlanArtifact.contentHash,
      ),
    ].map(({ artifactId, contentHash }) => `${artifactId}:${contentHash}`),
  );
  const findingsValid = input.findings.every(
    ({ findingId, observationId, ruleId, severity, title, evidence }) =>
      findingId.length > 0 &&
      observationId.length > 0 &&
      ruleId.length > 0 &&
      ["critical", "high", "medium", "low"].includes(severity) &&
      title.trim().length > 0 &&
      evidence.length > 0 &&
      evidence.every(
        ({ kind, artifactId, contentHash }) =>
          kind === "artifact" &&
          artifactId.length > 0 &&
          /^[a-f0-9]{64}$/.test(contentHash) &&
          suppliedEvidenceKeys.has(`${artifactId}:${contentHash}`),
      ),
  );
  const outputValidation = input.outputValidation;
  const outputValidationValid =
    outputValidation.validator === "deterministic-review-output-v1" &&
    outputValidation.validatedReviewContentHash ===
      input.reviewArtifact.contentHash &&
    outputValidation.schemaValid &&
    outputValidation.taxonomyValid &&
    outputValidation.controlledIdsValid &&
    outputValidation.evidenceReferencesSupplied;
  const reconciliationValid =
    reconciliation.validator === "deterministic-finding-reconciliation-v1" &&
    reconciliation.validatedReviewContentHash ===
      input.reviewArtifact.contentHash &&
    reconciliation.priorFindingsAccountedFor &&
    reconciliation.ambiguousCandidatesResolved &&
    reconciliation.findingIdsAssignedByOrchestrator &&
    reconciliation.observationIdsUnique &&
    uniqueFindingIds.size === findingIds.length &&
    uniqueObservationIds.size === observationIds.length &&
    blockingIds.size === reconciliation.blockingFindingIds.length &&
    reconciliation.blockingFindingIds.every((findingId) =>
      uniqueFindingIds.has(findingId),
    );

  return findingsValid && outputValidationValid && reconciliationValid
    ? { findingIds, observationIds, blockingIds }
    : null;
}

function planAfterBaselineReview(
  state: BaselineReviewState,
  input: ReviewAccepted,
  policy: PinnedRunPolicy,
  nextStateVersion: number,
  findingIds: string[],
  blockingIds: Set<string>,
): GenerateRemediation | ClosureReview {
  const commonInputArtifactHashes = [
    state.currentLedger.contentHash,
    state.currentPlan.contentHash,
    input.reviewArtifact.contentHash,
    input.renderedPlanArtifact.contentHash,
    state.reviewContext.taxonomy.contentHash,
    state.reviewContext.componentRegistry.contentHash,
    state.reviewContext.policy.contentHash,
    ...state.reviewContext.evidence.map(({ contentHash }) => contentHash),
  ];
  const commonCommand = {
    schemaVersion: 1 as const,
    runId: input.runId,
    triggeringStateVersion: nextStateVersion,
    policyHash: policy.policyHash,
    budgetReservation: input.nextCommandBudgetMaximum,
  };

  return blockingIds.size > 0
    ? planCommand<GenerateRemediation>(input.nextCommandId, {
        ...commonCommand,
        commandType: "generate_remediation",
        inputArtifactHashes: [
          ...commonInputArtifactHashes,
          input.remediationPromptArtifact.contentHash,
          input.remediationSchemaArtifact.contentHash,
        ],
        purposeId: `${input.runId}:plan:${state.currentPlan.versionId}:remediation:1`,
        provider: policy.plannerAssignment.provider,
        modelId: policy.plannerAssignment.modelId,
        providerRequestPolicy: providerRequestPolicy(
          "planner",
          input.remediationPromptArtifact,
          input.remediationSchemaArtifact,
          input.nextCommandBudgetMaximum,
          input.nextCommandTimeoutMs,
          input.nextCommandReasoning,
          {
            artifactId: state.configurationArtifactId,
            contentHash: state.configurationContentHash,
          },
          policy.policyHash,
        ),
        payload: {
          ledgerVersionId: state.currentLedger.versionId,
          planVersionId: state.currentPlan.versionId,
          planArtifactId: state.currentPlan.artifactId,
          reviewArtifactId: input.reviewArtifact.artifactId,
          promptArtifactId: input.remediationPromptArtifact.artifactId,
          outputSchemaArtifactId: input.remediationSchemaArtifact.artifactId,
          blockingFindingIds: input.reconciliation.blockingFindingIds,
          providerStorage: "minimize",
        },
      })
    : planCommand<ClosureReview>(input.nextCommandId, {
        ...commonCommand,
        commandType: "closure_review",
        inputArtifactHashes: [
          ...commonInputArtifactHashes,
          state.reviewContext.prompt.contentHash,
          state.reviewContext.schema.contentHash,
        ],
        purposeId: `${input.runId}:plan:${state.currentPlan.versionId}:closure:1`,
        provider: state.activeReview.reviewerAssignment.provider,
        modelId: state.activeReview.reviewerAssignment.modelId,
        providerRequestPolicy: providerRequestPolicy(
          "reviewer",
          state.reviewContext.prompt,
          state.reviewContext.schema,
          input.nextCommandBudgetMaximum,
          input.nextCommandTimeoutMs,
          input.nextCommandReasoning,
          {
            artifactId: state.configurationArtifactId,
            contentHash: state.configurationContentHash,
          },
          policy.policyHash,
        ),
        payload: {
          ledgerVersionId: state.currentLedger.versionId,
          planVersionId: state.currentPlan.versionId,
          planArtifactId: state.currentPlan.artifactId,
          baselineReviewArtifactId: input.reviewArtifact.artifactId,
          renderedPlanArtifactId: input.renderedPlanArtifact.artifactId,
          reviewerPromptArtifactId: state.reviewContext.prompt.artifactId,
          reviewSchemaArtifactId: state.reviewContext.schema.artifactId,
          taxonomyArtifactId: state.reviewContext.taxonomy.artifactId,
          componentRegistryArtifactId:
            state.reviewContext.componentRegistry.artifactId,
          reviewPolicyArtifactId: state.reviewContext.policy.artifactId,
          evidenceArtifactIds: state.reviewContext.evidence.map(
            ({ artifactId }) => artifactId,
          ),
          findingIds,
          independence: state.activeReview.independence,
          providerStorage: "minimize",
        },
      });
}

function projectBaselineFindings(
  state: BaselineReviewState,
  input: ReviewAccepted,
  policy: PinnedRunPolicy,
): ActiveFinding[] {
  return input.findings.map((finding) => ({
    findingId: finding.findingId,
    latestObservationId: finding.observationId,
    severity: finding.severity,
    ruleId: finding.ruleId,
    title: finding.title,
    evidence: finding.evidence,
    status: "open",
    latestObservationContext: {
      reviewId: input.reviewId,
      ledgerVersionId: state.currentLedger.versionId,
      ledgerContentHash: state.currentLedger.contentHash,
      planVersionId: state.currentPlan.versionId,
      planContentHash: state.currentPlan.contentHash,
      policyHash: policy.policyHash,
      reviewerAssignment: state.activeReview.reviewerAssignment,
      prompt: state.reviewContext.prompt,
      schema: state.reviewContext.schema,
      cycle: input.reviewCycle,
      originatingCommandId: input.originatingCommandId,
    },
  }));
}

function findingCreatedFacts(
  findings: ActiveFinding[],
  reviewEvidence: ArtifactEvidenceReference,
): FindingCreatedFact[] {
  return findings.map((finding) => ({
    type: "finding_created",
    actor: {
      kind: "system",
      component: "finding-reconciliation",
      version: "0.0.0",
    },
    reason: "Create an authoritative finding from the accepted observation",
    evidence: [reviewEvidence, ...finding.evidence],
    payload: {
      findingId: finding.findingId,
      initialObservationId: finding.latestObservationId,
      severity: finding.severity,
      ruleId: finding.ruleId,
    },
  }));
}

function evolveAfterBaselineReview(
  state: BaselineReviewState,
  input: ReviewAccepted,
  policy: PinnedRunPolicy,
  nextStateVersion: number,
  findings: ActiveFinding[],
  command: GenerateRemediation | ClosureReview,
): AdvancedRunState {
  const renderedPlan = {
    artifactId: input.renderedPlanArtifact.artifactId,
    contentHash: input.renderedPlanArtifact.contentHash,
  };
  const activeReview: ActiveReview = {
    ...state.activeReview,
    cycle: command.commandType === "generate_remediation" ? 1 : 2,
    commandId: command.commandId,
    reviewPurposeId: command.purposeId,
  };
  const baselineReview: AcceptedBaselineReview = {
    reviewId: input.reviewId,
    artifactId: input.reviewArtifact.artifactId,
    contentHash: input.reviewArtifact.contentHash,
    cycle: input.reviewCycle,
    source: {
      artifactId: state.sourceArtifactId,
      contentHash: state.sourceContentHash,
    },
    configuration: {
      artifactId: state.configurationArtifactId,
      contentHash: state.configurationContentHash,
    },
    ledgerVersionId: state.currentLedger.versionId,
    ledger: {
      artifactId: state.currentLedger.artifactId,
      contentHash: state.currentLedger.contentHash,
    },
    planVersionId: state.currentPlan.versionId,
    plan: {
      artifactId: state.currentPlan.artifactId,
      contentHash: state.currentPlan.contentHash,
    },
    renderedPlan,
    policyHash: policy.policyHash,
    planOrigin: state.currentPlan.origin,
    plannerAssignment:
      state.currentPlan.origin.kind === "planner"
        ? state.currentPlan.origin.assignment
        : null,
    reviewerAssignment: state.activeReview.reviewerAssignment,
    independence: state.activeReview.independence,
    reviewContext: state.reviewContext,
    request: {
      artifactId: input.reviewRequestArtifact.artifactId,
      contentHash: input.reviewRequestArtifact.contentHash,
    },
    usage: {
      artifactId: input.providerUsageArtifact.artifactId,
      contentHash: input.providerUsageArtifact.contentHash,
    },
    findings,
    acceptedAttemptId: input.acceptedAttempt.attemptId,
  };

  return command.commandType === "generate_remediation"
    ? {
        ...state,
        state: "remediation",
        stateVersion: nextStateVersion,
        activeFindings: findings,
        activeReview,
        renderedPlan,
        baselineReview,
        activePlanning: {
          purposeId: command.purposeId,
          commandId: command.commandId,
          plannerAssignment: policy.plannerAssignment,
        },
      }
    : {
        ...state,
        state: "closure",
        stateVersion: nextStateVersion,
        activeFindings: findings,
        activeReview,
        renderedPlan,
        baselineReview,
      };
}

function reviewAcceptedFact(
  state: BaselineReviewState,
  input: ReviewAccepted,
  policy: PinnedRunPolicy,
  observationIds: string[],
  reviewEvidence: ArtifactEvidenceReference,
): ReviewAcceptedFact {
  return {
    type: "review_accepted",
    actor: input.actor,
    reason: "Accept and reconcile the verified baseline review",
    evidence: [
      reviewEvidence,
      artifactEvidence(
        input.reviewRequestArtifact.artifactId,
        input.reviewRequestArtifact.contentHash,
      ),
      artifactEvidence(
        input.providerUsageArtifact.artifactId,
        input.providerUsageArtifact.contentHash,
      ),
      artifactEvidence(
        state.currentPlan.artifactId,
        state.currentPlan.contentHash,
      ),
    ],
    payload: {
      reviewId: input.reviewId,
      reviewArtifactId: input.reviewArtifact.artifactId,
      reviewContentHash: input.reviewArtifact.contentHash,
      ledgerVersionId: state.currentLedger.versionId,
      ledgerContentHash: state.currentLedger.contentHash,
      planVersionId: state.currentPlan.versionId,
      planContentHash: state.currentPlan.contentHash,
      cycle: input.reviewCycle,
      policyHash: policy.policyHash,
      reviewerAssignment: state.activeReview.reviewerAssignment,
      promptArtifactId: state.reviewContext.prompt.artifactId,
      promptContentHash: state.reviewContext.prompt.contentHash,
      schemaArtifactId: state.reviewContext.schema.artifactId,
      schemaContentHash: state.reviewContext.schema.contentHash,
      originatingCommandId: input.originatingCommandId,
      observationIds,
    },
  };
}

function acceptBaselineReview(
  previousState: NonterminalRunState | null,
  input: ReviewAccepted,
  policy: PinnedRunPolicy,
): TransitionResult {
  if (
    previousState === null ||
    previousState.state !== "baseline_review" ||
    previousState.runId !== input.runId
  ) {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "ReviewAccepted requires the matching baseline-review run",
    );
  }

  const reconciled = reconcileBaselineFindings(previousState, input);
  const renderedPlanResolution = input.renderedPlanResolution;
  const renderedPlanResolutionValid =
    renderedPlanResolution.validator ===
      "verified-command-dependency-resolution-v1" &&
    renderedPlanResolution.renderCommandId ===
      previousState.activeReview.renderCommandId &&
    renderedPlanResolution.consumingReviewCommandId ===
      previousState.activeReview.commandId &&
    renderedPlanResolution.renderedPlanContentHash ===
      input.renderedPlanArtifact.contentHash &&
    renderedPlanResolution.canonicalPlanContentHash ===
      previousState.currentPlan.contentHash;
  const acceptedAttempt = input.acceptedAttempt;
  const acceptedAttemptValid =
    acceptedAttempt.validator === "accepted-provider-attempt-v1" &&
    acceptedAttempt.commandId === previousState.activeReview.commandId &&
    acceptedAttempt.attemptId.length > 0 &&
    acceptedAttempt.requestArtifactId ===
      input.reviewRequestArtifact.artifactId &&
    acceptedAttempt.requestContentHash ===
      input.reviewRequestArtifact.contentHash &&
    acceptedAttempt.responseArtifactId === input.reviewArtifact.artifactId &&
    acceptedAttempt.responseContentHash === input.reviewArtifact.contentHash &&
    acceptedAttempt.rawResponseArtifactId.length > 0 &&
    /^[a-f0-9]{64}$/u.test(acceptedAttempt.rawResponseContentHash) &&
    acceptedAttempt.nativeUsageArtifactId ===
      input.providerUsageArtifact.artifactId &&
    acceptedAttempt.nativeUsageContentHash ===
      input.providerUsageArtifact.contentHash;
  const reviewerAuthorized =
    input.actor.provider ===
      previousState.activeReview.reviewerAssignment.provider &&
    input.actor.modelId ===
      previousState.activeReview.reviewerAssignment.modelId;

  if (
    input.expectedStateVersion !== previousState.stateVersion ||
    input.reviewId.length === 0 ||
    input.reviewPurposeId !== previousState.activeReview.reviewPurposeId ||
    input.originatingCommandId !== previousState.activeReview.commandId ||
    !verifiedArtifactInputIsValid(input.reviewArtifact) ||
    !verifiedArtifactInputIsValid(input.reviewRequestArtifact) ||
    !verifiedArtifactInputIsValid(input.providerUsageArtifact) ||
    !acceptedAttemptValid ||
    !verifiedArtifactInputIsValid(input.renderedPlanArtifact) ||
    !renderedPlanResolutionValid ||
    input.reviewedPlanVersionId !== previousState.currentPlan.versionId ||
    input.reviewedPlanContentHash !== previousState.currentPlan.contentHash ||
    input.reviewedPolicyHash !== previousState.policyHash ||
    policy.policyHash !== previousState.policyHash ||
    input.reviewCycle !== previousState.activeReview.cycle ||
    !input.outputValid ||
    reconciled === null ||
    (reconciled !== null &&
      reconciled.blockingIds.size > 0 &&
      (!verifiedArtifactInputIsValid(input.remediationPromptArtifact) ||
        !verifiedArtifactInputIsValid(input.remediationSchemaArtifact))) ||
    !reviewerAuthorized ||
    !providerBudgetIsEligible(
      input.nextCommandBudgetMaximum,
      input.availableBudget,
    ) ||
    !providerRequestSettingsAreValid(
      input.nextCommandTimeoutMs,
      input.nextCommandReasoning,
      input.nextCommandRequestPolicyResolved,
    ) ||
    input.nextCommandId.length === 0 ||
    !input.auditChainVerified ||
    !input.databaseIntegrityVerified ||
    !input.schemaCompatible ||
    !input.mutationLeaseAvailable
  ) {
    throw new DomainTransitionError(
      "PRECONDITION_FAILED",
      "ReviewAccepted requires a verified, reconciled baseline review bound to the active plan and policy",
    );
  }

  const { findingIds, observationIds, blockingIds } = reconciled;

  const nextStateVersion = previousState.stateVersion + 1;
  const activeFindings = projectBaselineFindings(previousState, input, policy);
  const reviewEvidence = artifactEvidence(
    input.reviewArtifact.artifactId,
    input.reviewArtifact.contentHash,
  );
  const command = planAfterBaselineReview(
    previousState,
    input,
    policy,
    nextStateVersion,
    findingIds,
    blockingIds,
  );
  const findingFacts = findingCreatedFacts(activeFindings, reviewEvidence);
  const nextState = evolveAfterBaselineReview(
    previousState,
    input,
    policy,
    nextStateVersion,
    activeFindings,
    command,
  );
  const acceptedFact = reviewAcceptedFact(
    previousState,
    input,
    policy,
    observationIds,
    reviewEvidence,
  );

  return {
    nextState,
    commands: [command],
    auditFacts: [
      acceptedFact,
      ...findingFacts,
      commandPlannedFact(
        command,
        blockingIds.size > 0
          ? "Plan remediation for blocking findings"
          : "Run full-document closure review",
        [
          reviewEvidence,
          artifactEvidence(
            previousState.currentPlan.artifactId,
            previousState.currentPlan.contentHash,
          ),
        ],
      ),
    ],
  };
}

function haltAfterProviderFailure(
  previousState: NonterminalRunState | null,
  input: ProviderOutcomeFailed,
  policy: PinnedRunPolicy,
): TerminalTransitionResult {
  if (
    previousState === null ||
    (previousState.state !== "planning" &&
      previousState.state !== "baseline_review") ||
    previousState.runId !== input.runId
  ) {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "ProviderOutcomeFailed requires the matching planning or baseline-review run",
    );
  }

  const activeCommand =
    previousState.state === "planning"
      ? previousState.activePlanning
      : {
          commandId: previousState.activeReview.commandId,
          purposeId: previousState.activeReview.reviewPurposeId,
        };
  const attemptsUnique =
    new Set(input.attemptIds).size === input.attemptIds.length;
  const bounds = input.recoveryBounds;
  const boundsValid =
    [
      bounds.retryLimit,
      bounds.repairLimit,
      bounds.retriesUsed,
      bounds.repairsUsed,
    ].every((value) => Number.isInteger(value) && value >= 0) &&
    (previousState.state === "planning" ||
      (bounds.retriesUsed >= bounds.retryLimit &&
        bounds.repairsUsed >= bounds.repairLimit));
  const classificationValid = [
    "refusal",
    "invalid_output",
    "transport",
    "provider_error",
    "budget",
  ].includes(input.failureClassification);
  if (
    input.expectedStateVersion !== previousState.stateVersion ||
    input.failedCommandId !== activeCommand.commandId ||
    input.failedPurposeId !== activeCommand.purposeId ||
    (previousState.state === "baseline_review" &&
      !input.retryRepairExhausted) ||
    input.terminalPolicyDecision !== "halt" ||
    !classificationValid ||
    !boundsValid ||
    !verifiedArtifactInputIsValid(input.terminalPolicyDecisionArtifact) ||
    !verifiedArtifactInputIsValid(input.budgetReportArtifact) ||
    !verifiedArtifactInputIsValid(input.outcomeArtifact) ||
    !verifiedArtifactInputIsValid(input.diagnosticArtifact) ||
    input.outcomeArtifact.artifactId === input.diagnosticArtifact.artifactId ||
    input.attemptIds.length === 0 ||
    !attemptsUnique ||
    input.terminalReportCommandId.length === 0 ||
    input.reason.trim().length === 0 ||
    input.actor.component.length === 0 ||
    input.actor.version.length === 0 ||
    policy.policyHash !== previousState.policyHash ||
    !input.auditChainVerified ||
    !input.databaseIntegrityVerified ||
    !input.schemaCompatible ||
    !input.mutationLeaseAvailable
  ) {
    throw new DomainTransitionError(
      "PRECONDITION_FAILED",
      "ProviderOutcomeFailed requires exhausted recovery bounds and verified failure evidence for the active command",
    );
  }

  const nextStateVersion = previousState.stateVersion + 1;
  const coreEvidence = [
    artifactEvidence(
      previousState.sourceArtifactId,
      previousState.sourceContentHash,
    ),
    artifactEvidence(
      previousState.configurationArtifactId,
      previousState.configurationContentHash,
    ),
    artifactEvidence(
      previousState.currentLedger.artifactId,
      previousState.currentLedger.contentHash,
    ),
    artifactEvidence(
      input.outcomeArtifact.artifactId,
      input.outcomeArtifact.contentHash,
    ),
    artifactEvidence(
      input.diagnosticArtifact.artifactId,
      input.diagnosticArtifact.contentHash,
    ),
    artifactEvidence(
      input.terminalPolicyDecisionArtifact.artifactId,
      input.terminalPolicyDecisionArtifact.contentHash,
    ),
    artifactEvidence(
      input.budgetReportArtifact.artifactId,
      input.budgetReportArtifact.contentHash,
    ),
  ];
  const planEvidence =
    previousState.state === "baseline_review"
      ? [
          artifactEvidence(
            previousState.currentPlan.artifactId,
            previousState.currentPlan.contentHash,
          ),
          artifactEvidence(
            previousState.currentPlan.sectionTransitionMap.artifactId,
            previousState.currentPlan.sectionTransitionMap.contentHash,
          ),
          artifactEvidence(
            previousState.currentPlan.provenance.artifactId,
            previousState.currentPlan.provenance.contentHash,
          ),
          ...previousState.reviewContext.evidence,
        ]
      : [];
  const failureEvidence = [
    ...coreEvidence,
    ...previousState.downstreamQualification.artifacts,
    ...planEvidence,
  ];
  const independence: ActiveReview["independence"] =
    previousState.state === "baseline_review"
      ? previousState.activeReview.independence
      : previousState.reviewIndependenceOverride === undefined
        ? { reduced: false }
        : {
            reduced: true,
            overrideEvidence: previousState.reviewIndependenceOverride.evidence,
          };
  const unresolvedFindingIds: string[] = [];
  const command = planCommand<ExportTerminal>(input.terminalReportCommandId, {
    commandType: "export_terminal",
    schemaVersion: 1,
    runId: input.runId,
    triggeringStateVersion: nextStateVersion,
    purposeId: `${input.runId}:terminal-report:${nextStateVersion}`,
    inputArtifactHashes: failureEvidence.map(({ contentHash }) => contentHash),
    policyHash: policy.policyHash,
    provider: "local",
    budgetReservation: zeroBudgetReservation(),
    payload: {
      haltedFrom: previousState.state,
      reason: input.reason,
      failedCommandId: input.failedCommandId,
      failureClassification: input.failureClassification,
      attemptIds: input.attemptIds,
      evidenceArtifactIds: failureEvidence.map(({ artifactId }) => artifactId),
      unresolvedFindingIds,
      sourceArtifactId: previousState.sourceArtifactId,
      configurationArtifactId: previousState.configurationArtifactId,
      ledgerArtifactId: previousState.currentLedger.artifactId,
      planArtifactId:
        previousState.state === "baseline_review"
          ? previousState.currentPlan.artifactId
          : null,
      policyHash: policy.policyHash,
      plannerAssignment: policy.plannerAssignment,
      reviewerAssignment: policy.reviewerAssignment,
      budgetReportArtifactId: input.budgetReportArtifact.artifactId,
      recoveryBounds: bounds,
      independence,
      lineageArtifactIds: previousState.downstreamQualification.artifacts.map(
        ({ artifactId }) => artifactId,
      ),
      waiverIds: [],
      outcome: "halted",
    },
  });

  return {
    nextState: {
      ...previousState,
      state: "halted",
      stateVersion: nextStateVersion,
      haltedFrom: previousState.state,
      haltReason: input.reason,
      failureEvidence,
      attemptIds: input.attemptIds,
      unresolvedFindingIds,
    },
    commands: [command],
    auditFacts: [
      {
        type: "run_halted",
        actor: input.actor,
        reason: input.reason,
        evidence: failureEvidence,
        payload: {
          haltedFrom: previousState.state,
          failedCommandId: input.failedCommandId,
          failedPurposeId: input.failedPurposeId,
          failureClassification: input.failureClassification,
          attemptIds: input.attemptIds,
          unresolvedFindingIds,
          bounds,
          manifest: { producedByCommandId: command.commandId },
        },
      },
      commandPlannedFact(
        command,
        "Export the evidence-rich terminal report",
        failureEvidence,
      ),
    ],
  };
}

function isNonterminalState(state: string): boolean {
  return (
    state === "draft" ||
    state === "requirements_approved" ||
    state === "planning" ||
    state === "baseline_review" ||
    state === "remediation" ||
    state === "closure" ||
    state === "qualified" ||
    state === "qualified_with_waivers"
  );
}
