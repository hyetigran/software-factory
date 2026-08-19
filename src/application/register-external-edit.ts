import { createHash } from "node:crypto";

import {
  transition,
  type ExternalEditDetected,
  type NonterminalRunState,
  type PinnedRunPolicy,
  type SystemActor,
} from "../domain/index.js";
import type {
  ArtifactStagingPort,
  AuthorityPort,
  PersistableTransition,
} from "./authority-port.js";
import { commitTransition } from "./commit-transition.js";
import {
  renderLedger,
  renderPlan,
  verifyProjection,
} from "./deterministic-documents.js";

export async function registerExternalEdit(input: {
  store: ArtifactStagingPort;
  authority: AuthorityPort;
  policy: PinnedRunPolicy;
  runId: string;
  expectedStateVersion: number;
  projectionKind: "ledger" | "plan";
  canonicalArtifactId: string;
  canonicalBytes: Uint8Array;
  workingBytes: Uint8Array;
  artifactId: string;
  actor: SystemActor;
  workspaceEvidence: {
    auditChainVerified: boolean;
    databaseIntegrityVerified: boolean;
    schemaCompatible: boolean;
    mutationLeaseAvailable: boolean;
  };
}): Promise<PersistableTransition<NonterminalRunState> | null> {
  const canonicalContentHash = createHash("sha256")
    .update(input.canonicalBytes)
    .digest("hex");
  const expectedRender =
    input.projectionKind === "ledger"
      ? renderLedger(input.canonicalBytes)
      : renderPlan(input.canonicalBytes);
  const verification = verifyProjection(
    input.workingBytes,
    expectedRender.contentHash,
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
      sourceArtifactIds: [input.canonicalArtifactId],
      expectedContentHash: expectedRender.contentHash,
    },
  });
  return commitTransition<NonterminalRunState>(input.authority, {
    runId: input.runId,
    expectedStateVersion: input.expectedStateVersion,
    stagedArtifacts: [descriptor],
    transition: (previousState) => {
      assertCanonicalDocument(previousState, input, canonicalContentHash);
      const detected: ExternalEditDetected = {
        type: "ExternalEditDetected",
        runId: input.runId,
        expectedStateVersion: input.expectedStateVersion,
        projectionKind: input.projectionKind,
        expectedContentHash: expectedRender.contentHash,
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

function assertCanonicalDocument(
  state: NonterminalRunState | null,
  input: {
    projectionKind: "ledger" | "plan";
    canonicalArtifactId: string;
  },
  canonicalContentHash: string,
): void {
  if (state === null)
    throw new TypeError("External edit requires an active run");
  const canonical =
    input.projectionKind === "plan" && "currentPlan" in state
      ? state.currentPlan
      : input.projectionKind === "ledger"
        ? state.currentLedger
        : undefined;
  if (
    canonical === undefined ||
    canonical.artifactId !== input.canonicalArtifactId ||
    canonical.contentHash !== canonicalContentHash
  ) {
    throw new TypeError(
      "External edit must be derived from the authoritative canonical document",
    );
  }
}
