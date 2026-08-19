import { describe, expect, it } from "vitest";

import {
  transition,
  type LedgerSubmitted,
  type RunStarted,
} from "../../src/domain/index.js";

const policyHash = "a".repeat(64);
const sourceContentHash = "b".repeat(64);
const configurationContentHash = "c".repeat(64);
const ledgerContentHash = "d".repeat(64);

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

  it("rejects a ledger submission for another run", () => {
    const draft = transition(null, runStartedInput(), { policyHash }).nextState;
    const input = { ...ledgerSubmittedInput(), runId: "run_other" };

    expect(() => transition(draft, input, { policyHash })).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" }),
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

  it("rejects resubmitting the current ledger version", () => {
    const draft = transition(null, runStartedInput(), { policyHash }).nextState;
    const first = transition(draft, ledgerSubmittedInput(), { policyHash });
    const replay = { ...ledgerSubmittedInput(), expectedStateVersion: 2 };

    expect(() =>
      transition(first.nextState, replay, { policyHash }),
    ).toThrowError(expect.objectContaining({ code: "PRECONDITION_FAILED" }));
  });
});
