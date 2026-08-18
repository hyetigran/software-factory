import { createHash } from "node:crypto";

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
  expectedStateVersion: number;
  sourceArtifactId: string;
  sourceContentHash: string;
  sourceProvenancePath: string;
  sourceObjectVerified: boolean;
  configurationArtifactId: string;
  configurationContentHash: string;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  renderCommandId: string;
  actor: HumanActor;
};

export type PinnedRunPolicy = {
  policyHash: string;
};

export type BudgetReservation = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
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

export type RunStartedFact = {
  type: "run_started";
  actor: HumanActor;
  reason: string;
  evidence: string[];
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
  evidence: string[];
  payload: {
    sourceArtifactId: string;
    contentHash: string;
    provenancePath: string;
  };
};

export type TransitionResult = {
  nextState: DraftRunState;
  commands: RenderSourceRegistrationReport[];
  auditFacts: [RunStartedFact, SourceRegisteredFact];
};

type DomainTransitionErrorCode = "INVALID_TRANSITION" | "PRECONDITION_FAILED";

export class DomainTransitionError extends Error {
  readonly code: DomainTransitionErrorCode;

  constructor(code: DomainTransitionErrorCode, message: string) {
    super(message);
    this.name = "DomainTransitionError";
    this.code = code;
  }
}

export function transition(
  previousState: DraftRunState | null,
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
    !input.databaseIntegrityVerified
  ) {
    throw new DomainTransitionError(
      "PRECONDITION_FAILED",
      "RunStarted requires verified source and workspace integrity",
    );
  }

  const budgetReservation: BudgetReservation = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsdMicros: 0,
  };
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
        commandId: input.renderCommandId,
        commandKey: createHash("sha256")
          .update(JSON.stringify(commandWithoutIdentity))
          .digest("hex"),
        ...commandWithoutIdentity,
      },
    ],
    auditFacts: [
      {
        type: "run_started",
        actor: input.actor,
        reason: "Start a run from verified immutable source",
        evidence: [input.sourceArtifactId, input.configurationArtifactId],
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
        evidence: [input.sourceArtifactId],
        payload: {
          contentHash: input.sourceContentHash,
          provenancePath: input.sourceProvenancePath,
          sourceArtifactId: input.sourceArtifactId,
        },
      },
    ],
  };
}
