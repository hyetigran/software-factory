import type { DatabaseSync } from "node:sqlite";

import type {
  PersistableCommand,
  PersistableTransition,
} from "../../application/authority-port.js";
import type { CompleteAttemptRequest } from "../../application/execution-port.js";
import type { StagedArtifactRegistration } from "../../application/artifact-port.js";
import { AuthorityIntegrityError } from "./errors.js";
import { canonicalJson } from "../../domain/canonical-json.js";

export class LocalCompletionEvidence {
  constructor(
    private readonly database: DatabaseSync,
    private readonly readStagedArtifactBytes: (
      artifact: StagedArtifactRegistration,
    ) => Buffer,
  ) {}

  assertProvenance(
    request: CompleteAttemptRequest,
    command: PersistableCommand,
  ): void {
    const resultPurpose =
      command.commandType === "validate_ledger"
        ? "ledger_validation"
        : command.commandType === "render_source_registration_report"
          ? "source_registration"
          : "ledger_approval";
    const matches = (
      artifact: StagedArtifactRegistration,
      purpose:
        | "ledger_validation"
        | "source_registration"
        | "ledger_approval"
        | "local_usage",
    ): boolean =>
      artifact.provenance.method === "application_generated" &&
      artifact.provenance.purpose === purpose &&
      artifact.provenance.commandId === request.commandId &&
      artifact.provenance.attemptId === request.attemptId;
    if (
      !matches(request.resultArtifact, resultPurpose) ||
      !matches(request.nativeUsageArtifact, "local_usage")
    )
      throw new TypeError(
        "Completed artifacts do not belong to the command attempt",
      );
    const payload = command.payload as Record<string, unknown>;
    const fields =
      command.commandType === "render_source_registration_report"
        ? ["sourceArtifactId"]
        : command.commandType === "validate_ledger"
          ? ["ledgerArtifactId", "sourceArtifactId"]
          : command.commandType === "render_ledger_approval"
            ? [
                "ledgerArtifactId",
                "coverageReportArtifactId",
                "sourceArtifactId",
              ]
            : [];
    const expectedIds = fields.map((field) => payload[field]);
    if (
      expectedIds.some(
        (value) => typeof value !== "string" || value.trim().length === 0,
      ) ||
      new Set(expectedIds).size !== expectedIds.length
    )
      throw new AuthorityIntegrityError(
        "Local command input artifact identities are invalid",
      );
    const controlledIds = (expectedIds as string[]).sort();
    for (const artifact of [
      request.resultArtifact,
      request.nativeUsageArtifact,
    ]) {
      const actualIds =
        artifact.provenance.method === "application_generated"
          ? [...artifact.provenance.sourceArtifactIds].sort()
          : [];
      if (
        actualIds.length !== controlledIds.length ||
        actualIds.some((id, index) => id !== controlledIds[index])
      )
        throw new TypeError("Local result provenance inputs are invalid");
    }
    const expectedHashes: string[] = [];
    for (const artifactId of controlledIds) {
      const row = this.database
        .prepare("SELECT content_hash FROM artifacts WHERE artifact_id = ?")
        .get(artifactId) as { content_hash: string } | undefined;
      if (row === undefined)
        throw new AuthorityIntegrityError(
          "Local command input artifact binding is invalid",
        );
      expectedHashes.push(row.content_hash);
    }
    const declaredHashes = [...command.inputArtifactHashes].sort();
    expectedHashes.sort();
    if (
      declaredHashes.length !== expectedHashes.length ||
      declaredHashes.some((hash, index) => hash !== expectedHashes[index])
    )
      throw new AuthorityIntegrityError(
        "Local command input hash set is invalid",
      );
  }

  assertValidationDomain(
    request: CompleteAttemptRequest,
    domain: {
      expectedStateVersion: number;
      result: PersistableTransition<object>;
    },
  ): void {
    const state = domain.result.nextState as Record<string, unknown>;
    const ledger = state.currentLedger as Record<string, unknown> | undefined;
    const validation = ledger?.validation as
      Record<string, unknown> | undefined;
    const report = JSON.parse(
      this.readStagedArtifactBytes(request.resultArtifact).toString("utf8"),
    ) as Record<string, unknown>;
    const currentRow = this.database
      .prepare("SELECT state_json FROM run_state_snapshots WHERE run_id = ?")
      .get(request.runId) as { state_json: string } | undefined;
    if (currentRow === undefined)
      throw new AuthorityIntegrityError(
        "Local completion run state is missing",
      );
    const currentState = JSON.parse(currentRow.state_json) as Record<
      string,
      unknown
    >;
    const currentLedger = currentState.currentLedger as Record<string, unknown>;
    const uncoveredRangeCount = Array.isArray(report.uncoveredRanges)
      ? report.uncoveredRanges.length
      : -1;
    const expectedState = {
      ...currentState,
      stateVersion: domain.expectedStateVersion + 1,
      currentLedger: {
        ...currentLedger,
        validationStatus: "validated",
        validation: {
          coverageReportArtifactId: request.resultArtifact.artifactId,
          coverageReportContentHash: request.resultArtifact.contentHash,
          validatedStateVersion: domain.expectedStateVersion + 1,
          coverageComplete: report.coverageValid,
        },
      },
    };
    const expectedFact = {
      type: "ledger_validation_completed",
      actor: {
        kind: "system",
        component: "deterministic-local-executor",
        version: "0.0.0",
      },
      reason: "Record deterministic ledger validation",
      evidence: [
        {
          kind: "artifact",
          artifactId: request.resultArtifact.artifactId,
          contentHash: request.resultArtifact.contentHash,
        },
      ],
      payload: {
        commandId: request.commandId,
        ledgerVersionId: currentLedger.versionId,
        schemaValid: true,
        identityValid: true,
        lineageValid: true,
        coverageComplete: report.coverageValid,
        uncoveredRangeCount,
      },
    };
    if (
      domain.result.commands.length !== 0 ||
      domain.result.auditFacts.length !== 1 ||
      canonicalJson(domain.result.nextState) !== canonicalJson(expectedState) ||
      canonicalJson(domain.result.auditFacts[0]) !==
        canonicalJson(expectedFact) ||
      validation?.coverageReportArtifactId !==
        request.resultArtifact.artifactId ||
      validation.coverageReportContentHash !==
        request.resultArtifact.contentHash ||
      Number(state.stateVersion) !== domain.expectedStateVersion + 1 ||
      report.ledgerContentHash !== ledger?.contentHash ||
      report.sourceContentHash !== state.sourceContentHash ||
      report.validator !== "deterministic-ledger-validator-v1" ||
      report.schemaValid !== true ||
      report.identityValid !== true ||
      report.lineageValid !== true ||
      report.coverageValid !== validation.coverageComplete ||
      uncoveredRangeCount < 0
    )
      throw new TypeError(
        "Ledger validation domain outcome does not match the completed attempt",
      );
  }
}
