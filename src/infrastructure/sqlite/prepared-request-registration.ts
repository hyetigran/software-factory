import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { StagedArtifactRegistration } from "../../application/artifact-port.js";
import type { PersistableCommand } from "../../application/authority-port.js";
import { commandIsValid } from "../../application/command-validation.js";
import {
  schemaRepairOverlayFromUnknown,
  type SchemaRepairOverlay,
  type StartedCommandAttempt,
} from "../../application/execution-port.js";
import type { ProviderRequest } from "../../application/provider-port.js";
import {
  resolvedConfigurationIsValid,
  type ResolvedConfigurationSnapshot,
} from "../../application/stage-configuration.js";
import { canonicalJson } from "../../domain/canonical-json.js";
import type { ContentAddressedArtifactStore } from "../artifacts/object-store.js";
import { AuthorityIntegrityError } from "./errors.js";

type Dependencies = {
  database: DatabaseSync;
  artifactStore: ContentAddressedArtifactStore;
  assertWritable(): void;
  verifyAuditChain(): void;
  persistArtifactMetadata(artifact: StagedArtifactRegistration): void;
  quarantine(reason: string): void;
};

type RegistrationInput = {
  attempt: StartedCommandAttempt;
  providerRequest: ProviderRequest;
  normalizedRequestHash: string;
  artifact: StagedArtifactRegistration;
};

function parseCommand(value: string): PersistableCommand {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AuthorityIntegrityError("Logical command JSON must be an object");
  }
  return parsed as PersistableCommand;
}

function parseConfiguration(bytes: Uint8Array): ResolvedConfigurationSnapshot {
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !resolvedConfigurationIsValid(parsed as ResolvedConfigurationSnapshot)
  ) {
    throw new AuthorityIntegrityError(
      "Resolved configuration artifact is invalid",
    );
  }
  return parsed as ResolvedConfigurationSnapshot;
}

function configuredRequestPolicy(
  configuration: ResolvedConfigurationSnapshot,
  commandType: string,
): {
  promptHash: string;
  schemaHash: string;
  timeoutMs: number;
  reasoning: string | null;
} | null {
  if (commandType === "generate_plan") {
    return {
      promptHash: configuration.artifactHashes.plannerPrompt,
      schemaHash: configuration.artifactHashes.planSchema,
      ...configuration.providerRequestSettings.planner,
    };
  }
  if (commandType === "generate_remediation") {
    return {
      promptHash: configuration.artifactHashes.remediationPrompt,
      schemaHash: configuration.artifactHashes.remediationSchema,
      ...configuration.providerRequestSettings.remediation,
    };
  }
  if (
    commandType === "baseline_review" ||
    commandType === "closure_review" ||
    commandType === "verify_remediation"
  ) {
    return {
      promptHash: configuration.artifactHashes.reviewerPrompt,
      schemaHash: configuration.artifactHashes.reviewSchema,
      ...configuration.providerRequestSettings.reviewer,
    };
  }
  return null;
}

type EffectiveProviderRequestPolicy = Omit<
  NonNullable<PersistableCommand["providerRequestPolicy"]>,
  "role"
> & { role: ProviderRequest["role"] };

function parseSchemaRepairOverlay(
  value: string | null,
): SchemaRepairOverlay | null {
  if (value === null) return null;
  try {
    return schemaRepairOverlayFromUnknown(JSON.parse(value));
  } catch {
    throw new AuthorityIntegrityError("Schema repair audit policy is invalid");
  }
}

export class SqlitePreparedRequestRegistration {
  constructor(private readonly dependencies: Dependencies) {}

