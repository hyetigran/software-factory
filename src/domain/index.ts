export type HumanActor = {
  kind: "human";
  displayName: string;
  osAccount: string;
};

export type DraftRunState = {
  runId: string;
  state: "draft";
  stateVersion: 1;
  sourceArtifactId: string;
  configurationArtifactId: string;
  policyHash: string;
  policyLocked: false;
  blockedReason: null;
};

export type RunStarted = {
  type: "RunStarted";
  runId: string;
  sourceArtifactId: string;
  sourceContentHash: string;
  configurationArtifactId: string;
  actor: HumanActor;
};

export type PinnedRunPolicy = {
  policyHash: string;
};

export type TransitionResult = {
  nextState: DraftRunState;
  commands: Array<{
    type: "render_source_registration_report";
    runId: string;
    sourceArtifactId: string;
  }>;
  auditFacts: Array<{
    type: "run_started" | "source_registered";
    actor: HumanActor;
    evidence: string[];
    payload: Record<string, string | null>;
  }>;
};

export class DomainTransitionError extends Error {
  readonly code: "INVALID_TRANSITION";

  constructor(message: string) {
    super(message);
    this.name = "DomainTransitionError";
    this.code = "INVALID_TRANSITION";
  }
}

export function transition(
  previousState: DraftRunState | null,
  input: RunStarted,
  policy: PinnedRunPolicy,
): TransitionResult {
  if (previousState !== null) {
    throw new DomainTransitionError("RunStarted requires no existing run");
  }

  return {
    nextState: {
      runId: input.runId,
      state: "draft",
      stateVersion: 1,
      sourceArtifactId: input.sourceArtifactId,
      configurationArtifactId: input.configurationArtifactId,
      policyHash: policy.policyHash,
      policyLocked: false,
      blockedReason: null,
    },
    commands: [
      {
        type: "render_source_registration_report",
        runId: input.runId,
        sourceArtifactId: input.sourceArtifactId,
      },
    ],
    auditFacts: [
      {
        type: "run_started",
        actor: input.actor,
        evidence: [input.sourceArtifactId, input.configurationArtifactId],
        payload: {
          configurationArtifactId: input.configurationArtifactId,
          parentRunId: null,
          policyHash: policy.policyHash,
          sourceArtifactId: input.sourceArtifactId,
        },
      },
      {
        type: "source_registered",
        actor: input.actor,
        evidence: [input.sourceArtifactId],
        payload: {
          contentHash: input.sourceContentHash,
          sourceArtifactId: input.sourceArtifactId,
        },
      },
    ],
  };
}
