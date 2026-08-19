import { describe, expect, it, vi } from "vitest";

import type {
  AuthorityPort,
  PersistableTransition,
} from "../../src/application/authority-port.js";
import { completeProviderAttempt } from "../../src/application/complete-provider-attempt.js";
import type { AcceptedProviderCompletion } from "../../src/application/complete-provider-attempt.js";

import {
  transition,
  type AdvancedRunState,
  type DraftRunState,
  type IndependenceOverrideGranted,
  type LedgerApprovalRequested,
  type LedgerSubmitted,
  type PlanGenerated,
  type PlanSubmitted,
  type PlanningRequested,
  type PinnedModelUnavailable,
  type ProviderOutcomeFailed,
  type ReviewAccepted,
  type RunStarted,
  type SourceExclusionApproved,
  type ExternalEditDetected,
  type ProjectionRestored,
  type RerunAuthorized,
} from "../../src/domain/index.js";
import { createProvisionalBaselineExport } from "../../src/reporting/provisional-baseline.js";

const policyHash = "a".repeat(64);
const sourceContentHash = "b".repeat(64);
const configurationContentHash = "c".repeat(64);
const ledgerContentHash = "d".repeat(64);
const planContentHash = "e".repeat(64);
const reviewContentHash = "f".repeat(64);
const coverageReportContentHash = "0".repeat(64);
const plannerPromptContentHash = "3".repeat(64);
const planSchemaContentHash = "4".repeat(64);
const sectionMapContentHash = "5".repeat(64);
const reviewerPromptContentHash = "6".repeat(64);
const reviewSchemaContentHash = "7".repeat(64);
const componentRegistryContentHash = "8".repeat(64);
const taxonomyContentHash = "1".repeat(64);
const configuredReviewerAssignment = {
  provider: "anthropic" as const,
  modelId: "claude-frontier-pinned-20260801",
};
const configuredPlannerAssignment = {
  provider: "openai" as const,
  modelId: "gpt-5.6-2026-08-01",
};
const pinnedPolicy = {
  policyHash,
  plannerAssignment: configuredPlannerAssignment,
  reviewerAssignment: configuredReviewerAssignment,
};
function reviewContextFixture() {
  return {
    prompt: {
      artifactId: "artifact_reviewer_prompt_01JTEST",
      contentHash: reviewerPromptContentHash,
    },
    schema: {
      artifactId: "artifact_review_schema_01JTEST",
      contentHash: reviewSchemaContentHash,
    },
    taxonomy: {
      artifactId: "artifact_review_taxonomy_01JTEST",
      contentHash: taxonomyContentHash,
    },
    componentRegistry: {
      artifactId: "artifact_component_registry_01JTEST",
      contentHash: componentRegistryContentHash,
    },
    policy: {
      artifactId: "artifact_review_policy_01JTEST",
      contentHash: policyHash,
    },
    evidence: [
      {
        kind: "artifact" as const,
        artifactId: "artifact_plan_01JTEST",
        contentHash: planContentHash,
      },
    ],
  };
}
function policyWithHash(nextPolicyHash: string) {
  return {
    policyHash: nextPolicyHash,
    plannerAssignment: configuredPlannerAssignment,
    reviewerAssignment: configuredReviewerAssignment,
  };
}

function runStartedInput(): RunStarted {
  return {
    type: "RunStarted",
    runId: "run_01JTEST0000000000000000000",
    expectedStateVersion: 0,
    sourceArtifactId: "artifact_source_01JTEST",
    sourceContentHash,
    sourceProvenancePath: "/project/requirements.md",
    sourceObjectVerified: true,
    configurationArtifactId: "artifact_config_01JTEST",
    configurationContentHash,
    auditChainVerified: true,
    databaseIntegrityVerified: true,
    schemaCompatible: true,
    mutationLeaseAvailable: true,
    renderCommandId: "command_render_source_01JTEST",
    actor: {
      kind: "human",
      displayName: "Tigran",
      osAccount: "tig",
    },
  };
}

function ledgerSubmittedInput(): LedgerSubmitted {
  return {
    type: "LedgerSubmitted",
    runId: "run_01JTEST0000000000000000000",
    expectedStateVersion: 1,
    ledgerVersionId: "ledger_01JTEST",
    ledgerArtifactId: "artifact_ledger_01JTEST",
    ledgerContentHash,
    ledgerObjectVerified: true,
    ledgerSchemaValid: true,
    sourceReferencesValid: true,
    auditChainVerified: true,
    databaseIntegrityVerified: true,
    schemaCompatible: true,
    mutationLeaseAvailable: true,
    validateCommandId: "command_validate_ledger_01JTEST",
    renderCommandId: "command_render_ledger_01JTEST",
    actor: {
      kind: "human",
      displayName: "Tigran",
      osAccount: "tig",
    },
  };
}

function sourceExclusionApprovedInput(): SourceExclusionApproved {
  return {
    type: "SourceExclusionApproved",
    runId: "run_01JTEST0000000000000000000",
    expectedStateVersion: 2,
    exclusionId: "exclusion_01JTEST",
    sourceRange: { startOffset: 120, endOffset: 168 },
    sourceRangeVerified: true,
    reason:
      "Deployment instructions are operational guidance, not a requirement",
    auditChainVerified: true,
    databaseIntegrityVerified: true,
    schemaCompatible: true,
    mutationLeaseAvailable: true,
    validateCommandId: "command_validate_exclusion_01JTEST",
    actor: {
      kind: "human",
      displayName: "Tigran",
      osAccount: "tig",
    },
  };
}

function ledgerApprovalRequestedInput(): LedgerApprovalRequested {
  return {
    type: "LedgerApprovalRequested",
    runId: "run_01JTEST0000000000000000000",
    expectedStateVersion: 3,
    validatedStateVersion: 3,
    validatedLedgerVersionId: "ledger_01JTEST",
    validatedLedgerContentHash: ledgerContentHash,
    validatedPolicyHash: policyHash,
    ledgerSchemaValid: true,
    lineageValid: true,
    identityValid: true,
    coverageComplete: true,
    coverageReportArtifactId: "artifact_coverage_01JTEST",
    coverageReportContentHash,
    coverageReportVerified: true,
    approvalGateId: "gate_requirements_approval_01JTEST",
    auditChainVerified: true,
    databaseIntegrityVerified: true,
    schemaCompatible: true,
    mutationLeaseAvailable: true,
    renderCommandId: "command_render_approval_01JTEST",
    actor: {
      kind: "human",
      displayName: "Tigran",
      osAccount: "tig",
    },
  };
}

function planningRequestedInput(): PlanningRequested {
  return {
    type: "PlanningRequested",
    runId: "run_01JTEST0000000000000000000",
    expectedStateVersion: 4,
    planPurposeId: "purpose_plan_01JTEST",
    plannerAssignment: {
      provider: "openai",
      modelId: "gpt-5.6-2026-08-01",
    },
    plannerModelAllowed: true,
    modelIdentityPinned: true,
    policyAccepted: true,
    budgetsAccepted: true,
    providerBoundaryAcknowledged: true,
    promptArtifactId: "artifact_planner_prompt_01JTEST",
    promptContentHash: plannerPromptContentHash,
    promptArtifactVerified: true,
    outputSchemaArtifactId: "artifact_plan_schema_01JTEST",
    outputSchemaContentHash: planSchemaContentHash,
    outputSchemaArtifactVerified: true,
    requestTimeoutMs: 120_000,
    requestReasoning: "high",
    requestPolicyResolved: true,
    budgetReservation: {
      calls: 1,
      inputTokens: 24_000,
      outputTokens: 12_000,
      costUsdMicros: 8_000_000,
    },
    availableBudget: {
      calls: 3,
      inputTokens: 100_000,
      outputTokens: 40_000,
      costUsdMicros: 50_000_000,
    },
    auditChainVerified: true,
    databaseIntegrityVerified: true,
    schemaCompatible: true,
    mutationLeaseAvailable: true,
    generateCommandId: "command_generate_plan_01JTEST",
    actor: {
      kind: "human",
      displayName: "Tigran",
      osAccount: "tig",
    },
  };
}

function independenceOverrideGrantedInput(): IndependenceOverrideGranted {
  return {
    type: "IndependenceOverrideGranted",
    runId: "run_01JTEST0000000000000000000",
    expectedStateVersion: 4,
    normalReviewerAssignment: {
      provider: "anthropic",
      modelId: "claude-frontier-pinned-20260801",
    },
    overrideReviewerAssignment: {
      provider: "openai",
      modelId: "gpt-reviewer-pinned",
    },
    evidenceArtifactId: "artifact_independence_override_01JTEST",
    evidenceContentHash: "9".repeat(64),
    evidenceVerified: true,
    beforeProviderDispatchVerified: true,
    reason: "Anthropic Reviewer unavailable under the pinned policy",
    auditChainVerified: true,
    databaseIntegrityVerified: true,
    schemaCompatible: true,
    mutationLeaseAvailable: true,
    actor: {
      kind: "human",
      displayName: "Tigran",
      osAccount: "tig",
    },
  };
}

function planningState(): AdvancedRunState & { state: "planning" } {
  const result = transition(
    requirementsApprovedState(),
    planningRequestedInput(),
    pinnedPolicy,
  ).nextState;
  if (result.state !== "planning") {
    throw new Error("Expected planning state fixture");
  }
  return result;
}

function planGeneratedInput(): PlanGenerated {
  return {
    type: "PlanGenerated",
    runId: "run_01JTEST0000000000000000000",
    expectedStateVersion: 5,
    planPurposeId: "purpose_plan_01JTEST",
    originatingCommandId: "command_generate_plan_01JTEST",
    acceptedAttempt: {
      validator: "accepted-provider-attempt-v1",
      commandId: "command_generate_plan_01JTEST",
      attemptId: "attempt_generate_plan_01JTEST",
      requestArtifactId: "artifact_plan_request_01JTEST",
      requestContentHash: "b".repeat(64),
      responseArtifactId: "artifact_plan_01JTEST",
      responseContentHash: planContentHash,
      rawResponseArtifactId: "artifact_plan_raw_response_01JTEST",
      rawResponseContentHash: "c".repeat(64),
      nativeUsageArtifactId: "artifact_plan_usage_01JTEST",
      nativeUsageContentHash: "d".repeat(64),
    },
    planVersionId: "plan_version_01JTEST",
    planArtifact: {
      artifactId: "artifact_plan_01JTEST",
      contentHash: planContentHash,
      verified: true,
    },
    outputValid: true,
    sectionTransitionValidation: {
      validator: "deterministic-section-transition-v1",
      validatedPlanContentHash: planContentHash,
      validatedTransitionMapContentHash: sectionMapContentHash,
      classificationsComplete: true,
      existingSectionIdsPreserved: true,
      onlyDeclaredNewSectionsAssignedIds: true,
    },
    sectionTransitionMapArtifact: {
      artifactId: "artifact_section_map_01JTEST",
      contentHash: sectionMapContentHash,
      verified: true,
    },
    provenanceArtifact: {
      artifactId: "artifact_plan_provenance_01JTEST",
      contentHash: reviewContentHash,
      verified: true,
    },
    reviewerAssignment: {
      provider: "anthropic",
      modelId: "claude-frontier-pinned-20260801",
    },
    reviewerModelAllowed: true,
    reviewerModelIdentityPinned: true,
    reviewerAssignmentAuthorized: true,
    reviewPolicyArtifact: {
      artifactId: "artifact_review_policy_01JTEST",
      contentHash: policyHash,
      verified: true,
    },
    reviewerPromptArtifact: {
      artifactId: "artifact_reviewer_prompt_01JTEST",
      contentHash: reviewerPromptContentHash,
      verified: true,
    },
    reviewSchemaArtifact: {
      artifactId: "artifact_review_schema_01JTEST",
      contentHash: reviewSchemaContentHash,
      verified: true,
    },
    taxonomyArtifact: {
      artifactId: "artifact_review_taxonomy_01JTEST",
      contentHash: taxonomyContentHash,
      verified: true,
    },
    componentRegistryArtifact: {
      artifactId: "artifact_component_registry_01JTEST",
      contentHash: componentRegistryContentHash,
      verified: true,
    },
    reviewTimeoutMs: 120_000,
    reviewReasoning: "high",
    reviewRequestPolicyResolved: true,
    reviewBudgetMaximum: {
      calls: 1,
      inputTokens: 30_000,
      outputTokens: 12_000,
      costUsdMicros: 10_000_000,
    },
    availableBudget: {
      calls: 2,
      inputTokens: 70_000,
      outputTokens: 28_000,
      costUsdMicros: 40_000_000,
    },
    auditChainVerified: true,
    databaseIntegrityVerified: true,
    schemaCompatible: true,
    mutationLeaseAvailable: true,
    renderCommandId: "command_render_plan_01JTEST",
    reviewCommandId: "command_baseline_review_01JTEST",
    actor: {
      kind: "planner",
      provider: "openai",
      modelId: "gpt-5.6-2026-08-01",
    },
  };
}

