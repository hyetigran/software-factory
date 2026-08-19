import { randomUUID } from "node:crypto";

import {
  transition,
  type HumanActor,
  type NonterminalRunState,
} from "../domain/index.js";
import type { AuthorityPort } from "./authority-port.js";
import type { ResolvedConfigurationSnapshot } from "./stage-configuration.js";

export async function approveSourceExclusion(input: {
  authority: AuthorityPort;
  runId: string;
  exclusionId: string;
  startOffset: number;
  endOffset: number;
  expectedSourceContentHash: string;
  sourceByteLength: number;
  reason: string;
  configuration: ResolvedConfigurationSnapshot;
  actor: HumanActor;
}): Promise<{ state: object }> {
  const result = await input.authority.transaction((transaction) => {
    const previousState = transaction.loadRun<NonterminalRunState>(input.runId);
    if (previousState === null) throw new TypeError("Run does not exist");
    if (previousState.sourceContentHash !== input.expectedSourceContentHash)
      throw new TypeError("Run source changed while approving exclusion");
    const accepted = transition(
      previousState,
      {
        type: "SourceExclusionApproved",
        runId: input.runId,
        expectedStateVersion: previousState.stateVersion,
        exclusionId: input.exclusionId,
        sourceRange: {
          startOffset: input.startOffset,
          endOffset: input.endOffset,
        },
        sourceRangeVerified:
          Number.isInteger(input.startOffset) &&
          Number.isInteger(input.endOffset) &&
          input.startOffset >= 0 &&
          input.endOffset > input.startOffset &&
          input.endOffset <= input.sourceByteLength,
        reason: input.reason,
        auditChainVerified: true,
        databaseIntegrityVerified: true,
        schemaCompatible: true,
        mutationLeaseAvailable: true,
        validateCommandId: `command_${randomUUID().replaceAll("-", "")}`,
        actor: input.actor,
      },
      {
        policyHash: input.configuration.policyHash,
        plannerAssignment: input.configuration.plannerAssignment,
        reviewerAssignment: input.configuration.reviewerAssignment,
      },
    );
    transaction.persist(
      { runId: input.runId, expectedStateVersion: previousState.stateVersion },
      accepted,
    );
    return accepted;
  });
  return { state: result.nextState };
}
