import { describe, expect, it } from "vitest";

import {
  transition,
  type AdvancedRunState,
  type DraftRunState,
  type IndependenceOverrideGranted,
  type LedgerApprovalRequested,
  type LedgerSubmitted,
  type PlanGenerated,
  type PlanningRequested,
  type RunStarted,
  type SourceExclusionApproved,
} from "../../src/domain/index.js";

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
const configuredReviewerAssignment = {
  provider: "anthropic" as const,
  modelId: "claude-frontier-pinned-20260801",
};

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
    { policyHash },
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
    planVersionId: "plan_version_01JTEST",
    planArtifact: {
      artifactId: "artifact_plan_01JTEST",
      contentHash: planContentHash,
      verified: true,
    },
    outputValid: true,
    sectionContinuityValid: true,
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
    componentRegistryArtifact: {
      artifactId: "artifact_component_registry_01JTEST",
      contentHash: componentRegistryContentHash,
      verified: true,
    },
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

function advancedRunState(state: AdvancedRunState["state"]): AdvancedRunState {
  const draft = transition(null, runStartedInput(), { policyHash }).nextState;
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
      },
      activeReview: {
        cycle: 1,
        reviewerAssignment: {
          provider: "anthropic",
          modelId: "claude-frontier-pinned-20260801",
        },
        reviewPurposeId:
          "run_01JTEST0000000000000000000:plan:plan_version_01JTEST:baseline:1",
        independence: { reduced: false },
      },
    };
  }
  return { ...base, state };
}

function approvalReadyDraft(): DraftRunState {
  const draft = transition(null, runStartedInput(), { policyHash }).nextState;
  const ledgerDraft = transition(draft, ledgerSubmittedInput(), {
    policyHash,
  }).nextState;
  const result = transition(ledgerDraft, sourceExclusionApprovedInput(), {
    policyHash,
  }).nextState;
  if (result.state !== "draft") {
    throw new Error("expected draft state");
  }
  return result;
}

function requirementsApprovedState(): AdvancedRunState {
  const result = transition(
    approvalReadyDraft(),
    ledgerApprovalRequestedInput(),
    { policyHash },
  ).nextState;
  if (result.state !== "requirements_approved") {
    throw new Error("expected requirements_approved state");
  }
  return result;
}

