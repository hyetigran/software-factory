import type {
  AuthorityPort,
  PersistableTransition,
  PersistTransitionRequest,
} from "./authority-port.js";
import type { CompleteAttemptRequest } from "./execution-port.js";
import {
  transition,
  type HaltedRunState,
  type NonterminalRunState,
  type PlanGenerated,
  type PinnedRunPolicy,
  type ProviderOutcomeFailed,
  type ReviewAccepted,
} from "../domain/index.js";

type ProviderOutcomeInput =
  PlanGenerated | ReviewAccepted | ProviderOutcomeFailed;

export type CompleteProviderAttemptRequest = PersistTransitionRequest & {
  completion: CompleteAttemptRequest;
  input: ProviderOutcomeInput;
  policy: PinnedRunPolicy;
};

function outcomeMatchesAttempt(
  input: ProviderOutcomeInput,
  completion: CompleteAttemptRequest,
): boolean {
  if (input.runId !== completion.runId) return false;
  if (input.type === "PlanGenerated") {
    return (
      input.originatingCommandId === completion.commandId &&
      input.planArtifact.artifactId === completion.resultArtifact.artifactId &&
      input.planArtifact.contentHash === completion.resultArtifact.contentHash
    );
  }
  if (input.type === "ReviewAccepted") {
    return (
      input.originatingCommandId === completion.commandId &&
      input.acceptedAttempt.commandId === completion.commandId &&
      input.acceptedAttempt.attemptId === completion.attemptId &&
      input.acceptedAttempt.responseArtifactId ===
        completion.resultArtifact.artifactId &&
      input.acceptedAttempt.responseContentHash ===
        completion.resultArtifact.contentHash &&
      input.acceptedAttempt.nativeUsageArtifactId ===
        completion.nativeUsageArtifact.artifactId &&
      input.acceptedAttempt.nativeUsageContentHash ===
        completion.nativeUsageArtifact.contentHash
    );
  }
  return input.failedCommandId === completion.commandId;
}

export async function completeProviderAttempt(
  authority: AuthorityPort,
  request: CompleteProviderAttemptRequest,
): Promise<PersistableTransition<NonterminalRunState | HaltedRunState>> {
  if (!outcomeMatchesAttempt(request.input, request.completion)) {
    throw new TypeError("Provider outcome does not match its physical attempt");
  }
  return authority.transaction((transaction) => {
    const previousState = transaction.loadRun<NonterminalRunState>(
      request.runId,
    );
    const completion = transaction.completeProviderAttempt(request.completion);
    if (!completion.acceptedAsLogicalResult) {
      throw new TypeError(
        "A discarded provider result cannot drive a domain transition",
      );
    }
    const result =
      request.input.type === "ProviderOutcomeFailed"
        ? transition(previousState, request.input, request.policy)
        : transition(previousState, request.input, request.policy);
    const combined = {
      ...result,
      auditFacts: [...completion.auditFacts, ...result.auditFacts],
    };
    transaction.persist<NonterminalRunState | HaltedRunState>(
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
        stagedArtifacts: [
          ...(request.stagedArtifacts ?? []),
          request.completion.resultArtifact,
          request.completion.nativeUsageArtifact,
        ],
      },
      combined,
    );
    return combined;
  });
}
