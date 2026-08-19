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

export type CurrentLedger = {
  versionId: string;
  artifactId: string;
  contentHash: string;
  validationStatus: "pending" | "approved";
};

export type SourceRange = {
  startOffset: number;
  endOffset: number;
};

export type SourceExclusion = {
  exclusionId: string;
  sourceRange: SourceRange;
  reason: string;
};

type RunStateBase = {
  runId: string;
  stateVersion: number;
  sourceArtifactId: string;
  sourceContentHash: string;
  configurationArtifactId: string;
  configurationContentHash: string;
  policyHash: string;
  blockedReason: null;
  sourceExclusions?: SourceExclusion[];
};

export type DraftRunState = RunStateBase & {
  state: "draft";
  policyLocked: boolean;
  currentLedger?: CurrentLedger;
};

type AdvancedStateBase = RunStateBase & {
  currentLedger: CurrentLedger & { validationStatus: "approved" };
  downstreamQualification: {
    artifacts: ArtifactEvidenceReference[];
    gateIds: string[];
  };
};

export type PlannerAssignment = {
  provider: "openai" | "anthropic";
  modelId: string;
};

export type ActivePlanning = {
  purposeId: string;
  plannerAssignment: PlannerAssignment;
  reservedBudget: BudgetReservation;
};

export type AdvancedRunState = AdvancedStateBase &
  (
    | { state: "requirements_approved"; policyLocked: boolean }
    | { state: "planning"; policyLocked: true; activePlanning: ActivePlanning }
    | {
        state:
          | "baseline_review"
          | "remediation"
          | "closure"
          | "qualified"
          | "qualified_with_waivers";
        policyLocked: true;
      }
  );

export type NonterminalRunState = DraftRunState | AdvancedRunState;

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
  ledgerObjectVerified: boolean;
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

export type SourceExclusionApproved = {
  type: "SourceExclusionApproved";
  runId: string;
  expectedStateVersion: number;
  exclusionId: string;
  sourceRange: SourceRange;
  sourceRangeVerified: boolean;
  reason: string;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  validateCommandId: string;
  actor: HumanActor;
};

export type LedgerApprovalRequested = {
  type: "LedgerApprovalRequested";
  runId: string;
  expectedStateVersion: number;
  validatedStateVersion: number;
  validatedLedgerVersionId: string;
  validatedLedgerContentHash: string;
  validatedPolicyHash: string;
  ledgerSchemaValid: boolean;
  lineageValid: boolean;
  identityValid: boolean;
  coverageComplete: boolean;
  coverageReportArtifactId: string;
  coverageReportContentHash: string;
  coverageReportVerified: boolean;
  approvalGateId: string;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  renderCommandId: string;
  actor: HumanActor;
};

export type PlanningRequested = {
  type: "PlanningRequested";
  runId: string;
  expectedStateVersion: number;
  planPurposeId: string;
  plannerAssignment: PlannerAssignment;
  plannerModelAllowed: boolean;
  modelIdentityPinned: boolean;
  policyAccepted: boolean;
  budgetsAccepted: boolean;
  providerBoundaryAcknowledged: boolean;
  promptArtifactId: string;
  promptContentHash: string;
  promptArtifactVerified: boolean;
  outputSchemaArtifactId: string;
  outputSchemaContentHash: string;
  outputSchemaArtifactVerified: boolean;
  budgetReservation: BudgetReservation;
  availableBudget: BudgetReservation;
  auditChainVerified: boolean;
  databaseIntegrityVerified: boolean;
  schemaCompatible: boolean;
  mutationLeaseAvailable: boolean;
  generateCommandId: string;
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
  triggeringStateVersion: number;
  purposeId: string;
  inputArtifactHashes: string[];
  policyHash: string;
  provider: "local";
  budgetReservation: BudgetReservation;
  payload: {
    ledgerVersionId: string;
    ledgerArtifactId: string;
    sourceArtifactId: string;
    sourceExclusions?: SourceExclusion[];
  };
};

