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

export type ArtifactEvidenceReference = {
  kind: "artifact";
  artifactId: string;
  contentHash: string;
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
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
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
    commandType: "render_source_registration_report";
    reservation: BudgetReservation;
  };
};

export type TransitionResult = {
  nextState: DraftRunState;
  commands: RenderSourceRegistrationReport[];
  auditFacts: [RunStartedFact, SourceRegisteredFact, CommandPlannedFact];
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
  if (input.type !== "RunStarted") {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      `Unsupported transition: ${String(input.type)}`,
    );
  }

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
  const command: RenderSourceRegistrationReport = {
    commandId: input.renderCommandId,
    commandKey: createHash("sha256")
      .update(canonicalJson(commandWithoutIdentity))
      .digest("hex"),
    ...commandWithoutIdentity,
  };
  const sourceEvidence: ArtifactEvidenceReference = {
    kind: "artifact",
    artifactId: input.sourceArtifactId,
    contentHash: input.sourceContentHash,
  };
  const configurationEvidence: ArtifactEvidenceReference = {
    kind: "artifact",
    artifactId: input.configurationArtifactId,
    contentHash: input.configurationContentHash,
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
      {
        type: "command_planned",
        actor: {
          kind: "system",
          component: "domain-transition",
          version: "0.0.0",
        },
        reason: "Plan the deterministic source registration report",
        evidence: [sourceEvidence],
        payload: {
          commandId: command.commandId,
          commandKey: command.commandKey,
          commandType: command.commandType,
          reservation: command.budgetReservation,
        },
      },
    ],
  };
}