  async register(
    input: RegistrationInput,
  ): Promise<"claimed" | "already_claimed"> {
    const { database } = this.dependencies;
    database.exec("BEGIN IMMEDIATE");
    try {
      this.dependencies.assertWritable();
      this.dependencies.verifyAuditChain();
      const body = await this.dependencies.artifactStore.readVerified(
        input.artifact.contentHash,
      );
      if (body.byteLength !== input.artifact.byteLength) {
        throw new AuthorityIntegrityError(
          "Provider request artifact byte length is invalid",
        );
      }
      const row = database
        .prepare(
          `SELECT c.run_id, c.command_key, c.specification_json,
                  r.configuration_artifact_id,
                  cfg.content_hash AS configuration_content_hash,
                  a.status AS attempt_status, a.correlation_id,
                  l.command_id AS lease_command_id,
                  l.attempt_id AS lease_attempt_id, l.owner_process,
                  (SELECT json_extract(e.payload_json, '$.attemptKind')
                     FROM audit_entries e
                    WHERE e.run_id = c.run_id
                      AND e.fact_type = 'command_attempt_started'
                      AND json_extract(e.payload_json, '$.attemptId') = a.attempt_id
                    ORDER BY e.sequence DESC LIMIT 1) AS attempt_kind,
                  (SELECT json_extract(e.payload_json, '$.schemaRepair')
                     FROM audit_entries e
                    WHERE e.run_id = c.run_id
                      AND e.fact_type = 'command_attempt_started'
                      AND json_extract(e.payload_json, '$.attemptId') = a.attempt_id
                    ORDER BY e.sequence DESC LIMIT 1) AS schema_repair_json
             FROM logical_commands c
             JOIN runs r ON r.run_id = c.run_id
             JOIN artifacts cfg ON cfg.artifact_id = r.configuration_artifact_id
             JOIN command_attempts a ON a.command_id = c.command_id
             LEFT JOIN mutation_lease l ON l.singleton = 1
            WHERE c.command_id = ? AND a.attempt_id = ?`,
        )
        .get(input.attempt.commandId, input.attempt.attemptId) as
        | {
            run_id: string;
            configuration_artifact_id: string;
            configuration_content_hash: string;
            command_key: string;
            specification_json: string;
            attempt_status: string;
            correlation_id: string;
            lease_command_id: string | null;
            lease_attempt_id: string | null;
            owner_process: string | null;
            attempt_kind: string | null;
            schema_repair_json: string | null;
          }
        | undefined;
      const command = row && parseCommand(row.specification_json);
      const requestPolicy = command?.providerRequestPolicy;
      const configuration =
        row === undefined
          ? undefined
          : parseConfiguration(
              await this.dependencies.artifactStore.readVerified(
                row.configuration_content_hash,
              ),
            );
      const configuredPolicy =
        command === undefined || configuration === undefined
          ? null
          : configuredRequestPolicy(configuration, command.commandType);
      const repairOverlay =
        row === undefined
          ? null
          : parseSchemaRepairOverlay(row.schema_repair_json);
      const effectivePolicy =
        row?.attempt_kind === "schema_repair" &&
        requestPolicy !== undefined &&
        configuration !== undefined &&
        repairOverlay !== null
          ? {
              ...requestPolicy,
              role: "schema_repair" as const,
              promptArtifactId: repairOverlay.promptArtifactId,
              promptContentHash: repairOverlay.promptContentHash,
              outputSchemaArtifactId: repairOverlay.outputSchemaArtifactId,
              outputSchemaContentHash: repairOverlay.outputSchemaContentHash,
              timeoutMs:
                configuration.providerRequestSettings.schemaRepair.timeoutMs,
              reasoning:
                configuration.providerRequestSettings.schemaRepair.reasoning,
              providerStorage: configuration.providerStorage,
            }
          : requestPolicy;
      const expectedConfiguredPolicy =
        row?.attempt_kind === "schema_repair" && configuration !== undefined
          ? {
              promptHash: configuration.artifactHashes.schemaRepairPrompt,
              schemaHash: requestPolicy?.outputSchemaContentHash ?? "",
              ...configuration.providerRequestSettings.schemaRepair,
            }
          : configuredPolicy;
      if (
        row === undefined ||
        command === undefined ||
        !commandIsValid(command) ||
        requestPolicy === undefined ||
        effectivePolicy === undefined ||
        configuration === undefined ||
        row.run_id !== input.attempt.runId ||
        row.command_key !== input.providerRequest.logicalCommandKey ||
        row.attempt_status !== "started" ||
        row.correlation_id !== input.attempt.correlationId ||
        row.correlation_id !== input.providerRequest.correlationId ||
        row.lease_command_id !== input.attempt.commandId ||
        row.lease_attempt_id !== input.attempt.attemptId ||
        row.owner_process !== input.attempt.lease.ownerProcess ||
        command.provider !== input.providerRequest.provider ||
        command.modelId !== input.providerRequest.modelId ||
        requestPolicy.configurationArtifactId !==
          row.configuration_artifact_id ||
        requestPolicy.configurationContentHash !==
          row.configuration_content_hash ||
        requestPolicy.policyHash !== command.policyHash ||
        configuration.policyHash !== command.policyHash ||
        expectedConfiguredPolicy === null ||
        effectivePolicy.promptContentHash !==
          expectedConfiguredPolicy.promptHash ||
        effectivePolicy.outputSchemaContentHash !==
          expectedConfiguredPolicy.schemaHash ||
        effectivePolicy.timeoutMs !== expectedConfiguredPolicy.timeoutMs ||
        effectivePolicy.reasoning !== expectedConfiguredPolicy.reasoning ||
        effectivePolicy.providerStorage !== configuration.providerStorage ||
        effectivePolicy.role !== input.providerRequest.role ||
        effectivePolicy.maxOutputTokens !==
          input.providerRequest.maxOutputTokens ||
        effectivePolicy.timeoutMs !== input.providerRequest.timeoutMs ||
        effectivePolicy.reasoning !==
          (input.providerRequest.reasoning ?? null) ||
        effectivePolicy.providerStorage !==
          input.providerRequest.providerStorage
      ) {
        throw new TypeError(
          "Provider request is not bound to the active command attempt",
        );
      }
      this.assertArtifactIdentity(input, row.owner_process);
      this.assertInputs(
        input.providerRequest,
        command,
        effectivePolicy,
        repairOverlay,
        requestPolicy.promptContentHash,
      );
      const existing = database
        .prepare(
          `SELECT artifact_id FROM artifacts
            WHERE kind = 'provider_request'
              AND json_extract(metadata_json, '$.provenance.attemptId') = ?`,
        )
        .get(input.attempt.attemptId) as { artifact_id: string } | undefined;
      if (
        existing !== undefined &&
        existing.artifact_id !== input.artifact.artifactId
      ) {
        throw new TypeError(
          "Command attempt already has a different provider request",
        );
      }
      this.dependencies.persistArtifactMetadata(input.artifact);
      if (existing !== undefined) {
        database.exec("COMMIT");
        return "already_claimed";
      }
      database.exec("COMMIT");
      return "claimed";
    } catch (error) {
      database.exec("ROLLBACK");
      if (error instanceof AuthorityIntegrityError) {
        this.dependencies.quarantine(error.message);
      }
      throw error;
    }
  }

