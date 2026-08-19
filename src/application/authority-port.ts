export type PersistableCommand = {
  commandId: string;
  commandKey: string;
  commandType: string;
  schemaVersion: number;
  runId: string;
  triggeringStateVersion: number;
  purposeId: string;
  prerequisiteCommandIds?: string[];
  inputArtifactHashes: string[];
  policyHash: string;
  provider?: "openai" | "anthropic" | "manual" | "local";
  modelId?: string;
  budgetReservation: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsdMicros: number;
  };
  payload: object;
};

export type PersistableAuditFact = {
  type: string;
  actor: object;
  reason?: string;
  evidence: unknown[];
  payload: object;
};

export type PersistableTransition<TState extends object> = {
  nextState: TState;
  commands: PersistableCommand[];
  auditFacts: PersistableAuditFact[];
};

export type PersistTransitionRequest = {
  runId: string;
  expectedStateVersion: number;
  causationId?: string;
  correlationId?: string;
  validatedProjection?: ValidatedProjection;
};

export type ValidatedProjection = {
  validator: "deterministic-authority-projection-v1";
  stateVersion: number;
  ledgerVersionId?: string;
  planVersionId?: string;
  requirements?: Array<{
    requirementId: string;
    displayId: string;
    status: "active" | "removed" | "replaced";
    statement: string;
    sourceRanges: unknown[];
    lineageRoots: string[];
    predecessorIds: string[];
  }>;
  planSections?: Array<{
    sectionId: string;
    kind: string;
    title: string;
    normalizedHash: string;
    componentIds: string[];
    requirementIds: string[];
  }>;
  sectionTransitions?: Array<{
    transitionId: string;
    kind: "preserved" | "retitled" | "split" | "merged" | "retired" | "new";
    fromIds: string[];
    toIds: string[];
    reason: string;
  }>;
  findingFingerprints?: Array<{
    findingId: string;
    fingerprint: string;
    policyHash: string;
  }>;
  observationAssociations?: Array<{
    observationId: string;
    componentIds: string[];
    requirementIds: string[];
  }>;
};

export interface AuthorityTransaction {
  loadRun<TState extends object>(runId: string): TState | null;
  persist<TState extends object>(
    request: PersistTransitionRequest,
    result: PersistableTransition<TState>,
  ): void;
}

export interface AuthorityPort {
  transaction<T>(work: (transaction: AuthorityTransaction) => T): Promise<T>;
}
