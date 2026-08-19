import { createHash } from "node:crypto";

import { artifactRegistrationIsValid } from "./artifact-port.js";
import { canonicalJson } from "../domain/canonical-json.js";
import type {
  CompleteProviderFailureEvidence,
  ExecutionPolicy,
  ProviderFailureCompletionPort,
  ProviderFailureDisposition,
} from "./execution-port.js";

export function completeProviderFailure(
  authority: ProviderFailureCompletionPort,
  request: CompleteProviderFailureEvidence,
  policy: ExecutionPolicy,
): Promise<ProviderFailureDisposition> {
  const identities = [
    request.runId,
    request.commandId,
    request.attemptId,
    request.ownerProcess,
    request.correlationId,
    request.requestArtifactId,
    request.requestContentHash,
    request.outcomeArtifact.artifactId,
  ];
  const rawBytes = request.execution.recording.rawResponseBytes;
  const nativeBytes = request.execution.recording.nativeUsageBytes;
  const diagnosticBytes = Buffer.from(
    canonicalJson({
      kind: request.execution.kind,
      evidence: request.execution.evidence,
    }),
  );
  const expectedOutcomeHash = createHash("sha256")
    .update(rawBytes ?? diagnosticBytes)
    .digest("hex");
  if (
    identities.some((value) => value.trim().length === 0) ||
    request.runId !== policy.runId ||
    !/^[a-f0-9]{64}$/u.test(request.requestContentHash) ||
    !artifactRegistrationIsValid(request.outcomeArtifact) ||
    (request.nativeUsageArtifact !== undefined &&
      !artifactRegistrationIsValid(request.nativeUsageArtifact)) ||
    request.outcomeArtifact.contentHash !== expectedOutcomeHash ||
    (nativeBytes === undefined) !==
      (request.nativeUsageArtifact === undefined) ||
    (nativeBytes !== undefined &&
      request.nativeUsageArtifact?.contentHash !==
        createHash("sha256").update(nativeBytes).digest("hex")) ||
    request.execution.evidence.correlationId !== request.correlationId ||
    request.execution.evidence.requestedModel.trim().length === 0
  ) {
    throw new TypeError("Provider failure evidence is invalid");
  }
  return authority.completeProviderFailure(request, policy);
}
