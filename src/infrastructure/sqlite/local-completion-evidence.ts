import type { DatabaseSync } from "node:sqlite";

import type {
  PersistableCommand,
  PersistableTransition,
} from "../../application/authority-port.js";
import type { CompleteAttemptRequest } from "../../application/execution-port.js";
import type { StagedArtifactRegistration } from "../../application/artifact-port.js";
import { AuthorityIntegrityError } from "./errors.js";

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
    const expectedIds = [payload.ledgerArtifactId, payload.sourceArtifactId]
      .filter((value): value is string => typeof value === "string")
      .sort();
    for (const artifact of [
      request.resultArtifact,
      request.nativeUsageArtifact,
    ]) {
      const actualIds =
        artifact.provenance.method === "application_generated"
          ? [...artifact.provenance.sourceArtifactIds].sort()
          : [];
      if (
        actualIds.length !== expectedIds.length ||
        actualIds.some((id, index) => id !== expectedIds[index])
      )
        throw new TypeError("Local result provenance inputs are invalid");
    }
    for (const artifactId of expectedIds) {
      const row = this.database
        .prepare("SELECT content_hash FROM artifacts WHERE artifact_id = ?")
        .get(artifactId) as { content_hash: string } | undefined;
      if (
        row === undefined ||
        !command.inputArtifactHashes.includes(row.content_hash)
      )
        throw new AuthorityIntegrityError(
          "Local command input artifact binding is invalid",
        );
    }
  }

  assertValidationDomain(
    request: CompleteAttemptRequest,
    domain: {
      expectedStateVersion: number;
      result: PersistableTransition<object>;
    },
  ): void {
    const facts = domain.result.auditFacts.filter(
      ({ type }) => type === "ledger_validation_completed",
    );
    const state = domain.result.nextState as Record<string, unknown>;
    const ledger = state.currentLedger as Record<string, unknown> | undefined;
    const validation = ledger?.validation as
      Record<string, unknown> | undefined;
    const report = JSON.parse(
      this.readStagedArtifactBytes(request.resultArtifact).toString("utf8"),
    ) as Record<string, unknown>;
    const factPayload = facts[0]?.payload as
      Record<string, unknown> | undefined;
    if (
      facts.length !== 1 ||
      factPayload?.commandId !== request.commandId ||
      validation?.coverageReportArtifactId !==
        request.resultArtifact.artifactId ||
      validation.coverageReportContentHash !==
        request.resultArtifact.contentHash ||
      Number(state.stateVersion) !== domain.expectedStateVersion + 1 ||
      report.ledgerContentHash !== ledger?.contentHash ||
      report.sourceContentHash !== state.sourceContentHash ||
      report.coverageValid !== validation.coverageComplete ||
      factPayload.coverageComplete !== report.coverageValid ||
      factPayload.uncoveredRangeCount !==
        (Array.isArray(report.uncoveredRanges)
          ? report.uncoveredRanges.length
          : -1)
    )
      throw new TypeError(
        "Ledger validation domain outcome does not match the completed attempt",
      );
  }
}