function planSubmittedInput(): PlanSubmitted {
  const generated = planGeneratedInput();
  return {
    type: "PlanSubmitted",
    runId: generated.runId,
    expectedStateVersion: 4,
    planVersionId: generated.planVersionId,
    planArtifact: generated.planArtifact,
    canonicalSchemaValid: true,
    sectionTransitionValidation: generated.sectionTransitionValidation,
    sectionTransitionMapArtifact: generated.sectionTransitionMapArtifact,
    provenanceArtifact: generated.provenanceArtifact,
    reviewerAssignment: generated.reviewerAssignment,
    reviewerModelAllowed: generated.reviewerModelAllowed,
    reviewerModelIdentityPinned: generated.reviewerModelIdentityPinned,
    reviewerAssignmentAuthorized: generated.reviewerAssignmentAuthorized,
    reviewPolicyArtifact: generated.reviewPolicyArtifact,
    reviewerPromptArtifact: generated.reviewerPromptArtifact,
    reviewSchemaArtifact: generated.reviewSchemaArtifact,
    taxonomyArtifact: generated.taxonomyArtifact,
    componentRegistryArtifact: generated.componentRegistryArtifact,
    reviewTimeoutMs: generated.reviewTimeoutMs,
    reviewReasoning: generated.reviewReasoning,
    reviewRequestPolicyResolved: generated.reviewRequestPolicyResolved,
    reviewBudgetMaximum: generated.reviewBudgetMaximum,
    availableBudget: generated.availableBudget,
    auditChainVerified: true,
    databaseIntegrityVerified: true,
    schemaCompatible: true,
    mutationLeaseAvailable: true,
    renderCommandId: "command_render_submitted_plan_01JTEST",
    reviewCommandId: "command_review_submitted_plan_01JTEST",
    actor: {
      kind: "human",
      displayName: "Tigran",
      osAccount: "tig",
    },
  };
}

function baselineReviewState(): AdvancedRunState & {
  state: "baseline_review";
} {
  const result = transition(
    planningState(),
    planGeneratedInput(),
    pinnedPolicy,
  ).nextState;
  if (result.state !== "baseline_review") {
    throw new Error("Expected baseline review fixture");
  }
  return result;
}

function reviewAcceptedInput(blockingFindingIds: string[]): ReviewAccepted {
  return {
    type: "ReviewAccepted",
    runId: "run_01JTEST0000000000000000000",
    expectedStateVersion: 6,
    reviewId: "review_baseline_01JTEST",
    reviewPurposeId:
      "run_01JTEST0000000000000000000:plan:plan_version_01JTEST:baseline:1",
    originatingCommandId: "command_baseline_review_01JTEST",
    reviewArtifact: {
      artifactId: "artifact_review_baseline_01JTEST",
      contentHash: reviewContentHash,
      verified: true,
    },
    reviewRequestArtifact: {
      artifactId: "artifact_review_request_01JTEST",
      contentHash: "0".repeat(64),
      verified: true,
    },
    providerUsageArtifact: {
      artifactId: "artifact_review_usage_01JTEST",
      contentHash: "3".repeat(64),
      verified: true,
    },
    acceptedAttempt: {
      validator: "accepted-provider-attempt-v1",
      commandId: "command_baseline_review_01JTEST",
      attemptId: "attempt_baseline_review_01JTEST_1",
      requestArtifactId: "artifact_review_request_01JTEST",
      requestContentHash: "0".repeat(64),
      responseArtifactId: "artifact_review_baseline_01JTEST",
      responseContentHash: reviewContentHash,
      rawResponseArtifactId: "artifact_review_raw_response_01JTEST",
      rawResponseContentHash: "a".repeat(64),
      nativeUsageArtifactId: "artifact_review_usage_01JTEST",
      nativeUsageContentHash: "3".repeat(64),
    },
    renderedPlanArtifact: {
      artifactId: "artifact_rendered_plan_01JTEST",
      contentHash: "2".repeat(64),
      verified: true,
    },
    renderedPlanResolution: {
      validator: "verified-command-dependency-resolution-v1",
      renderCommandId: "command_render_plan_01JTEST",
      consumingReviewCommandId: "command_baseline_review_01JTEST",
      renderedPlanContentHash: "2".repeat(64),
      canonicalPlanContentHash: planContentHash,
    },
    reviewedPlanVersionId: "plan_version_01JTEST",
    reviewedPlanContentHash: planContentHash,
    reviewedPolicyHash: policyHash,
    reviewCycle: 1,
    outputValid: true,
    outputValidation: {
      validator: "deterministic-review-output-v1",
      validatedReviewContentHash: reviewContentHash,
      schemaValid: true,
      taxonomyValid: true,
      controlledIdsValid: true,
      evidenceReferencesSupplied: true,
    },
    findings: [
      {
        findingId: "finding_architecture_01JTEST",
        observationId: "observation_architecture_01JTEST",
        ruleId: "rule_architecture_boundary",
        severity: "high",
        title: "Boundary is underspecified",
        evidence: [
          {
            kind: "artifact",
            artifactId: "artifact_plan_01JTEST",
            contentHash: planContentHash,
          },
        ],
      },
    ],
    reconciliation: {
      validator: "deterministic-finding-reconciliation-v1",
      validatedReviewContentHash: reviewContentHash,
      priorFindingsAccountedFor: true,
      ambiguousCandidatesResolved: true,
      findingIdsAssignedByOrchestrator: true,
      observationIdsUnique: true,
      blockingFindingIds,
    },
    nextCommandId: "command_after_baseline_01JTEST",
    nextCommandBudgetMaximum: {
      calls: 1,
      inputTokens: 70_000,
      outputTokens: 28_000,
      costUsdMicros: 40_000_000,
    },
    nextCommandTimeoutMs: 120_000,
    nextCommandReasoning: "high",
    nextCommandRequestPolicyResolved: true,
    remediationPromptArtifact: {
      artifactId: "artifact_remediation_prompt_01JTEST",
      contentHash: "a".repeat(64),
      verified: true,
    },
    remediationSchemaArtifact: {
      artifactId: "artifact_remediation_schema_01JTEST",
      contentHash: "b".repeat(64),
      verified: true,
    },
    availableBudget: {
      calls: 2,
      inputTokens: 100_000,
      outputTokens: 40_000,
      costUsdMicros: 50_000_000,
    },
    auditChainVerified: true,
    databaseIntegrityVerified: true,
    schemaCompatible: true,
    mutationLeaseAvailable: true,
    actor: {
      kind: "reviewer",
      provider: "anthropic",
      modelId: "claude-frontier-pinned-20260801",
    },
  };
}

function providerOutcomeFailedInput(): ProviderOutcomeFailed {
  return {
    type: "ProviderOutcomeFailed",
    runId: "run_01JTEST0000000000000000000",
    expectedStateVersion: 5,
    failedCommandId: "command_generate_plan_01JTEST",
    failedPurposeId: "purpose_plan_01JTEST",
    retryRepairExhausted: true,
    failureClassification: "invalid_output",
    terminalPolicyDecision: "halt",
    terminalPolicyDecisionArtifact: {
      artifactId: "artifact_terminal_policy_decision_01JTEST",
      contentHash: "4".repeat(64),
      verified: true,
    },
    budgetReportArtifact: {
      artifactId: "artifact_budget_report_01JTEST",
      contentHash: "3".repeat(64),
      verified: true,
    },
    recoveryBounds: {
      retryLimit: 2,
      repairLimit: 1,
      retriesUsed: 2,
      repairsUsed: 1,
    },
    outcomeArtifact: {
      artifactId: "artifact_provider_failure_01JTEST",
      contentHash: "9".repeat(64),
      verified: true,
    },
    diagnosticArtifact: {
      artifactId: "artifact_provider_diagnostic_01JTEST",
      contentHash: "2".repeat(64),
      verified: true,
    },
    attemptIds: ["attempt_generate_plan_01JTEST_1"],
    terminalReportCommandId: "command_terminal_report_01JTEST",
    reason: "Provider output repair limit exhausted",
    auditChainVerified: true,
    databaseIntegrityVerified: true,
    schemaCompatible: true,
    mutationLeaseAvailable: true,
    actor: {
      kind: "system",
      component: "provider-executor",
      version: "0.0.0",
    },
  };
}

function advancedRunState(state: AdvancedRunState["state"]): AdvancedRunState {
  const draft = transition(null, runStartedInput(), pinnedPolicy).nextState;
  const base = {
    ...draft,
    stateVersion: 7,
    policyLocked: true as const,
    currentLedger: {
      versionId: "ledger_01JTEST",
      artifactId: "artifact_ledger_01JTEST",
      contentHash: ledgerContentHash,
      validationStatus: "approved" as const,
    },
    downstreamQualification: {
      artifacts: [
        {
          kind: "artifact" as const,
          artifactId: "artifact_plan_01JTEST",
          contentHash: planContentHash,
        },
        {
          kind: "artifact" as const,
          artifactId: "artifact_review_01JTEST",
          contentHash: reviewContentHash,
        },
      ],
      gateIds: ["gate_closure_01JTEST", "gate_qualification_01JTEST"],
    },
  };
  if (state === "planning") {
    return {
      ...base,
      state,
      activePlanning: {
        purposeId: "purpose_plan_01JTEST",
        commandId: "command_generate_plan_01JTEST",
        plannerAssignment: {
          provider: "openai",
          modelId: "gpt-5.6-2026-08-01",
        },
      },
    };
  }
  if (state === "baseline_review") {
    return {
      ...base,
      state,
      currentPlan: {
        versionId: "plan_version_01JTEST",
        artifactId: "artifact_plan_01JTEST",
        contentHash: planContentHash,
        sectionTransitionMap: {
          artifactId: "artifact_section_map_01JTEST",
          contentHash: sectionMapContentHash,
        },
        provenance: {
          artifactId: "artifact_plan_provenance_01JTEST",
          contentHash: reviewContentHash,
        },
        origin: {
          kind: "planner",
          assignment: configuredPlannerAssignment,
          originatingCommandId: "command_generate_plan_01JTEST",
        },
      },
      activeReview: {
        cycle: 1,
        commandId: "command_baseline_review_01JTEST",
        renderCommandId: "command_render_plan_01JTEST",
        reviewerAssignment: {
          provider: "anthropic",
          modelId: "claude-frontier-pinned-20260801",
        },
        reviewPurposeId:
          "run_01JTEST0000000000000000000:plan:plan_version_01JTEST:baseline:1",
        independence: { reduced: false },
      },
      reviewContext: reviewContextFixture(),
    };
  }
  if (state === "remediation" || state === "closure") {
    const reviewed = advancedRunState("baseline_review");
    if (reviewed.state !== "baseline_review") {
      throw new Error("Expected baseline review fixture");
    }
    const accepted = transition(
      reviewed,
      {
        ...reviewAcceptedInput(
          state === "remediation" ? ["finding_architecture_01JTEST"] : [],
        ),
        expectedStateVersion: reviewed.stateVersion,
      },
      pinnedPolicy,
    ).nextState;
    if (accepted.state !== state) {
      throw new Error(`Expected ${state} fixture`);
    }
    return accepted;
  }
  return { ...base, state };
}

function approvalReadyDraft(): DraftRunState {
  const draft = transition(null, runStartedInput(), pinnedPolicy).nextState;
  const ledgerDraft = transition(
    draft,
    ledgerSubmittedInput(),
    pinnedPolicy,
  ).nextState;
  const result = transition(
    ledgerDraft,
    sourceExclusionApprovedInput(),
    pinnedPolicy,
  ).nextState;
  if (result.state !== "draft") {
    throw new Error("expected draft state");
  }
  return result;
}

function requirementsApprovedState(): AdvancedRunState {
  const result = transition(
    approvalReadyDraft(),
    ledgerApprovalRequestedInput(),
    pinnedPolicy,
  ).nextState;
  if (result.state !== "requirements_approved") {
    throw new Error("expected requirements_approved state");
  }
  return result;
}

