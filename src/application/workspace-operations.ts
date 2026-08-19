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
};

export type FindingSummary = {
  findingId: string;
  status: string;
  severity: string;
  createdAt: string;
  updatedAt: string;
  fingerprints: string[];
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
  totals: {
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
      | "CONFLICT",
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "WorkspaceOperationError";
  }
}

export interface WorkspaceOperations {
  initialize(projectRoot: string): Promise<{ workspaceRoot: string }>;
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