export type RenderLedger = {
  commandId: string;
  commandKey: string;
  commandType: "render_ledger";
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: number;
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

export type RenderLedgerApproval = {
  commandId: string;
  commandKey: string;
  commandType: "render_ledger_approval";
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: number;
  purposeId: string;
  inputArtifactHashes: string[];
  policyHash: string;
  provider: "local";
  budgetReservation: BudgetReservation;
  payload: {
    ledgerVersionId: string;
    ledgerArtifactId: string;
    coverageReportArtifactId: string;
    coverageValidatedStateVersion: number;
    coverageValidatedPolicyHash: string;
    approvalGateId: string;
    sourceExclusions: SourceExclusion[];
    approvedBy: HumanActor;
  };
};

export type GeneratePlan = {
  commandId: string;
  commandKey: string;
  commandType: "generate_plan";
  schemaVersion: 1;
  runId: string;
  triggeringStateVersion: number;
  purposeId: string;
  inputArtifactHashes: string[];
  policyHash: string;
  provider: PlannerAssignment["provider"];
  modelId: string;
  budgetReservation: BudgetReservation;
  payload: {
    ledgerVersionId: string;
    ledgerArtifactId: string;
    promptArtifactId: string;
    outputSchemaArtifactId: string;
    providerStorage: "minimize";
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
      | "render_source_registration_report"
      | "validate_ledger"
      | "render_ledger"
      | "render_ledger_approval"
      | "generate_plan";
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

export type DownstreamInvalidatedFact = {
  type: "downstream_invalidated";
  actor: SystemActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    cause: {
      type: "ledger_revised";
      previousLedgerVersionId: string;
      nextLedgerVersionId: string;
    };
    affectedArtifactIds: string[];
    affectedGateIds: string[];
  };
};

export type SourceExclusionApprovedFact = {
  type: "source_exclusion_approved";
  actor: HumanActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: SourceExclusion;
};

export type LedgerApprovedFact = {
  type: "ledger_approved";
  actor: HumanActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    ledgerVersionId: string;
    coverageReportArtifactId: string;
    coverageReportContentHash: string;
    coverageValidatedStateVersion: number;
    coverageValidatedPolicyHash: string;
    approvalGateId: string;
    approvedBy: HumanActor;
  };
};

export type PlanningRequestedFact = {
  type: "planning_requested";
  actor: HumanActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    planPurposeId: string;
    plannerAssignment: PlannerAssignment;
    policyHash: string;
    budgetReservation: BudgetReservation;
  };
};

export type BudgetReservedFact = {
  type: "budget_reserved";
  actor: SystemActor;
  reason: string;
  evidence: ArtifactEvidenceReference[];
  payload: {
    commandId: string;
    reservation: BudgetReservation;
  };
};

export type TransitionResult = {
  nextState: NonterminalRunState;
  commands: Array<
    | RenderSourceRegistrationReport
    | ValidateLedger
    | RenderLedger
    | RenderLedgerApproval
    | GeneratePlan
  >;
  auditFacts: Array<
    | RunStartedFact
    | SourceRegisteredFact
    | LedgerSubmittedFact
    | DownstreamInvalidatedFact
    | SourceExclusionApprovedFact
    | LedgerApprovedFact
    | PlanningRequestedFact
    | BudgetReservedFact
    | CommandPlannedFact
  >;
};

type LocalCommand =
  | RenderSourceRegistrationReport
  | ValidateLedger
  | RenderLedger
  | RenderLedgerApproval;

type PlannedCommand = LocalCommand | GeneratePlan;

function zeroBudgetReservation(): BudgetReservation {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsdMicros: 0,
  };
}

function planCommand<T extends PlannedCommand>(
  commandId: string,
  commandWithoutIdentity: Omit<T, "commandId" | "commandKey">,
): T {
  return {
    commandId,
    commandKey: createHash("sha256")
      .update(canonicalJson(commandWithoutIdentity))
      .digest("hex"),
    ...commandWithoutIdentity,
  } as T;
}