  private assertArtifactIdentity(
    input: RegistrationInput,
    ownerProcess: string,
  ): void {
    const provenance = input.artifact.provenance;
    const sourceIds = [
      input.providerRequest.systemPromptArtifactId,
      input.providerRequest.outputSchemaArtifactId,
      ...input.providerRequest.inputArtifacts.map(
        ({ artifactId }) => artifactId,
      ),
    ];
    if (
      input.normalizedRequestHash !== input.artifact.contentHash ||
      input.artifact.kind !== "provider_request" ||
      input.artifact.mediaType !== "application/json" ||
      input.artifact.schemaId !== "provider-request-recording.v1" ||
      input.artifact.createdBy !== ownerProcess ||
      provenance.method !== "application_generated" ||
      provenance.purpose !== "provider_request" ||
      provenance.commandId !== input.attempt.commandId ||
      provenance.attemptId !== input.attempt.attemptId ||
      canonicalJson([...provenance.sourceArtifactIds].sort()) !==
        canonicalJson([...new Set(sourceIds)].sort())
    ) {
      throw new TypeError("Provider request artifact identity is invalid");
    }
  }

  private assertInputs(
    request: ProviderRequest,
    command: PersistableCommand,
    policy: EffectiveProviderRequestPolicy,
    repairOverlay: SchemaRepairOverlay | null,
    originalPromptHash: string,
  ): void {
    if (
      repairOverlay !== null &&
      !request.inputArtifacts.some(
        ({ artifactId, contentHash }) =>
          artifactId === repairOverlay.invalidResponseArtifactId &&
          contentHash === repairOverlay.invalidResponseContentHash,
      )
    ) {
      throw new TypeError(
        "Schema repair request does not contain the failed response",
      );
    }
    if (
      createHash("sha256").update(request.systemPrompt).digest("hex") !==
        request.systemPromptContentHash ||
      createHash("sha256")
        .update(canonicalJson(request.outputSchema))
        .digest("hex") !== request.outputSchemaContentHash ||
      policy.promptArtifactId !== request.systemPromptArtifactId ||
      policy.promptContentHash !== request.systemPromptContentHash ||
      policy.outputSchemaArtifactId !== request.outputSchemaArtifactId ||
      policy.outputSchemaContentHash !== request.outputSchemaContentHash
    ) {
      throw new TypeError("Provider controlled artifacts do not match command");
    }
    const artifacts = [
      {
        artifactId: request.systemPromptArtifactId,
        contentHash: request.systemPromptContentHash,
      },
      {
        artifactId: request.outputSchemaArtifactId,
        contentHash: request.outputSchemaContentHash,
      },
      ...request.inputArtifacts,
    ];
    const hashes = artifacts.map(({ contentHash }) => contentHash);
    if (
      new Set(hashes).size !== hashes.length ||
      canonicalJson([...hashes].sort()) !==
        canonicalJson(
          [
            ...command.inputArtifactHashes.filter(
              (hash) => repairOverlay === null || hash !== originalPromptHash,
            ),
            ...(repairOverlay === null
              ? []
              : [
                  repairOverlay.promptContentHash,
                  repairOverlay.invalidResponseContentHash,
                ]),
          ].sort(),
        )
    ) {
      throw new TypeError("Provider request inputs do not match command");
    }
    for (const artifact of artifacts) {
      const registered = this.dependencies.database
        .prepare("SELECT content_hash FROM artifacts WHERE artifact_id = ?")
        .get(artifact.artifactId) as { content_hash: string } | undefined;
      if (registered?.content_hash !== artifact.contentHash) {
        throw new TypeError(
          "Provider request input is not an authoritative artifact",
        );
      }
    }
  }
}
