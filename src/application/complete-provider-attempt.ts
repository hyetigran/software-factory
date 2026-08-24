import type {
  AuthorityPort,
  PersistableTransition,
  PersistTransitionRequest,
} from "./authority-port.js";
import type {
  CompleteProviderAttemptEvidence,
  CompletedCommandAttempt,
} from "./execution-port.js";
import {
  transition,
  type HaltedRunState,
  type NonterminalRunState,
  type PlanGenerated,
  type PinnedRunPolicy,
  type RemediationGenerated,
  type RemediationReviewAccepted,
  type ReviewAccepted,
} from "../domain/index.js";
import { canonicalJson } from "../domain/canonical-json.js";
import { createHash } from "node:crypto";

type ProviderOutcomeInput =
  | PlanGenerated
  | ReviewAccepted
  | RemediationGenerated
  | RemediationReviewAccepted;

export type CompleteProviderAttemptRequest = PersistTransitionRequest & {
  completion: CompleteProviderAttemptEvidence;
  input: ProviderOutcomeInput;
  policy: PinnedRunPolicy;
};

const acceptedProviderCompletionBrand = Symbol("AcceptedProviderCompletion");

type AcceptedProviderCompletionData = {
  previousStateHash: string;
  completion: CompleteProviderAttemptEvidence;
  persistRequest: PersistTransitionRequest;
  result: PersistableTransition<NonterminalRunState | HaltedRunState>;
};

function immutableCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (nested: unknown): void => {
    if (nested === null || typeof nested !== "object") return;
    Object.freeze(nested);
    Object.values(nested).forEach(freeze);
  };
  freeze(copy);
  return copy;
}

export class AcceptedProviderCompletion {
  readonly [acceptedProviderCompletionBrand] = true;

  private constructor(private readonly value: AcceptedProviderCompletionData) {
    Object.freeze(value.persistRequest);
    Object.freeze(value);
    Object.freeze(this);
  }

  static fromDomain(
    previousState: NonterminalRunState | null,
    request: CompleteProviderAttemptRequest,
  ): AcceptedProviderCompletion {
    if (!outcomeMatchesAttempt(request.input, request.completion)) {
      throw new TypeError(
        "Provider outcome does not match its physical attempt",
      );
    }
    // Both branches are the same call: the narrowed input types select
    // different transition() overloads, and the full union matches none.
    const result =
      request.input.type === "RemediationReviewAccepted"
        ? transition(previousState, request.input, request.policy)
        : transition(previousState, request.input, request.policy);
    const { validatedProjection, ...plainPersistRequest } = request;
    const copied = immutableCopy({
      previousStateHash: createHash("sha256")
        .update(canonicalJson(previousState))
        .digest("hex"),
      completion: request.completion,
      persistRequest: {
        runId: request.runId,
        expectedStateVersion: request.expectedStateVersion,
        ...(request.causationId === undefined
          ? {}
          : { causationId: request.causationId }),
        ...(request.correlationId === undefined
          ? {}
          : { correlationId: request.correlationId }),
        ...(request.stagedArtifacts === undefined
          ? {}
          : { stagedArtifacts: request.stagedArtifacts }),
      },
      result,
    });
    void plainPersistRequest;
    return new AcceptedProviderCompletion({
      ...copied,
      persistRequest: {
        ...copied.persistRequest,
        ...(validatedProjection === undefined ? {} : { validatedProjection }),
      },
    });
  }

  toPersistenceData(): AcceptedProviderCompletionData {
    if (this[acceptedProviderCompletionBrand] !== true) {
      throw new TypeError("Provider completion capability is invalid");
    }
    return this.value;
  }
}

function attemptMatchesCompletion(
  input: ProviderOutcomeInput,
  completion: CompleteProviderAttemptEvidence,
): boolean {
  return (
    input.originatingCommandId === completion.commandId &&
    input.acceptedAttempt.commandId === completion.commandId &&
    input.acceptedAttempt.attemptId === completion.attemptId &&
    input.acceptedAttempt.requestArtifactId === completion.requestArtifactId &&
    input.acceptedAttempt.requestContentHash ===
      completion.requestContentHash &&
    input.acceptedAttempt.responseArtifactId ===
      completion.outputArtifact.artifactId &&
    input.acceptedAttempt.responseContentHash ===
      completion.outputArtifact.contentHash &&
    input.acceptedAttempt.rawResponseArtifactId ===
      completion.rawResponseArtifact.artifactId &&
    input.acceptedAttempt.rawResponseContentHash ===
      completion.rawResponseArtifact.contentHash &&
    input.acceptedAttempt.nativeUsageArtifactId ===
      completion.nativeUsageArtifact.artifactId &&
    input.acceptedAttempt.nativeUsageContentHash ===
      completion.nativeUsageArtifact.contentHash
  );
}

function outcomeMatchesAttempt(
  input: ProviderOutcomeInput,
  completion: CompleteProviderAttemptEvidence,
): boolean {
  if (input.runId !== completion.runId) return false;
  if (input.type === "PlanGenerated") {
    return (
      input.planArtifact.artifactId === completion.outputArtifact.artifactId &&
      input.planArtifact.contentHash ===
        completion.outputArtifact.contentHash &&
      attemptMatchesCompletion(input, completion)
    );
  }
  if (
    input.type === "ReviewAccepted" ||
    input.type === "RemediationReviewAccepted"
  ) {
    return attemptMatchesCompletion(input, completion);
  }
  if (input.type === "RemediationGenerated") {
    return (
      input.remediationArtifact.artifactId ===
        completion.outputArtifact.artifactId &&
      input.remediationArtifact.contentHash ===
        completion.outputArtifact.contentHash &&
      attemptMatchesCompletion(input, completion)
    );
  }
  return false;
}

export async function completeProviderAttempt(
  authority: AuthorityPort,
  request: CompleteProviderAttemptRequest,
): Promise<
  | PersistableTransition<NonterminalRunState | HaltedRunState>
  | CompletedCommandAttempt
> {
  return authority.transaction((transaction) => {
    const settlement = transaction.settleProviderCompletion(request.completion);
    if (settlement.status === "settled") {
      return settlement.completion;
    }
    const previousState = transaction.loadRun<NonterminalRunState>(
      request.runId,
    );
    return transaction.persistProviderCompletion<
      NonterminalRunState | HaltedRunState
    >(AcceptedProviderCompletion.fromDomain(previousState, request));
  });
}