function artifactEvidence(
  artifactId: string,
  contentHash: string,
): ArtifactEvidenceReference {
  return { kind: "artifact", artifactId, contentHash };
}

function commandPlannedFact(
  command: PlannedCommand,
  reason: string,
  evidence: ArtifactEvidenceReference[],
): CommandPlannedFact {
  return {
    type: "command_planned",
    actor: {
      kind: "system",
      component: "domain-transition",
      version: "0.0.0",
    },
    reason,
    evidence,
    payload: {
      commandId: command.commandId,
      commandKey: command.commandKey,
      commandType: command.commandType,
      reservation: command.budgetReservation,
    },
  };
}

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
  previousState: NonterminalRunState | null,
  input:
    | RunStarted
    | LedgerSubmitted
    | SourceExclusionApproved
    | LedgerApprovalRequested
    | PlanningRequested,
  policy: PinnedRunPolicy,
): TransitionResult {
  switch (input.type) {
    case "RunStarted":
      return startRun(previousState, input, policy);
    case "LedgerSubmitted":
      return submitLedger(previousState, input, policy);
    case "SourceExclusionApproved":
      return approveSourceExclusion(previousState, input, policy);
    case "LedgerApprovalRequested":
      return approveLedger(previousState, input, policy);
    case "PlanningRequested":
      return requestPlanning(previousState, input, policy);
    default:
      throw new DomainTransitionError(
        "INVALID_TRANSITION",
        `Unsupported transition: ${String((input as { type: unknown }).type)}`,
      );
  }
}

function startRun(
  previousState: NonterminalRunState | null,
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

  const budgetReservation = zeroBudgetReservation();
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
  const command = planCommand<RenderSourceRegistrationReport>(
    input.renderCommandId,
    commandWithoutIdentity,
  );
  const sourceEvidence = artifactEvidence(
    input.sourceArtifactId,
    input.sourceContentHash,
  );
  const configurationEvidence = artifactEvidence(
    input.configurationArtifactId,
    input.configurationContentHash,
  );

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
      commandPlannedFact(
        command,
        "Plan the deterministic source registration report",
        [sourceEvidence],
      ),
    ],
  };
}

