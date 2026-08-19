import type {
  ArtifactRegistration,
  ArtifactStagingPort,
  StagedArtifactRegistration,
} from "./artifact-port.js";
import type { StartedCommandAttempt } from "./execution-port.js";
import type {
  ProviderAdapter,
  ProviderExecution,
  ProviderRequest,
} from "./provider-port.js";
import { canonicalJson } from "../domain/canonical-json.js";

export type ExecuteProviderCallRequest = {
  adapter: ProviderAdapter;
  artifactStaging: ArtifactStagingPort;
  requestRegistration: PreparedProviderRequestRegistrationPort;
  providerRequest: ProviderRequest;
  requestArtifactId: string;
  attempt: StartedCommandAttempt;
};

export interface PreparedProviderRequestRegistrationPort {
  registerPreparedProviderRequest(input: {
    attempt: StartedCommandAttempt;
    providerRequest: ProviderRequest;
    normalizedRequestHash: string;
    artifact: StagedArtifactRegistration;
  }): Promise<void>;
}

export type ExecutedProviderCall = {
  requestArtifact: StagedArtifactRegistration;
  execution: ProviderExecution;
};

export async function executeProviderCall(
  input: ExecuteProviderCallRequest,
): Promise<ExecutedProviderCall> {
  if (
    input.requestArtifactId.trim().length === 0 ||
    input.attempt.attemptId.trim().length === 0 ||
    input.providerRequest.inputArtifacts.length === 0 ||
    new Set(
      input.providerRequest.inputArtifacts.map(({ artifactId }) => artifactId),
    ).size !== input.providerRequest.inputArtifacts.length
  ) {
    throw new TypeError("Provider call recording identity is invalid");
  }

  const prepared = input.adapter.prepare(input.providerRequest);
  const registration: ArtifactRegistration = {
    artifactId: input.requestArtifactId,
    kind: "provider_request",
    mediaType: "application/json",
    schemaId: "provider-request-recording.v1",
    createdBy: input.attempt.lease.ownerProcess,
    provenance: {
      method: "application_generated",
      purpose: "provider_request",
      sourceArtifactIds: [
        input.providerRequest.systemPromptArtifactId,
        input.providerRequest.outputSchemaArtifactId,
        ...input.providerRequest.inputArtifacts.map(
          ({ artifactId }) => artifactId,
        ),
      ],
      commandId: input.attempt.commandId,
      attemptId: input.attempt.attemptId,
    },
  };
  const requestArtifact = await input.artifactStaging.stageArtifact(
    prepared.redactedRequestBytes,
    registration,
  );
  if (
    requestArtifact.contentHash !== prepared.normalizedRequestHash ||
    requestArtifact.byteLength !== prepared.redactedRequestBytes.byteLength ||
    requestArtifact.schemaVersion !== 1 ||
    requestArtifact.artifactId !== registration.artifactId ||
    requestArtifact.kind !== registration.kind ||
    requestArtifact.mediaType !== registration.mediaType ||
    requestArtifact.schemaId !== registration.schemaId ||
    requestArtifact.createdBy !== registration.createdBy ||
    canonicalJson(requestArtifact.provenance) !==
      canonicalJson(registration.provenance)
  ) {
    throw new TypeError(
      "Staged provider request does not match its requested identity",
    );
  }
  await input.requestRegistration.registerPreparedProviderRequest({
    attempt: input.attempt,
    providerRequest: input.providerRequest,
    normalizedRequestHash: prepared.normalizedRequestHash,
    artifact: requestArtifact,
  });
  return { requestArtifact, execution: await prepared.dispatch() };
}
