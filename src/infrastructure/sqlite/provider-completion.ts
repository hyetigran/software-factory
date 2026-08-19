import type { DatabaseSync } from "node:sqlite";

import type {
  PersistableAuditFact,
  PersistableCommand,
} from "../../application/authority-port.js";
import { commandIsValid } from "../../application/command-validation.js";
import type {
  CompleteProviderAttemptEvidence,
  CompletedCommandAttempt,
} from "../../application/execution-port.js";
import type { StagedArtifactRegistration } from "../../application/artifact-port.js";
import { AuthorityIntegrityError } from "./errors.js";

type Dependencies = {
  database: DatabaseSync;
  now: () => string;
  verifyStagedArtifact(artifact: StagedArtifactRegistration): void;
  readStagedArtifactBytes(artifact: StagedArtifactRegistration): Uint8Array;
  readObjectBytes(contentHash: string): Uint8Array;
  persistArtifactMetadata(artifact: StagedArtifactRegistration): void;
};

type Completion = CompletedCommandAttempt & {
  auditFacts: PersistableAuditFact[];
};

export class SqliteProviderCompletion {
  constructor(private readonly dependencies: Dependencies) {}

  complete(request: CompleteProviderAttemptEvidence): Completion {
    const row = this.dependencies.database
      .prepare(
        `SELECT c.run_id, c.status AS command_status, c.accepted_attempt_id,
                c.triggering_state_version, c.specification_json,
                a.status AS attempt_status, a.correlation_id,
                l.owner_process, l.attempt_id AS lease_attempt_id,
                r.state_version,
                pr.artifact_id AS request_artifact_id,
                pr.content_hash AS request_content_hash
           FROM logical_commands c
           JOIN command_attempts a ON a.command_id = c.command_id
           JOIN runs r ON r.run_id = c.run_id
           LEFT JOIN mutation_lease l ON l.singleton = 1
           LEFT JOIN artifacts pr
             ON json_extract(pr.metadata_json, '$.provenance.attemptId') = a.attempt_id
            AND pr.kind = 'provider_request'
          WHERE c.command_id = ? AND a.attempt_id = ?`,
      )
      .get(request.commandId, request.attemptId) as
      | {
          run_id: string;
          command_status: string;
          accepted_attempt_id: string | null;
          triggering_state_version: number;
          specification_json: string;
          attempt_status: string;
          correlation_id: string;
          owner_process: string | null;
          lease_attempt_id: string | null;
          state_version: number;
          request_artifact_id: string | null;
          request_content_hash: string | null;
        }
      | undefined;
    if (
      row === undefined ||
      row.run_id !== request.runId ||
      row.command_status !== "running" ||
      row.accepted_attempt_id !== null ||
      row.attempt_status !== "started" ||
      row.correlation_id !== request.correlationId ||
      row.owner_process !== request.ownerProcess ||
      row.lease_attempt_id !== request.attemptId ||
      row.state_version !== row.triggering_state_version
    ) {
      throw new TypeError("Provider attempt completion is not eligible");
    }
    const command = JSON.parse(row.specification_json) as PersistableCommand;
    if (
      !commandIsValid(command) ||
      command.provider === undefined ||
      !["openai", "anthropic"].includes(command.provider)
    ) {
      throw new AuthorityIntegrityError(
        "Provider command envelope is invalid during completion",
      );
    }
    if (
      row.request_artifact_id === null ||
      row.request_content_hash === null ||
      request.requestArtifactId !== row.request_artifact_id ||
      request.requestContentHash !== row.request_content_hash ||
      !this.providerEvidenceIsValid(request, command)
    ) {
      throw new TypeError("Provider completion evidence is invalid");
    }
    this.assertStructuredOutput(request.outputArtifact, request, command);
    this.assertProviderArtifact(
      request.rawResponseArtifact,
      request,
      "provider_response",
      row.request_artifact_id,
    );
    this.assertProviderArtifact(
      request.nativeUsageArtifact,
      request,
      "native_usage",
      row.request_artifact_id,
    );
    this.dependencies.verifyStagedArtifact(request.outputArtifact);
    const rawResponseBytes = this.dependencies.readStagedArtifactBytes(
      request.rawResponseArtifact,
    );
    const nativeUsageBytes = this.dependencies.readStagedArtifactBytes(
      request.nativeUsageArtifact,
    );
    const recordedRequestBytes = this.dependencies.readObjectBytes(
      row.request_content_hash,
    );
    this.dependencies.persistArtifactMetadata(request.outputArtifact);
    this.dependencies.persistArtifactMetadata(request.rawResponseArtifact);
    this.dependencies.persistArtifactMetadata(request.nativeUsageArtifact);
    const reservation = this.loadReservation(request.attemptId);
    if (
      !Object.values(request.actualUsage).every(
        (value) => Number.isInteger(value) && value >= 0,
      ) ||
      request.actualUsage.calls !== 1 ||
      request.actualUsage.calls > reservation.calls ||
      request.actualUsage.inputTokens > reservation.inputTokens ||
      request.actualUsage.outputTokens > reservation.outputTokens ||
      request.actualUsage.costUsdMicros !== reservation.costUsdMicros ||
      !this.usageMatchesNative(request, nativeUsageBytes) ||
      !this.responseMatchesEvidence(request, rawResponseBytes) ||
      !this.evidenceMatchesRecording(request, recordedRequestBytes)
    ) {
      throw new TypeError("Provider usage exceeds the reserved maximum");
    }
    const completedAt = this.dependencies.now();
    this.dependencies.database
      .prepare(
        `UPDATE command_attempts
            SET status = 'completed', result_artifact_id = ?,
                native_usage_artifact_id = ?, completed_at = ?
          WHERE attempt_id = ?`,
      )
      .run(
        request.outputArtifact.artifactId,
        request.nativeUsageArtifact.artifactId,
        completedAt,
        request.attemptId,
      );
    this.dependencies.database
      .prepare(
        `UPDATE logical_commands
            SET status = 'succeeded', accepted_attempt_id = ?
          WHERE command_id = ?`,
      )
      .run(request.attemptId, request.commandId);
    this.reconcileUsage(request, reservation, completedAt);
    const evidence = [
      { kind: "artifact", artifactId: request.outputArtifact.artifactId },
      { kind: "artifact", artifactId: request.rawResponseArtifact.artifactId },
      {
        kind: "artifact",
        artifactId: request.nativeUsageArtifact.artifactId,
      },
    ];
    return {
      status: "completed",
      runId: request.runId,
      commandId: request.commandId,
      attemptId: request.attemptId,
      acceptedAsLogicalResult: true,
      auditFacts: [
        {
          type: "command_attempt_completed",
          actor: { kind: "system", component: "executor", version: "0.0.0" },
          reason: "Accept provider evidence with its domain transition",
          evidence,
          payload: {
            commandId: request.commandId,
            attemptId: request.attemptId,
            resultArtifactId: request.outputArtifact.artifactId,
            rawResponseArtifactId: request.rawResponseArtifact.artifactId,
            requestArtifactId: row.request_artifact_id,
            requestContentHash: row.request_content_hash,
            nativeUsageArtifactId: request.nativeUsageArtifact.artifactId,
            providerEvidence: request.providerEvidence,
          },
        },
        {
          type: "budget_reconciled",
          actor: { kind: "system", component: "executor", version: "0.0.0" },
          reason: "Convert the attempt reservation to actual provider usage",
          evidence: [evidence[1]],
          payload: {
            commandId: request.commandId,
            attemptId: request.attemptId,
            reserved: reservation,
            actual: request.actualUsage,
            costBasis: "reserved_maximum_no_pinned_price_schedule",
          },
        },
      ],
    };
  }