function submitLedger(
  previousState: NonterminalRunState | null,
  input: LedgerSubmitted,
  policy: PinnedRunPolicy,
): TransitionResult {
  if (
    previousState === null ||
    !isNonterminalState(previousState.state) ||
    previousState.runId !== input.runId
  ) {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "LedgerSubmitted requires the matching nonterminal run",
    );
  }

  if (
    previousState.stateVersion !== input.expectedStateVersion ||
    (previousState.policyLocked &&
      previousState.policyHash !== policy.policyHash) ||
    previousState.currentLedger?.versionId === input.ledgerVersionId ||
    !input.ledgerObjectVerified ||
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

  const reservation = zeroBudgetReservation();
  const nextStateVersion = previousState.stateVersion + 1;
  const validateWithoutIdentity = {
    commandType: "validate_ledger" as const,
    schemaVersion: 1 as const,
    runId: input.runId,
    triggeringStateVersion: nextStateVersion,
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
      ...(previousState.sourceExclusions === undefined
        ? {}
        : { sourceExclusions: previousState.sourceExclusions }),
    },
  };
  const renderWithoutIdentity = {
    commandType: "render_ledger" as const,
    schemaVersion: 1 as const,
    runId: input.runId,
    triggeringStateVersion: nextStateVersion,
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
  const validateCommand = planCommand<ValidateLedger>(
    input.validateCommandId,
    validateWithoutIdentity,
  );
  const renderCommand = planCommand<RenderLedger>(
    input.renderCommandId,
    renderWithoutIdentity,
  );
  const ledgerEvidence = artifactEvidence(
    input.ledgerArtifactId,
    input.ledgerContentHash,
  );
  const sourceEvidence = artifactEvidence(
    previousState.sourceArtifactId,
    previousState.sourceContentHash,
  );
  const downstreamInvalidatedFact: DownstreamInvalidatedFact | null =
    previousState.state === "draft"
      ? null
      : {
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
              artifactId: previousState.currentLedger.artifactId,
              contentHash: previousState.currentLedger.contentHash,
            },
            ...previousState.downstreamQualification.artifacts,
          ],
          payload: {
            cause: {
              type: "ledger_revised",
              previousLedgerVersionId: previousState.currentLedger.versionId,
              nextLedgerVersionId: input.ledgerVersionId,
            },
            affectedArtifactIds:
              previousState.downstreamQualification.artifacts.map(
                (artifact) => artifact.artifactId,
              ),
            affectedGateIds: previousState.downstreamQualification.gateIds,
          },
        };

  return {
    nextState: {
      runId: previousState.runId,
      state: "draft",
      stateVersion: nextStateVersion,
      sourceArtifactId: previousState.sourceArtifactId,
      sourceContentHash: previousState.sourceContentHash,
      configurationArtifactId: previousState.configurationArtifactId,
      configurationContentHash: previousState.configurationContentHash,
      policyHash: policy.policyHash,
      policyLocked: previousState.policyLocked,
      blockedReason: null,
      ...(previousState.sourceExclusions === undefined
        ? {}
        : { sourceExclusions: previousState.sourceExclusions }),
      currentLedger: {
        versionId: input.ledgerVersionId,
        artifactId: input.ledgerArtifactId,
        contentHash: input.ledgerContentHash,
        validationStatus: "pending",
      },
    },
    commands: [validateCommand, renderCommand],
    auditFacts: [
      ...(downstreamInvalidatedFact === null
        ? []
        : [downstreamInvalidatedFact]),
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
      commandPlannedFact(validateCommand, "Plan validate_ledger", [
        ledgerEvidence,
      ]),
      commandPlannedFact(renderCommand, "Plan render_ledger", [ledgerEvidence]),
    ],
  };
}

function approveSourceExclusion(
  previousState: NonterminalRunState | null,
  input: SourceExclusionApproved,
  policy: PinnedRunPolicy,
): TransitionResult {
  if (
    previousState === null ||
    previousState.state !== "draft" ||
    previousState.runId !== input.runId
  ) {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "SourceExclusionApproved requires the matching draft run",
    );
  }

  if (
    previousState.stateVersion !== input.expectedStateVersion ||
    previousState.currentLedger === undefined ||
    (previousState.policyLocked &&
      previousState.policyHash !== policy.policyHash) ||
    !input.sourceRangeVerified ||
    !Number.isInteger(input.sourceRange.startOffset) ||
    !Number.isInteger(input.sourceRange.endOffset) ||
    input.sourceRange.startOffset < 0 ||
    input.sourceRange.endOffset <= input.sourceRange.startOffset ||
    input.reason.trim().length === 0 ||
    previousState.sourceExclusions?.some(
      (exclusion) => exclusion.exclusionId === input.exclusionId,
    ) === true ||
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
      "SourceExclusionApproved requires a verified span, reason, ledger, and workspace evidence",
    );
  }

  const sourceExclusion: SourceExclusion = {
    exclusionId: input.exclusionId,
    sourceRange: input.sourceRange,
    reason: input.reason,
  };
  const sourceExclusions = [
    ...(previousState.sourceExclusions ?? []),
    sourceExclusion,
  ];
  const nextStateVersion = previousState.stateVersion + 1;
  const reservation = zeroBudgetReservation();
  const commandWithoutIdentity = {
    commandType: "validate_ledger" as const,
    schemaVersion: 1 as const,
    runId: input.runId,
    triggeringStateVersion: nextStateVersion,
    purposeId: `${input.runId}:ledger:${previousState.currentLedger.versionId}:validate:exclusion:${input.exclusionId}`,
    inputArtifactHashes: [
      previousState.currentLedger.contentHash,
      previousState.sourceContentHash,
    ],
    policyHash: policy.policyHash,
    provider: "local" as const,
    budgetReservation: reservation,
    payload: {
      ledgerVersionId: previousState.currentLedger.versionId,
      ledgerArtifactId: previousState.currentLedger.artifactId,
      sourceArtifactId: previousState.sourceArtifactId,
      sourceExclusions,
    },
  };
  const command = planCommand<ValidateLedger>(
    input.validateCommandId,
    commandWithoutIdentity,
  );
  const sourceEvidence = artifactEvidence(
    previousState.sourceArtifactId,
    previousState.sourceContentHash,
  );
  const ledgerEvidence = artifactEvidence(
    previousState.currentLedger.artifactId,
    previousState.currentLedger.contentHash,
  );

  return {
    nextState: {
      ...previousState,
      stateVersion: nextStateVersion,
      policyHash: policy.policyHash,
      sourceExclusions,
      currentLedger: {
        ...previousState.currentLedger,
        validationStatus: "pending",
      },
    },
    commands: [command],
    auditFacts: [
      {
        type: "source_exclusion_approved",
        actor: input.actor,
        reason: "Approve a source exclusion and recompute ledger coverage",
        evidence: [sourceEvidence, ledgerEvidence],
        payload: sourceExclusion,
      },
      commandPlannedFact(
        command,
        "Recompute ledger coverage after source exclusion approval",
        [sourceEvidence, ledgerEvidence],
      ),
    ],
  };
}

