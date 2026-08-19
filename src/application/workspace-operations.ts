import type { ProviderBoundaryDisclosure } from "../domain/index.js";

export type RunSummary = {
  runId: string;
  state: string;
  stateVersion: number;
  createdAt: string;
};

export type AuditSummary = {
  sequence: number;
  runId: string;
  factType: string;
  stateVersionBefore: number;
  stateVersionAfter: number;
  recordedAt: string;
  [key: string]: unknown;
};

export type ArtifactSummary = {
  artifactId: string;
  kind: string;
  contentHash: string;
  byteLength: number;
  mediaType: string;
  schemaId: string | null;
  metadata: object;
  createdAt: string;
  objectVerified: true;
};

export type FindingSummary = {
  findingId: string;
  status: string;
  severity: string;
  createdAt: string;
  updatedAt: string;
  fingerprints: Array<{
    fingerprint: string;
    policyHash: string;
    createdAt: string;
  }>;
  observations: Array<{
    observationId: string;
    reviewArtifactId: string;
    planVersionId: string;
    reviewKind: string;
    disposition: string;
    severity: string;
    ruleId: string;
    componentIds: string[];
    requirementIds: string[];
    evidence: unknown[];
    createdAt: string;
  }>;
  waivers: Array<{
    waiverId: string;
    status: string;
    reason: string;
    evidenceHash: string;
    grantedByActorId: string;
    grantedAt: string;
    reaffirmedAt: string | null;
  }>;
  history: AuditSummary[];
};

export type UsageSummary = {
  entries: Array<{
    usageEntryId: string;
    commandId: string | null;
    attemptId: string | null;
    kind: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsdMicros: number;
    nativeUsageArtifactId: string | null;
    createdAt: string;
  }>;
  actualAndConservative: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsdMicros: number;
  };
  outstandingReserved: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsdMicros: number;
  };
  effectiveConsumption: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsdMicros: number;
  };
};

export type GateSummary = {
  gateId: string;
  gateType: string;
  status: string;
  evidenceArtifactId: string | null;
  evaluatedAt: string;
};

export class WorkspaceOperationError extends Error {
  constructor(
    readonly code:
      | "WORKSPACE_NOT_FOUND"
      | "RUN_NOT_FOUND"
      | "SCHEMA_INCOMPATIBLE"
      | "INTEGRITY_ERROR"
      | "CONFLICT"
      | "INVALID_INPUT"
      | "INPUT_NOT_FOUND",
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "WorkspaceOperationError";
  }
}

export interface WorkspaceOperations {
  initialize(projectRoot: string): Promise<{ workspaceRoot: string }>;
  configure(
    projectRoot: string,
    configurationPath?: string,
    overrideConfigurationPath?: string,
  ): Promise<{
    configurationArtifactId: string;
    configurationContentHash: string;
    policyHash: string;
  }>;
  startRun(
    projectRoot: string,
    sourcePath: string,
    configurationArtifactId: string,
  ): Promise<{ runId: string; state: object }>;
  submitLedger(
    projectRoot: string,
    runId: string,
    ledgerPath: string,
  ): Promise<{ state: object; ledgerArtifactId: string }>;
  approveSourceExclusion(
    projectRoot: string,
    runId: string,
    exclusionId: string,
    startOffset: number,
    endOffset: number,
    reason: string,
  ): Promise<{ state: object }>;
  executeNext(
    projectRoot: string,
    runId: string,
  ): Promise<{
    commandId: string;
    commandType: string;
    resultArtifactId: string;
  } | null>;
  approveLedger(
    projectRoot: string,
    runId: string,
  ): Promise<{ state: object; coverageReportArtifactId: string }>;
  requestPlanning(
    projectRoot: string,
    runId: string,
    acceptance: {
      policy: boolean;
      budgets: boolean;
      providerBoundary: boolean;
      providerBoundaryDisclosureHash: string;
    },
  ): Promise<{
    state: object;
    commandId: string;
    providerBoundaryDisclosure: ProviderBoundaryDisclosure;
    providerBoundaryDisclosureHash: string;
  }>;
  previewPlanningBoundary(
    projectRoot: string,
    runId: string,
  ): Promise<{
    providerBoundaryDisclosure: ProviderBoundaryDisclosure;
    providerBoundaryDisclosureHash: string;
  }>;
  listRuns(projectRoot: string): Promise<RunSummary[]>;
  loadRun(projectRoot: string, runId: string): Promise<object | null>;
  listAudit(projectRoot: string, runId?: string): Promise<AuditSummary[]>;
  listArtifacts(
    projectRoot: string,
    runId?: string,
  ): Promise<ArtifactSummary[]>;
  listFindings(projectRoot: string, runId: string): Promise<FindingSummary[]>;
  loadUsage(projectRoot: string, runId: string): Promise<UsageSummary>;
  listGates(projectRoot: string, runId: string): Promise<GateSummary[]>;
}
