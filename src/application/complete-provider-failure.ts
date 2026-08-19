import { createHash } from "node:crypto";

import type {
  AuthorityPort,
  PersistableTransition,
  PersistTransitionRequest,
} from "./authority-port.js";
import { artifactRegistrationIsValid } from "./artifact-port.js";
import type {
  CompleteProviderFailureEvidence,
  ExecutionPolicy,
  ProviderFailureDisposition,
} from "./execution-port.js";
import { canonicalJson } from "../domain/canonical-json.js";
import {
  transition,
  type NonterminalRunState,
  type PinnedRunPolicy,
  type PinnedModelUnavailable,
  type ProviderOutcomeFailed,
} from "../domain/index.js";

export type CompleteProviderFailureRequest = PersistTransitionRequest & {
  completion: CompleteProviderFailureEvidence;
  executionPolicy: ExecutionPolicy;
  terminalInput?: ProviderOutcomeFailed | PinnedModelUnavailable;
  domainPolicy?: PinnedRunPolicy;
};

const acceptedFailureBrand = Symbol("AcceptedProviderFailure");

type AcceptedFailureData = {
  previousStateHash: string;
  completion: CompleteProviderFailureEvidence;
  executionPolicy: ExecutionPolicy;
  persistRequest: PersistTransitionRequest;
  terminalInput?: ProviderOutcomeFailed | PinnedModelUnavailable;
  terminalResult?: PersistableTransition<object>;
};

function immutableCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (nested: unknown): void => {
    if (
      nested === null ||
      typeof nested !== "object" ||
      ArrayBuffer.isView(nested)
    )
      return;
    Object.freeze(nested);
    Object.values(nested).forEach(freeze);
  };
  freeze(copy);
  return copy;
}

export class AcceptedProviderFailure {
  readonly [acceptedFailureBrand] = true;

  private constructor(private readonly value: AcceptedFailureData) {
    Object.freeze(value);
    Object.freeze(this);
  }

  static fromDomain(
    previousState: NonterminalRunState | null,
    request: CompleteProviderFailureRequest,
  ): AcceptedProviderFailure {
    validateFailureRequest(request);
    if (
      (request.terminalInput === undefined) !==
      (request.domainPolicy === undefined)
    ) {
      throw new TypeError("Terminal failure input and policy must be paired");
    }
    const terminalResult =
      request.terminalInput === undefined || request.domainPolicy === undefined
        ? undefined
        : transition(
            previousState,
            request.terminalInput,
            request.domainPolicy,
          );
    const copied = immutableCopy({
      previousStateHash: createHash("sha256")
        .update(canonicalJson(previousState))
        .digest("hex"),
      completion: request.completion,
      executionPolicy: request.executionPolicy,
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
      ...(terminalResult === undefined
        ? {}
        : {
            terminalInput: request.terminalInput,
            terminalResult,
          }),
    });
    return new AcceptedProviderFailure({
      ...copied,
      executionPolicy: request.executionPolicy,
      completion: Object.freeze({
        ...copied.completion,
        execution: request.completion.execution,
      }),
    });
  }

  toPersistenceData(): AcceptedFailureData {
    if (this[acceptedFailureBrand] !== true) {
      throw new TypeError("Provider failure capability is invalid");
    }
    return this.value;
  }
}

function validateFailureRequest(request: CompleteProviderFailureRequest) {
  const completion = request.completion;
  const rawBytes = completion.execution.recording.rawResponseBytes;
  const nativeBytes = completion.execution.recording.nativeUsageBytes;
  const diagnosticBytes = Buffer.from(
    canonicalJson({
      kind: completion.execution.kind,
      evidence: completion.execution.evidence,
    }),
  );
  if (
    [
      completion.runId,
      completion.commandId,
      completion.attemptId,
      completion.ownerProcess,
      completion.correlationId,
      completion.requestArtifactId,
      completion.requestContentHash,
      completion.outcomeArtifact.artifactId,
    ].some((value) => value.trim().length === 0) ||
    request.runId !== completion.runId ||
    request.runId !== request.executionPolicy.runId ||
    !/^[a-f0-9]{64}$/u.test(completion.requestContentHash) ||
    !artifactRegistrationIsValid(completion.outcomeArtifact) ||
    (completion.nativeUsageArtifact !== undefined &&
      !artifactRegistrationIsValid(completion.nativeUsageArtifact)) ||
    completion.outcomeArtifact.contentHash !==
      createHash("sha256")
        .update(rawBytes ?? diagnosticBytes)
        .digest("hex") ||
    (nativeBytes === undefined) !==
      (completion.nativeUsageArtifact === undefined) ||
    (nativeBytes !== undefined &&
      completion.nativeUsageArtifact?.contentHash !==
        createHash("sha256").update(nativeBytes).digest("hex")) ||
    completion.execution.evidence.correlationId !== completion.correlationId
  ) {
    throw new TypeError("Provider failure evidence is invalid");
  }
}

export async function completeProviderFailure(
  authority: AuthorityPort,
  request: CompleteProviderFailureRequest,
): Promise<ProviderFailureDisposition | PersistableTransition<object>> {
  return authority.transaction((transaction) => {
    const settlement = transaction.settleProviderFailure(
      request.completion,
      request.executionPolicy,
    );
    if (settlement.status === "settled") return settlement.disposition;
    const previousState = transaction.loadRun<NonterminalRunState>(
      request.runId,
    );
    return transaction.persistProviderFailure(
      AcceptedProviderFailure.fromDomain(previousState, request),
    );
  });
}