  private usageMatchesNative(
    request: CompleteProviderAttemptEvidence,
    bytes: Uint8Array,
  ): boolean {
    try {
      const usage = JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<
        string,
        unknown
      >;
      return (
        usage !== null &&
        typeof usage === "object" &&
        !Array.isArray(usage) &&
        usage.input_tokens === request.actualUsage.inputTokens &&
        usage.output_tokens === request.actualUsage.outputTokens
      );
    } catch {
      return false;
    }
  }

  private responseMatchesEvidence(
    request: CompleteProviderAttemptEvidence,
    bytes: Uint8Array,
  ): boolean {
    try {
      const response = JSON.parse(
        Buffer.from(bytes).toString("utf8"),
      ) as Record<string, unknown>;
      return (
        response !== null &&
        typeof response === "object" &&
        !Array.isArray(response) &&
        response.id === request.providerEvidence.providerResponseId &&
        response.model === request.providerEvidence.returnedModel &&
        (response.status === request.providerEvidence.completionStatus ||
          response.stop_reason === request.providerEvidence.completionStatus)
      );
    } catch {
      return false;
    }
  }

  private assertProviderArtifact(
    artifact: StagedArtifactRegistration,
    request: CompleteProviderAttemptEvidence,
    kind: "provider_response" | "native_usage",
    requestArtifactId: string,
  ): void {
    if (
      artifact.kind !== kind ||
      artifact.createdBy !== request.ownerProcess ||
      artifact.provenance.method !== "provider_generated" ||
      artifact.provenance.commandId !== request.commandId ||
      artifact.provenance.attemptId !== request.attemptId ||
      artifact.provenance.sourceArtifactIds.length !== 1 ||
      artifact.provenance.sourceArtifactIds[0] !== requestArtifactId
    ) {
      throw new TypeError("Provider completion artifact provenance is invalid");
    }
  }

  private assertStructuredOutput(
    artifact: StagedArtifactRegistration,
    request: CompleteProviderAttemptEvidence,
    command: PersistableCommand,
  ): void {
    const provenance = artifact.provenance;
    const schemaArtifactId =
      command.providerRequestPolicy?.outputSchemaArtifactId;
    if (
      artifact.kind !== "provider_response" ||
      artifact.createdBy !== request.ownerProcess ||
      provenance.method !== "application_generated" ||
      provenance.purpose !== "structured_provider_output" ||
      provenance.commandId !== request.commandId ||
      provenance.attemptId !== request.attemptId ||
      schemaArtifactId === undefined ||
      new Set(provenance.sourceArtifactIds).size !== 2 ||
      !provenance.sourceArtifactIds.includes(
        request.rawResponseArtifact.artifactId,
      ) ||
      !provenance.sourceArtifactIds.includes(schemaArtifactId)
    ) {
      throw new TypeError("Structured provider output provenance is invalid");
    }
  }

