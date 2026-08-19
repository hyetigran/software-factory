import { randomUUID } from "node:crypto";

import {
  transition,
  type HumanActor,
  type NonterminalRunState,
} from "../domain/index.js";
import type { AuthorityPort } from "./authority-port.js";
import type { ResolvedConfigurationSnapshot } from "./stage-configuration.js";
import type { ArtifactSummary, UsageSummary } from "./workspace-operations.js";
import { WorkspaceOperationError } from "./workspace-operations.js";
import { packagedControlPaths } from "./resolve-configuration.js";

function pinnedArtifact(
  artifacts: Array<Omit<ArtifactSummary, "objectVerified">>,
  contentHash: string,
  packagePath: string,
): { artifactId: string; contentHash: string } {
  const matches = artifacts.filter((artifact) => {
    const provenance = (artifact.metadata as { provenance?: unknown })
      .provenance as { method?: unknown; packagePath?: unknown } | undefined;
    return (
      artifact.contentHash === contentHash &&
      provenance?.method === "packaged" &&
      provenance.packagePath === packagePath
    );
  });
  if (matches.length !== 1)
    throw new WorkspaceOperationError(
      "INTEGRITY_ERROR",
      `Pinned planning control has ${matches.length} registrations`,
      { contentHash },
    );
  return matches[0]!;
}

export async function requestPlanning(input: {
  authority: AuthorityPort;
  runId: string;
  configuration: ResolvedConfigurationSnapshot;
  registeredArtifacts: Array<Omit<ArtifactSummary, "objectVerified">>;
  usage: UsageSummary;
  policyAccepted: boolean;
  budgetsAccepted: boolean;
  providerBoundaryAcknowledged: boolean;
  actor: HumanActor;
}): Promise<{ state: object; commandId: string }> {
  const prompt = pinnedArtifact(
    input.registeredArtifacts,
    input.configuration.artifactHashes.plannerPrompt,
    packagedControlPaths.plannerPrompt,
  );
  const outputSchema = pinnedArtifact(
    input.registeredArtifacts,
    input.configuration.artifactHashes.planSchema,
    packagedControlPaths.planSchema,
  );
  const ceilings = input.configuration.hardCeilings;
  const consumed = input.usage.effectiveConsumption;
  const availableBudget = {
    calls: ceilings.calls - consumed.calls,
    inputTokens: ceilings.inputTokens - consumed.inputTokens,
    outputTokens: ceilings.outputTokens - consumed.outputTokens,
    costUsdMicros: ceilings.costUsdMicros - consumed.costUsdMicros,
  };
  const reservation = { ...availableBudget, calls: 1 };
  const commandId = `command_${randomUUID().replaceAll("-", "")}`;
  return input.authority.transaction((transaction) => {
    const state = transaction.loadRun<NonterminalRunState>(input.runId);
    if (state === null)
      throw new WorkspaceOperationError(
        "RUN_NOT_FOUND",
        `Run not found: ${input.runId}`,
      );
    const result = transition(
      state,
      {
        type: "PlanningRequested",
        runId: input.runId,
        expectedStateVersion: state.stateVersion,
        planPurposeId: `${input.runId}:plan:baseline`,
        plannerAssignment: input.configuration.plannerAssignment,
        plannerModelAllowed: true,
        modelIdentityPinned: true,
        policyAccepted: input.policyAccepted,
        budgetsAccepted: input.budgetsAccepted,
        providerBoundaryAcknowledged: input.providerBoundaryAcknowledged,
        promptArtifactId: prompt.artifactId,
        promptContentHash: prompt.contentHash,
        promptArtifactVerified: true,
        outputSchemaArtifactId: outputSchema.artifactId,
        outputSchemaContentHash: outputSchema.contentHash,
        outputSchemaArtifactVerified: true,
        requestTimeoutMs:
          input.configuration.providerRequestSettings.planner.timeoutMs,
        requestReasoning:
          input.configuration.providerRequestSettings.planner.reasoning,
        requestPolicyResolved: true,
        budgetReservation: reservation,
        availableBudget,
        auditChainVerified: true,
        databaseIntegrityVerified: true,
        schemaCompatible: true,
        mutationLeaseAvailable: true,
        generateCommandId: commandId,
        actor: input.actor,
      },
      {
        policyHash: input.configuration.policyHash,
        plannerAssignment: input.configuration.plannerAssignment,
        reviewerAssignment: input.configuration.reviewerAssignment,
      },
    );
    transaction.persist(
      { runId: input.runId, expectedStateVersion: state.stateVersion },
      result,
    );
    return { state: result.nextState, commandId };
  });
}
