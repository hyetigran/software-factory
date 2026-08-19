import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { StagedArtifactRegistration } from "../../application/artifact-port.js";
import type { PersistableCommand } from "../../application/authority-port.js";
import { commandIsValid } from "../../application/command-validation.js";
import type { StartedCommandAttempt } from "../../application/execution-port.js";
import type { ProviderRequest } from "../../application/provider-port.js";
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

function expectedRole(commandType: string): ProviderRequest["role"] | null {
  if (["generate_plan", "generate_remediation"].includes(commandType)) {
    return "planner";
  }
  if (
    ["baseline_review", "closure_review", "verify_remediation"].includes(
      commandType,
    )
  ) {
    return "reviewer";
  }
  return commandType === "repair_schema" ? "schema_repair" : null;
}

function controlledArtifactIds(command: PersistableCommand): {
  promptId?: string;
  schemaId?: string;
} {
  const payload = command.payload as Record<string, unknown>;
  if (command.commandType === "generate_plan") {
    return {
      promptId: String(payload.promptArtifactId),
      schemaId: String(payload.outputSchemaArtifactId),
    };
  }
  if (["baseline_review", "closure_review"].includes(command.commandType)) {
    return {
      promptId: String(payload.reviewerPromptArtifactId),
      schemaId: String(payload.reviewSchemaArtifactId),
    };
  }
  if (command.commandType === "repair_schema") {
    return { schemaId: String(payload.schemaArtifactId) };
  }
  return {};
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
                  a.status AS attempt_status, a.correlation_id,
                  l.command_id AS lease_command_id,
                  l.attempt_id AS lease_attempt_id, l.owner_process,
                  (SELECT json_extract(e.payload_json, '$.attemptKind')
                     FROM audit_entries e
                    WHERE e.run_id = c.run_id
                      AND e.fact_type = 'command_attempt_started'
                      AND json_extract(e.payload_json, '$.attemptId') = a.attempt_id
                    ORDER BY e.sequence DESC LIMIT 1) AS attempt_kind
             FROM logical_commands c
             JOIN command_attempts a ON a.command_id = c.command_id
             LEFT JOIN mutation_lease l ON l.singleton = 1
            WHERE c.command_id = ? AND a.attempt_id = ?`,
        )
        .get(input.attempt.commandId, input.attempt.attemptId) as
        | {
            run_id: string;
            command_key: string;
            specification_json: string;
            attempt_status: string;
            correlation_id: string;
            lease_command_id: string | null;
            lease_attempt_id: string | null;
            owner_process: string | null;
            attempt_kind: string | null;
          }
        | undefined;
      const command = row && parseCommand(row.specification_json);
      const role =
        row?.attempt_kind === "schema_repair"
          ? "schema_repair"
          : command && expectedRole(command.commandType);
      const payload = command?.payload as Record<string, unknown> | undefined;
      if (
        row === undefined ||
        command === undefined ||
        !commandIsValid(command) ||
        role === null ||
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
        role !== input.providerRequest.role ||
        input.providerRequest.maxOutputTokens >
          command.budgetReservation.outputTokens ||
        (typeof payload?.providerStorage === "string" &&
          payload.providerStorage !== input.providerRequest.providerStorage)
      ) {
        throw new TypeError(
          "Provider request is not bound to the active command attempt",
        );
      }
      this.assertArtifactIdentity(input, row.owner_process);
      this.assertInputs(input.providerRequest, command);
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
      if (existing !== undefined) {
        database.exec("COMMIT");
        return "already_claimed";
      }
      this.dependencies.persistArtifactMetadata(input.artifact);
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
  ): void {
    const controlled = controlledArtifactIds(command);
    if (
      createHash("sha256").update(request.systemPrompt).digest("hex") !==
        request.systemPromptContentHash ||
      createHash("sha256")
        .update(canonicalJson(request.outputSchema))
        .digest("hex") !== request.outputSchemaContentHash ||
      (controlled.promptId !== undefined &&
        controlled.promptId !== request.systemPromptArtifactId) ||
      (controlled.schemaId !== undefined &&
        controlled.schemaId !== request.outputSchemaArtifactId)
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
        canonicalJson([...command.inputArtifactHashes].sort())
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
