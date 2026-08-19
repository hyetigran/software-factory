import type {
  ArtifactRegistrationPort,
  ArtifactStagingPort,
  StagedArtifactRegistration,
} from "./artifact-port.js";
import type {
  ProviderAdapter,
  ProviderExecution,
  ProviderRequest,
} from "./provider-port.js";

export type ExecuteProviderCallRequest = {
  adapter: ProviderAdapter;
  artifactStaging: ArtifactStagingPort;
  artifactRegistration: ArtifactRegistrationPort;
  providerRequest: ProviderRequest;
  requestArtifactId: string;
  commandId: string;
  attemptId: string;
  inputArtifactIds: string[];
  createdBy: string;
};

export type ExecutedProviderCall = {
  requestArtifact: StagedArtifactRegistration;
  execution: ProviderExecution;
};

export async function executeProviderCall(
  input: ExecuteProviderCallRequest,
): Promise<ExecutedProviderCall> {
  if (
    input.requestArtifactId.trim().length === 0 ||
    input.commandId.trim().length === 0 ||
    input.attemptId.trim().length === 0 ||
    input.createdBy.trim().length === 0 ||
    input.inputArtifactIds.length === 0 ||
    new Set(input.inputArtifactIds).size !== input.inputArtifactIds.length ||
    input.inputArtifactIds.some((id) => id.trim().length === 0)
  ) {
    throw new TypeError("Provider call recording identity is invalid");
  }

  const prepared = input.adapter.prepare(input.providerRequest);
  const requestArtifact = await input.artifactStaging.stageArtifact(
    prepared.redactedRequestBytes,
    {
      artifactId: input.requestArtifactId,
      kind: "provider_request",
      mediaType: "application/json",
      schemaId: "provider-request-recording.v1",
      createdBy: input.createdBy,
      provenance: {
        method: "provider_generated",
        sourceArtifactIds: [...input.inputArtifactIds],
        commandId: input.commandId,
        attemptId: input.attemptId,
      },
    },
  );
  if (requestArtifact.contentHash !== prepared.normalizedRequestHash) {
    throw new TypeError(
      "Staged provider request does not match its normalized request hash",
    );
  }
  await input.artifactRegistration.registerArtifact(requestArtifact);
  return { requestArtifact, execution: await prepared.dispatch() };
}