describe("transition", () => {
  it("starts a draft run from verified immutable source", () => {
    const result = transition(null, runStartedInput(), { policyHash });

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
    const existingState = transition(null, input, { policyHash }).nextState;

    expect(() => transition(existingState, input, { policyHash })).toThrowError(
      expect.objectContaining({
        code: "INVALID_TRANSITION",
        message: "RunStarted requires no existing run",
      }),
    );
  });

  it("rejects RunStarted when source verification is missing", () => {
    const input = { ...runStartedInput(), sourceObjectVerified: false };

    expect(() => transition(null, input, { policyHash })).toThrowError(
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

    expect(() => transition(null, input, { policyHash })).toThrowError(
      expect.objectContaining({ code: "PRECONDITION_FAILED" }),
    );
  });

  it("rejects RunStarted from an unauthorized actor", () => {
    const input = {
      ...runStartedInput(),
      actor: { kind: "human" as const, displayName: "", osAccount: "" },
    };

    expect(() => transition(null, input, { policyHash })).toThrowError(
      expect.objectContaining({ code: "PRECONDITION_FAILED" }),
    );
  });

  it("rejects an unsupported transition discriminator at runtime", () => {
    const input = {
      ...runStartedInput(),
      type: "UnsupportedTransition",
    } as unknown as RunStarted;

    expect(() => transition(null, input, { policyHash })).toThrowError(
      expect.objectContaining({
        code: "INVALID_TRANSITION",
        message: "Unsupported transition: UnsupportedTransition",
      }),
    );
  });

  it("submits a ledger for validation and rendering", () => {
    const draft = transition(null, runStartedInput(), { policyHash }).nextState;

    const result = transition(draft, ledgerSubmittedInput(), { policyHash });

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
    const draft = transition(null, runStartedInput(), { policyHash }).nextState;
    const input = makeInvalid(ledgerSubmittedInput());

    expect(() => transition(draft, input, { policyHash })).toThrowError(
      expect.objectContaining({ code: "PRECONDITION_FAILED" }),
    );
  });

  it.each<
    [string, () => unknown, "INVALID_TRANSITION" | "PRECONDITION_FAILED"]
  >([
    [
      "without an active draft run",
      () => transition(null, ledgerSubmittedInput(), { policyHash }),
      "INVALID_TRANSITION",
    ],
    [
      "for another run",
      () => {
        const draft = transition(null, runStartedInput(), {
          policyHash,
        }).nextState;
        const input = { ...ledgerSubmittedInput(), runId: "run_other" };
        return transition(draft, input, { policyHash });
      },
      "INVALID_TRANSITION",
    ],
    [
      "for the current ledger version",
      () => {
        const draft = transition(null, runStartedInput(), {
          policyHash,
        }).nextState;
        const first = transition(draft, ledgerSubmittedInput(), { policyHash });
        const replay = { ...ledgerSubmittedInput(), expectedStateVersion: 2 };
        return transition(first.nextState, replay, { policyHash });
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
        return transition(terminal, ledgerSubmittedInput(), { policyHash });
      },
      "INVALID_TRANSITION",
    ],
  ])("rejects a ledger submission %s", (_caseName, submit, expectedCode) => {
    expect(submit).toThrowError(
      expect.objectContaining({ code: expectedCode }),
    );
  });

  it("advances the authoritative version for a revised ledger", () => {
    const draft = transition(null, runStartedInput(), { policyHash }).nextState;
    const first = transition(draft, ledgerSubmittedInput(), { policyHash });
    const revision = {
      ...ledgerSubmittedInput(),
      expectedStateVersion: 2,
      ledgerVersionId: "ledger_02JTEST",
      ledgerArtifactId: "artifact_ledger_02JTEST",
      validateCommandId: "command_validate_ledger_02JTEST",
      renderCommandId: "command_render_ledger_02JTEST",
    };

    const second = transition(first.nextState, revision, { policyHash });

    expect(second.nextState.stateVersion).toBe(3);
    expect(second.commands).toEqual([
      expect.objectContaining({ triggeringStateVersion: 3 }),
      expect.objectContaining({ triggeringStateVersion: 3 }),
    ]);
  });

  it("invalidates downstream qualification when revising an advanced run", () => {
    const draft = transition(null, runStartedInput(), { policyHash }).nextState;
    const qualified = advancedRunState("qualified");
    const revision = {
      ...ledgerSubmittedInput(),
      expectedStateVersion: 7,
      ledgerVersionId: "ledger_02JTEST",
      ledgerArtifactId: "artifact_ledger_02JTEST",
      validateCommandId: "command_validate_ledger_02JTEST",
      renderCommandId: "command_render_ledger_02JTEST",
    };

    const result = transition(qualified, revision, { policyHash });

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
      expectedStateVersion: 7,
      ledgerVersionId: "ledger_02JTEST",
    };

    const result = transition(previousState, revision, { policyHash });

    expect(result.nextState).toEqual(
      expect.objectContaining({
        state: "draft",
        stateVersion: 8,
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
      transition(qualified, revision, { policyHash: "f".repeat(64) }),
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

    const result = transition(requirementsApproved, revision, {
      policyHash: revisedPolicyHash,
    });

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
    const draft = transition(null, runStartedInput(), { policyHash }).nextState;
    const ledgerDraft = transition(draft, ledgerSubmittedInput(), {
      policyHash,
    }).nextState;

    const result = transition(ledgerDraft, sourceExclusionApprovedInput(), {
      policyHash,
    });

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
    const draft = transition(null, runStartedInput(), { policyHash }).nextState;
    const ledgerDraft = transition(draft, ledgerSubmittedInput(), {
      policyHash,
    }).nextState;

    expect(() =>
      transition(ledgerDraft, makeInvalid(sourceExclusionApprovedInput()), {
        policyHash,
      }),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it.each<
    [string, () => unknown, "INVALID_TRANSITION" | "PRECONDITION_FAILED"]
  >([
    [
      "without an active run",
      () =>
        transition(null, sourceExclusionApprovedInput(), {
          policyHash,
        }),
      "INVALID_TRANSITION",
    ],
    [
      "without a current ledger",
      () => {
        const draft = transition(null, runStartedInput(), {
          policyHash,
        }).nextState;
        const input = {
          ...sourceExclusionApprovedInput(),
          expectedStateVersion: 1,
        };
        return transition(draft, input, { policyHash });
      },
      "PRECONDITION_FAILED",
    ],
    [
      "for another run",
      () => {
        const draft = transition(null, runStartedInput(), {
          policyHash,
        }).nextState;
        const ledgerDraft = transition(draft, ledgerSubmittedInput(), {
          policyHash,
        }).nextState;
        const input = {
          ...sourceExclusionApprovedInput(),
          runId: "run_other",
        };
        return transition(ledgerDraft, input, { policyHash });
      },
      "INVALID_TRANSITION",
    ],
    [
      "outside draft state",
      () =>
        transition(
          advancedRunState("requirements_approved"),
          { ...sourceExclusionApprovedInput(), expectedStateVersion: 7 },
          { policyHash },
        ),
      "INVALID_TRANSITION",
    ],
    [
      "with a changed locked policy",
      () => {
        const draft = transition(null, runStartedInput(), {
          policyHash,
        }).nextState;
        const ledgerDraft = transition(draft, ledgerSubmittedInput(), {
          policyHash,
        }).nextState;
        return transition(
          { ...ledgerDraft, policyLocked: true },
          sourceExclusionApprovedInput(),
          { policyHash: "0".repeat(64) },
        );
      },
      "PRECONDITION_FAILED",
    ],
    [
      "with a duplicate exclusion ID",
      () => {
        const draft = transition(null, runStartedInput(), {
          policyHash,
        }).nextState;
        const ledgerDraft = transition(draft, ledgerSubmittedInput(), {
          policyHash,
        }).nextState;
        const first = transition(ledgerDraft, sourceExclusionApprovedInput(), {
          policyHash,
        });
        return transition(
          first.nextState,
          { ...sourceExclusionApprovedInput(), expectedStateVersion: 3 },
          { policyHash },
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
    const draft = transition(null, runStartedInput(), { policyHash }).nextState;
    const ledgerDraft = transition(draft, ledgerSubmittedInput(), {
      policyHash,
    }).nextState;
    const first = transition(ledgerDraft, sourceExclusionApprovedInput(), {
      policyHash,
    });
    const secondInput = {
      ...sourceExclusionApprovedInput(),
      expectedStateVersion: 3,
      exclusionId: "exclusion_02JTEST",
      sourceRange: { startOffset: 200, endOffset: 220 },
      reason: "Appendix heading has no normative content",
      validateCommandId: "command_validate_exclusion_02JTEST",
    };

    const second = transition(first.nextState, secondInput, { policyHash });

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
    const revised = transition(second.nextState, ledgerRevision, {
      policyHash,
    });

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
      { policyHash },
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
        {
          policyHash,
        },
      ),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it.each<
    [string, () => unknown, "INVALID_TRANSITION" | "PRECONDITION_FAILED"]
  >([
    [
      "without an active run",
      () => transition(null, ledgerApprovalRequestedInput(), { policyHash }),
      "INVALID_TRANSITION",
    ],
    [
      "without a current ledger",
      () => {
        const draft = transition(null, runStartedInput(), {
          policyHash,
        }).nextState;
        return transition(
          draft,
          { ...ledgerApprovalRequestedInput(), expectedStateVersion: 1 },
          { policyHash },
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
          { policyHash },
        ),
      "INVALID_TRANSITION",
    ],
    [
      "outside draft state",
      () =>
        transition(
          advancedRunState("requirements_approved"),
          { ...ledgerApprovalRequestedInput(), expectedStateVersion: 7 },
          { policyHash },
        ),
      "INVALID_TRANSITION",
    ],
    [
      "with a changed locked policy",
      () =>
        transition(
          { ...approvalReadyDraft(), policyLocked: true },
          ledgerApprovalRequestedInput(),
          { policyHash: "1".repeat(64) },
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
      { policyHash },
    );
    const revision = {
      ...ledgerSubmittedInput(),
      expectedStateVersion: 4,
      ledgerVersionId: "ledger_02JTEST",
      ledgerArtifactId: "artifact_ledger_02JTEST",
      validateCommandId: "command_validate_ledger_02JTEST",
      renderCommandId: "command_render_ledger_02JTEST",
    };

    const revised = transition(approved.nextState, revision, { policyHash });

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

    const result = transition(approvalReadyDraft(), approval, {
      policyHash: revisedPolicyHash,
    });

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
      transition(approvalReadyDraft(), ledgerApprovalRequestedInput(), {
        policyHash: "2".repeat(64),
      }),
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
    const revised = transition(approvalReadyDraft(), revision, {
      policyHash,
    });
    const staleCoverageApproval = {
      ...ledgerApprovalRequestedInput(),
      expectedStateVersion: 4,
    };

    expect(() =>
      transition(revised.nextState, staleCoverageApproval, { policyHash }),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("requests provider-backed planning with a maximum budget", () => {
    const approved = requirementsApprovedState();

    const result = transition(approved, planningRequestedInput(), {
      policyHash,
    });

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
      transition(approved, planningRequestedInput(), { policyHash }).commands[0]
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
      transition(requirementsApprovedState(), input, { policyHash }),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("rejects PlanningRequested under a policy different from the approved policy", () => {
    expect(() =>
      transition(requirementsApprovedState(), planningRequestedInput(), {
        policyHash: "f".repeat(64),
      }),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it.each([
    ["no run", null],
    ["a draft run", approvalReadyDraft()],
    ["a later nonterminal state", advancedRunState("baseline_review")],
  ])("rejects PlanningRequested from %s", (_name, state) => {
    expect(() =>
      transition(state, planningRequestedInput(), { policyHash }),
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
        { policyHash },
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
  });

  it("accepts a generated plan and schedules independent baseline review", () => {
    const planning = planningState();

    const result = transition(planning, planGeneratedInput(), { policyHash });

    expect(result.nextState).toEqual({
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
      },
      activeReview: {
        cycle: 1,
        reviewerAssignment: planGeneratedInput().reviewerAssignment,
        reviewPurposeId:
          "run_01JTEST0000000000000000000:plan:plan_version_01JTEST:baseline:1",
        independence: { reduced: false },
      },
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
          componentRegistryArtifactId: "artifact_component_registry_01JTEST",
          reviewPolicyArtifactId: "artifact_review_policy_01JTEST",
          evidenceArtifactIds: [
            "artifact_section_map_01JTEST",
            "artifact_plan_provenance_01JTEST",
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
    ["invalid section continuity", { sectionContinuityValid: false }],
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

    expect(() =>
      transition(planningState(), input, { policyHash }),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it.each([
    ["no run", null],
    ["requirements approval", requirementsApprovedState()],
    ["baseline review", advancedRunState("baseline_review")],
  ])("rejects PlanGenerated from %s", (_name, state) => {
    expect(() =>
      transition(state, planGeneratedInput(), { policyHash }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
  });

  it("rejects PlanGenerated for a different run", () => {
    expect(() =>
      transition(
        planningState(),
        { ...planGeneratedInput(), runId: "run_other" },
        { policyHash },
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSITION" }));
  });

  it("rejects PlanGenerated under a different pinned policy", () => {
    expect(() =>
      transition(planningState(), planGeneratedInput(), {
        policyHash: "9".repeat(64),
      }),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("accepts a policy-authorized reduced-independence review assignment", () => {
    const approved = requirementsApprovedState();
    const override = transition(approved, independenceOverrideGrantedInput(), {
      policyHash,
      reviewerAssignment: configuredReviewerAssignment,
    });
    const planning = transition(
      override.nextState,
      { ...planningRequestedInput(), expectedStateVersion: 5 },
      { policyHash },
    );
    const input: PlanGenerated = {
      ...planGeneratedInput(),
      expectedStateVersion: 6,
      reviewerAssignment: {
        provider: "openai" as const,
        modelId: "gpt-reviewer-pinned",
      },
    };

    const result = transition(planning.nextState, input, { policyHash });

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
        reviewerAssignment: configuredReviewerAssignment,
      }),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("rejects a duplicate independence override", () => {
    const granted = transition(
      requirementsApprovedState(),
      independenceOverrideGrantedInput(),
      { policyHash, reviewerAssignment: configuredReviewerAssignment },
    );

    expect(() =>
      transition(
        granted.nextState,
        { ...independenceOverrideGrantedInput(), expectedStateVersion: 5 },
        { policyHash, reviewerAssignment: configuredReviewerAssignment },
      ),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });

  it("rejects IndependenceOverrideGranted without a run", () => {
    expect(() =>
      transition(null, independenceOverrideGrantedInput(), { policyHash }),
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
          reviewerAssignment: {
            provider: "openai",
            modelId: "different-pinned-reviewer",
          },
        },
      ),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });
});
