import type {
  AuthorityPort,
  PersistableTransition,
  PersistTransitionRequest,
} from "./authority-port.js";
import type { CompleteProviderAttemptEvidence } from "./execution-port.js";
import {
  transition,
  type NonterminalRunState,
  type PlanGenerated,
  type PinnedRunPolicy,
  type ReviewAccepted,
} from "../domain/index.js";

type ProviderOutcomeInput = PlanGenerated | ReviewAccepted;

export type CompleteProviderAttemptRequest = PersistTransitionRequest & {
  completion: CompleteProviderAttemptEvidence;
  input: ProviderOutcomeInput;
  policy: PinnedRunPolicy;
};

function outcomeMatchesAttempt(
  input: ProviderOutcomeInput,
  completion: CompleteProviderAttemptEvidence,
): boolean {
  if (input.runId !== completion.runId) return false;
  if (input.type === "PlanGenerated") {
    return (
      input.originatingCommandId === completion.commandId &&
      input.planArtifact.artifactId === completion.outputArtifact.artifactId &&
      input.planArtifact.contentHash ===
        completion.outputArtifact.contentHash &&
      input.acceptedAttempt.commandId === completion.commandId &&
      input.acceptedAttempt.attemptId === completion.attemptId &&
      input.acceptedAttempt.requestArtifactId ===
        completion.requestArtifactId &&
      input.acceptedAttempt.requestContentHash ===
        completion.requestContentHash &&
      input.acceptedAttempt.responseArtifactId ===
        completion.rawResponseArtifact.artifactId &&
      input.acceptedAttempt.responseContentHash ===
        completion.rawResponseArtifact.contentHash &&
      input.acceptedAttempt.nativeUsageArtifactId ===
        completion.nativeUsageArtifact.artifactId &&
      input.acceptedAttempt.nativeUsageContentHash ===
        completion.nativeUsageArtifact.contentHash
    );
  }
  if (input.type === "ReviewAccepted") {
    return (
      input.originatingCommandId === completion.commandId &&
      input.acceptedAttempt.commandId === completion.commandId &&
      input.acceptedAttempt.attemptId === completion.attemptId &&
      input.acceptedAttempt.requestArtifactId ===
        completion.requestArtifactId &&
      input.acceptedAttempt.requestContentHash ===
        completion.requestContentHash &&
      input.acceptedAttempt.responseArtifactId ===
        completion.outputArtifact.artifactId &&
      input.acceptedAttempt.responseContentHash ===
        completion.outputArtifact.contentHash &&
      input.acceptedAttempt.nativeUsageArtifactId ===
        completion.nativeUsageArtifact.artifactId &&
      input.acceptedAttempt.nativeUsageContentHash ===
        completion.nativeUsageArtifact.contentHash
    );
  }
  return false;
}

export async function completeProviderAttempt(
  authority: AuthorityPort,
  request: CompleteProviderAttemptRequest,
): Promise<PersistableTransition<NonterminalRunState>> {
  if (!outcomeMatchesAttempt(request.input, request.completion)) {
    throw new TypeError("Provider outcome does not match its physical attempt");
  }
  return authority.transaction((transaction) => {
    const previousState = transaction.loadRun<NonterminalRunState>(
      request.runId,
    );
    const result = transition(previousState, request.input, request.policy);
    return transaction.persistProviderCompletion<NonterminalRunState>(
      request.completion,
      {
        runId: request.runId,
        expectedStateVersion: request.expectedStateVersion,
        ...(request.causationId === undefined
          ? {}
          : { causationId: request.causationId }),
        ...(request.correlationId === undefined
          ? {}
          : { correlationId: request.correlationId }),
        ...(request.validatedProjection === undefined
          ? {}
          : { validatedProjection: request.validatedProjection }),
        ...(request.stagedArtifacts === undefined
          ? {}
          : { stagedArtifacts: request.stagedArtifacts }),
      },
      result,
    );
  });
}
