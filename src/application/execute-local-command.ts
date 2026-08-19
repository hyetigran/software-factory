import { randomUUID } from "node:crypto";

import { canonicalJson } from "../domain/canonical-json.js";
import type { PersistableCommand } from "./authority-port.js";
import type { ArtifactStagingPort } from "./artifact-port.js";
import { validateLedger, renderLedger } from "./deterministic-documents.js";
import {
  beginEligibleCommandAttempt,
  completeCommandAttempt,
  ExecutionPolicy,
  type CommandExecutionPort,
} from "./execution-port.js";
import type { ResolvedConfigurationSnapshot } from "./stage-configuration.js";

export interface LocalCommandPort extends CommandExecutionPort {
  listCommands(runId: string): PersistableCommand[];
}

type RegisteredArtifact = { artifactId: string; contentHash: string };

export async function executeNextLocalCommand(input: {
  execution: LocalCommandPort;
  staging: ArtifactStagingPort;
  readVerified: (contentHash: string) => Promise<Uint8Array>;
  registeredArtifacts: RegisteredArtifact[];
  runId: string;
  currentStateVersion: number;
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
    if (command.triggeringStateVersion !== input.currentStateVersion) continue;
    if (!new Set(["validate_ledger", "render_ledger"]).has(command.commandType))
      continue;
    const payload = command.payload as Record<string, unknown>;
    const sourceIds = command.inputArtifactHashes.map((contentHash) => {
      const matches = input.registeredArtifacts.filter(
        (artifact) => artifact.contentHash === contentHash,
      );
      const payloadIds = [payload.ledgerArtifactId, payload.sourceArtifactId];
      const artifact = matches.find(({ artifactId }) =>
        payloadIds.includes(artifactId),
      );
      if (artifact === undefined)
        throw new TypeError("Local command input artifact identity is invalid");
      return artifact.artifactId;
    });
    let resultBytes: Uint8Array;
    let kind: "coverage_report" | "rendered_ledger";
    let mediaType: string;
    if (command.commandType === "validate_ledger") {
      const [ledgerHash, sourceHash] = command.inputArtifactHashes;
      if (ledgerHash === undefined || sourceHash === undefined)
        throw new TypeError("Ledger validation command inputs are incomplete");
      const report = validateLedger({
        ledgerBytes: await input.readVerified(ledgerHash),
        ledgerSchema: JSON.parse(
          Buffer.from(
            await input.readVerified(
              input.configuration.artifactHashes.requirementsSchema,
            ),
          ).toString("utf8"),
        ) as unknown,
        sourceBytes: await input.readVerified(sourceHash),
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
      resultBytes = Buffer.from(canonicalJson(report));
      kind = "coverage_report";
      mediaType = "application/json";
    } else {
      const ledgerHash = command.inputArtifactHashes[0];
      if (ledgerHash === undefined)
        throw new TypeError("Ledger render command input is incomplete");
      const rendered = renderLedger(await input.readVerified(ledgerHash));
      resultBytes = rendered.bytes;
      kind = "rendered_ledger";
      mediaType = rendered.mediaType;
    }
    const attemptId = `attempt_${randomUUID().replaceAll("-", "")}`;
    const correlationId = `correlation_${randomUUID().replaceAll("-", "")}`;
    const result = await input.staging.stageArtifact(resultBytes, {
      artifactId: `${kind}_${randomUUID().replaceAll("-", "")}`,
      kind,
      mediaType,
      createdBy: "system:deterministic-local-executor",
      provenance: {
        method: "deterministic_render",
        sourceArtifactIds: sourceIds,
        commandId: command.commandId,
      },
    });
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
        method: "deterministic_render",
        sourceArtifactIds: sourceIds,
        commandId: command.commandId,
      },
    });
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
    await completeCommandAttempt(input.execution, {
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
    });
    return {
      commandId: command.commandId,
      commandType: command.commandType,
      resultArtifactId: result.artifactId,
    };
  }
  return null;
}