function approveLedger(
  previousState: NonterminalRunState | null,
  input: LedgerApprovalRequested,
  policy: PinnedRunPolicy,
): TransitionResult {
  if (
    previousState === null ||
    previousState.state !== "draft" ||
    previousState.runId !== input.runId
  ) {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "LedgerApprovalRequested requires the matching draft run",
    );
  }

  if (
    previousState.stateVersion !== input.expectedStateVersion ||
    previousState.currentLedger === undefined ||
    input.validatedStateVersion !== previousState.stateVersion ||
    input.validatedLedgerVersionId !== previousState.currentLedger.versionId ||
    input.validatedLedgerContentHash !==
      previousState.currentLedger.contentHash ||
    input.validatedPolicyHash !== policy.policyHash ||
    (previousState.policyLocked &&
      previousState.policyHash !== policy.policyHash) ||
    !input.ledgerSchemaValid ||
    !input.lineageValid ||
    !input.identityValid ||
    !input.coverageComplete ||
    !input.coverageReportVerified ||
    typeof input.coverageReportArtifactId !== "string" ||
    input.coverageReportArtifactId.trim().length === 0 ||
    typeof input.coverageReportContentHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(input.coverageReportContentHash) ||
    input.approvalGateId.trim().length === 0 ||
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
      "LedgerApprovalRequested requires validated coverage and human approval",
    );
  }

  const nextStateVersion = previousState.stateVersion + 1;
  const reservation = zeroBudgetReservation();
  const sourceExclusions = previousState.sourceExclusions ?? [];
  const commandWithoutIdentity = {
    commandType: "render_ledger_approval" as const,
    schemaVersion: 1 as const,
    runId: input.runId,
    triggeringStateVersion: nextStateVersion,
    purposeId: `${input.runId}:ledger:${previousState.currentLedger.versionId}:approval`,
    inputArtifactHashes: [
      previousState.currentLedger.contentHash,
      input.coverageReportContentHash,
      previousState.sourceContentHash,
    ],
    policyHash: policy.policyHash,
    provider: "local" as const,
    budgetReservation: reservation,
    payload: {
      ledgerVersionId: previousState.currentLedger.versionId,
      ledgerArtifactId: previousState.currentLedger.artifactId,
      coverageReportArtifactId: input.coverageReportArtifactId,
      coverageValidatedStateVersion: input.validatedStateVersion,
      coverageValidatedPolicyHash: input.validatedPolicyHash,
      approvalGateId: input.approvalGateId,
      sourceExclusions,
      approvedBy: input.actor,
    },
  };
  const command = planCommand<RenderLedgerApproval>(
    input.renderCommandId,
    commandWithoutIdentity,
  );
  const ledgerEvidence = artifactEvidence(
    previousState.currentLedger.artifactId,
    previousState.currentLedger.contentHash,
  );
  const coverageEvidence = artifactEvidence(
    input.coverageReportArtifactId,
    input.coverageReportContentHash,
  );
  const sourceEvidence = artifactEvidence(
    previousState.sourceArtifactId,
    previousState.sourceContentHash,
  );

  return {
    nextState: {
      ...previousState,
      state: "requirements_approved",
      stateVersion: nextStateVersion,
      policyHash: policy.policyHash,
      currentLedger: {
        ...previousState.currentLedger,
        validationStatus: "approved",
      },
      downstreamQualification: {
        artifacts: [coverageEvidence],
        gateIds: [input.approvalGateId],
      },
    },
    commands: [command],
    auditFacts: [
      {
        type: "ledger_approved",
        actor: input.actor,
        reason: "Approve the validated requirements ledger",
        evidence: [ledgerEvidence, coverageEvidence],
        payload: {
          ledgerVersionId: previousState.currentLedger.versionId,
          coverageReportArtifactId: input.coverageReportArtifactId,
          coverageReportContentHash: input.coverageReportContentHash,
          coverageValidatedStateVersion: input.validatedStateVersion,
          coverageValidatedPolicyHash: input.validatedPolicyHash,
          approvalGateId: input.approvalGateId,
          approvedBy: input.actor,
        },
      },
      commandPlannedFact(command, "Render ledger approval evidence", [
        ledgerEvidence,
        coverageEvidence,
        sourceEvidence,
      ]),
    ],
  };
}

