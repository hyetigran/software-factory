import { createHash } from "node:crypto";

import {
  transition,
  type NonterminalRunState,
  type PinnedRunPolicy,
  type ProjectionRestored,
  type SystemActor,
} from "../domain/index.js";
import type { AuthorityPort, PersistableTransition } from "./authority-port.js";
import { commitTransition } from "./commit-transition.js";

export function restoreProjection(input: {
  authority: AuthorityPort;
  policy: PinnedRunPolicy;
  runId: string;
  expectedStateVersion: number;
  workingBytes: Uint8Array;
  actor: SystemActor;
  workspaceEvidence: {
    auditChainVerified: boolean;
    databaseIntegrityVerified: boolean;
    schemaCompatible: boolean;
    mutationLeaseAvailable: boolean;
  };
}): Promise<PersistableTransition<NonterminalRunState>> {
  const restoredContentHash = createHash("sha256")
    .update(input.workingBytes)
    .digest("hex");
  return commitTransition<NonterminalRunState>(input.authority, {
    runId: input.runId,
    expectedStateVersion: input.expectedStateVersion,
    transition: (previousState) => {
      const restored: ProjectionRestored = {
        type: "ProjectionRestored",
        runId: input.runId,
        expectedStateVersion: input.expectedStateVersion,
        restoredContentHash,
        ...input.workspaceEvidence,
        actor: input.actor,
      };
      return transition(previousState, restored, input.policy);
    },
  });
}
