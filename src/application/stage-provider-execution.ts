import { randomUUID } from "node:crypto";

import type {
  ArtifactStagingPort,
  StagedArtifactRegistration,
} from "./artifact-port.js";
import type { StartedCommandAttempt } from "./execution-port.js";
import type { ProviderExecution } from "./provider-port.js";
import { providerFailureEvidenceBytes } from "./provider-execution-codec.js";
import { canonicalJson } from "../domain/canonical-json.js";

type CommonInput = {
  staging: ArtifactStagingPort;
  attempt: StartedCommandAttempt;
  requestArtifactId: string;
  outputSchemaArtifactId: string;
  execution: ProviderExecution;
  normalizedUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
};

export type StagedProviderExecution =
  | {
      kind: "completed";
      outputArtifact: StagedArtifactRegistration;
      rawResponseArtifact: StagedArtifactRegistration;
      nativeUsageArtifact: StagedArtifactRegistration;
      actualUsage: {
        calls: 0 | 1;
        inputTokens: number;
        outputTokens: number;
        costUsdMicros: number;
      };
    }
  | {
      kind: "failed";
      outcomeArtifact: StagedArtifactRegistration;
      nativeUsageArtifact?: StagedArtifactRegistration;
    };

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export async function stageProviderExecution(
  input: CommonInput,
): Promise<StagedProviderExecution> {
  const liveProvenance = {
    commandId: input.attempt.commandId,
    attemptId: input.attempt.attemptId,
    sourceArtifactIds: [input.requestArtifactId],
  };
  const replay = input.attempt.strictReplay;
  const providerEvidenceProvenance =
    input.attempt.attemptKind === "strict_replay"
      ? {
          method: "application_generated" as const,
          purpose: "replayed_provider_evidence" as const,
          commandId: input.attempt.commandId,
          attemptId: input.attempt.attemptId,
          sourceArtifactIds: [
            input.requestArtifactId,
            replay?.recordingManifestArtifactId ?? "",
          ],
        }
      : {
          method: "provider_generated" as const,
          ...liveProvenance,
        };
  if (
    input.attempt.attemptKind === "strict_replay" &&
    (replay === undefined ||
      replay.recordingManifestArtifactId.trim().length === 0 ||
      !/^[a-f0-9]{64}$/u.test(replay.recordingManifestContentHash))
  )
    throw new TypeError("Strict replay evidence identity is invalid");
  if (input.execution.kind === "completed") {
    const raw = input.execution.recording.rawResponseBytes;
    const usage = input.execution.recording.nativeUsageBytes;
    if (raw === undefined || usage === undefined)
      throw new TypeError(
        "Completed provider execution requires raw response and native usage",
      );
    const rawResponseArtifact = await input.staging.stageArtifact(raw, {
      artifactId: id("provider_response"),
      kind: "provider_response",
      mediaType: "application/json",
      createdBy: input.attempt.lease.ownerProcess,
      provenance: providerEvidenceProvenance,
    });
    const nativeUsageArtifact = await input.staging.stageArtifact(usage, {
      artifactId: id("native_usage"),
      kind: "native_usage",
      mediaType: "application/json",
      createdBy: input.attempt.lease.ownerProcess,
      provenance: providerEvidenceProvenance,
    });
    const outputBytes = Buffer.from(canonicalJson(input.execution.structured));
    const outputArtifact = await input.staging.stageArtifact(outputBytes, {
      artifactId: id("provider_output"),
      kind: "provider_response",
      mediaType: "application/json",
      createdBy: input.attempt.lease.ownerProcess,
      provenance: {
        method: "application_generated",
        purpose: "structured_provider_output",
        sourceArtifactIds: [
          rawResponseArtifact.artifactId,
          input.outputSchemaArtifactId,
        ],
        commandId: input.attempt.commandId,
        attemptId: input.attempt.attemptId,
      },
    });
    const strictReplay = input.attempt.attemptKind === "strict_replay";
    const normalized = input.normalizedUsage;
    if (
      !strictReplay &&
      (normalized === undefined ||
        ![normalized.inputTokens, normalized.outputTokens].every(
          (value) => Number.isInteger(value) && value >= 0,
        ))
    )
      throw new TypeError("Normalized provider usage is required");
    return {
      kind: "completed",
      outputArtifact,
      rawResponseArtifact,
      nativeUsageArtifact,
      actualUsage: {
        calls: strictReplay ? 0 : 1,
        inputTokens: strictReplay ? 0 : (normalized?.inputTokens ?? 0),
        outputTokens: strictReplay ? 0 : (normalized?.outputTokens ?? 0),
        costUsdMicros: strictReplay
          ? 0
          : input.attempt.reservation.costUsdMicros,
      },
    };
  }

  const raw = input.execution.recording.rawResponseBytes;
  const outcomeArtifact = await input.staging.stageArtifact(
    raw ?? Buffer.from(providerFailureEvidenceBytes(input.execution)),
    input.attempt.attemptKind === "strict_replay"
      ? {
          artifactId: id("provider_replay"),
          kind: raw === undefined ? "other" : "provider_response",
          mediaType: "application/json",
          createdBy: input.attempt.lease.ownerProcess,
          provenance: providerEvidenceProvenance,
        }
      : raw === undefined
        ? {
            artifactId: id("provider_failure"),
            kind: "other",
            mediaType: "application/json",
            createdBy: input.attempt.lease.ownerProcess,
            provenance: {
              method: "application_generated",
              purpose: "provider_failure_evidence",
              ...liveProvenance,
            },
          }
        : {
            artifactId: id("provider_response"),
            kind: "provider_response",
            mediaType: "application/json",
            createdBy: input.attempt.lease.ownerProcess,
            provenance: providerEvidenceProvenance,
          },
  );
  const native = input.execution.recording.nativeUsageBytes;
  const nativeUsageArtifact =
    native === undefined
      ? undefined
      : await input.staging.stageArtifact(native, {
          artifactId: id("native_usage"),
          kind: "native_usage",
          mediaType: "application/json",
          createdBy: input.attempt.lease.ownerProcess,
          provenance: providerEvidenceProvenance,
        });
  return {
    kind: "failed",
    outcomeArtifact,
    ...(nativeUsageArtifact === undefined ? {} : { nativeUsageArtifact }),
  };
}
