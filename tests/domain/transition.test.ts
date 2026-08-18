import { describe, expect, it } from "vitest";

import { transition, type RunStarted } from "../../src/domain/index.js";

const policyHash = "a".repeat(64);
const sourceContentHash = "b".repeat(64);
const configurationContentHash = "c".repeat(64);

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

describe("transition", () => {
  it("starts a draft run from verified immutable source", () => {
    const result = transition(null, runStartedInput(), { policyHash });

    expect(result).toEqual({
      nextState: {
        runId: "run_01JTEST0000000000000000000",
        state: "draft",
        stateVersion: 1,
        sourceArtifactId: "artifact_source_01JTEST",
        configurationArtifactId: "artifact_config_01JTEST",
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
});
