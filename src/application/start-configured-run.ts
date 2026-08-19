import type { AuthorityPort } from "./authority-port.js";
import { assertJsonSchema } from "./json-schema-validator.js";
import { packagedControlPaths } from "./resolve-configuration.js";
import {
  resolvedConfigurationIsValid,
  resolvedConfigurationPolicyHash,
  type ResolvedConfigurationSnapshot,
} from "./stage-configuration.js";
import { startRun } from "./start-run.js";
import {
  WorkspaceOperationError,
  type ArtifactSummary,
} from "./workspace-operations.js";

type RegisteredArtifact = Omit<ArtifactSummary, "objectVerified">;

export interface ConfiguredRunArtifactPort {
  listArtifacts(): Promise<RegisteredArtifact[]>;
  readVerified(contentHash: string): Promise<Uint8Array>;
  copySource(sourcePath: string): Promise<{
    contentHash: string;
    byteLength: number;
    provenancePath: string;
  }>;
}

export async function startConfiguredRun(input: {
  authority: AuthorityPort;
  artifacts: ConfiguredRunArtifactPort;
  sourcePath: string;
  configurationArtifactId: string;
  expectedPackageVersion: string;
  actor: { kind: "human"; displayName: string; osAccount: string };
}): Promise<{ runId: string; state: object }> {
  const artifacts = await input.artifacts.listArtifacts();
  const configurationMetadata = artifacts.find(
    (artifact) => artifact.artifactId === input.configurationArtifactId,
  );
  const provenance = configurationMetadata?.metadata as
    | { provenance?: { method?: unknown; sourceArtifactIds?: unknown } }
    | undefined;
  if (
    configurationMetadata === undefined ||
    configurationMetadata.schemaId !==
      "software-factory/resolved-configuration.v1" ||
    provenance?.provenance?.method !== "resolved_configuration" ||
    !Array.isArray(provenance.provenance.sourceArtifactIds) ||
    !provenance.provenance.sourceArtifactIds.every(
      (value): value is string => typeof value === "string",
    )
  ) {
    throw new WorkspaceOperationError(
      "RUN_NOT_FOUND",
      `Configuration artifact not found: ${input.configurationArtifactId}`,
      { configurationArtifactId: input.configurationArtifactId },
    );
  }
  const configurationBytes = await input.artifacts.readVerified(
    configurationMetadata.contentHash,
  );
  const configuration = JSON.parse(
    Buffer.from(configurationBytes).toString("utf8"),
  ) as ResolvedConfigurationSnapshot;
  if (
    !resolvedConfigurationIsValid(configuration) ||
    configuration.policyHash !== resolvedConfigurationPolicyHash(configuration)
  ) {
    throw new WorkspaceOperationError(
      "INTEGRITY_ERROR",
      `Resolved configuration identity is invalid: ${input.configurationArtifactId}`,
    );
  }
  const sourceIds = new Set(provenance.provenance.sourceArtifactIds);
  const packageVersions = new Set<string>();
  for (const [key, expectedPath] of Object.entries(
    packagedControlPaths,
  ) as Array<[keyof typeof packagedControlPaths, string]>) {
    const contentHash = configuration.artifactHashes[key];
    const control = artifacts.find((artifact) => {
      const controlProvenance = artifact.metadata as {
        provenance?: {
          method?: unknown;
          packagePath?: unknown;
          packageVersion?: unknown;
        };
      };
      return (
        artifact.contentHash === contentHash &&
        sourceIds.has(artifact.artifactId) &&
        controlProvenance.provenance?.method === "packaged" &&
        controlProvenance.provenance.packagePath === expectedPath &&
        typeof controlProvenance.provenance.packageVersion === "string"
      );
    });
    if (control === undefined) {
      throw new WorkspaceOperationError(
        "INTEGRITY_ERROR",
        `Configured control is not authority-bound to ${expectedPath}`,
      );
    }
    packageVersions.add(
      String(
        (control.metadata as { provenance: { packageVersion: string } })
          .provenance.packageVersion,
      ),
    );
    await input.artifacts.readVerified(contentHash);
  }
  if (
    packageVersions.size !== 1 ||
    !packageVersions.has(input.expectedPackageVersion)
  ) {
    throw new WorkspaceOperationError(
      "INTEGRITY_ERROR",
      "Configured controls do not share one package version",
    );
  }
  const resolvedSchema = JSON.parse(
    Buffer.from(
      await input.artifacts.readVerified(
        configuration.artifactHashes.resolvedConfigurationSchema,
      ),
    ).toString("utf8"),
  ) as unknown;
  assertJsonSchema(configuration, resolvedSchema);
  const allowlist = JSON.parse(
    Buffer.from(
      await input.artifacts.readVerified(
        configuration.artifactHashes.frontierAllowlist,
      ),
    ).toString("utf8"),
  ) as { models?: Array<{ provider?: unknown; model_id?: unknown }> };
  const allowed = (assignment: { provider: string; modelId: string }) =>
    Array.isArray(allowlist.models) &&
    allowlist.models.some(
      (model) =>
        model.provider === assignment.provider &&
        model.model_id === assignment.modelId,
    );
  if (
    !allowed(configuration.plannerAssignment) ||
    !allowed(configuration.reviewerAssignment) ||
    configuration.plannerAssignment.provider ===
      configuration.reviewerAssignment.provider ||
    configuration.plannerAssignment.modelId ===
      configuration.reviewerAssignment.modelId
  ) {
    throw new WorkspaceOperationError(
      "INTEGRITY_ERROR",
      "Resolved assignments violate the pinned allowlist",
    );
  }
  const product = JSON.parse(
    Buffer.from(
      await input.artifacts.readVerified(
        configuration.artifactHashes.productDefaults,
      ),
    ).toString("utf8"),
  ) as { source_input?: { max_bytes?: unknown } };
  const maximumSourceBytes = product.source_input?.max_bytes;
  if (
    !Number.isInteger(maximumSourceBytes) ||
    (maximumSourceBytes as number) < 1
  ) {
    throw new WorkspaceOperationError(
      "INTEGRITY_ERROR",
      "Pinned source-size policy is invalid",
    );
  }
  const copied = await input.artifacts.copySource(input.sourcePath);
  if (
    copied.byteLength < 1 ||
    copied.byteLength > (maximumSourceBytes as number)
  ) {
    throw new WorkspaceOperationError(
      "INVALID_INPUT",
      "Source artifact violates the pinned source-size policy",
    );
  }
  return startRun({
    authority: input.authority,
    sourceArtifact: {
      schemaVersion: 1,
      artifactId: `source_${copied.contentHash.slice(0, 24)}`,
      kind: "raw_requirements",
      contentHash: copied.contentHash,
      byteLength: copied.byteLength,
      mediaType: "text/markdown; charset=utf-8",
      createdBy: `human:${input.actor.osAccount}`,
      provenance: { method: "copied", sourcePath: copied.provenancePath },
    },
    sourceProvenancePath: copied.provenancePath,
    configurationArtifactId: input.configurationArtifactId,
    configurationContentHash: configurationMetadata.contentHash,
    configuration,
    actor: input.actor,
  });
}
