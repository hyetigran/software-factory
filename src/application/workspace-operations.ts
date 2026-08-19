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
}
