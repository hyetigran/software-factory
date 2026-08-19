import { createHash, randomUUID } from "node:crypto";

import {
  transition,
  type HumanActor,
  type NonterminalRunState,
} from "../domain/index.js";
import type { ArtifactStagingPort } from "./artifact-port.js";
import { ValidatedProjection, type AuthorityPort } from "./authority-port.js";
import type { ResolvedConfigurationSnapshot } from "./stage-configuration.js";

export async function submitLedger(input: {
  authority: AuthorityPort;
  staging: ArtifactStagingPort;
  runId: string;
  ledgerBytes: Uint8Array;
  configuration: ResolvedConfigurationSnapshot;
  actor: HumanActor;
}): Promise<{ state: object; ledgerArtifactId: string }> {
  const parsed: unknown = JSON.parse(
    Buffer.from(input.ledgerBytes).toString("utf8"),
  );
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new TypeError("Ledger must be a JSON object");
  const ledger = parsed as Record<string, unknown>;
  if (
    typeof ledger.ledger_id !== "string" ||
    ledger.ledger_id.trim().length === 0
  )
    throw new TypeError("Ledger identity is required");
  const hash = createHash("sha256").update(input.ledgerBytes).digest("hex");
  const artifact = await input.staging.stageArtifact(input.ledgerBytes, {
    artifactId: `ledger_${hash.slice(0, 24)}`,
    kind: "requirements_ledger",
    mediaType: "application/json",
    schemaId: "software-factory/requirements-ledger.v1",
    createdBy: `human:${input.actor.osAccount}`,
    provenance: { method: "human_submitted" },
  });
  const result = await input.authority.transaction((transaction) => {
    const previousState = transaction.loadRun<NonterminalRunState>(input.runId);
    if (previousState === null) throw new TypeError("Run does not exist");
    const nextVersion = previousState.stateVersion + 1;
    const projection = ValidatedProjection.fromLedgerArtifact({
      bytes: input.ledgerBytes,
      contentHash: hash,
      stateVersion: nextVersion,
      ledgerVersionId: ledger.ledger_id as string,
      sourceArtifactId: previousState.sourceArtifactId,
    });
    const accepted = transition(
      previousState,
      {
        type: "LedgerSubmitted",
        runId: input.runId,
        expectedStateVersion: previousState.stateVersion,
        ledgerVersionId: ledger.ledger_id as string,
        ledgerArtifactId: artifact.artifactId,
        ledgerContentHash: hash,
        ledgerObjectVerified: true,
        ledgerSchemaValid: true,
        sourceReferencesValid:
          ledger.source_artifact_id === previousState.sourceArtifactId,
        auditChainVerified: true,
        databaseIntegrityVerified: true,
        schemaCompatible: true,
        mutationLeaseAvailable: true,
        validateCommandId: `command_${randomUUID().replaceAll("-", "")}`,
        renderCommandId: `command_${randomUUID().replaceAll("-", "")}`,
        actor: input.actor,
      },
      {
        policyHash: input.configuration.policyHash,
        plannerAssignment: input.configuration.plannerAssignment,
        reviewerAssignment: input.configuration.reviewerAssignment,
      },
    );
    transaction.persist(
      {
        runId: input.runId,
        expectedStateVersion: previousState.stateVersion,
        stagedArtifacts: [artifact],
        validatedProjection: projection,
      },
      accepted,
    );
    return accepted;
  });
  return { state: result.nextState, ledgerArtifactId: artifact.artifactId };
}
