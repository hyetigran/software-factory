import type { DatabaseSync } from "node:sqlite";

import type {
  PersistableCommand,
  PersistableTransition,
} from "../../application/authority-port.js";
import type { CompleteAttemptRequest } from "../../application/execution-port.js";
import type { StagedArtifactRegistration } from "../../application/artifact-port.js";
import { AuthorityIntegrityError } from "./errors.js";
import { canonicalJson } from "../../domain/canonical-json.js";
import {
  completeLedgerRender,
  completeLedgerValidation,
  type NonterminalRunState,
} from "../../domain/index.js";
import {
  renderLedger,
  validateLedger,
} from "../../application/deterministic-documents.js";
import { localCommandSpecification } from "../../application/local-command-specification.js";

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
    const specification = localCommandSpecification(command);
    if (specification === null)
      throw new TypeError("Unsupported local command completion");
    const resultPurpose = specification.resultPurpose;
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
    const fields = specification.controlledArtifactFields;
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
    command: PersistableCommand,
    domain: {
      expectedStateVersion: number;
      result: PersistableTransition<object>;
    },
    validateTransition = true,
  ): void {
    const currentRow = this.database
      .prepare("SELECT state_json FROM run_state_snapshots WHERE run_id = ?")
      .get(request.runId) as { state_json: string } | undefined;
    if (currentRow === undefined)
      throw new AuthorityIntegrityError(
        "Local completion run state is missing",
      );
    const currentState = JSON.parse(
      currentRow.state_json,
    ) as NonterminalRunState;
    if (currentState.currentLedger === undefined)
      throw new AuthorityIntegrityError("Current ledger is missing");
    const payload = command.payload as Record<string, unknown>;
    const artifactHash = (artifactId: unknown): string => {
      const row = this.database
        .prepare("SELECT content_hash FROM artifacts WHERE artifact_id = ?")
        .get(String(artifactId)) as { content_hash: string } | undefined;
      if (row === undefined)
        throw new AuthorityIntegrityError("Local validation input is missing");
      return row.content_hash;
    };
    const ledgerHash = artifactHash(payload.ledgerArtifactId);
    const sourceHash = artifactHash(payload.sourceArtifactId);
    const configuration = JSON.parse(
      this.readRegisteredObject(currentState.configurationContentHash).toString(
        "utf8",
      ),
    ) as { artifactHashes?: { requirementsSchema?: unknown } };
    const schemaHash = configuration.artifactHashes?.requirementsSchema;
    if (typeof schemaHash !== "string")
      throw new AuthorityIntegrityError(
        "Pinned requirements schema identity is missing",
      );
    const exclusions =
      (payload.sourceExclusions as
        Array<Record<string, unknown>> | undefined) ?? [];
    const report = validateLedger({
      ledgerBytes: this.readRegisteredObject(ledgerHash),
      ledgerSchema: JSON.parse(
        this.readRegisteredObject(schemaHash).toString("utf8"),
      ) as unknown,
      sourceBytes: this.readRegisteredObject(sourceHash),
      expectedSourceArtifactId: String(payload.sourceArtifactId),
      approvedExclusions: exclusions.map((exclusion) => {
        const range = exclusion.sourceRange as Record<string, unknown>;
        return {
          exclusionId: String(exclusion.exclusionId),
          sourceRange: {
            startByte: Number(range.startOffset),
            endByte: Number(range.endOffset),
          },
          reason: String(exclusion.reason),
        };
      }),
    });
    const reportBytes = this.readStagedArtifactBytes(request.resultArtifact);
    const expectedReportBytes = Buffer.from(canonicalJson(report));
    if (!reportBytes.equals(expectedReportBytes))
      throw new TypeError(
        "Ledger validation result does not match deterministic output",
      );
    if (!validateTransition) return;
    const proposedCommand = domain.result.commands[0];
    if (proposedCommand === undefined)
      throw new TypeError("Ledger validation must plan its render command");
    const expected = completeLedgerValidation(
      currentState,
      {
        type: "LedgerValidationCompleted",
        runId: request.runId,
        expectedStateVersion: domain.expectedStateVersion,
        commandId: request.commandId,
        ledgerVersionId: String(payload.ledgerVersionId),
        ledgerContentHash: report.ledgerContentHash,
        sourceContentHash: report.sourceContentHash,
        coverageReportArtifactId: request.resultArtifact.artifactId,
        coverageReportContentHash: request.resultArtifact.contentHash,
        schemaValid: report.schemaValid,
        identityValid: report.identityValid,
        lineageValid: report.lineageValid,
        coverageComplete: report.coverageValid,
        uncoveredRangeCount: report.uncoveredRanges.length,
        renderCommandId: proposedCommand.commandId,
        actor: {
          kind: "system",
          component: "deterministic-local-executor",
          version: "0.0.0",
        },
      },
      { policyHash: currentState.policyHash },
    );
    if (canonicalJson(domain.result) !== canonicalJson(expected))
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
    validateTransition = true,
  ): void {
    const currentRow = this.database
      .prepare("SELECT state_json FROM run_state_snapshots WHERE run_id = ?")
      .get(request.runId) as { state_json: string } | undefined;
    if (currentRow === undefined)
      throw new AuthorityIntegrityError(
        "Local completion run state is missing",
      );
    const currentState = JSON.parse(
      currentRow.state_json,
    ) as NonterminalRunState;
    if (currentState.currentLedger === undefined)
      throw new AuthorityIntegrityError("Current ledger is missing");
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
    if (
      !actualRender.equals(expectedRender.bytes) ||
      expectedRender.contentHash !== request.resultArtifact.contentHash ||
      request.resultArtifact.kind !== "rendered_ledger" ||
      request.resultArtifact.mediaType !== expectedRender.mediaType
    )
      throw new TypeError(
        "Ledger render result does not match deterministic output",
      );
    if (!validateTransition) return;
    const expected = completeLedgerRender(
      currentState,
      {
        type: "LedgerRendered",
        runId: request.runId,
        expectedStateVersion: domain.expectedStateVersion,
        commandId: request.commandId,
        ledgerVersionId: String(payload.ledgerVersionId),
        ledgerContentHash: ledgerRow.content_hash,
        renderedArtifactId: request.resultArtifact.artifactId,
        renderedContentHash: request.resultArtifact.contentHash,
        actor: {
          kind: "system",
          component: "deterministic-local-executor",
          version: "0.0.0",
        },
      },
      { policyHash: currentState.policyHash },
    );
    if (canonicalJson(domain.result) !== canonicalJson(expected))
      throw new TypeError(
        "Ledger render domain outcome does not match deterministic output",
      );
  }
}
