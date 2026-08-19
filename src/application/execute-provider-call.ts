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
  }): Promise<"claimed" | "already_claimed">;
}

export type ExecutedProviderCall =
  | {
      status: "dispatched";
      requestArtifact: StagedArtifactRegistration;
      execution: ProviderExecution;
    }
  | {
      status: "already_claimed";
      requestArtifact: StagedArtifactRegistration;
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

  const providerRequest = structuredClone(input.providerRequest);
  const prepared = input.adapter.prepare(providerRequest);
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
        providerRequest.systemPromptArtifactId,
        providerRequest.outputSchemaArtifactId,
        ...providerRequest.inputArtifacts.map(({ artifactId }) => artifactId),
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
  const claim = await input.requestRegistration.registerPreparedProviderRequest(
    {
      attempt: input.attempt,
      providerRequest,
      normalizedRequestHash: prepared.normalizedRequestHash,
      artifact: requestArtifact,
    },
  );
  if (claim === "already_claimed") {
    return { status: "already_claimed", requestArtifact };
  }
  return {
    status: "dispatched",
    requestArtifact,
    execution: await prepared.dispatch(),
  };
}
