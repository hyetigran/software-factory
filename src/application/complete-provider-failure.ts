import { artifactRegistrationIsValid } from "./artifact-port.js";
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
  const usage = request.actualUsage;
  if (
    identities.some((value) => value.trim().length === 0) ||
    request.runId !== policy.runId ||
    !/^[a-f0-9]{64}$/u.test(request.requestContentHash) ||
    !artifactRegistrationIsValid(request.outcomeArtifact) ||
    (request.nativeUsageArtifact !== undefined &&
      !artifactRegistrationIsValid(request.nativeUsageArtifact)) ||
    !Object.values(usage).every(
      (value) => Number.isInteger(value) && value >= 0,
    ) ||
    request.providerEvidence.correlationId !== request.correlationId ||
    request.providerEvidence.requestedModel.trim().length === 0
  ) {
    throw new TypeError("Provider failure evidence is invalid");
  }
  return authority.completeProviderFailure(request, policy);
}
