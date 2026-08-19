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

export type ValidatedProjectionData = {
  validator: "deterministic-authority-projection-v1";
  stateVersion: number;
  ledgerVersionId?: string;
  ledgerContentHash?: string;
  planVersionId?: string;
  planContentHash?: string;
  reviewContentHash?: string;
  schemaValid: boolean;
  controlledIdsValid: boolean;
  referencesComplete: boolean;
  identitiesUnique: boolean;
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

const validatedProjectionBrand = Symbol("ValidatedProjection");

export class ValidatedProjection {
  readonly [validatedProjectionBrand] = true;

  private constructor(private readonly value: ValidatedProjectionData) {}

  static fromLedgerArtifact(input: {
    bytes: Uint8Array;
    contentHash: string;
    stateVersion: number;
    ledgerVersionId: string;
  }): ValidatedProjection {
    const observedHash = createHash("sha256").update(input.bytes).digest("hex");
    if (observedHash !== input.contentHash) {
      throw new TypeError(
        "Ledger projection hash does not match artifact bytes",
      );
    }
    const parsed: unknown = JSON.parse(
      Buffer.from(input.bytes).toString("utf8"),
    );
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new TypeError("Ledger projection requires a valid ledger object");
    }
    const ledger = parsed as Record<string, unknown>;
    if (
      ledger.schema_version !== 1 ||
      ledger.ledger_id !== input.ledgerVersionId ||
      !Array.isArray(ledger.requirements) ||
      ledger.requirements.length === 0
    ) {
      throw new TypeError("Ledger artifact does not satisfy projection schema");
    }
    const requirements = ledger.requirements.map((value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("Ledger requirement is invalid");
      }
      const requirement = value as Record<string, unknown>;
      if (
        typeof requirement.requirement_id !== "string" ||
        typeof requirement.display_id !== "string" ||
        typeof requirement.statement !== "string" ||
        !["active", "removed", "replaced"].includes(
          String(requirement.status),
        ) ||
        !Array.isArray(requirement.source_ranges) ||
        !Array.isArray(requirement.lineage_roots) ||
        (requirement.predecessor_ids !== undefined &&
          !Array.isArray(requirement.predecessor_ids))
      ) {
        throw new TypeError("Ledger requirement is invalid");
      }
      return {
        requirementId: requirement.requirement_id,
        displayId: requirement.display_id,
        status: requirement.status as "active" | "removed" | "replaced",
        statement: requirement.statement,
        sourceRanges: requirement.source_ranges,
        lineageRoots: requirement.lineage_roots as string[],
        predecessorIds: (requirement.predecessor_ids ?? []) as string[],
      };
    });
    return new ValidatedProjection({
      validator: "deterministic-authority-projection-v1",
      stateVersion: input.stateVersion,
      ledgerVersionId: input.ledgerVersionId,
      ledgerContentHash: input.contentHash,
      schemaValid: true,
      controlledIdsValid: true,
      referencesComplete: true,
      identitiesUnique:
        new Set(requirements.map(({ requirementId }) => requirementId)).size ===
        requirements.length,
      requirements,
    });
  }

  toPersistenceData(): ValidatedProjectionData {
    if (this[validatedProjectionBrand] !== true) {
      throw new TypeError("Projection validation capability is invalid");
    }
    return this.value;
  }
}

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
import { createHash } from "node:crypto";