  private providerEvidenceIsValid(
    request: CompleteProviderAttemptEvidence,
    command: PersistableCommand,
  ): boolean {
    const evidence = request.providerEvidence;
    const preflight = evidence.preflight;
    const optionalKeys = [
      ...(evidence.returnedModel === undefined ? [] : ["returnedModel"]),
      ...(evidence.apiVersion === undefined ? [] : ["apiVersion"]),
      ...(evidence.providerRequestId === undefined
        ? []
        : ["providerRequestId"]),
      ...(evidence.providerResponseId === undefined
        ? []
        : ["providerResponseId"]),
      ...(evidence.completionStatus === undefined ? [] : ["completionStatus"]),
    ];
    const exactKeys = (value: object, keys: string[]): boolean =>
      Object.keys(value).sort().join(",") === [...keys].sort().join(",");
    return (
      exactKeys(evidence, [
        "requestedModel",
        "endpoint",
        "behaviorHeaders",
        "correlationId",
        "preflight",
        ...optionalKeys,
      ]) &&
      exactKeys(preflight, [
        "canonicalModelId",
        "structuredOutput",
        "contextWindowTokens",
        "maxOutputTokens",
        "inputTokens",
      ]) &&
      evidence.requestedModel === command.modelId &&
      evidence.returnedModel === command.modelId &&
      evidence.correlationId === request.correlationId &&
      evidence.endpoint.trim().length > 0 &&
      (evidence.providerResponseId?.trim().length ?? 0) > 0 &&
      (evidence.completionStatus?.trim().length ?? 0) > 0 &&
      (evidence.apiVersion === undefined ||
        evidence.apiVersion.trim().length > 0) &&
      (evidence.providerRequestId === undefined ||
        evidence.providerRequestId.trim().length > 0) &&
      preflight.structuredOutput === true &&
      preflight.canonicalModelId === command.modelId &&
      [
        preflight.contextWindowTokens,
        preflight.maxOutputTokens,
        preflight.inputTokens,
      ].every((value) => Number.isInteger(value) && value >= 0) &&
      Object.values(evidence.behaviorHeaders).every(
        (value) => typeof value === "string",
      )
    );
  }

  private evidenceMatchesRecording(
    request: CompleteProviderAttemptEvidence,
    bytes: Uint8Array,
  ): boolean {
    try {
      const recording = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
        endpoint?: unknown;
        headers?: unknown;
        preflight?: unknown;
      };
      return (
        recording !== null &&
        typeof recording === "object" &&
        !Array.isArray(recording) &&
        recording.endpoint === request.providerEvidence.endpoint &&
        JSON.stringify(recording.headers) ===
          JSON.stringify(request.providerEvidence.behaviorHeaders) &&
        JSON.stringify(recording.preflight) ===
          JSON.stringify(request.providerEvidence.preflight) &&
        (request.providerEvidence.apiVersion === undefined ||
          (recording.headers as Record<string, unknown> | undefined)?.[
            "anthropic-version"
          ] === request.providerEvidence.apiVersion)
      );
    } catch {
      return false;
    }
  }

  private loadReservation(attemptId: string) {
    const row = this.dependencies.database
      .prepare(
        `SELECT calls, input_tokens, output_tokens, cost_usd_micros
           FROM usage_ledger WHERE attempt_id = ? AND kind = 'reservation'`,
      )
      .get(attemptId) as
      | {
          calls: number;
          input_tokens: number;
          output_tokens: number;
          cost_usd_micros: number;
        }
      | undefined;
    if (row === undefined) {
      throw new AuthorityIntegrityError("Attempt reservation is missing");
    }
    return {
      calls: row.calls,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsdMicros: row.cost_usd_micros,
    };
  }

  private reconcileUsage(
    request: CompleteProviderAttemptEvidence,
    reservation: ReturnType<SqliteProviderCompletion["loadReservation"]>,
    createdAt: string,
  ): void {
    const insert = this.dependencies.database.prepare(
      `INSERT INTO usage_ledger
         (usage_entry_id, run_id, command_id, attempt_id, kind,
          calls, input_tokens, output_tokens, cost_usd_micros, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      `${request.attemptId}:release`,
      request.runId,
      request.commandId,
      request.attemptId,
      "release",
      reservation.calls,
      reservation.inputTokens,
      reservation.outputTokens,
      reservation.costUsdMicros,
      createdAt,
    );
    insert.run(
      `${request.attemptId}:actual`,
      request.runId,
      request.commandId,
      request.attemptId,
      "actual",
      request.actualUsage.calls,
      request.actualUsage.inputTokens,
      request.actualUsage.outputTokens,
      request.actualUsage.costUsdMicros,
      createdAt,
    );
  }
}
