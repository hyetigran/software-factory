import type { ExternalEditDetected, SystemActor } from "../domain/index.js";
import type { ContentAddressedArtifactStore } from "../infrastructure/artifacts/object-store.js";
import type { StagedArtifactDescriptor } from "../infrastructure/artifacts/object-store.js";
import { verifyProjection } from "./deterministic-documents.js";

export async function registerExternalEdit(input: {
  store: ContentAddressedArtifactStore;
  artifactRegistrar: {
    registerArtifact(descriptor: StagedArtifactDescriptor): Promise<void>;
  };
  runId: string;
  expectedStateVersion: number;
  projectionKind: "ledger" | "plan";
  expectedContentHash: string;
  workingBytes: Uint8Array;
  artifactId: string;
  sourceArtifactIds: string[];
  commandId: string;
  actor: SystemActor;
  workspaceEvidence: {
    auditChainVerified: boolean;
    databaseIntegrityVerified: boolean;
    schemaCompatible: boolean;
    mutationLeaseAvailable: boolean;
  };
}): Promise<ExternalEditDetected | null> {
  const verification = verifyProjection(
    input.workingBytes,
    input.expectedContentHash,
  );
  if (verification.status === "verified") return null;
  const descriptor = await input.store.stageArtifact(verification.editedBytes, {
    artifactId: input.artifactId,
    kind: "other",
    mediaType: "text/markdown; charset=utf-8",
    schemaId: "external-edit.v1",
    createdBy: `${input.actor.component}@${input.actor.version}`,
    provenance: {
      method: "deterministic_render",
      sourceArtifactIds: input.sourceArtifactIds,
      commandId: input.commandId,
    },
  });
  await input.artifactRegistrar.registerArtifact(descriptor);
  return {
    type: "ExternalEditDetected",
    runId: input.runId,
    expectedStateVersion: input.expectedStateVersion,
    projectionKind: input.projectionKind,
    expectedContentHash: input.expectedContentHash,
    editedArtifact: {
      artifactId: descriptor.artifactId,
      contentHash: descriptor.contentHash,
      verified: true,
    },
    ...input.workspaceEvidence,
    actor: input.actor,
  };
}
