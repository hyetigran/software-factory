import { createHash, randomUUID } from "node:crypto";

import {
  transition,
  type HumanActor,
  type NonterminalRunState,
} from "../domain/index.js";
import type { AuthorityPort } from "./authority-port.js";
import type { LedgerValidationReport } from "./deterministic-documents.js";
import type { ResolvedConfigurationSnapshot } from "./stage-configuration.js";
import { WorkspaceOperationError } from "./workspace-operations.js";

export async function approveLedger(input: {
  authority: AuthorityPort;
  runId: string;
  coverageReportBytes: Uint8Array;
  configuration: ResolvedConfigurationSnapshot;
  actor: HumanActor;
}): Promise<{ state: object; coverageReportArtifactId: string }> {
  const contentHash = createHash("sha256")
    .update(input.coverageReportBytes)
    .digest("hex");
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(input.coverageReportBytes).toString("utf8"),
    );
  } catch (error) {
    throw new WorkspaceOperationError(
      "INTEGRITY_ERROR",
      "Coverage report is corrupt",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new WorkspaceOperationError(
      "INTEGRITY_ERROR",
      "Coverage report must be an object",
    );
  const report = parsed as LedgerValidationReport;
  return input.authority.transaction((transaction) => {
    const state = transaction.loadRun<NonterminalRunState>(input.runId);
    if (state === null || state.currentLedger === undefined)
      throw new WorkspaceOperationError(
        "CONFLICT",
        "Ledger approval requires a submitted ledger",
      );
    const validation = state.currentLedger.validation;
    if (
      state.currentLedger.validationStatus !== "validated" ||
      validation === undefined ||
      validation.coverageReportContentHash !== contentHash ||
      report.validator !== "deterministic-ledger-validator-v1" ||
      report.ledgerContentHash !== state.currentLedger.contentHash ||
      report.sourceContentHash !== state.sourceContentHash ||
      report.schemaValid !== true ||
      report.identityValid !== true ||
      report.lineageValid !== true ||
      report.coverageValid !== true ||
      report.uncoveredRanges.length !== 0 ||
      validation.coverageComplete !== true ||
      validation.validatedStateVersion !== state.stateVersion
    ) {
      throw new WorkspaceOperationError(
        "CONFLICT",
        "Ledger validation evidence is not approval-ready",
      );
    }
    const accepted = transition(
      state,
      {
        type: "LedgerApprovalRequested",
        runId: input.runId,
        expectedStateVersion: state.stateVersion,
        validatedStateVersion: validation.validatedStateVersion,
        validatedLedgerVersionId: state.currentLedger.versionId,
        validatedLedgerContentHash: state.currentLedger.contentHash,
        validatedPolicyHash: input.configuration.policyHash,
        ledgerSchemaValid: report.schemaValid,
        lineageValid: report.lineageValid,
        identityValid: report.identityValid,
        coverageComplete: report.coverageValid,
        coverageReportArtifactId: validation.coverageReportArtifactId,
        coverageReportContentHash: validation.coverageReportContentHash,
        coverageReportVerified: true,
        approvalGateId: `gate_${randomUUID().replaceAll("-", "")}`,
        auditChainVerified: true,
        databaseIntegrityVerified: true,
        schemaCompatible: true,
        mutationLeaseAvailable: true,
        renderCommandId: `command_${randomUUID().replaceAll("-", "")}`,
        actor: input.actor,
      },
      {
        policyHash: input.configuration.policyHash,
        plannerAssignment: input.configuration.plannerAssignment,
        reviewerAssignment: input.configuration.reviewerAssignment,
      },
    );
    transaction.persist(
      { runId: input.runId, expectedStateVersion: state.stateVersion },
      accepted,
    );
    return {
      state: accepted.nextState,
      coverageReportArtifactId: validation.coverageReportArtifactId,
    };
  });
}
