import { randomUUID } from "node:crypto";

import {
  transition,
  type HumanActor,
  type NonterminalRunState,
} from "../domain/index.js";
import type { AuthorityPort } from "./authority-port.js";
import { commitTransition } from "./commit-transition.js";
import type { StagedArtifactRegistration } from "./artifact-port.js";
import type { ResolvedConfigurationSnapshot } from "./stage-configuration.js";

export async function startRun(input: {
  authority: AuthorityPort;
  sourceArtifact: StagedArtifactRegistration;
  sourceProvenancePath: string;
  configurationArtifactId: string;
  configurationContentHash: string;
  configuration: ResolvedConfigurationSnapshot;
  actor: HumanActor;
  runId?: string;
  renderCommandId?: string;
}): Promise<{ runId: string; state: object }> {
  const runId = input.runId ?? `run_${randomUUID().replaceAll("-", "")}`;
  const renderCommandId =
    input.renderCommandId ?? `command_${randomUUID().replaceAll("-", "")}`;
  const result = await commitTransition<NonterminalRunState>(input.authority, {
    runId,
    expectedStateVersion: 0,
    stagedArtifacts: [input.sourceArtifact],
    transition: (previousState) =>
      transition(
        previousState,
        {
          type: "RunStarted",
          runId,
          expectedStateVersion: 0,
          sourceArtifactId: input.sourceArtifact.artifactId,
          sourceContentHash: input.sourceArtifact.contentHash,
          sourceProvenancePath: input.sourceProvenancePath,
          sourceObjectVerified: true,
          configurationArtifactId: input.configurationArtifactId,
          configurationContentHash: input.configurationContentHash,
          auditChainVerified: true,
          databaseIntegrityVerified: true,
          schemaCompatible: true,
          mutationLeaseAvailable: true,
          renderCommandId,
          actor: input.actor,
        },
        {
          policyHash: input.configuration.policyHash,
          plannerAssignment: input.configuration.plannerAssignment,
          reviewerAssignment: input.configuration.reviewerAssignment,
        },
      ),
  });
  return { runId, state: result.nextState };
}
