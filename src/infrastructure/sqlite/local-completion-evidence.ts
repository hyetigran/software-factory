import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

import type {
  PersistableCommand,
  PersistableTransition,
} from "../../application/authority-port.js";
import type { CompleteAttemptRequest } from "../../application/execution-port.js";
import type { StagedArtifactRegistration } from "../../application/artifact-port.js";
import { AuthorityIntegrityError } from "./errors.js";
import { canonicalJson } from "../../domain/canonical-json.js";
import { renderLedger } from "../../application/deterministic-documents.js";

export class LocalCompletionEvidence {
  constructor(
    private readonly database: DatabaseSync,
    private readonly readStagedArtifactBytes: (
      artifact: StagedArtifactRegistration,
    ) => Buffer,
    private readonly readRegisteredObject: (contentHash: string) => Buffer,
  ) {}

  assertProvenance(
    request: CompleteAttemptRequest,
    command: PersistableCommand,
  ): void {
    const resultPurpose =
      command.commandType === "validate_ledger"
        ? "ledger_validation"
        : command.commandType === "render_ledger"
          ? "ledger_render"
          : command.commandType === "render_source_registration_report"
            ? "source_registration"
            : "ledger_approval";
    const matches = (
      artifact: StagedArtifactRegistration,
      purpose:
        | "ledger_validation"
        | "ledger_render"
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
          : command.commandType === "render_ledger"
            ? ["ledgerArtifactId"]
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

  assertUsage(request: CompleteAttemptRequest): void {
    const usageBytes = this.readStagedArtifactBytes(
      request.nativeUsageArtifact,
    );
    const expectedBytes = Buffer.from(
      canonicalJson({
        commandId: request.commandId,
        attemptId: request.attemptId,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsdMicros: 0,
      }),
    );
    if (
      !usageBytes.equals(expectedBytes) ||
      canonicalJson(request.actualUsage) !==
        canonicalJson({
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        })
    )
      throw new TypeError(
        "Local usage evidence does not match the completed attempt",
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
    const proposedCommand = domain.result.commands[0];
    const commandWithoutIdentity = {
      commandType: "render_ledger",
      schemaVersion: 1,
      runId: request.runId,
      triggeringStateVersion: domain.expectedStateVersion + 1,
      purposeId: `${request.runId}:ledger:${String(currentLedger.versionId)}:render`,
      inputArtifactHashes: [String(currentLedger.contentHash)],
      policyHash: String(currentState.policyHash),
      provider: "local",
      budgetReservation: {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsdMicros: 0,
      },
      payload: {
        ledgerVersionId: String(currentLedger.versionId),
        ledgerArtifactId: String(currentLedger.artifactId),
      },
    };
    const expectedCommand = {
      commandId: proposedCommand?.commandId,
      commandKey: createHash("sha256")
        .update(canonicalJson(commandWithoutIdentity))
        .digest("hex"),
      ...commandWithoutIdentity,
    };
    const expectedCommandFact = {
      type: "command_planned",
      actor: {
        kind: "system",
        component: "domain-transition",
        version: "0.0.0",
      },
      reason: "Plan render_ledger",
      evidence: [
        {
          kind: "artifact",
          artifactId: currentLedger.artifactId,
          contentHash: currentLedger.contentHash,
        },
      ],
      payload: {
        commandId: expectedCommand.commandId,
        commandKey: expectedCommand.commandKey,
        commandType: "render_ledger",
        reservation: commandWithoutIdentity.budgetReservation,
      },
    };
    if (
      domain.result.commands.length !== 1 ||
      domain.result.auditFacts.length !== 2 ||
      canonicalJson(domain.result.nextState) !== canonicalJson(expectedState) ||
      canonicalJson(domain.result.auditFacts[0]) !==
        canonicalJson(expectedFact) ||
      canonicalJson(domain.result.commands[0]) !==
        canonicalJson(expectedCommand) ||
      canonicalJson(domain.result.auditFacts[1]) !==
        canonicalJson(expectedCommandFact) ||
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

  assertLedgerRenderDomain(
    request: CompleteAttemptRequest,
    domain: {
      expectedStateVersion: number;
      result: PersistableTransition<object>;
    },
  ): void {
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
    const commandRow = this.database
      .prepare(
        "SELECT specification_json FROM logical_commands WHERE command_id = ?",
      )
      .get(request.commandId) as { specification_json: string } | undefined;
    if (commandRow === undefined)
      throw new AuthorityIntegrityError("Local render command is missing");
    const command = JSON.parse(commandRow.specification_json) as Record<
      string,
      unknown
    >;
    const payload = command.payload as Record<string, unknown>;
    const ledgerRow = this.database
      .prepare("SELECT content_hash FROM artifacts WHERE artifact_id = ?")
      .get(String(payload.ledgerArtifactId)) as
      { content_hash: string } | undefined;
    if (ledgerRow === undefined)
      throw new AuthorityIntegrityError("Ledger render input is missing");
    const ledgerBytes = this.readRegisteredObject(ledgerRow.content_hash);
    const expectedRender = renderLedger(ledgerBytes);
    const actualRender = this.readStagedArtifactBytes(request.resultArtifact);
    const expectedState = {
      ...currentState,
      stateVersion: domain.expectedStateVersion + 1,
      currentLedger: {
        ...currentLedger,
        renderedProjection: {
          artifactId: request.resultArtifact.artifactId,
          contentHash: request.resultArtifact.contentHash,
          renderedStateVersion: domain.expectedStateVersion + 1,
        },
      },
    };
    const expectedFact = {
      type: "ledger_rendered",
      actor: {
        kind: "system",
        component: "deterministic-local-executor",
        version: "0.0.0",
      },
      reason: "Record deterministic ledger projection",
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
        renderedArtifactId: request.resultArtifact.artifactId,
        renderedContentHash: request.resultArtifact.contentHash,
      },
    };
    if (
      !actualRender.equals(expectedRender.bytes) ||
      expectedRender.contentHash !== request.resultArtifact.contentHash ||
      request.resultArtifact.kind !== "rendered_ledger" ||
      request.resultArtifact.mediaType !== expectedRender.mediaType ||
      domain.result.commands.length !== 0 ||
      domain.result.auditFacts.length !== 1 ||
      canonicalJson(domain.result.nextState) !== canonicalJson(expectedState) ||
      canonicalJson(domain.result.auditFacts[0]) !== canonicalJson(expectedFact)
    )
      throw new TypeError(
        "Ledger render domain outcome does not match deterministic output",
      );
  }
}