function requestPlanning(
  previousState: NonterminalRunState | null,
  input: PlanningRequested,
  policy: PinnedRunPolicy,
): TransitionResult {
  if (
    previousState === null ||
    previousState.state !== "requirements_approved" ||
    previousState.runId !== input.runId
  ) {
    throw new DomainTransitionError(
      "INVALID_TRANSITION",
      "PlanningRequested requires an approved requirements ledger",
    );
  }

  const reservation = input.budgetReservation;
  const available = input.availableBudget;
  const reservationValid =
    reservation.calls === 1 &&
    Number.isInteger(reservation.inputTokens) &&
    reservation.inputTokens > 0 &&
    Number.isInteger(reservation.outputTokens) &&
    reservation.outputTokens > 0 &&
    Number.isInteger(reservation.costUsdMicros) &&
    reservation.costUsdMicros > 0;
  const capacityValid =
    Number.isInteger(available.calls) &&
    Number.isInteger(available.inputTokens) &&
    Number.isInteger(available.outputTokens) &&
    Number.isInteger(available.costUsdMicros) &&
    available.calls >= reservation.calls &&
    available.inputTokens >= reservation.inputTokens &&
    available.outputTokens >= reservation.outputTokens &&
    available.costUsdMicros >= reservation.costUsdMicros;
  const sha256 = /^[a-f0-9]{64}$/;
  const actor = input.actor;
  const actorAuthorized =
    actor.kind === "human" &&
    typeof actor.displayName === "string" &&
    actor.displayName.length > 0 &&
    typeof actor.osAccount === "string" &&
    actor.osAccount.length > 0;

  if (
    input.expectedStateVersion !== previousState.stateVersion ||
    policy.policyHash !== previousState.policyHash ||
    !input.policyAccepted ||
    !input.budgetsAccepted ||
    !input.providerBoundaryAcknowledged ||
    !input.plannerModelAllowed ||
    !input.modelIdentityPinned ||
    !input.promptArtifactVerified ||
    !input.outputSchemaArtifactVerified ||
    input.planPurposeId.length === 0 ||
    input.plannerAssignment.modelId.length === 0 ||
    (input.plannerAssignment.provider !== "openai" &&
      input.plannerAssignment.provider !== "anthropic") ||
    input.promptArtifactId.length === 0 ||
    input.outputSchemaArtifactId.length === 0 ||
    !sha256.test(input.promptContentHash) ||
    !sha256.test(input.outputSchemaContentHash) ||
    !input.auditChainVerified ||
    !input.databaseIntegrityVerified ||
    !input.schemaCompatible ||
    !input.mutationLeaseAvailable ||
    !actorAuthorized ||
    !reservationValid ||
    !capacityValid
  ) {
    throw new DomainTransitionError(
      "PRECONDITION_FAILED",
      "PlanningRequested requires accepted policy, verified provider inputs, and sufficient reserved budget",
    );
  }

  const nextStateVersion = previousState.stateVersion + 1;
  const commandWithoutIdentity = {
    commandType: "generate_plan" as const,
    schemaVersion: 1 as const,
    runId: input.runId,
    triggeringStateVersion: nextStateVersion,
    purposeId: input.planPurposeId,
    inputArtifactHashes: [
      previousState.currentLedger.contentHash,
      input.promptContentHash,
      input.outputSchemaContentHash,
    ],
    policyHash: policy.policyHash,
    provider: input.plannerAssignment.provider,
    modelId: input.plannerAssignment.modelId,
    budgetReservation: input.budgetReservation,
    payload: {
      ledgerVersionId: previousState.currentLedger.versionId,
      ledgerArtifactId: previousState.currentLedger.artifactId,
      promptArtifactId: input.promptArtifactId,
      outputSchemaArtifactId: input.outputSchemaArtifactId,
      providerStorage: "minimize" as const,
    },
  };
  const command = planCommand<GeneratePlan>(
    input.generateCommandId,
    commandWithoutIdentity,
  );
  const evidence = [
    artifactEvidence(
      previousState.currentLedger.artifactId,
      previousState.currentLedger.contentHash,
    ),
    artifactEvidence(input.promptArtifactId, input.promptContentHash),
    artifactEvidence(
      input.outputSchemaArtifactId,
      input.outputSchemaContentHash,
    ),
  ];
  const systemActor: SystemActor = {
    kind: "system",
    component: "domain-transition",
    version: "0.0.0",
  };

  return {
    nextState: {
      ...previousState,
      state: "planning",
      stateVersion: nextStateVersion,
      policyLocked: true,
      activePlanning: {
        purposeId: input.planPurposeId,
        plannerAssignment: input.plannerAssignment,
        reservedBudget: input.budgetReservation,
      },
    },
    commands: [command],
    auditFacts: [
      {
        type: "planning_requested",
        actor: input.actor,
        reason: "Request a plan from the assigned Planner",
        evidence,
        payload: {
          planPurposeId: input.planPurposeId,
          plannerAssignment: input.plannerAssignment,
          policyHash: policy.policyHash,
          budgetReservation: input.budgetReservation,
        },
      },
      commandPlannedFact(
        command,
        "Generate plan with the assigned Planner",
        evidence,
      ),
      {
        type: "budget_reserved",
        actor: systemActor,
        reason: "Reserve the maximum budget before provider dispatch",
        evidence,
        payload: {
          commandId: command.commandId,
          reservation: command.budgetReservation,
        },
      },
    ],
  };
}

function isNonterminalState(state: string): boolean {
  return (
    state === "draft" ||
    state === "requirements_approved" ||
    state === "planning" ||
    state === "baseline_review" ||
    state === "remediation" ||
    state === "closure" ||
    state === "qualified" ||
    state === "qualified_with_waivers"
  );
}
