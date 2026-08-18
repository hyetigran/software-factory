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
  stateVersion: number;
  sourceArtifactId: string;
  sourceContentHash: string;
  configurationArtifactId: string;
  configurationContentHash: string;
  policyHash: string;
  policyLocked: false;
  blockedReason: null;
  currentLedgerVersionId?: string;
  currentLedgerArtifactId?: string;
  ledgerValidationStatus?: "pending";
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

export type LedgerSubmitted = {
  type: "LedgerSubmitted";
  runId: string;
  expectedStateVersion: number;
  ledgerVersionId: string;
  ledgerArtifactId: string;
  ledgerContentHash: string;
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

export type ValidateLedger = {
  commandId: string;
  commandKey: string;
  commandType: "validate_ledger";
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: 2;
  purposeId: string;
  inputArtifactHashes: string[];
  policyHash: string;
  provider: "local";
  budgetReservation: BudgetReservation;
  payload: {
    ledgerVersionId: string;
    ledgerArtifactId: string;
    sourceArtifactId: string;
  };
};

export type RenderLedger = {
  commandId: string;
  commandKey: string;
  commandType: "render_ledger";
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: 2;
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
      "render_source_registration_report" | "validate_ledger" | "render_ledger";
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

export type TransitionResult = {
  nextState: DraftRunState;
  commands: Array<
    RenderSourceRegistrationReport | ValidateLedger | RenderLedger
  >;
  auditFacts: Array<
    | RunStartedFact
    | SourceRegisteredFact
    | LedgerSubmittedFact
    | CommandPlannedFact
  >;
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
  input: RunStarted | LedgerSubmitted,
  policy: PinnedRunPolicy,
): TransitionResult {
  switch (input.type) {
    case "RunStarted":
      return startRun(previousState, input, policy);
    case "LedgerSubmitted":
      return submitLedger(previousState, input, policy);
    default:
      throw new DomainTransitionError(
        "INVALID_TRANSITION",
        `Unsupported transition: ${String((input as { type: unknown }).type)}`,
      );
  }
}

function startRun(
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

function submitLedger(
  previousState: DraftRunState | null,
  input: LedgerSubmitted,
  policy: PinnedRunPolicy,
): TransitionResult {
  if (
    previousState === null ||
    previousState.state !== "draft" ||
    previousState.runId !== input.runId
  ) {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "LedgerSubmitted requires the matching draft run",
    );
  }

  if (
    previousState.stateVersion !== input.expectedStateVersion ||
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

  const reservation: BudgetReservation = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsdMicros: 0,
  };
  const validateWithoutIdentity = {
    commandType: "validate_ledger" as const,
    schemaVersion: 1 as const,
    runId: input.runId,
    triggeringStateVersion: 2 as const,
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
    },
  };
  const renderWithoutIdentity = {
    commandType: "render_ledger" as const,
    schemaVersion: 1 as const,
    runId: input.runId,
    triggeringStateVersion: 2 as const,
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
  const validateCommand: ValidateLedger = {
    commandId: input.validateCommandId,
    commandKey: createHash("sha256")
      .update(canonicalJson(validateWithoutIdentity))
      .digest("hex"),
    ...validateWithoutIdentity,
  };
  const renderCommand: RenderLedger = {
    commandId: input.renderCommandId,
    commandKey: createHash("sha256")
      .update(canonicalJson(renderWithoutIdentity))
      .digest("hex"),
    ...renderWithoutIdentity,
  };
  const ledgerEvidence: ArtifactEvidenceReference = {
    kind: "artifact",
    artifactId: input.ledgerArtifactId,
    contentHash: input.ledgerContentHash,
  };
  const sourceEvidence: ArtifactEvidenceReference = {
    kind: "artifact",
    artifactId: previousState.sourceArtifactId,
    contentHash: previousState.sourceContentHash,
  };
  const commandFact = (
    command: ValidateLedger | RenderLedger,
  ): CommandPlannedFact => ({
    type: "command_planned",
    actor: {
      kind: "system",
      component: "domain-transition",
      version: "0.0.0",
    },
    reason: `Plan ${command.commandType}`,
    evidence: [ledgerEvidence],
    payload: {
      commandId: command.commandId,
      commandKey: command.commandKey,
      commandType: command.commandType,
      reservation: command.budgetReservation,
    },
  });

  return {
    nextState: {
      ...previousState,
      stateVersion: 2,
      currentLedgerVersionId: input.ledgerVersionId,
      currentLedgerArtifactId: input.ledgerArtifactId,
      ledgerValidationStatus: "pending",
    },
    commands: [validateCommand, renderCommand],
    auditFacts: [
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
      commandFact(validateCommand),
      commandFact(renderCommand),
    ],
  };
}
