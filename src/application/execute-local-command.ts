import { randomUUID } from "node:crypto";

import { canonicalJson } from "../domain/canonical-json.js";
import { transition, type NonterminalRunState } from "../domain/index.js";
import type {
  PersistableCommand,
  PersistableTransition,
} from "./authority-port.js";
import type { ArtifactStagingPort } from "./artifact-port.js";
import { renderLedger, validateLedger } from "./deterministic-documents.js";
import {
  beginEligibleCommandAttempt,
  ExecutionPolicy,
  type CommandExecutionPort,
  type FailLocalAttemptRequest,
} from "./execution-port.js";
import type { ResolvedConfigurationSnapshot } from "./stage-configuration.js";
import { WorkspaceOperationError } from "./workspace-operations.js";
import { localCommandSpecification } from "./local-command-specification.js";

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
    const specification = localCommandSpecification(command);
    if (specification?.executable !== true) continue;
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
      const payloadIds = specification.controlledArtifactFields.map(
        (field) => payload[field],
      );
      if (
        payloadIds.some((value) => typeof value !== "string") ||
        new Set(payloadIds).size !== payloadIds.length
      )
        throw new TypeError("Local command input identities are invalid");
      const bindings = (payloadIds as string[]).map((artifactId) => {
        const artifact = input.registeredArtifacts.find(
          (candidate) => candidate.artifactId === artifactId,
        );
        if (artifact === undefined)
          throw new TypeError("Local command input artifact is not registered");
        return artifact;
      });
      const expectedHashes = bindings
        .map(({ contentHash }) => contentHash)
        .sort();
      const declaredHashes = [...command.inputArtifactHashes].sort();
      if (
        expectedHashes.length !== declaredHashes.length ||
        expectedHashes.some((hash, index) => hash !== declaredHashes[index])
      )
        throw new TypeError("Local command input artifact identity is invalid");
      const sourceIds = bindings.map(({ artifactId }) => artifactId);
      const ledgerHash = bindings[0]?.contentHash;
      const sourceHash = bindings[1]?.contentHash;
      if (ledgerHash === undefined)
        throw new TypeError("Ledger command input is incomplete");
      const ledgerBytes = await input.readVerified(ledgerHash);
      let report: ReturnType<typeof validateLedger> | undefined;
      let resultBytes: Uint8Array;
      if (command.commandType === "validate_ledger") {
        if (sourceHash === undefined)
          throw new TypeError("Ledger validation source is incomplete");
        const sourceBytes = await input.readVerified(sourceHash);
        const ledgerSchema = JSON.parse(
          Buffer.from(
            await input.readVerified(
              input.configuration.artifactHashes.requirementsSchema,
            ),
          ).toString("utf8"),
        ) as unknown;
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
        resultBytes = Buffer.from(canonicalJson(report));
      } else {
        resultBytes = renderLedger(ledgerBytes).bytes;
      }
      const result = await input.staging.stageArtifact(resultBytes, {
        artifactId: `${specification.resultKind}_${randomUUID().replaceAll("-", "")}`,
        kind: specification.resultKind,
        mediaType: specification.resultMediaType,
        createdBy: "system:deterministic-local-executor",
        provenance: {
          method: "application_generated",
          purpose: specification.resultPurpose,
          sourceArtifactIds: sourceIds,
          commandId: command.commandId,
          attemptId,
        },
      });
      const usageBytes = Buffer.from(
        canonicalJson({
          commandId: command.commandId,
          attemptId,
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
      const domainInput =
        command.commandType === "validate_ledger"
          ? {
              type: "LedgerValidationCompleted" as const,
              runId: input.runId,
              expectedStateVersion: input.currentState.stateVersion,
              commandId: command.commandId,
              ledgerVersionId: String(payload.ledgerVersionId),
              ledgerContentHash: report!.ledgerContentHash,
              sourceContentHash: report!.sourceContentHash,
              coverageReportArtifactId: result.artifactId,
              coverageReportContentHash: result.contentHash,
              schemaValid: report!.schemaValid,
              identityValid: report!.identityValid,
              lineageValid: report!.lineageValid,
              coverageComplete: report!.coverageValid,
              uncoveredRangeCount: report!.uncoveredRanges.length,
              renderCommandId: `command_${randomUUID().replaceAll("-", "")}`,
              actor: {
                kind: "system" as const,
                component: "deterministic-local-executor",
                version: "0.0.0",
              },
            }
          : {
              type: "LedgerRendered" as const,
              runId: input.runId,
              expectedStateVersion: input.currentState.stateVersion,
              commandId: command.commandId,
              ledgerVersionId: String(payload.ledgerVersionId),
              ledgerContentHash: ledgerHash,
              renderedArtifactId: result.artifactId,
              renderedContentHash: result.contentHash,
              actor: {
                kind: "system" as const,
                component: "deterministic-local-executor",
                version: "0.0.0",
              },
            };
      const domainResult = transition(input.currentState, domainInput, {
        policyHash: input.configuration.policyHash,
        plannerAssignment: input.configuration.plannerAssignment,
        reviewerAssignment: input.configuration.reviewerAssignment,
      });
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
