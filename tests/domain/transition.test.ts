import { describe, expect, it } from "vitest";

import {
  transition,
  type AdvancedRunState,
  type LedgerSubmitted,
  type RunStarted,
  type SourceExclusionApproved,
} from "../../src/domain/index.js";

const policyHash = "a".repeat(64);
const sourceContentHash = "b".repeat(64);
const configurationContentHash = "c".repeat(64);
const ledgerContentHash = "d".repeat(64);
const planContentHash = "e".repeat(64);
const reviewContentHash = "f".repeat(64);

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

function advancedRunState(state: AdvancedRunState["state"]): AdvancedRunState {
  const draft = transition(null, runStartedInput(), { policyHash }).nextState;
  return {
    ...draft,
    state,
    stateVersion: 7,
    policyLocked: true,
    currentLedger: {
      versionId: "ledger_01JTEST",
      artifactId: "artifact_ledger_01JTEST",
      contentHash: ledgerContentHash,
      validationStatus: "approved",
    },
    downstreamQualification: {
      artifacts: [
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
      gateIds: ["gate_closure_01JTEST", "gate_qualification_01JTEST"],
    },
  };
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
});
