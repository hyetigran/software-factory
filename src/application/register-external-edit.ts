import {
  transition,
  type ExternalEditDetected,
  type NonterminalRunState,
  type PinnedRunPolicy,
  type SystemActor,
} from "../domain/index.js";
import type { ContentAddressedArtifactStore } from "../infrastructure/artifacts/object-store.js";
import type { AuthorityPort, PersistableTransition } from "./authority-port.js";
import { commitTransition } from "./commit-transition.js";
import { verifyProjection } from "./deterministic-documents.js";

export async function registerExternalEdit(input: {
  store: ContentAddressedArtifactStore;
  authority: AuthorityPort;
  policy: PinnedRunPolicy;
  runId: string;
  expectedStateVersion: number;
  projectionKind: "ledger" | "plan";
  expectedProjection: { artifactId: string; contentHash: string };
  workingBytes: Uint8Array;
  artifactId: string;
  sourceArtifactIds: string[];
  actor: SystemActor;
  workspaceEvidence: {
    auditChainVerified: boolean;
    databaseIntegrityVerified: boolean;
    schemaCompatible: boolean;
    mutationLeaseAvailable: boolean;
  };
}): Promise<PersistableTransition<NonterminalRunState> | null> {
  const verification = verifyProjection(
    input.workingBytes,
    input.expectedProjection.contentHash,
  );
  if (verification.status === "verified") return null;
  const descriptor = await input.store.stageArtifact(verification.editedBytes, {
    artifactId: input.artifactId,
    kind: "external_edit",
    mediaType: "text/markdown; charset=utf-8",
    schemaId: "external-edit.v1",
    createdBy: `${input.actor.component}@${input.actor.version}`,
    provenance: {
      method: "external_edit",
      sourceArtifactIds: input.sourceArtifactIds,
      verifiedRenderArtifactId: input.expectedProjection.artifactId,
    },
  });
  return commitTransition<NonterminalRunState>(input.authority, {
    runId: input.runId,
    expectedStateVersion: input.expectedStateVersion,
    stagedArtifacts: [descriptor],
    transition: (previousState) => {
      assertExpectedProjection(previousState, input);
      const detected: ExternalEditDetected = {
        type: "ExternalEditDetected",
        runId: input.runId,
        expectedStateVersion: input.expectedStateVersion,
        projectionKind: input.projectionKind,
        expectedContentHash: input.expectedProjection.contentHash,
        editedArtifact: {
          artifactId: descriptor.artifactId,
          contentHash: descriptor.contentHash,
          verified: true,
        },
        ...input.workspaceEvidence,
        actor: input.actor,
      };
      return transition(previousState, detected, input.policy);
    },
  });
}

function assertExpectedProjection(
  state: NonterminalRunState | null,
  input: {
    projectionKind: "ledger" | "plan";
    expectedProjection: { artifactId: string; contentHash: string };
  },
): void {
  if (state === null)
    throw new TypeError("External edit requires an active run");
  if (input.projectionKind === "plan" && "renderedPlan" in state) {
    if (
      state.renderedPlan.artifactId !== input.expectedProjection.artifactId ||
      state.renderedPlan.contentHash !== input.expectedProjection.contentHash
    ) {
      throw new TypeError(
        "External edit must be compared with the authoritative rendered plan",
      );
    }
    return;
  }
  throw new TypeError(
    "The authoritative rendered projection is not recorded in run state",
  );
}
