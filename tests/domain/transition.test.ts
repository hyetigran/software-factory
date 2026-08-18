import { describe, expect, it } from "vitest";

import { transition } from "../../src/domain/index.js";

const policyHash = "a".repeat(64);

describe("transition", () => {
  it("starts a draft run from verified immutable source", () => {
    const result = transition(
      null,
      {
        type: "RunStarted",
        runId: "run_01JTEST0000000000000000000",
        sourceArtifactId: "artifact_source_01JTEST",
        sourceContentHash: "b".repeat(64),
        configurationArtifactId: "artifact_config_01JTEST",
        actor: {
          kind: "human",
          displayName: "Tigran",
          osAccount: "tig",
        },
      },
      { policyHash },
    );

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
          type: "render_source_registration_report",
          runId: "run_01JTEST0000000000000000000",
          sourceArtifactId: "artifact_source_01JTEST",
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
          evidence: ["artifact_source_01JTEST", "artifact_config_01JTEST"],
          payload: {
            configurationArtifactId: "artifact_config_01JTEST",
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
          evidence: ["artifact_source_01JTEST"],
          payload: {
            contentHash: "b".repeat(64),
            sourceArtifactId: "artifact_source_01JTEST",
          },
        },
      ],
    });
  });

  it("rejects RunStarted when a run already exists", () => {
    const input = {
      type: "RunStarted" as const,
      runId: "run_01JTEST0000000000000000000",
      sourceArtifactId: "artifact_source_01JTEST",
      sourceContentHash: "b".repeat(64),
      configurationArtifactId: "artifact_config_01JTEST",
      actor: {
        kind: "human" as const,
        displayName: "Tigran",
        osAccount: "tig",
      },
    };
    const existingState = transition(null, input, { policyHash }).nextState;

    let thrown: unknown;
    try {
      transition(existingState, input, { policyHash });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "INVALID_TRANSITION",
      message: "RunStarted requires no existing run",
    });
  });
});
