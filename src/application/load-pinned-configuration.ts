import {
  resolvedConfigurationIsValid,
  resolvedConfigurationPolicyHash,
  type ResolvedConfigurationSnapshot,
} from "./stage-configuration.js";
import {
  WorkspaceOperationError,
  type ArtifactSummary,
} from "./workspace-operations.js";

type RegisteredArtifact = Omit<ArtifactSummary, "objectVerified">;

export interface PinnedConfigurationReadPort {
  loadRun(runId: string): Promise<object | null>;
  listArtifacts(): Promise<RegisteredArtifact[]>;
  readVerified(contentHash: string): Promise<Uint8Array>;
}

export async function loadPinnedConfiguration(input: {
  runId: string;
  read: PinnedConfigurationReadPort;
}): Promise<ResolvedConfigurationSnapshot> {
  const state = await input.read.loadRun(input.runId);
  if (state === null)
    throw new WorkspaceOperationError(
      "RUN_NOT_FOUND",
      `Run not found: ${input.runId}`,
      {
        runId: input.runId,
      },
    );
  const identity = state as {
    configurationArtifactId?: unknown;
    configurationContentHash?: unknown;
  };
  if (
    typeof identity.configurationArtifactId !== "string" ||
    typeof identity.configurationContentHash !== "string"
  ) {
    throw new WorkspaceOperationError(
      "INTEGRITY_ERROR",
      `Run configuration identity is invalid: ${input.runId}`,
    );
  }
  const registered = (await input.read.listArtifacts()).find(
    (artifact) => artifact.artifactId === identity.configurationArtifactId,
  );
  if (registered?.contentHash !== identity.configurationContentHash) {
    throw new WorkspaceOperationError(
      "INTEGRITY_ERROR",
      `Run configuration registration is invalid: ${input.runId}`,
    );
  }
  try {
    const bytes = await input.read.readVerified(
      identity.configurationContentHash,
    );
    const configuration = JSON.parse(
      Buffer.from(bytes).toString("utf8"),
    ) as ResolvedConfigurationSnapshot;
    if (
      !resolvedConfigurationIsValid(configuration) ||
      configuration.policyHash !==
        resolvedConfigurationPolicyHash(configuration)
    ) {
      throw new Error("invalid resolved configuration identity");
    }
    return configuration;
  } catch (error) {
    throw new WorkspaceOperationError(
      "INTEGRITY_ERROR",
      `Run configuration is missing or corrupt: ${input.runId}`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}
