import { randomUUID } from "node:crypto";

import {
  transition,
  type HumanActor,
  type NonterminalRunState,
  type ProviderBoundaryDisclosure,
} from "../domain/index.js";
import type { AuthorityPort } from "./authority-port.js";
import type { ResolvedConfigurationSnapshot } from "./stage-configuration.js";
import type { ArtifactSummary } from "./workspace-operations.js";
import { WorkspaceOperationError } from "./workspace-operations.js";
import { packagedControlPaths } from "./resolve-configuration.js";
import { createHash } from "node:crypto";
import { canonicalJson } from "../domain/canonical-json.js";

export function providerBoundaryDisclosure(
  configuration: ResolvedConfigurationSnapshot,
): { disclosure: ProviderBoundaryDisclosure; disclosureHash: string } {
  const base = {
    provider: configuration.plannerAssignment.provider,
    modelId: configuration.plannerAssignment.modelId,
    providerStorage: configuration.providerStorage,
  };
  const disclosure: ProviderBoundaryDisclosure =
    configuration.recordingMode === "strict_replay"
      ? {
          mode: "strict_replay",
          ...base,
          externalTransmission: false,
          transmittedArtifactClasses: [],
          retentionApplicability: "not_applicable_no_network",
          cassetteBoundary: "local_verified_recording",
        }
      : {
          mode: "live",
          ...base,
          externalTransmission: true,
          transmittedArtifactClasses: [
            "system_prompt",
            "requirements_ledger",
            "output_schema",
          ],
          retentionApplicability: "provider_terms_apply",
        };
  return {
    disclosure,
    disclosureHash: createHash("sha256")
      .update(canonicalJson(disclosure))
      .digest("hex"),
  };
}

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
  policyAccepted: boolean;
  budgetsAccepted: boolean;
  providerBoundaryAcknowledged: boolean;
  providerBoundaryDisclosureHash: string;
  actor: HumanActor;
}): Promise<{
  state: object;
  commandId: string;
  providerBoundaryDisclosure: ProviderBoundaryDisclosure;
  providerBoundaryDisclosureHash: string;
}> {
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
  const { disclosure, disclosureHash } = providerBoundaryDisclosure(
    input.configuration,
  );
  if (input.providerBoundaryDisclosureHash !== disclosureHash) {
    throw new WorkspaceOperationError(
      "CONFLICT",
      "Provider-boundary disclosure changed; preview and acknowledge it again",
    );
  }
  const commandId = `command_${randomUUID().replaceAll("-", "")}`;
  return input.authority.transaction((transaction) => {
    const state = transaction.loadRun<NonterminalRunState>(input.runId);
    if (state === null)
      throw new WorkspaceOperationError(
        "RUN_NOT_FOUND",
        `Run not found: ${input.runId}`,
      );
    if (
      state.currentLedger?.approval === undefined ||
      transaction.loadAcceptedCommandResult(
        input.runId,
        "render_ledger_approval",
        state.currentLedger?.approval?.receiptCommandId,
      ) === null
    )
      throw new WorkspaceOperationError(
        "CONFLICT",
        "Ledger approval receipt must be rendered before planning",
      );
    const capacity = transaction.loadExecutionCapacity(
      input.runId,
      input.configuration.hardCeilings,
    );
    const availableBudget = capacity.availableBudget;
    const reservation = { ...availableBudget, calls: 1 };
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
        providerBoundaryDisclosure: disclosure,
        providerBoundaryDisclosureHash: disclosureHash,
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
        mutationLeaseAvailable: capacity.mutationLeaseAvailable,
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
    return {
      state: result.nextState,
      commandId,
      providerBoundaryDisclosure: disclosure,
      providerBoundaryDisclosureHash: disclosureHash,
    };
  });
}