describe("transition", () => {
  it("starts a draft run from verified immutable source", () => {
    const result = transition(null, runStartedInput(), pinnedPolicy);

    expect(result).toEqual({
      nextState: {
        runId: "run_01JTEST0000000000000000000",
        state: "draft",
        stateVersion: 1,
        sourceArtifactId: "artifact_source_01JTEST",
        sourceContentHash,
        configurationArtifactId: "artifact_config_01JTEST",
        configurationContentHash,
        policyHash,
        policyLocked: false,
        blockedReason: null,
      },
      commands: [
        {
          commandId: "command_render_source_01JTEST",
          commandKey:
            "684db2024a706ffc91c075de8abdca100e1dc5d8164449c3f553beaa759fb7ba",
          commandType: "render_source_registration_report",
          schemaVersion: 1,
          runId: "run_01JTEST0000000000000000000",
          triggeringStateVersion: 1,
          purposeId: "run_01JTEST0000000000000000000:source-registration",
          inputArtifactHashes: [sourceContentHash, configurationContentHash],
          policyHash,
          provider: "local",
          budgetReservation: {
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsdMicros: 0,
          },
          payload: {
            sourceArtifactId: "artifact_source_01JTEST",
          },
        },
      ],
      auditFacts: [
        {
          type: "run_started",
          actor: {
            kind: "human",
            displayName: "Tigran",
            osAccount: "tig",
          },
          reason: "Start a run from verified immutable source",
          evidence: [
            {
              kind: "artifact",
              artifactId: "artifact_source_01JTEST",
              contentHash: sourceContentHash,
            },
            {
              kind: "artifact",
              artifactId: "artifact_config_01JTEST",
              contentHash: configurationContentHash,
            },
          ],
          payload: {
            configurationHash: configurationContentHash,
            parentRunId: null,
            policyHash,
            sourceArtifactId: "artifact_source_01JTEST",
          },
        },
        {
          type: "source_registered",
          actor: {
            kind: "human",
            displayName: "Tigran",
            osAccount: "tig",
          },
          reason: "Register the verified source artifact for this run",
          evidence: [
            {
              kind: "artifact",
              artifactId: "artifact_source_01JTEST",
              contentHash: sourceContentHash,
            },
          ],
          payload: {
            contentHash: sourceContentHash,
            provenancePath: "/project/requirements.md",
            sourceArtifactId: "artifact_source_01JTEST",
          },
        },
        {
          type: "command_planned",
          actor: {
            kind: "system",
            component: "domain-transition",
            version: "0.0.0",
          },
          reason: "Plan the deterministic source registration report",
          evidence: [
            {
              kind: "artifact",
              artifactId: "artifact_source_01JTEST",
              contentHash: sourceContentHash,
            },
          ],
          payload: {
            commandId: "command_render_source_01JTEST",
            commandKey:
              "684db2024a706ffc91c075de8abdca100e1dc5d8164449c3f553beaa759fb7ba",
            commandType: "render_source_registration_report",
            reservation: {
              calls: 0,
              inputTokens: 0,
              outputTokens: 0,
              costUsdMicros: 0,
            },
          },
        },
      ],
    });
  });

  it("rejects RunStarted when a run already exists", () => {
    const input = runStartedInput();
    const existingState = transition(null, input, pinnedPolicy).nextState;

    expect(() => transition(existingState, input, pinnedPolicy)).toThrowError(
      expect.objectContaining({
        code: "INVALID_TRANSITION",
        message: "RunStarted requires no existing run",
      }),
    );
  });

  it("rejects RunStarted when source verification is missing", () => {
    const input = { ...runStartedInput(), sourceObjectVerified: false };

    expect(() => transition(null, input, pinnedPolicy)).toThrowError(
      expect.objectContaining({
        code: "PRECONDITION_FAILED",
        message: "RunStarted requires verified source and workspace integrity",
      }),
    );
  });

  it.each([
    ["audit chain", { auditChainVerified: false }],
    ["database integrity", { databaseIntegrityVerified: false }],
    ["schema compatibility", { schemaCompatible: false }],
    ["mutation lease", { mutationLeaseAvailable: false }],
  ])("rejects RunStarted without %s verification", (_name, override) => {
    const input = { ...runStartedInput(), ...override };

    expect(() => transition(null, input, pinnedPolicy)).toThrowError(
      expect.objectContaining({ code: "PRECONDITION_FAILED" }),
    );
  });

  it("rejects RunStarted from an unauthorized actor", () => {
    const input = {
      ...runStartedInput(),
      actor: { kind: "human" as const, displayName: "", osAccount: "" },
    };

    expect(() => transition(null, input, pinnedPolicy)).toThrowError(
      expect.objectContaining({ code: "PRECONDITION_FAILED" }),
    );
  });

  it("rejects an unsupported transition discriminator at runtime", () => {
    const input = {
      ...runStartedInput(),
      type: "UnsupportedTransition",
    } as unknown as RunStarted;

    expect(() => transition(null, input, pinnedPolicy)).toThrowError(
      expect.objectContaining({
        code: "INVALID_TRANSITION",
        message: "Unsupported transition: UnsupportedTransition",
      }),
    );
  });

  it("submits a ledger for validation and rendering", () => {
    const draft = transition(null, runStartedInput(), pinnedPolicy).nextState;

    const result = transition(draft, ledgerSubmittedInput(), pinnedPolicy);

    expect(result.nextState).toEqual({
      ...draft,
      stateVersion: 2,
      currentLedger: {
        versionId: "ledger_01JTEST",
        artifactId: "artifact_ledger_01JTEST",
        contentHash: ledgerContentHash,
        validationStatus: "pending",
      },
    });
    expect(result.commands).toEqual([
      {
        commandId: "command_validate_ledger_01JTEST",
        commandKey:
          "121f18cceeb005ef8043b6ce47ad8c5aa3113eee4969b342b53c3cca4ec05254",
        commandType: "validate_ledger",
        schemaVersion: 1,
        runId: draft.runId,
        triggeringStateVersion: 2,
        purposeId: `${draft.runId}:ledger:ledger_01JTEST:validate`,
        inputArtifactHashes: [ledgerContentHash, sourceContentHash],
        policyHash,
        provider: "local",
        budgetReservation: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
        payload: {
          ledgerVersionId: "ledger_01JTEST",
          ledgerArtifactId: "artifact_ledger_01JTEST",
          sourceArtifactId: "artifact_source_01JTEST",
        },
      },
      {
        commandId: "command_render_ledger_01JTEST",
        commandKey:
          "99a4792a90958c4d9e6fe6be58357188ef858eab1c8dd8d21e0f19f7b8cea6bd",
        commandType: "render_ledger",
        schemaVersion: 1,
        runId: draft.runId,
        triggeringStateVersion: 2,
        purposeId: `${draft.runId}:ledger:ledger_01JTEST:render`,
        inputArtifactHashes: [ledgerContentHash],
        policyHash,
        provider: "local",
        budgetReservation: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
        payload: {
          ledgerVersionId: "ledger_01JTEST",
          ledgerArtifactId: "artifact_ledger_01JTEST",
        },
      },
    ]);
    expect(result.auditFacts).toEqual([
      {
        type: "ledger_submitted",
        actor: ledgerSubmittedInput().actor,
        reason: "Submit a requirements ledger for validation and review",
        evidence: [
          {
            kind: "artifact",
            artifactId: "artifact_ledger_01JTEST",
            contentHash: ledgerContentHash,
          },
          {
            kind: "artifact",
            artifactId: "artifact_source_01JTEST",
            contentHash: sourceContentHash,
          },
        ],
        payload: {
          ledgerVersionId: "ledger_01JTEST",
          ledgerArtifactId: "artifact_ledger_01JTEST",
          contentHash: ledgerContentHash,
        },
      },
      {
        type: "command_planned",
        actor: {
          kind: "system",
          component: "domain-transition",
          version: "0.0.0",
        },
        reason: "Plan validate_ledger",
        evidence: [
          {
            kind: "artifact",
            artifactId: "artifact_ledger_01JTEST",
            contentHash: ledgerContentHash,
          },
        ],
        payload: {
          commandId: "command_validate_ledger_01JTEST",
          commandKey:
            "121f18cceeb005ef8043b6ce47ad8c5aa3113eee4969b342b53c3cca4ec05254",
          commandType: "validate_ledger",
          reservation: {
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsdMicros: 0,
          },
        },
      },
      {
        type: "command_planned",
        actor: {
          kind: "system",
          component: "domain-transition",
          version: "0.0.0",
        },
        reason: "Plan render_ledger",
        evidence: [
          {
            kind: "artifact",
            artifactId: "artifact_ledger_01JTEST",
            contentHash: ledgerContentHash,
          },
        ],
        payload: {
          commandId: "command_render_ledger_01JTEST",
          commandKey:
            "99a4792a90958c4d9e6fe6be58357188ef858eab1c8dd8d21e0f19f7b8cea6bd",
          commandType: "render_ledger",
          reservation: {
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsdMicros: 0,
          },
        },
      },
    ]);
  });

  it.each<[string, (validInput: LedgerSubmitted) => LedgerSubmitted]>([
    [
      "a stale state version",
      (input) => ({ ...input, expectedStateVersion: 0 }),
    ],
    [
      "an unverified ledger object",
      (input) => ({ ...input, ledgerObjectVerified: false }),
    ],
    [
      "an invalid ledger schema",
      (input) => ({ ...input, ledgerSchemaValid: false }),
    ],
    [
      "invalid source references",
      (input) => ({ ...input, sourceReferencesValid: false }),
    ],
    [
      "an invalid audit chain",
      (input) => ({ ...input, auditChainVerified: false }),
    ],
    [
      "invalid database integrity",
      (input) => ({ ...input, databaseIntegrityVerified: false }),
    ],
    [
      "an incompatible schema",
      (input) => ({ ...input, schemaCompatible: false }),
    ],
    [
      "a conflicting mutation lease",
      (input) => ({ ...input, mutationLeaseAvailable: false }),
    ],
    [
      "a non-human actor",
      (input) =>
        ({
          ...input,
          actor: {
            kind: "system",
            component: "test-runner",
            version: "1.0.0",
          },
        }) as unknown as LedgerSubmitted,
    ],
    [
      "an empty actor display name",
      (input) => ({ ...input, actor: { ...input.actor, displayName: "" } }),
    ],
    [
      "an empty actor OS account",
      (input) => ({ ...input, actor: { ...input.actor, osAccount: "" } }),
    ],
  ])("rejects a ledger submission with %s", (_caseName, makeInvalid) => {
    const draft = transition(null, runStartedInput(), pinnedPolicy).nextState;
    const input = makeInvalid(ledgerSubmittedInput());

    expect(() => transition(draft, input, pinnedPolicy)).toThrowError(
      expect.objectContaining({ code: "PRECONDITION_FAILED" }),
    );
  });

  it.each<
    [string, () => unknown, "INVALID_TRANSITION" | "PRECONDITION_FAILED"]
  >([
    [
      "without an active draft run",
      () => transition(null, ledgerSubmittedInput(), pinnedPolicy),
      "INVALID_TRANSITION",
    ],
    [
      "for another run",
      () => {
        const draft = transition(
          null,
          runStartedInput(),
          pinnedPolicy,
        ).nextState;
        const input = { ...ledgerSubmittedInput(), runId: "run_other" };
        return transition(draft, input, pinnedPolicy);
      },
      "INVALID_TRANSITION",
    ],
    [
      "for the current ledger version",
      () => {
        const draft = transition(
          null,
          runStartedInput(),
          pinnedPolicy,
        ).nextState;
        const first = transition(draft, ledgerSubmittedInput(), pinnedPolicy);
        const replay = { ...ledgerSubmittedInput(), expectedStateVersion: 2 };
        return transition(first.nextState, replay, pinnedPolicy);
      },
      "PRECONDITION_FAILED",
    ],
    [
      "after the run is terminal",
      () => {
        const terminal = {
          ...advancedRunState("qualified"),
          state: "approved",
        } as unknown as AdvancedRunState;
        return transition(terminal, ledgerSubmittedInput(), pinnedPolicy);
      },
      "INVALID_TRANSITION",
    ],
  ])("rejects a ledger submission %s", (_caseName, submit, expectedCode) => {
    expect(submit).toThrowError(
      expect.objectContaining({ code: expectedCode }),
    );
  });

  it("advances the authoritative version for a revised ledger", () => {
    const draft = transition(null, runStartedInput(), pinnedPolicy).nextState;
    const first = transition(draft, ledgerSubmittedInput(), pinnedPolicy);
    const revision = {
      ...ledgerSubmittedInput(),
      expectedStateVersion: 2,
      ledgerVersionId: "ledger_02JTEST",
      ledgerArtifactId: "artifact_ledger_02JTEST",
      validateCommandId: "command_validate_ledger_02JTEST",
      renderCommandId: "command_render_ledger_02JTEST",
    };

    const second = transition(first.nextState, revision, pinnedPolicy);

    expect(second.nextState.stateVersion).toBe(3);
    expect(second.commands).toEqual([
      expect.objectContaining({ triggeringStateVersion: 3 }),
      expect.objectContaining({ triggeringStateVersion: 3 }),
    ]);
  });

  it("invalidates downstream qualification when revising an advanced run", () => {
    const draft = transition(null, runStartedInput(), pinnedPolicy).nextState;
    const qualified = advancedRunState("qualified");
    const revision = {
      ...ledgerSubmittedInput(),
      expectedStateVersion: qualified.stateVersion,
      ledgerVersionId: "ledger_02JTEST",
      ledgerArtifactId: "artifact_ledger_02JTEST",
      validateCommandId: "command_validate_ledger_02JTEST",
      renderCommandId: "command_render_ledger_02JTEST",
    };

    const result = transition(qualified, revision, pinnedPolicy);

    expect(result.nextState).toEqual({
      runId: draft.runId,
      state: "draft",
      stateVersion: 8,
      sourceArtifactId: draft.sourceArtifactId,
      sourceContentHash,
      configurationArtifactId: draft.configurationArtifactId,
      configurationContentHash,
      policyHash,
      policyLocked: true,
      blockedReason: null,
      currentLedger: {
        versionId: "ledger_02JTEST",
        artifactId: "artifact_ledger_02JTEST",
        contentHash: ledgerContentHash,
        validationStatus: "pending",
      },
    });
    expect(result.auditFacts[0]).toEqual({
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
          artifactId: "artifact_ledger_01JTEST",
          contentHash: ledgerContentHash,
        },
        {
          kind: "artifact",
          artifactId: "artifact_plan_01JTEST",
          contentHash: planContentHash,
        },
        {
          kind: "artifact",
          artifactId: "artifact_review_01JTEST",
          contentHash: reviewContentHash,
        },
      ],
      payload: {
        cause: {
          type: "ledger_revised",
          previousLedgerVersionId: "ledger_01JTEST",
          nextLedgerVersionId: "ledger_02JTEST",
        },
        affectedArtifactIds: [
          "artifact_plan_01JTEST",
          "artifact_review_01JTEST",
        ],
        affectedGateIds: ["gate_closure_01JTEST", "gate_qualification_01JTEST"],
      },
    });
    expect(result.commands).toEqual([
      expect.objectContaining({ triggeringStateVersion: 8 }),
      expect.objectContaining({ triggeringStateVersion: 8 }),
    ]);
  });

  it.each<AdvancedRunState["state"]>([
    "requirements_approved",
    "planning",
    "baseline_review",
    "remediation",
    "closure",
    "qualified",
    "qualified_with_waivers",
  ])("accepts a ledger revision from %s", (state) => {
    const previousState = advancedRunState(state);
    const revision = {
      ...ledgerSubmittedInput(),
      expectedStateVersion: previousState.stateVersion,
      ledgerVersionId: "ledger_02JTEST",
    };

    const result = transition(previousState, revision, pinnedPolicy);

    expect(result.nextState).toEqual(
      expect.objectContaining({
        state: "draft",
        stateVersion: previousState.stateVersion + 1,
        policyLocked: true,
      }),
    );
    expect(result.auditFacts[0]).toEqual(
      expect.objectContaining({ type: "downstream_invalidated" }),
    );
  });

  it("rejects a ledger revision that changes a locked policy", () => {
    const qualified = advancedRunState("qualified");
    const revision = {
      ...ledgerSubmittedInput(),
      expectedStateVersion: 7,
      ledgerVersionId: "ledger_02JTEST",
    };

    expect(() =>
      transition(qualified, revision, policyWithHash("f".repeat(64))),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("adopts a policy change when requirements approval is not yet locked", () => {
    const requirementsApproved: AdvancedRunState = {
      ...advancedRunState("requirements_approved"),
      state: "requirements_approved",
      policyLocked: false,
    };
    const revisedPolicyHash = "0".repeat(64);
    const revision = {
      ...ledgerSubmittedInput(),
      expectedStateVersion: 7,
      ledgerVersionId: "ledger_02JTEST",
    };

    const result = transition(
      requirementsApproved,
      revision,
      policyWithHash(revisedPolicyHash),
    );

    expect(result.nextState).toEqual(
      expect.objectContaining({
        policyHash: revisedPolicyHash,
        policyLocked: false,
      }),
    );
    expect(result.commands).toEqual([
      expect.objectContaining({ policyHash: revisedPolicyHash }),
      expect.objectContaining({ policyHash: revisedPolicyHash }),
    ]);
  });

  it("approves a source exclusion and recomputes ledger coverage", () => {
    const draft = transition(null, runStartedInput(), pinnedPolicy).nextState;
    const ledgerDraft = transition(
      draft,
      ledgerSubmittedInput(),
      pinnedPolicy,
    ).nextState;

    const result = transition(
      ledgerDraft,
      sourceExclusionApprovedInput(),
      pinnedPolicy,
    );

    expect(result.nextState).toEqual({
      ...ledgerDraft,
      stateVersion: 3,
      sourceExclusions: [
        {
          exclusionId: "exclusion_01JTEST",
          sourceRange: { startOffset: 120, endOffset: 168 },
          reason:
            "Deployment instructions are operational guidance, not a requirement",
        },
      ],
    });
    expect(result.commands).toEqual([
      {
        commandId: "command_validate_exclusion_01JTEST",
        commandKey:
          "59646ad50b130f7b583ea7040676fe58982bae3ab68238dddc1df22707bbd2b0",
        commandType: "validate_ledger",
        schemaVersion: 1,
        runId: ledgerDraft.runId,
        triggeringStateVersion: 3,
        purposeId: `${ledgerDraft.runId}:ledger:ledger_01JTEST:validate:exclusion:exclusion_01JTEST`,
        inputArtifactHashes: [ledgerContentHash, sourceContentHash],
        policyHash,
        provider: "local",
        budgetReservation: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
        payload: {
          ledgerVersionId: "ledger_01JTEST",
          ledgerArtifactId: "artifact_ledger_01JTEST",
          sourceArtifactId: "artifact_source_01JTEST",
          sourceExclusions: [
            {
              exclusionId: "exclusion_01JTEST",
              sourceRange: { startOffset: 120, endOffset: 168 },
              reason:
                "Deployment instructions are operational guidance, not a requirement",
            },
          ],
        },
      },
    ]);
    expect(result.auditFacts).toEqual([
      {
        type: "source_exclusion_approved",
        actor: sourceExclusionApprovedInput().actor,
        reason: "Approve a source exclusion and recompute ledger coverage",
        evidence: [
          {
            kind: "artifact",
            artifactId: "artifact_source_01JTEST",
            contentHash: sourceContentHash,
          },
          {
            kind: "artifact",
            artifactId: "artifact_ledger_01JTEST",
            contentHash: ledgerContentHash,
          },
        ],
        payload: {
          exclusionId: "exclusion_01JTEST",
          sourceRange: { startOffset: 120, endOffset: 168 },
          reason:
            "Deployment instructions are operational guidance, not a requirement",
        },
      },
      {
        type: "command_planned",
        actor: {
          kind: "system",
          component: "domain-transition",
          version: "0.0.0",
        },
        reason: "Recompute ledger coverage after source exclusion approval",
        evidence: [
          {
            kind: "artifact",
            artifactId: "artifact_source_01JTEST",
            contentHash: sourceContentHash,
          },
          {
            kind: "artifact",
            artifactId: "artifact_ledger_01JTEST",
            contentHash: ledgerContentHash,
          },
        ],
        payload: {
          commandId: "command_validate_exclusion_01JTEST",
          commandKey:
            "59646ad50b130f7b583ea7040676fe58982bae3ab68238dddc1df22707bbd2b0",
          commandType: "validate_ledger",
          reservation: {
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsdMicros: 0,
          },
        },
      },
    ]);
  });

  it.each<
    [string, (validInput: SourceExclusionApproved) => SourceExclusionApproved]
  >([
    [
      "a stale state version",
      (input) => ({ ...input, expectedStateVersion: 1 }),
    ],
    [
      "an unverified source range",
      (input) => ({ ...input, sourceRangeVerified: false }),
    ],
    [
      "a negative range start",
      (input) => ({
        ...input,
        sourceRange: { ...input.sourceRange, startOffset: -1 },
      }),
    ],
    [
      "a non-integer range boundary",
      (input) => ({
        ...input,
        sourceRange: { ...input.sourceRange, endOffset: 168.5 },
      }),
    ],
    [
      "an empty range",
      (input) => ({
        ...input,
        sourceRange: { startOffset: 120, endOffset: 120 },
      }),
    ],
    ["a blank reason", (input) => ({ ...input, reason: "  " })],
    [
      "an invalid audit chain",
      (input) => ({ ...input, auditChainVerified: false }),
    ],
    [
      "invalid database integrity",
      (input) => ({ ...input, databaseIntegrityVerified: false }),
    ],
    [
      "an incompatible schema",
      (input) => ({ ...input, schemaCompatible: false }),
    ],
    [
      "a conflicting mutation lease",
      (input) => ({ ...input, mutationLeaseAvailable: false }),
    ],
    [
      "a non-human actor",
      (input) =>
        ({
          ...input,
          actor: {
            kind: "system",
            component: "test-runner",
            version: "1.0.0",
          },
        }) as unknown as SourceExclusionApproved,
    ],
    [
      "an empty actor display name",
      (input) => ({ ...input, actor: { ...input.actor, displayName: "" } }),
    ],
    [
      "an empty actor OS account",
      (input) => ({ ...input, actor: { ...input.actor, osAccount: "" } }),
    ],
  ])("rejects source exclusion approval with %s", (_name, makeInvalid) => {
    const draft = transition(null, runStartedInput(), pinnedPolicy).nextState;
    const ledgerDraft = transition(
      draft,
      ledgerSubmittedInput(),
      pinnedPolicy,
    ).nextState;

    expect(() =>
      transition(
        ledgerDraft,
        makeInvalid(sourceExclusionApprovedInput()),
        pinnedPolicy,
      ),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it.each<
    [string, () => unknown, "INVALID_TRANSITION" | "PRECONDITION_FAILED"]
  >([
    [
      "without an active run",
      () => transition(null, sourceExclusionApprovedInput(), pinnedPolicy),
      "INVALID_TRANSITION",
    ],
    [
      "without a current ledger",
      () => {
        const draft = transition(
          null,
          runStartedInput(),
          pinnedPolicy,
        ).nextState;
        const input = {
          ...sourceExclusionApprovedInput(),
          expectedStateVersion: 1,
        };
        return transition(draft, input, pinnedPolicy);
      },
      "PRECONDITION_FAILED",
    ],
    [
      "for another run",
      () => {
        const draft = transition(
          null,
          runStartedInput(),
          pinnedPolicy,
        ).nextState;
        const ledgerDraft = transition(
          draft,
          ledgerSubmittedInput(),
          pinnedPolicy,
        ).nextState;
        const input = {
          ...sourceExclusionApprovedInput(),
          runId: "run_other",
        };
        return transition(ledgerDraft, input, pinnedPolicy);
      },
      "INVALID_TRANSITION",
    ],
    [
      "outside draft state",
      () =>
        transition(
          advancedRunState("requirements_approved"),
          { ...sourceExclusionApprovedInput(), expectedStateVersion: 7 },
          pinnedPolicy,
        ),
      "INVALID_TRANSITION",
    ],
    [
      "with a changed locked policy",
      () => {
        const draft = transition(
          null,
          runStartedInput(),
          pinnedPolicy,
        ).nextState;
        const ledgerDraft = transition(
          draft,
          ledgerSubmittedInput(),
          pinnedPolicy,
        ).nextState;
        return transition(
          { ...ledgerDraft, policyLocked: true },
          sourceExclusionApprovedInput(),
          policyWithHash("0".repeat(64)),
        );
      },
      "PRECONDITION_FAILED",
    ],
    [
      "with a duplicate exclusion ID",
      () => {
        const draft = transition(
          null,
          runStartedInput(),
          pinnedPolicy,
        ).nextState;
        const ledgerDraft = transition(
          draft,
          ledgerSubmittedInput(),
          pinnedPolicy,
        ).nextState;
        const first = transition(
          ledgerDraft,
          sourceExclusionApprovedInput(),
          pinnedPolicy,
        );
        return transition(
          first.nextState,
          { ...sourceExclusionApprovedInput(), expectedStateVersion: 3 },
          pinnedPolicy,
        );
      },
      "PRECONDITION_FAILED",
    ],
  ])("rejects source exclusion approval %s", (_name, approve, expectedCode) => {
    expect(approve).toThrowError(
      expect.objectContaining({ code: expectedCode }),
    );
  });

  it("accumulates exclusions and carries them into revised ledger validation", () => {
    const draft = transition(null, runStartedInput(), pinnedPolicy).nextState;
    const ledgerDraft = transition(
      draft,
      ledgerSubmittedInput(),
      pinnedPolicy,
    ).nextState;
    const first = transition(
      ledgerDraft,
      sourceExclusionApprovedInput(),
      pinnedPolicy,
    );
    const secondInput = {
      ...sourceExclusionApprovedInput(),
      expectedStateVersion: 3,
      exclusionId: "exclusion_02JTEST",
      sourceRange: { startOffset: 200, endOffset: 220 },
      reason: "Appendix heading has no normative content",
      validateCommandId: "command_validate_exclusion_02JTEST",
    };

    const second = transition(first.nextState, secondInput, pinnedPolicy);

    expect(second.nextState.sourceExclusions).toEqual([
      {
        exclusionId: "exclusion_01JTEST",
        sourceRange: { startOffset: 120, endOffset: 168 },
        reason:
          "Deployment instructions are operational guidance, not a requirement",
      },
      {
        exclusionId: "exclusion_02JTEST",
        sourceRange: { startOffset: 200, endOffset: 220 },
        reason: "Appendix heading has no normative content",
      },
    ]);
    const secondCommand = second.commands[0];
    if (secondCommand?.commandType !== "validate_ledger") {
      throw new Error("expected validate_ledger command");
    }
    expect(secondCommand.payload.sourceExclusions).toEqual(
      second.nextState.sourceExclusions,
    );
    expect(secondCommand.commandKey).not.toBe(first.commands[0]?.commandKey);

    const ledgerRevision = {
      ...ledgerSubmittedInput(),
      expectedStateVersion: 4,
      ledgerVersionId: "ledger_02JTEST",
      ledgerArtifactId: "artifact_ledger_02JTEST",
      validateCommandId: "command_validate_ledger_02JTEST",
      renderCommandId: "command_render_ledger_02JTEST",
    };
    const revised = transition(second.nextState, ledgerRevision, pinnedPolicy);

    expect(revised.nextState.sourceExclusions).toEqual(
      second.nextState.sourceExclusions,
    );
    const revisedValidationCommand = revised.commands[0];
    if (revisedValidationCommand?.commandType !== "validate_ledger") {
      throw new Error("expected validate_ledger command");
    }
    expect(revisedValidationCommand.payload.sourceExclusions).toEqual(
      second.nextState.sourceExclusions,
    );
  });

  it("approves a validated ledger and renders approval evidence", () => {
    const exclusionApproved = approvalReadyDraft();

    const result = transition(
      exclusionApproved,
      ledgerApprovalRequestedInput(),
      pinnedPolicy,
    );

    expect(result.nextState).toEqual({
      ...exclusionApproved,
      state: "requirements_approved",
      stateVersion: 4,
      currentLedger: {
        ...exclusionApproved.currentLedger,
        validationStatus: "approved",
      },
      downstreamQualification: {
        artifacts: [
          {
            kind: "artifact",
            artifactId: "artifact_coverage_01JTEST",
            contentHash: coverageReportContentHash,
          },
        ],
        gateIds: ["gate_requirements_approval_01JTEST"],
      },
    });
    expect(result.commands).toEqual([
      {
        commandId: "command_render_approval_01JTEST",
        commandKey:
          "33fd71d7b4745bfdd6362fde282f095826f005b895fac8532cbd906d45156690",
        commandType: "render_ledger_approval",
        schemaVersion: 1,
        runId: exclusionApproved.runId,
        triggeringStateVersion: 4,
        purposeId: `${exclusionApproved.runId}:ledger:ledger_01JTEST:approval`,
        inputArtifactHashes: [
          ledgerContentHash,
          coverageReportContentHash,
          sourceContentHash,
        ],
        policyHash,
        provider: "local",
        budgetReservation: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
        payload: {
          ledgerVersionId: "ledger_01JTEST",
          ledgerArtifactId: "artifact_ledger_01JTEST",
          coverageReportArtifactId: "artifact_coverage_01JTEST",
          coverageValidatedStateVersion: 3,
          coverageValidatedPolicyHash: policyHash,
          approvalGateId: "gate_requirements_approval_01JTEST",
          sourceExclusions: exclusionApproved.sourceExclusions,
          approvedBy: ledgerApprovalRequestedInput().actor,
        },
      },
    ]);
    expect(result.auditFacts[0]).toEqual({
      type: "ledger_approved",
      actor: ledgerApprovalRequestedInput().actor,
      reason: "Approve the validated requirements ledger",
      evidence: [
        {
          kind: "artifact",
          artifactId: "artifact_ledger_01JTEST",
          contentHash: ledgerContentHash,
        },
        {
          kind: "artifact",
          artifactId: "artifact_coverage_01JTEST",
          contentHash: coverageReportContentHash,
        },
      ],
      payload: {
        ledgerVersionId: "ledger_01JTEST",
        coverageReportArtifactId: "artifact_coverage_01JTEST",
        coverageReportContentHash,
        coverageValidatedStateVersion: 3,
        coverageValidatedPolicyHash: policyHash,
        approvalGateId: "gate_requirements_approval_01JTEST",
        approvedBy: ledgerApprovalRequestedInput().actor,
      },
    });
    expect(result.auditFacts[1]).toEqual({
      type: "command_planned",
      actor: {
        kind: "system",
        component: "domain-transition",
        version: "0.0.0",
      },
      reason: "Render ledger approval evidence",
      evidence: [
        {
          kind: "artifact",
          artifactId: "artifact_ledger_01JTEST",
          contentHash: ledgerContentHash,
        },
        {
          kind: "artifact",
          artifactId: "artifact_coverage_01JTEST",
          contentHash: coverageReportContentHash,
        },
        {
          kind: "artifact",
          artifactId: "artifact_source_01JTEST",
          contentHash: sourceContentHash,
        },
      ],
      payload: {
        commandId: "command_render_approval_01JTEST",
        commandKey:
          "33fd71d7b4745bfdd6362fde282f095826f005b895fac8532cbd906d45156690",
        commandType: "render_ledger_approval",
        reservation: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
      },
    });
  });

  it.each<
    [string, (validInput: LedgerApprovalRequested) => LedgerApprovalRequested]
  >([
    [
      "a stale state version",
      (input) => ({ ...input, expectedStateVersion: 2 }),
    ],
    [
      "an invalid ledger schema",
      (input) => ({ ...input, ledgerSchemaValid: false }),
    ],
    ["invalid lineage", (input) => ({ ...input, lineageValid: false })],
    ["invalid identity", (input) => ({ ...input, identityValid: false })],
    ["incomplete coverage", (input) => ({ ...input, coverageComplete: false })],
    [
      "an unverified coverage report",
      (input) => ({ ...input, coverageReportVerified: false }),
    ],
    [
      "an empty coverage report artifact ID",
      (input) => ({ ...input, coverageReportArtifactId: "" }),
    ],
    [
      "an invalid coverage report content hash",
      (input) => ({ ...input, coverageReportContentHash: "not-a-sha256" }),
    ],
    [
      "an empty approval gate ID",
      (input) => ({ ...input, approvalGateId: "" }),
    ],
    [
      "an invalid audit chain",
      (input) => ({ ...input, auditChainVerified: false }),
    ],
    [
      "invalid database integrity",
      (input) => ({ ...input, databaseIntegrityVerified: false }),
    ],
    [
      "an incompatible schema",
      (input) => ({ ...input, schemaCompatible: false }),
    ],
    [
      "a conflicting mutation lease",
      (input) => ({ ...input, mutationLeaseAvailable: false }),
    ],
    [
      "a non-human actor",
      (input) =>
        ({
          ...input,
          actor: {
            kind: "system",
            component: "test-runner",
            version: "1.0.0",
          },
        }) as unknown as LedgerApprovalRequested,
    ],
    [
      "an empty actor display name",
      (input) => ({ ...input, actor: { ...input.actor, displayName: "" } }),
    ],
    [
      "an empty actor OS account",
      (input) => ({ ...input, actor: { ...input.actor, osAccount: "" } }),
    ],
  ])("rejects ledger approval with %s", (_name, makeInvalid) => {
    expect(() =>
      transition(
        approvalReadyDraft(),
        makeInvalid(ledgerApprovalRequestedInput()),
        pinnedPolicy,
      ),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it.each<
    [string, () => unknown, "INVALID_TRANSITION" | "PRECONDITION_FAILED"]
  >([
    [
      "without an active run",
      () => transition(null, ledgerApprovalRequestedInput(), pinnedPolicy),
      "INVALID_TRANSITION",
    ],
    [
      "without a current ledger",
      () => {
        const draft = transition(
          null,
          runStartedInput(),
          pinnedPolicy,
        ).nextState;
        return transition(
          draft,
          { ...ledgerApprovalRequestedInput(), expectedStateVersion: 1 },
          pinnedPolicy,
        );
      },
      "PRECONDITION_FAILED",
    ],
    [
      "for another run",
      () =>
        transition(
          approvalReadyDraft(),
          { ...ledgerApprovalRequestedInput(), runId: "run_other" },
          pinnedPolicy,
        ),
      "INVALID_TRANSITION",
    ],
    [
      "outside draft state",
      () =>
        transition(
          advancedRunState("requirements_approved"),
          { ...ledgerApprovalRequestedInput(), expectedStateVersion: 7 },
          pinnedPolicy,
        ),
      "INVALID_TRANSITION",
    ],
    [
      "with a changed locked policy",
      () =>
        transition(
          { ...approvalReadyDraft(), policyLocked: true },
          ledgerApprovalRequestedInput(),
          policyWithHash("1".repeat(64)),
        ),
      "PRECONDITION_FAILED",
    ],
  ])("rejects ledger approval %s", (_name, approve, expectedCode) => {
    expect(approve).toThrowError(
      expect.objectContaining({ code: expectedCode }),
    );
  });

  it("makes approval evidence and its gate invalidatable by ledger revision", () => {
    const approved = transition(
      approvalReadyDraft(),
      ledgerApprovalRequestedInput(),
      pinnedPolicy,
    );
    const revision = {
      ...ledgerSubmittedInput(),
      expectedStateVersion: 4,
      ledgerVersionId: "ledger_02JTEST",
      ledgerArtifactId: "artifact_ledger_02JTEST",
      validateCommandId: "command_validate_ledger_02JTEST",
      renderCommandId: "command_render_ledger_02JTEST",
    };

    const revised = transition(approved.nextState, revision, pinnedPolicy);

    expect(revised.auditFacts[0]).toEqual(
      expect.objectContaining({
        type: "downstream_invalidated",
        payload: {
          cause: {
            type: "ledger_revised",
            previousLedgerVersionId: "ledger_01JTEST",
            nextLedgerVersionId: "ledger_02JTEST",
          },
          affectedArtifactIds: ["artifact_coverage_01JTEST"],
          affectedGateIds: ["gate_requirements_approval_01JTEST"],
        },
      }),
    );
  });

  it("adopts an unlocked policy change in approval state and evidence", () => {
    const revisedPolicyHash = "2".repeat(64);
    const approval = {
      ...ledgerApprovalRequestedInput(),
      validatedPolicyHash: revisedPolicyHash,
    };

    const result = transition(
      approvalReadyDraft(),
      approval,
      policyWithHash(revisedPolicyHash),
    );

    expect(result.nextState).toEqual(
      expect.objectContaining({
        state: "requirements_approved",
        policyHash: revisedPolicyHash,
        policyLocked: false,
      }),
    );
    expect(result.commands).toEqual([
      expect.objectContaining({ policyHash: revisedPolicyHash }),
    ]);
  });

  it("rejects coverage evidence validated under an earlier policy", () => {
    expect(() =>
      transition(
        approvalReadyDraft(),
        ledgerApprovalRequestedInput(),
        policyWithHash("2".repeat(64)),
      ),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("rejects coverage evidence produced for an earlier ledger revision", () => {
    const revision = {
      ...ledgerSubmittedInput(),
      expectedStateVersion: 3,
      ledgerVersionId: "ledger_02JTEST",
      ledgerArtifactId: "artifact_ledger_02JTEST",
      validateCommandId: "command_validate_ledger_02JTEST",
      renderCommandId: "command_render_ledger_02JTEST",
    };
    const revised = transition(approvalReadyDraft(), revision, pinnedPolicy);
    const staleCoverageApproval = {
      ...ledgerApprovalRequestedInput(),
      expectedStateVersion: 4,
    };

    expect(() =>
      transition(revised.nextState, staleCoverageApproval, pinnedPolicy),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("requests provider-backed planning with a maximum budget", () => {
    const approved = requirementsApprovedState();

    const result = transition(approved, planningRequestedInput(), pinnedPolicy);

    expect(result.nextState).toEqual({
      ...approved,
      state: "planning",
      stateVersion: 5,
      policyLocked: true,
      activePlanning: {
        purposeId: "purpose_plan_01JTEST",
        commandId: "command_generate_plan_01JTEST",
        plannerAssignment: {
          provider: "openai",
          modelId: "gpt-5.6-2026-08-01",
        },
      },
    });
    expect(result.commands).toEqual([
      expect.objectContaining({
        commandId: "command_generate_plan_01JTEST",
        commandType: "generate_plan",
        triggeringStateVersion: 5,
        purposeId: "purpose_plan_01JTEST",
        inputArtifactHashes: [
          ledgerContentHash,
          plannerPromptContentHash,
          planSchemaContentHash,
        ],
        policyHash,
        provider: "openai",
        modelId: "gpt-5.6-2026-08-01",
        budgetReservation: planningRequestedInput().budgetReservation,
        payload: {
          ledgerVersionId: "ledger_01JTEST",
          ledgerArtifactId: "artifact_ledger_01JTEST",
          promptArtifactId: "artifact_planner_prompt_01JTEST",
          outputSchemaArtifactId: "artifact_plan_schema_01JTEST",
          providerStorage: "minimize",
        },
      }),
    ]);
    expect(result.auditFacts[0]).toEqual({
      type: "planning_requested",
      actor: planningRequestedInput().actor,
      reason: "Request a plan from the assigned Planner",
      evidence: [
        {
          kind: "artifact",
          artifactId: "artifact_ledger_01JTEST",
          contentHash: ledgerContentHash,
        },
        {
          kind: "artifact",
          artifactId: "artifact_planner_prompt_01JTEST",
          contentHash: plannerPromptContentHash,
        },
        {
          kind: "artifact",
          artifactId: "artifact_plan_schema_01JTEST",
          contentHash: planSchemaContentHash,
        },
      ],
      payload: {
        planPurposeId: "purpose_plan_01JTEST",
        plannerAssignment: {
          provider: "openai",
          modelId: "gpt-5.6-2026-08-01",
        },
        policyHash,
        budgetReservation: planningRequestedInput().budgetReservation,
      },
    });
    const command = result.commands[0];
    expect(command?.commandKey).toMatch(/^[a-f0-9]{64}$/);
    expect(
      transition(approved, planningRequestedInput(), pinnedPolicy).commands[0]
        ?.commandKey,
    ).toBe(command?.commandKey);
    expect(result.auditFacts.slice(1)).toEqual([
      {
        type: "command_planned",
        actor: {
          kind: "system",
          component: "domain-transition",
          version: "0.0.0",
        },
        reason: "Generate plan with the assigned Planner",
        evidence: result.auditFacts[0]?.evidence,
        payload: {
          commandId: "command_generate_plan_01JTEST",
          commandKey: command?.commandKey,
          commandType: "generate_plan",
          reservation: planningRequestedInput().budgetReservation,
        },
      },
    ]);
  });

  it.each([
    ["stale state version", { expectedStateVersion: 3 }],
    ["unaccepted policy", { policyAccepted: false }],
    ["unaccepted budgets", { budgetsAccepted: false }],
    [
      "unacknowledged provider boundary",
      { providerBoundaryAcknowledged: false },
    ],
    ["unallowlisted Planner model", { plannerModelAllowed: false }],
    ["floating model identity", { modelIdentityPinned: false }],
    ["unverified prompt artifact", { promptArtifactVerified: false }],
    ["unverified schema artifact", { outputSchemaArtifactVerified: false }],
    ["invalid prompt hash", { promptContentHash: "not-a-sha256" }],
    ["invalid schema hash", { outputSchemaContentHash: "" }],
    ["missing prompt identity", { promptArtifactId: "" }],
    ["missing schema identity", { outputSchemaArtifactId: "" }],
    ["missing purpose", { planPurposeId: "" }],
    [
      "missing model identity",
      { plannerAssignment: { provider: "openai", modelId: "" } },
    ],
    ["unverified audit chain", { auditChainVerified: false }],
    ["failed database integrity", { databaseIntegrityVerified: false }],
    ["incompatible schema", { schemaCompatible: false }],
    ["conflicting mutation lease", { mutationLeaseAvailable: false }],
    [
      "unauthorized actor",
      { actor: { kind: "system", component: "test", version: "1" } },
    ],
    [
      "zero call reservation",
      {
        budgetReservation: {
          calls: 0,
          inputTokens: 24_000,
          outputTokens: 12_000,
          costUsdMicros: 8_000_000,
        },
      },
    ],
    [
      "fractional reservation",
      {
        budgetReservation: {
          calls: 1,
          inputTokens: 1.5,
          outputTokens: 12_000,
          costUsdMicros: 8_000_000,
        },
      },
    ],
    [
      "insufficient calls",
      {
        availableBudget: {
          calls: 0,
          inputTokens: 100_000,
          outputTokens: 40_000,
          costUsdMicros: 50_000_000,
        },
      },
    ],
    [
      "insufficient input tokens",
      {
        availableBudget: {
          calls: 3,
          inputTokens: 23_999,
          outputTokens: 40_000,
          costUsdMicros: 50_000_000,
        },
      },
    ],
    [
      "insufficient output tokens",
      {
        availableBudget: {
          calls: 3,
          inputTokens: 100_000,
          outputTokens: 11_999,
          costUsdMicros: 50_000_000,
        },
      },
    ],
    [
      "insufficient cost",
      {
        availableBudget: {
          calls: 3,
          inputTokens: 100_000,
          outputTokens: 40_000,
          costUsdMicros: 7_999_999,
        },
      },
    ],
  ])("rejects PlanningRequested with %s", (_name, override) => {
    const input = {
      ...planningRequestedInput(),
      ...override,
    } as PlanningRequested;

    expect(() =>
      transition(requirementsApprovedState(), input, pinnedPolicy),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("rejects PlanningRequested under a policy different from the approved policy", () => {
    expect(() =>
      transition(
        requirementsApprovedState(),
        planningRequestedInput(),
        policyWithHash("f".repeat(64)),
      ),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it.each([
    ["no run", null],
    ["a draft run", approvalReadyDraft()],
    ["a later nonterminal state", advancedRunState("baseline_review")],
  ])("rejects PlanningRequested from %s", (_name, state) => {
    expect(() =>
      transition(state, planningRequestedInput(), pinnedPolicy),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
  });

  it("rejects PlanningRequested for a different run", () => {
    expect(() =>
      transition(
        requirementsApprovedState(),
        {
          ...planningRequestedInput(),
          runId: "run_other",
        },
        pinnedPolicy,
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
  });

  it("accepts a generated plan and schedules independent baseline review", () => {
    const planning = planningState();

    const result = transition(planning, planGeneratedInput(), pinnedPolicy);

    expect(result.nextState).toEqual(
      expect.objectContaining({
        ...planning,
        state: "baseline_review",
        stateVersion: 6,
        currentPlan: {
          versionId: "plan_version_01JTEST",
          artifactId: "artifact_plan_01JTEST",
          contentHash: planContentHash,
          sectionTransitionMap: {
            artifactId: "artifact_section_map_01JTEST",
            contentHash: sectionMapContentHash,
          },
          provenance: {
            artifactId: "artifact_plan_provenance_01JTEST",
            contentHash: reviewContentHash,
          },
          origin: {
            kind: "planner",
            assignment: configuredPlannerAssignment,
            originatingCommandId: "command_generate_plan_01JTEST",
          },
        },
        activeReview: {
          cycle: 1,
          commandId: "command_baseline_review_01JTEST",
          renderCommandId: "command_render_plan_01JTEST",
          reviewerAssignment: planGeneratedInput().reviewerAssignment,
          reviewPurposeId:
            "run_01JTEST0000000000000000000:plan:plan_version_01JTEST:baseline:1",
          independence: { reduced: false },
        },
      }),
    );
    if (result.nextState.state !== "baseline_review") {
      throw new Error("Expected baseline review state");
    }
    expect(result.nextState.reviewContext.taxonomy).toEqual({
      artifactId: "artifact_review_taxonomy_01JTEST",
      contentHash: taxonomyContentHash,
    });
    expect(result.commands).toEqual([
      expect.objectContaining({
        commandId: "command_render_plan_01JTEST",
        commandType: "render_plan",
        triggeringStateVersion: 6,
        provider: "local",
        budgetReservation: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
        payload: {
          planVersionId: "plan_version_01JTEST",
          planArtifactId: "artifact_plan_01JTEST",
        },
      }),
      expect.objectContaining({
        commandId: "command_baseline_review_01JTEST",
        commandType: "baseline_review",
        triggeringStateVersion: 6,
        prerequisiteCommandIds: ["command_render_plan_01JTEST"],
        provider: "anthropic",
        modelId: "claude-frontier-pinned-20260801",
        budgetReservation: planGeneratedInput().reviewBudgetMaximum,
        payload: {
          ledgerVersionId: "ledger_01JTEST",
          ledgerArtifactId: "artifact_ledger_01JTEST",
          planVersionId: "plan_version_01JTEST",
          planArtifactId: "artifact_plan_01JTEST",
          renderPlanCommandId: "command_render_plan_01JTEST",
          reviewerPromptArtifactId: "artifact_reviewer_prompt_01JTEST",
          reviewSchemaArtifactId: "artifact_review_schema_01JTEST",
          taxonomyArtifactId: "artifact_review_taxonomy_01JTEST",
          componentRegistryArtifactId: "artifact_component_registry_01JTEST",
          reviewPolicyArtifactId: "artifact_review_policy_01JTEST",
          evidenceArtifactIds: [
            "artifact_section_map_01JTEST",
            "artifact_plan_provenance_01JTEST",
            "artifact_review_taxonomy_01JTEST",
            "artifact_coverage_01JTEST",
          ],
          independence: { reduced: false },
          providerStorage: "minimize",
        },
      }),
    ]);
    expect(result.auditFacts[0]).toEqual({
      type: "plan_version_accepted",
      actor: planGeneratedInput().actor,
      reason: "Accept the verified Planner output for baseline review",
      evidence: [
        {
          kind: "artifact",
          artifactId: "artifact_plan_01JTEST",
          contentHash: planContentHash,
        },
        {
          kind: "artifact",
          artifactId: "artifact_section_map_01JTEST",
          contentHash: sectionMapContentHash,
        },
        {
          kind: "artifact",
          artifactId: "artifact_plan_provenance_01JTEST",
          contentHash: reviewContentHash,
        },
      ],
      payload: {
        planVersionId: "plan_version_01JTEST",
        planArtifactId: "artifact_plan_01JTEST",
        planContentHash,
        sectionTransitionMapArtifactId: "artifact_section_map_01JTEST",
        sectionTransitionMapContentHash: sectionMapContentHash,
        provenanceArtifactId: "artifact_plan_provenance_01JTEST",
        provenanceContentHash: reviewContentHash,
      },
    });
  });

  it.each([
    ["a stale state version", { expectedStateVersion: 4 }],
    ["a different planning purpose", { planPurposeId: "purpose_other" }],
    ["a different command", { originatingCommandId: "command_other" }],
    [
      "an unverified plan",
      {
        planArtifact: { ...planGeneratedInput().planArtifact, verified: false },
      },
    ],
    ["invalid structured output", { outputValid: false }],
    [
      "invalid section continuity",
      {
        sectionTransitionValidation: {
          ...planGeneratedInput().sectionTransitionValidation,
          existingSectionIdsPreserved: false,
        },
      },
    ],
    [
      "an unverified transition map",
      {
        sectionTransitionMapArtifact: {
          ...planGeneratedInput().sectionTransitionMapArtifact,
          verified: false,
        },
      },
    ],
    [
      "unverified provenance",
      {
        provenanceArtifact: {
          ...planGeneratedInput().provenanceArtifact,
          verified: false,
        },
      },
    ],
    ["an unallowlisted Reviewer", { reviewerModelAllowed: false }],
    ["a floating Reviewer identity", { reviewerModelIdentityPinned: false }],
    [
      "a Reviewer different from pinned policy",
      {
        reviewerAssignment: {
          provider: "anthropic",
          modelId: "different-pinned-model",
        },
      },
    ],
    [
      "an unauthorized Reviewer assignment",
      { reviewerAssignmentAuthorized: false },
    ],
    [
      "an unverified review policy",
      {
        reviewPolicyArtifact: {
          ...planGeneratedInput().reviewPolicyArtifact,
          verified: false,
        },
      },
    ],
    [
      "an unverified Reviewer prompt",
      {
        reviewerPromptArtifact: {
          ...planGeneratedInput().reviewerPromptArtifact,
          verified: false,
        },
      },
    ],
    [
      "an unverified review schema",
      {
        reviewSchemaArtifact: {
          ...planGeneratedInput().reviewSchemaArtifact,
          verified: false,
        },
      },
    ],
    [
      "an unverified component registry",
      {
        componentRegistryArtifact: {
          ...planGeneratedInput().componentRegistryArtifact,
          verified: false,
        },
      },
    ],
    [
      "an invalid plan hash",
      {
        planArtifact: {
          ...planGeneratedInput().planArtifact,
          contentHash: "invalid",
        },
      },
    ],
    [
      "an invalid transition-map hash",
      {
        sectionTransitionMapArtifact: {
          ...planGeneratedInput().sectionTransitionMapArtifact,
          contentHash: "invalid",
        },
      },
    ],
    [
      "an invalid provenance hash",
      {
        provenanceArtifact: {
          ...planGeneratedInput().provenanceArtifact,
          contentHash: "invalid",
        },
      },
    ],
    [
      "an invalid Reviewer-prompt hash",
      {
        reviewerPromptArtifact: {
          ...planGeneratedInput().reviewerPromptArtifact,
          contentHash: "invalid",
        },
      },
    ],
    [
      "an invalid review-schema hash",
      {
        reviewSchemaArtifact: {
          ...planGeneratedInput().reviewSchemaArtifact,
          contentHash: "invalid",
        },
      },
    ],
    [
      "an invalid registry hash",
      {
        componentRegistryArtifact: {
          ...planGeneratedInput().componentRegistryArtifact,
          contentHash: "invalid",
        },
      },
    ],
    ["a missing plan version", { planVersionId: "" }],
    [
      "a missing plan artifact",
      {
        planArtifact: {
          ...planGeneratedInput().planArtifact,
          artifactId: "",
        },
      },
    ],
    [
      "a missing Reviewer model",
      { reviewerAssignment: { provider: "anthropic", modelId: "" } },
    ],
    ["an unverified audit chain", { auditChainVerified: false }],
    ["failed database integrity", { databaseIntegrityVerified: false }],
    ["an incompatible schema", { schemaCompatible: false }],
    ["a conflicting mutation lease", { mutationLeaseAvailable: false }],
    [
      "the wrong Planner actor",
      {
        actor: {
          kind: "planner",
          provider: "anthropic",
          modelId: "claude-other",
        },
      },
    ],
    [
      "an invalid review maximum",
      {
        reviewBudgetMaximum: {
          calls: 0,
          inputTokens: 30_000,
          outputTokens: 12_000,
          costUsdMicros: 10_000_000,
        },
      },
    ],
    [
      "insufficient review-call capacity",
      {
        availableBudget: {
          calls: 0,
          inputTokens: 70_000,
          outputTokens: 28_000,
          costUsdMicros: 40_000_000,
        },
      },
    ],
    [
      "insufficient review-token capacity",
      {
        availableBudget: {
          calls: 2,
          inputTokens: 29_999,
          outputTokens: 28_000,
          costUsdMicros: 40_000_000,
        },
      },
    ],
    [
      "duplicate command identities",
      { reviewCommandId: "command_render_plan_01JTEST" },
    ],
  ])("rejects PlanGenerated with %s", (_name, override) => {
    const input = { ...planGeneratedInput(), ...override } as PlanGenerated;

    expect(() => transition(planningState(), input, pinnedPolicy)).toThrowError(
      expect.objectContaining({ code: "PRECONDITION_FAILED" }),
    );
  });

  it.each([
    ["no run", null],
    ["requirements approval", requirementsApprovedState()],
    ["baseline review", advancedRunState("baseline_review")],
  ])("rejects PlanGenerated from %s", (_name, state) => {
    expect(() =>
      transition(state, planGeneratedInput(), pinnedPolicy),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
  });

  it("rejects PlanGenerated for a different run", () => {
    expect(() =>
      transition(
        planningState(),
        { ...planGeneratedInput(), runId: "run_other" },
        pinnedPolicy,
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
  });

  it("rejects PlanGenerated under a different pinned policy", () => {
    expect(() =>
      transition(
        planningState(),
        planGeneratedInput(),
        policyWithHash("9".repeat(64)),
      ),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("rejects a same-provider pinned Reviewer without an override", () => {
    const reviewerAssignment = {
      provider: "openai" as const,
      modelId: "gpt-reviewer-pinned",
    };

    expect(() =>
      transition(
        planningState(),
        { ...planGeneratedInput(), reviewerAssignment },
        {
          policyHash,
          plannerAssignment: configuredPlannerAssignment,
          reviewerAssignment,
        },
      ),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("accepts a human-submitted canonical plan for baseline review", () => {
    const result = transition(
      requirementsApprovedState(),
      planSubmittedInput(),
      pinnedPolicy,
    );

    expect(result.nextState.state).toBe("baseline_review");
    if (result.nextState.state !== "baseline_review") {
      throw new Error("Expected baseline review state");
    }
    expect(result.nextState.stateVersion).toBe(5);
    expect(result.nextState.currentPlan).toEqual(
      expect.objectContaining({
        versionId: "plan_version_01JTEST",
        artifactId: "artifact_plan_01JTEST",
        contentHash: planContentHash,
      }),
    );
    expect(result.commands.map(({ commandType }) => commandType)).toEqual([
      "render_plan",
      "baseline_review",
    ]);
    expect(result.auditFacts[0]?.type).toBe("plan_version_accepted");
    expect(result.auditFacts[0]?.actor).toEqual(planSubmittedInput().actor);
    expect(result.auditFacts[0]?.reason).toBe(
      "Accept the human-submitted canonical plan for baseline review",
    );
  });

  it("does not require Planner/Reviewer provider separation for a human-submitted plan", () => {
    const reviewerAssignment = {
      provider: "openai" as const,
      modelId: "gpt-reviewer-pinned",
    };
    const result = transition(
      requirementsApprovedState(),
      { ...planSubmittedInput(), reviewerAssignment },
      { ...pinnedPolicy, reviewerAssignment },
    );

    expect(result.nextState.state).toBe("baseline_review");
    if (result.nextState.state !== "baseline_review") {
      throw new Error("Expected baseline review state");
    }
    expect(result.nextState.activeReview.independence).toEqual({
      reduced: false,
    });
  });

  it("ignores a Planner-specific independence override for a human-submitted plan", () => {
    const approved = requirementsApprovedState();
    const overridden = transition(
      approved,
      independenceOverrideGrantedInput(),
      pinnedPolicy,
    );
    const result = transition(
      overridden.nextState,
      { ...planSubmittedInput(), expectedStateVersion: 5 },
      pinnedPolicy,
    );

    expect(result.nextState.state).toBe("baseline_review");
    if (result.nextState.state !== "baseline_review") {
      throw new Error("Expected baseline review state");
    }
    expect(result.nextState.activeReview.reviewerAssignment).toEqual(
      configuredReviewerAssignment,
    );
    expect(result.nextState.activeReview.independence).toEqual({
      reduced: false,
    });
  });

  it.each([
    ["a stale state version", { expectedStateVersion: 3 }],
    ["an invalid canonical schema", { canonicalSchemaValid: false }],
    [
      "an incomplete section transition map",
      {
        sectionTransitionValidation: {
          ...planSubmittedInput().sectionTransitionValidation,
          classificationsComplete: false,
        },
      },
    ],
    [
      "an illegal ID assignment",
      {
        sectionTransitionValidation: {
          ...planSubmittedInput().sectionTransitionValidation,
          onlyDeclaredNewSectionsAssignedIds: false,
        },
      },
    ],
    [
      "validation evidence for another transition map",
      {
        sectionTransitionValidation: {
          ...planSubmittedInput().sectionTransitionValidation,
          validatedTransitionMapContentHash: "9".repeat(64),
        },
      },
    ],
    [
      "an unauthorized actor",
      { actor: { kind: "system", component: "test", version: "1" } },
    ],
  ])("rejects PlanSubmitted with %s", (_name, override) => {
    const input = { ...planSubmittedInput(), ...override } as PlanSubmitted;

    expect(() =>
      transition(requirementsApprovedState(), input, pinnedPolicy),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("rejects PlanSubmitted after provider planning has started", () => {
    expect(() =>
      transition(
        planningState(),
        {
          ...planSubmittedInput(),
          expectedStateVersion: 5,
        },
        pinnedPolicy,
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
  });

  it("routes an accepted baseline review with blockers to remediation", () => {
    const result = transition(
      baselineReviewState(),
      reviewAcceptedInput(["finding_architecture_01JTEST"]),
      pinnedPolicy,
    );

    expect(result.nextState.state).toBe("remediation");
    expect(result.nextState.stateVersion).toBe(7);
    expect(result.commands).toEqual([
      expect.objectContaining({ commandType: "generate_remediation" }),
    ]);
    expect(result.auditFacts.map(({ type }) => type)).toEqual([
      "review_accepted",
      "finding_created",
      "command_planned",
    ]);
  });

  it("exports a non-final provisional baseline result", () => {
    const reviewed = transition(
      baselineReviewState(),
      reviewAcceptedInput(["finding_architecture_01JTEST"]),
      pinnedPolicy,
    ).nextState;

    const exported = createProvisionalBaselineExport(reviewed);

    expect(exported).toEqual(
      expect.objectContaining({
        outcome: "provisional_baseline_reviewed",
        qualified: false,
        approved: false,
        planVersionId: "plan_version_01JTEST",
        reviewId: "review_baseline_01JTEST",
        findings: [
          expect.objectContaining({
            findingId: "finding_architecture_01JTEST",
            severity: "high",
            ruleId: "rule_architecture_boundary",
          }),
        ],
      }),
    );
    expect(createProvisionalBaselineExport(reviewed)).toEqual(exported);
    expect(JSON.stringify(exported)).not.toContain('"approved":true');
    expect(JSON.stringify(exported)).not.toContain('"qualified":true');
  });

  it("rejects provisional export before baseline review is accepted", () => {
    expect(() =>
      createProvisionalBaselineExport(baselineReviewState()),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
  });

  it("exports the reviewed snapshot after the mutable current plan advances", () => {
    const reviewed = transition(
      baselineReviewState(),
      reviewAcceptedInput(["finding_architecture_01JTEST"]),
      pinnedPolicy,
    ).nextState;
    if (reviewed.state !== "remediation") {
      throw new Error("Expected remediation state");
    }
    const laterState = {
      ...reviewed,
      currentPlan: {
        ...reviewed.currentPlan,
        versionId: "plan_version_02JTEST",
        artifactId: "artifact_plan_02JTEST",
        contentHash: "4".repeat(64),
      },
    };

    const exported = createProvisionalBaselineExport(laterState);

    expect(exported.planVersionId).toBe("plan_version_01JTEST");
    expect(exported.planArtifact).toEqual({
      artifactId: "artifact_plan_01JTEST",
      contentHash: planContentHash,
    });
  });

  it("reports human plan origin without implying Planner authorship", () => {
    const submitted = transition(
      requirementsApprovedState(),
      planSubmittedInput(),
      pinnedPolicy,
    ).nextState;
    if (submitted.state !== "baseline_review") {
      throw new Error("Expected submitted plan baseline review");
    }
    const reviewed = transition(
      submitted,
      {
        ...reviewAcceptedInput([]),
        expectedStateVersion: 5,
        originatingCommandId: "command_review_submitted_plan_01JTEST",
        renderedPlanResolution: {
          ...reviewAcceptedInput([]).renderedPlanResolution,
          renderCommandId: "command_render_submitted_plan_01JTEST",
          consumingReviewCommandId: "command_review_submitted_plan_01JTEST",
        },
        acceptedAttempt: {
          ...reviewAcceptedInput([]).acceptedAttempt,
          commandId: "command_review_submitted_plan_01JTEST",
        },
      },
      pinnedPolicy,
    ).nextState;

    const exported = createProvisionalBaselineExport(reviewed);

    expect(exported.plannerAssignment).toBeNull();
    expect(exported.planOrigin).toEqual({
      kind: "human",
      actor: planSubmittedInput().actor,
    });
  });

  it("rejects review evidence resolved from a different physical attempt", () => {
    expect(() =>
      transition(
        baselineReviewState(),
        {
          ...reviewAcceptedInput([]),
          acceptedAttempt: {
            ...reviewAcceptedInput([]).acceptedAttempt,
            commandId: "command_other_review_01JTEST",
          },
        },
        pinnedPolicy,
      ),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("routes an accepted baseline review without blockers to closure", () => {
    const result = transition(
      baselineReviewState(),
      reviewAcceptedInput([]),
      pinnedPolicy,
    );

    expect(result.nextState.state).toBe("closure");
    const command = result.commands[0];
    expect(command?.commandType).toBe("closure_review");
    if (command?.commandType !== "closure_review") {
      throw new Error("Expected closure review command");
    }
    expect(command.payload).toEqual(
      expect.objectContaining({
        renderedPlanArtifactId: "artifact_rendered_plan_01JTEST",
        reviewerPromptArtifactId: "artifact_reviewer_prompt_01JTEST",
        reviewSchemaArtifactId: "artifact_review_schema_01JTEST",
        taxonomyArtifactId: "artifact_review_taxonomy_01JTEST",
        componentRegistryArtifactId: "artifact_component_registry_01JTEST",
        reviewPolicyArtifactId: "artifact_review_policy_01JTEST",
      }),
    );
  });

  it.each([
    ["a stale state version", { expectedStateVersion: 5 }],
    ["an invalid review", { outputValid: false }],
    ["a stale plan", { reviewedPlanContentHash: "9".repeat(64) }],
    [
      "a rendered artifact from another render command",
      {
        renderedPlanResolution: {
          ...reviewAcceptedInput([]).renderedPlanResolution,
          renderCommandId: "command_render_other_plan_01JTEST",
        },
      },
    ],
    ["the wrong review purpose", { reviewPurposeId: "purpose_wrong" }],
    [
      "the wrong originating command",
      { originatingCommandId: "command_wrong" },
    ],
    [
      "an unknown taxonomy rule",
      {
        outputValidation: {
          ...reviewAcceptedInput([]).outputValidation,
          taxonomyValid: false,
        },
      },
    ],
    [
      "an unsupplied evidence reference",
      {
        findings: [
          {
            ...reviewAcceptedInput([]).findings[0]!,
            evidence: [
              {
                kind: "artifact" as const,
                artifactId: "artifact_not_supplied_01JTEST",
                contentHash: "9".repeat(64),
              },
            ],
          },
        ],
      },
    ],
    [
      "an unknown blocking finding",
      {
        reconciliation: {
          ...reviewAcceptedInput([]).reconciliation,
          blockingFindingIds: ["finding_unknown_01JTEST"],
        },
      },
    ],
    [
      "incomplete prior-finding accounting",
      {
        reconciliation: {
          ...reviewAcceptedInput([]).reconciliation,
          priorFindingsAccountedFor: false,
        },
      },
    ],
  ])("rejects ReviewAccepted with %s", (_name, override) => {
    expect(() =>
      transition(
        baselineReviewState(),
        { ...reviewAcceptedInput([]), ...override },
        pinnedPolicy,
      ),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("halts planning with evidence when provider recovery is exhausted", () => {
    const result = transition(
      planningState(),
      providerOutcomeFailedInput(),
      pinnedPolicy,
    );

    expect(result.nextState.state).toBe("halted");
    expect(result.commands).toEqual([
      expect.objectContaining({ commandType: "export_terminal" }),
    ]);
    expect(result.auditFacts.map(({ type }) => type)).toEqual([
      "run_halted",
      "command_planned",
    ]);
    const command = result.commands[0];
    expect(command.payload).toEqual(
      expect.objectContaining({
        policyHash,
        plannerAssignment: configuredPlannerAssignment,
        reviewerAssignment: configuredReviewerAssignment,
        budgetReportArtifactId: "artifact_budget_report_01JTEST",
        recoveryBounds: providerOutcomeFailedInput().recoveryBounds,
        outcome: "halted",
      }),
    );
    expect(result.auditFacts[0].payload).toEqual(
      expect.objectContaining({
        bounds: providerOutcomeFailedInput().recoveryBounds,
        manifest: { producedByCommandId: "command_terminal_report_01JTEST" },
      }),
    );
  });

  it("uses the dedicated pinned-model-unavailable domain input", () => {
    const input: PinnedModelUnavailable = {
      ...providerOutcomeFailedInput(),
      type: "PinnedModelUnavailable",
      unavailableModelId: configuredPlannerAssignment.modelId,
      providerConfirmedUnavailable: true,
      failureClassification: "provider_error",
      reason: "Pinned planner model is unavailable",
    };
    const result = transition(planningState(), input, pinnedPolicy);

    expect(result.nextState).toEqual(
      expect.objectContaining({
        state: "halted",
        haltReason: "Pinned planner model is unavailable",
      }),
    );
    expect(result.commands[0].payload.failureClassification).toBe(
      "provider_error",
    );
  });

  it("halts immediately when the pinned baseline reviewer is unavailable", () => {
    const input: PinnedModelUnavailable = {
      ...providerOutcomeFailedInput(),
      type: "PinnedModelUnavailable",
      expectedStateVersion: 6,
      failedCommandId: "command_baseline_review_01JTEST",
      failedPurposeId:
        "run_01JTEST0000000000000000000:plan:plan_version_01JTEST:baseline:1",
      retryRepairExhausted: false,
      recoveryBounds: {
        retryLimit: 2,
        repairLimit: 1,
        retriesUsed: 0,
        repairsUsed: 0,
      },
      unavailableModelId: configuredReviewerAssignment.modelId,
      providerConfirmedUnavailable: true,
      failureClassification: "provider_error",
      reason: "Pinned reviewer model is unavailable",
    };

    expect(
      transition(baselineReviewState(), input, pinnedPolicy).nextState,
    ).toMatchObject({ state: "halted", haltedFrom: "baseline_review" });
  });

  it("halts baseline review against its exact active review command", () => {
    const result = transition(
      baselineReviewState(),
      {
        ...providerOutcomeFailedInput(),
        expectedStateVersion: 6,
        failedCommandId: "command_baseline_review_01JTEST",
        failedPurposeId:
          "run_01JTEST0000000000000000000:plan:plan_version_01JTEST:baseline:1",
      },
      pinnedPolicy,
    );

    expect(result.nextState).toEqual(
      expect.objectContaining({
        state: "halted",
        haltedFrom: "baseline_review",
      }),
    );
  });

  it("halts a policy-terminal planning refusal without schema repair", () => {
    const result = transition(
      planningState(),
      {
        ...providerOutcomeFailedInput(),
        retryRepairExhausted: false,
        failureClassification: "refusal",
        recoveryBounds: {
          retryLimit: 2,
          repairLimit: 1,
          retriesUsed: 0,
          repairsUsed: 0,
        },
      },
      pinnedPolicy,
    );

    expect(result.nextState.state).toBe("halted");
  });

  it("rejects baseline failure before retry and repair bounds are exhausted", () => {
    expect(() =>
      transition(
        baselineReviewState(),
        {
          ...providerOutcomeFailedInput(),
          expectedStateVersion: 6,
          failedCommandId: "command_baseline_review_01JTEST",
          failedPurposeId:
            "run_01JTEST0000000000000000000:plan:plan_version_01JTEST:baseline:1",
          retryRepairExhausted: false,
        },
        pinnedPolicy,
      ),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("accepts a policy-authorized reduced-independence review assignment", () => {
    const approved = requirementsApprovedState();
    const override = transition(approved, independenceOverrideGrantedInput(), {
      policyHash,
      plannerAssignment: configuredPlannerAssignment,
      reviewerAssignment: configuredReviewerAssignment,
    });
    const planning = transition(
      override.nextState,
      { ...planningRequestedInput(), expectedStateVersion: 5 },
      pinnedPolicy,
    );
    const input: PlanGenerated = {
      ...planGeneratedInput(),
      expectedStateVersion: 6,
      reviewerAssignment: {
        provider: "openai" as const,
        modelId: "gpt-reviewer-pinned",
      },
    };

    const result = transition(planning.nextState, input, pinnedPolicy);

    expect(result.nextState.state).toBe("baseline_review");
    if (result.nextState.state !== "baseline_review") {
      throw new Error("Expected baseline review state");
    }
    expect(result.nextState.activeReview.independence).toEqual({
      reduced: true,
      overrideEvidence: {
        artifactId: "artifact_independence_override_01JTEST",
        contentHash: "9".repeat(64),
      },
    });
    expect(override.auditFacts).toEqual([
      {
        type: "independence_override_granted",
        actor: independenceOverrideGrantedInput().actor,
        reason: "Anthropic Reviewer unavailable under the pinned policy",
        evidence: [
          {
            kind: "artifact",
            artifactId: "artifact_independence_override_01JTEST",
            contentHash: "9".repeat(64),
          },
        ],
        payload: {
          policyHash,
          normalReviewerAssignment:
            independenceOverrideGrantedInput().normalReviewerAssignment,
          overrideReviewerAssignment:
            independenceOverrideGrantedInput().overrideReviewerAssignment,
          reason: "Anthropic Reviewer unavailable under the pinned policy",
        },
      },
    ]);
  });

  it.each([
    ["a stale state version", { expectedStateVersion: 3 }],
    ["unverified evidence", { evidenceVerified: false }],
    [
      "an already-started provider dispatch",
      { beforeProviderDispatchVerified: false },
    ],
    ["an empty reason", { reason: "" }],
    ["an invalid evidence hash", { evidenceContentHash: "invalid" }],
    [
      "an unauthorized actor",
      { actor: { kind: "system", component: "test", version: "1" } },
    ],
    ["an unverified audit chain", { auditChainVerified: false }],
    ["failed database integrity", { databaseIntegrityVerified: false }],
    ["an incompatible schema", { schemaCompatible: false }],
    ["a conflicting mutation lease", { mutationLeaseAvailable: false }],
  ])("rejects IndependenceOverrideGranted with %s", (_name, override) => {
    const input = {
      ...independenceOverrideGrantedInput(),
      ...override,
    } as IndependenceOverrideGranted;

    expect(() =>
      transition(requirementsApprovedState(), input, {
        policyHash,
        plannerAssignment: configuredPlannerAssignment,
        reviewerAssignment: configuredReviewerAssignment,
      }),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("rejects a duplicate independence override", () => {
    const granted = transition(
      requirementsApprovedState(),
      independenceOverrideGrantedInput(),
      {
        policyHash,
        plannerAssignment: configuredPlannerAssignment,
        reviewerAssignment: configuredReviewerAssignment,
      },
    );

    expect(() =>
      transition(
        granted.nextState,
        { ...independenceOverrideGrantedInput(), expectedStateVersion: 5 },
        {
          policyHash,
          plannerAssignment: configuredPlannerAssignment,
          reviewerAssignment: configuredReviewerAssignment,
        },
      ),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("rejects IndependenceOverrideGranted without a run", () => {
    expect(() =>
      transition(null, independenceOverrideGrantedInput(), pinnedPolicy),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
  });

  it("rejects an independence override after planning has started", () => {
    expect(() =>
      transition(
        planningState(),
        {
          ...independenceOverrideGrantedInput(),
          expectedStateVersion: 5,
        },
        {
          policyHash,
          plannerAssignment: configuredPlannerAssignment,
          reviewerAssignment: configuredReviewerAssignment,
        },
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
  });

  it("rejects an independence override whose normal assignment differs from pinned policy", () => {
    expect(() =>
      transition(
        requirementsApprovedState(),
        independenceOverrideGrantedInput(),
        {
          policyHash,
          plannerAssignment: configuredPlannerAssignment,
          reviewerAssignment: {
            provider: "openai",
            modelId: "different-pinned-reviewer",
          },
        },
      ),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("blocks on a preserved external edit and unblocks only on the verified render", () => {
    const started = transition(null, runStartedInput(), pinnedPolicy).nextState;
    const edit: ExternalEditDetected = {
      type: "ExternalEditDetected",
      runId: started.runId,
      expectedStateVersion: started.stateVersion,
      projectionKind: "plan",
      expectedContentHash: planContentHash,
      editedArtifact: {
        artifactId: "artifact_external_edit_01JTEST",
        contentHash: reviewContentHash,
        verified: true,
      },
      auditChainVerified: true,
      databaseIntegrityVerified: true,
      schemaCompatible: true,
      mutationLeaseAvailable: true,
      actor: {
        kind: "system",
        component: "projection-watch",
        version: "0.0.0",
      },
    };
    const blocked = transition(started, edit, pinnedPolicy);
    expect(blocked.nextState).toMatchObject({
      stateVersion: 2,
      blockedReason: "external_projection_edit",
      projectionBlock: { projectionKind: "plan" },
    });
    expect(blocked.auditFacts[0]?.type).toBe("external_edit_detected");

    const restore: ProjectionRestored = {
      type: "ProjectionRestored",
      runId: started.runId,
      expectedStateVersion: 2,
      restoredContentHash: planContentHash,
      auditChainVerified: true,
      databaseIntegrityVerified: true,
      schemaCompatible: true,
      mutationLeaseAvailable: true,
      actor: {
        kind: "system",
        component: "projection-watch",
        version: "0.0.0",
      },
    };
    expect(
      transition(blocked.nextState, restore, pinnedPolicy).nextState,
    ).toMatchObject({
      stateVersion: 3,
      blockedReason: null,
    });
    expect(() =>
      transition(
        blocked.nextState,
        { ...restore, restoredContentHash: sourceContentHash },
        pinnedPolicy,
      ),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("does not reconcile an edited ledger projection by submitting a plan", () => {
    const state = {
      ...requirementsApprovedState(),
      blockedReason: "external_projection_edit",
      projectionBlock: {
        projectionKind: "ledger" as const,
        expectedContentHash: ledgerContentHash,
        editedArtifact: {
          artifactId: "artifact_external_edit_ledger_01JTEST",
          contentHash: reviewContentHash,
        },
      },
    };
    expect(() => transition(state, planSubmittedInput(), pinnedPolicy)).toThrow(
      expect.objectContaining({ code: "INVALID_TRANSITION" }),
    );
  });

  it("records a human rerun authorization bound to one attempt and correlation", () => {
    const started = transition(null, runStartedInput(), pinnedPolicy).nextState;
    const input: RerunAuthorized = {
      type: "RerunAuthorized",
      runId: started.runId,
      expectedStateVersion: started.stateVersion,
      decisionId: "decision_rerun_01JTEST",
      commandId: "command_provider_01JTEST",
      attemptId: "attempt_rerun_01JTEST",
      correlationId: "correlation_rerun_01JTEST",
      reason: "Reproduce the provider result with current evidence",
      auditChainVerified: true,
      databaseIntegrityVerified: true,
      schemaCompatible: true,
      mutationLeaseAvailable: true,
      actor: { kind: "human", displayName: "Tigran", osAccount: "tig" },
    };
    const result = transition(started, input, pinnedPolicy);
    expect(result.nextState.stateVersion).toBe(started.stateVersion + 1);
    expect(result.auditFacts[0]).toMatchObject({
      type: "rerun_authorized",
      evidence: [
        {
          kind: "rerun_authorization",
          commandId: input.commandId,
          attemptId: input.attemptId,
          correlationId: input.correlationId,
        },
      ],
      payload: {
        decisionId: input.decisionId,
        commandId: input.commandId,
        attemptId: input.attemptId,
        correlationId: input.correlationId,
      },
    });
  });

  it("couples accepted planner evidence to its domain transition", async () => {
    const input = planGeneratedInput();
    const state = planningState();
    let persistedProviderCompletion = false;
    const authority: AuthorityPort = {
      transaction: (work) =>
        Promise.resolve(
          work({
            loadRun: <TState extends object>() => state as unknown as TState,
            settleProviderCompletion: () => ({ status: "eligible" as const }),
            settleProviderFailure: () => ({ status: "eligible" as const }),
            persistProviderFailure: () => {
              throw new Error("unexpected provider failure");
            },
            persist: vi.fn(),
            persistProviderCompletion: <TState extends object>(
              completion: AcceptedProviderCompletion,
            ) => {
              persistedProviderCompletion = true;
              return completion.toPersistenceData()
                .result as unknown as PersistableTransition<TState>;
            },
          }),
        ),
    };
    const artifact = (
      artifactId: string,
      contentHash: string,
      kind: "provider_response" | "native_usage",
    ) => ({
      schemaVersion: 1 as const,
      artifactId,
      kind,
      contentHash,
      byteLength: 10,
      mediaType: "application/json",
      createdBy: "pid:planner",
      provenance: {
        method: "provider_generated" as const,
        sourceArtifactIds: [input.acceptedAttempt.requestArtifactId],
        commandId: input.originatingCommandId,
        attemptId: input.acceptedAttempt.attemptId,
      },
    });
    const result = await completeProviderAttempt(authority, {
      runId: input.runId,
      expectedStateVersion: input.expectedStateVersion,
      input,
      policy: pinnedPolicy,
      completion: {
        runId: input.runId,
        commandId: input.originatingCommandId,
        attemptId: input.acceptedAttempt.attemptId,
        ownerProcess: "pid:planner",
        correlationId: "correlation_plan_01JTEST",
        requestArtifactId: input.acceptedAttempt.requestArtifactId,
        requestContentHash: input.acceptedAttempt.requestContentHash,
        outputArtifact: artifact(
          input.planArtifact.artifactId,
          input.planArtifact.contentHash,
          "provider_response",
        ),
        rawResponseArtifact: artifact(
          input.acceptedAttempt.rawResponseArtifactId,
          input.acceptedAttempt.rawResponseContentHash,
          "provider_response",
        ),
        nativeUsageArtifact: artifact(
          input.acceptedAttempt.nativeUsageArtifactId,
          input.acceptedAttempt.nativeUsageContentHash,
          "native_usage",
        ),
        actualUsage: {
          calls: 1,
          inputTokens: 10,
          outputTokens: 20,
          costUsdMicros: 100,
        },
        providerEvidence: {
          requestedModel: pinnedPolicy.plannerAssignment.modelId,
          returnedModel: pinnedPolicy.plannerAssignment.modelId,
          endpoint: "https://provider.invalid",
          behaviorHeaders: {},
          providerResponseId: "response_1",
          correlationId: "correlation_plan_01JTEST",
          preflight: {
            canonicalModelId: pinnedPolicy.plannerAssignment.modelId,
            structuredOutput: true,
            contextWindowTokens: 100_000,
            maxOutputTokens: 10_000,
            inputTokens: 1_000,
          },
        },
      },
    });
    if (!("nextState" in result)) {
      throw new Error("Expected the provider result to advance the run");
    }
    expect(result.nextState.state).toBe("baseline_review");
    expect(persistedProviderCompletion).toBe(true);
  });

  it("does not run a domain transition for an evidence-only provider result", async () => {
    const input = planGeneratedInput();
    const completion = {
      status: "completed" as const,
      runId: input.runId,
      commandId: input.originatingCommandId,
      attemptId: input.acceptedAttempt.attemptId,
      acceptedAsLogicalResult: false,
    };
    const authority: AuthorityPort = {
      transaction: (work) =>
        Promise.resolve(
          work({
            loadRun: () => {
              throw new Error("late evidence must not load workflow state");
            },
            settleProviderCompletion: () => ({
              status: "settled" as const,
              completion,
            }),
            settleProviderFailure: () => ({ status: "eligible" as const }),
            persistProviderCompletion: () => {
              throw new Error("late evidence must not persist a transition");
            },
            persistProviderFailure: () => {
              throw new Error("unexpected provider failure");
            },
            persist: vi.fn(),
          }),
        ),
    };
    const accepted = input.acceptedAttempt;
    const providerArtifact = (
      artifactId: string,
      contentHash: string,
      kind: "provider_response" | "native_usage",
    ) => ({
      schemaVersion: 1 as const,
      artifactId,
      kind,
      contentHash,
      byteLength: 1,
      mediaType: "application/json",
      createdBy: "pid:planner",
      provenance: {
        method: "provider_generated" as const,
        sourceArtifactIds: [accepted.requestArtifactId],
        commandId: input.originatingCommandId,
        attemptId: accepted.attemptId,
      },
    });
    const result = await completeProviderAttempt(authority, {
      runId: input.runId,
      expectedStateVersion: input.expectedStateVersion,
      input,
      policy: pinnedPolicy,
      completion: {
        runId: input.runId,
        commandId: input.originatingCommandId,
        attemptId: accepted.attemptId,
        ownerProcess: "pid:planner",
        correlationId: "correlation_late",
        requestArtifactId: accepted.requestArtifactId,
        requestContentHash: accepted.requestContentHash,
        outputArtifact: providerArtifact(
          input.planArtifact.artifactId,
          input.planArtifact.contentHash,
          "provider_response",
        ),
        rawResponseArtifact: providerArtifact(
          accepted.rawResponseArtifactId,
          accepted.rawResponseContentHash,
          "provider_response",
        ),
        nativeUsageArtifact: providerArtifact(
          accepted.nativeUsageArtifactId,
          accepted.nativeUsageContentHash,
          "native_usage",
        ),
        actualUsage: {
          calls: 1,
          inputTokens: 1,
          outputTokens: 1,
          costUsdMicros: 1,
        },
        providerEvidence: {
          requestedModel: pinnedPolicy.plannerAssignment.modelId,
          endpoint: "https://provider.invalid",
          behaviorHeaders: {},
          correlationId: "correlation_late",
          preflight: {
            canonicalModelId: pinnedPolicy.plannerAssignment.modelId,
            structuredOutput: true,
            contextWindowTokens: 10,
            maxOutputTokens: 5,
            inputTokens: 1,
          },
        },
      },
    });
    expect(result).toEqual(completion);
  });
});
