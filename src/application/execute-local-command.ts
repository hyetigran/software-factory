import { randomUUID } from "node:crypto";

import { canonicalJson } from "../domain/canonical-json.js";
import { transition, type NonterminalRunState } from "../domain/index.js";
import type {
  PersistableCommand,
  PersistableTransition,
} from "./authority-port.js";
import type { ArtifactStagingPort } from "./artifact-port.js";
import { validateLedger } from "./deterministic-documents.js";
import {
  beginEligibleCommandAttempt,
  ExecutionPolicy,
  type CommandExecutionPort,
  type FailLocalAttemptRequest,
} from "./execution-port.js";
import type { ResolvedConfigurationSnapshot } from "./stage-configuration.js";
import { WorkspaceOperationError } from "./workspace-operations.js";

export interface LocalCommandPort extends CommandExecutionPort {
  listCommands(runId: string): PersistableCommand[];
  failLocalAttempt(request: FailLocalAttemptRequest): Promise<void>;
  completeLocalTransition(
    request: Parameters<CommandExecutionPort["completeAttempt"]>[0],
    expectedStateVersion: number,
    result: PersistableTransition<object>,
  ): Promise<void>;
}

type RegisteredArtifact = { artifactId: string; contentHash: string };

class LocalValidationRejected extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "LocalValidationRejected";
  }
}

export async function executeNextLocalCommand(input: {
  execution: LocalCommandPort;
  staging: ArtifactStagingPort;
  readVerified: (contentHash: string) => Promise<Uint8Array>;
  registeredArtifacts: RegisteredArtifact[];
  runId: string;
  currentState: NonterminalRunState;
  configurationArtifactId: string;
  configurationContentHash: string;
  configuration: ResolvedConfigurationSnapshot;
  ownerProcess: string;
}): Promise<{
  commandId: string;
  commandType: string;
  resultArtifactId: string;
} | null> {
  const policy = ExecutionPolicy.fromConfiguration({
    runId: input.runId,
    configurationArtifactId: input.configurationArtifactId,
    expectedContentHash: input.configurationContentHash,
    configuration: input.configuration,
  });
  for (const command of input.execution.listCommands(input.runId)) {
    if (command.provider !== "local") continue;
    if (command.triggeringStateVersion !== input.currentState.stateVersion)
      continue;
    if (command.commandType !== "validate_ledger") continue;
    const payload = command.payload as Record<string, unknown>;
    const attemptId = `attempt_${randomUUID().replaceAll("-", "")}`;
    const correlationId = `correlation_${randomUUID().replaceAll("-", "")}`;
    const begun = await beginEligibleCommandAttempt(input.execution, {
      runId: input.runId,
      commandId: command.commandId,
      attemptId,
      correlationId,
      ownerProcess: input.ownerProcess,
      configurationArtifactId: input.configurationArtifactId,
      policy,
      attemptKind: "initial",
    });
    if (begun.status === "already_succeeded") continue;
    try {
      const sourceIds = command.inputArtifactHashes.map((contentHash) => {
        const matches = input.registeredArtifacts.filter(
          (artifact) => artifact.contentHash === contentHash,
        );
        const payloadIds = [payload.ledgerArtifactId, payload.sourceArtifactId];
        const artifact = matches.find(({ artifactId }) =>
          payloadIds.includes(artifactId),
        );
        if (artifact === undefined)
          throw new TypeError(
            "Local command input artifact identity is invalid",
          );
        return artifact.artifactId;
      });
      const [ledgerHash, sourceHash] = command.inputArtifactHashes;
      if (ledgerHash === undefined || sourceHash === undefined)
        throw new TypeError("Ledger validation command inputs are incomplete");
      const ledgerBytes = await input.readVerified(ledgerHash);
      const sourceBytes = await input.readVerified(sourceHash);
      const ledgerSchema = JSON.parse(
        Buffer.from(
          await input.readVerified(
            input.configuration.artifactHashes.requirementsSchema,
          ),
        ).toString("utf8"),
      ) as unknown;
      let report;
      try {
        report = validateLedger({
          ledgerBytes,
          ledgerSchema,
          sourceBytes,
          expectedSourceArtifactId: String(payload.sourceArtifactId),
          approvedExclusions: (
            (payload.sourceExclusions as
              Array<Record<string, unknown>> | undefined) ?? []
          ).map((exclusion) => {
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
      } catch (error) {
        throw new LocalValidationRejected(error);
      }
      const result = await input.staging.stageArtifact(
        Buffer.from(canonicalJson(report)),
        {
          artifactId: `coverage_report_${randomUUID().replaceAll("-", "")}`,
          kind: "coverage_report",
          mediaType: "application/json",
          createdBy: "system:deterministic-local-executor",
          provenance: {
            method: "application_generated",
            purpose: "ledger_validation",
            sourceArtifactIds: sourceIds,
            commandId: command.commandId,
            attemptId,
          },
        },
      );
      const usageBytes = Buffer.from(
        canonicalJson({
          calls: 0,
          costUsdMicros: 0,
          inputTokens: 0,
          outputTokens: 0,
        }),
      );
      const usage = await input.staging.stageArtifact(usageBytes, {
        artifactId: `usage_${attemptId}`,
        kind: "native_usage",
        mediaType: "application/json",
        createdBy: "system:deterministic-local-executor",
        provenance: {
          method: "application_generated",
          purpose: "local_usage",
          sourceArtifactIds: sourceIds,
          commandId: command.commandId,
          attemptId,
        },
      });
      const completion = {
        runId: input.runId,
        commandId: command.commandId,
        attemptId,
        ownerProcess: input.ownerProcess,
        correlationId,
        resultArtifact: result,
        nativeUsageArtifact: usage,
        actualUsage: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
        providerEvidence: {},
      };
      const domainResult = transition(
        input.currentState,
        {
          type: "LedgerValidationCompleted",
          runId: input.runId,
          expectedStateVersion: input.currentState.stateVersion,
          commandId: command.commandId,
          ledgerVersionId: String(payload.ledgerVersionId),
          ledgerContentHash: report.ledgerContentHash,
          sourceContentHash: report.sourceContentHash,
          coverageReportArtifactId: result.artifactId,
          coverageReportContentHash: result.contentHash,
          schemaValid: report.schemaValid,
          identityValid: report.identityValid,
          lineageValid: report.lineageValid,
          coverageComplete: report.coverageValid,
          uncoveredRangeCount: report.uncoveredRanges.length,
          actor: {
            kind: "system",
            component: "deterministic-local-executor",
            version: "0.0.0",
          },
        },
        {
          policyHash: input.configuration.policyHash,
          plannerAssignment: input.configuration.plannerAssignment,
          reviewerAssignment: input.configuration.reviewerAssignment,
        },
      );
      await input.execution.completeLocalTransition(
        completion,
        input.currentState.stateVersion,
        domainResult,
      );
      return {
        commandId: command.commandId,
        commandType: command.commandType,
        resultArtifactId: result.artifactId,
      };
    } catch (error) {
      const rejected = error instanceof LocalValidationRejected;
      await input.execution.failLocalAttempt({
        runId: input.runId,
        commandId: command.commandId,
        attemptId,
        ownerProcess: input.ownerProcess,
        correlationId,
        failureMessage: error instanceof Error ? error.message : String(error),
        failureKind: rejected ? "invalid_output" : "integrity",
      });
      throw new WorkspaceOperationError(
        rejected ? "CONFLICT" : "INTEGRITY_ERROR",
        rejected
          ? "Ledger validation rejected the current input"
          : "Authoritative local command input is missing or invalid",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }
  return null;
}
