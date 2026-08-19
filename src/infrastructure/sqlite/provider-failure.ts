import type { DatabaseSync } from "node:sqlite";

import type { StagedArtifactRegistration } from "../../application/artifact-port.js";
import type {
  CompleteProviderFailureEvidence,
  ExecutionPolicy,
  ProviderFailureDisposition,
} from "../../application/execution-port.js";
import { appendAuditEntries } from "./audit-journal.js";
import { AuthorityIntegrityError } from "./errors.js";

type Dependencies = {
  database: DatabaseSync;
  workspaceId: string;
  now: () => string;
  readStagedArtifactBytes(artifact: StagedArtifactRegistration): Uint8Array;
  persistArtifactMetadata(artifact: StagedArtifactRegistration): void;
};

type AttemptRow = {
  run_id: string;
  command_status: string;
  attempt_status: string;
  correlation_id: string;
  owner_process: string | null;
  lease_attempt_id: string | null;
  request_artifact_id: string | null;
  request_content_hash: string | null;
  state_version: number;
};

const mapping = {
  refusal: { status: "failed", failureClass: "refusal", recovery: "terminal" },
  truncated: {
    status: "failed",
    failureClass: "invalid_output",
    recovery: "terminal",
  },
  schema_invalid: {
    status: "failed",
    failureClass: "schema_invalid",
    recovery: "schema_repair",
  },
  transport_retryable: {
    status: "failed",
    failureClass: "transport",
    recovery: "transport_retry",
  },
  transport_nonretryable: {
    status: "failed",
    failureClass: "transport",
    recovery: "terminal",
  },
  unknown_outcome: {
    status: "unknown",
    failureClass: "unknown",
    recovery: "transport_retry",
  },
  model_unavailable: {
    status: "failed",
    failureClass: "provider_error",
    recovery: "terminal",
  },
  model_mismatch: {
    status: "failed",
    failureClass: "provider_error",
    recovery: "terminal",
  },
} as const;

export class SqliteProviderFailure {
  constructor(private readonly dependencies: Dependencies) {}

  complete(
    request: CompleteProviderFailureEvidence,
    policy: ExecutionPolicy,
  ): ProviderFailureDisposition {
    const row = this.loadAttempt(request);
    if (
      row.run_id !== request.runId ||
      row.command_status !== "running" ||
      row.attempt_status !== "started" ||
      row.correlation_id !== request.correlationId ||
      row.owner_process !== request.ownerProcess ||
      row.lease_attempt_id !== request.attemptId ||
      row.request_artifact_id !== request.requestArtifactId ||
      row.request_content_hash !== request.requestContentHash ||
      policy.runId !== request.runId
    ) {
      throw new TypeError(
        "Provider failure is not bound to the active attempt",
      );
    }
    this.assertArtifact(request.outcomeArtifact, request);
    this.dependencies.readStagedArtifactBytes(request.outcomeArtifact);
    this.dependencies.persistArtifactMetadata(request.outcomeArtifact);
    if (request.nativeUsageArtifact !== undefined) {
      this.assertArtifact(request.nativeUsageArtifact, request);
      this.dependencies.readStagedArtifactBytes(request.nativeUsageArtifact);
      this.dependencies.persistArtifactMetadata(request.nativeUsageArtifact);
    }
    const reservation = this.loadReservation(request.attemptId);
    const normalizedActual =
      request.failureKind === "unknown_outcome"
        ? reservation
        : request.actualUsage;
    if (
      !Object.values(request.actualUsage).every(
        (value) => Number.isInteger(value) && value >= 0,
      ) ||
      request.actualUsage.calls > reservation.calls ||
      request.actualUsage.inputTokens > reservation.inputTokens ||
      request.actualUsage.outputTokens > reservation.outputTokens ||
      request.actualUsage.costUsdMicros > reservation.costUsdMicros
    ) {
      throw new TypeError("Provider failure usage is invalid");
    }
    const counts = this.recoveryCounts(request);
    const selected = mapping[request.failureKind];
    const recovery =
      selected.recovery === "transport_retry" &&
      counts.retriesUsed >= policy.ceilings.retries
        ? "terminal"
        : selected.recovery === "schema_repair" &&
            counts.repairsUsed >= policy.ceilings.repairs
          ? "terminal"
          : selected.recovery;
    const completedAt = this.dependencies.now();
    this.dependencies.database
      .prepare(
        `UPDATE command_attempts
            SET status = ?, failure_class = ?, result_artifact_id = ?,
                native_usage_artifact_id = ?, provider_request_id = ?,
                provider_response_id = ?, completed_at = ?
          WHERE attempt_id = ?`,
      )
      .run(
        selected.status,
        selected.failureClass,
        request.outcomeArtifact.artifactId,
        request.nativeUsageArtifact?.artifactId ?? null,
        request.providerEvidence.providerRequestId ?? null,
        request.providerEvidence.providerResponseId ?? null,
        completedAt,
        request.attemptId,
      );
    this.dependencies.database
      .prepare("UPDATE logical_commands SET status = ? WHERE command_id = ?")
      .run(selected.status, request.commandId);
    this.reconcileUsage(request, reservation, normalizedActual, completedAt);
    const disposition: ProviderFailureDisposition = {
      status: selected.status,
      runId: request.runId,
      commandId: request.commandId,
      attemptId: request.attemptId,
      failureClass: selected.failureClass,
      recovery,
      recoveryBounds: {
        retryLimit: policy.ceilings.retries,
        repairLimit: policy.ceilings.repairs,
        ...counts,
      },
    };
    this.appendAudit(
      request,
      row.state_version,
      reservation,
      normalizedActual,
      disposition,
    );
    this.dependencies.database
      .prepare(
        "DELETE FROM mutation_lease WHERE singleton = 1 AND attempt_id = ?",
      )
      .run(request.attemptId);
    return disposition;
  }

  private loadAttempt(request: CompleteProviderFailureEvidence): AttemptRow {
    const row = this.dependencies.database
      .prepare(
        `SELECT c.run_id, c.status AS command_status,
                a.status AS attempt_status, a.correlation_id,
                l.owner_process, l.attempt_id AS lease_attempt_id,
                r.state_version, pr.artifact_id AS request_artifact_id,
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
      .get(request.commandId, request.attemptId) as AttemptRow | undefined;
    if (row === undefined)
      throw new TypeError("Provider attempt is unavailable");
    return row;
  }

  private assertArtifact(
    artifact: StagedArtifactRegistration,
    request: CompleteProviderFailureEvidence,
  ): void {
    const provenance = artifact.provenance;
    if (
      artifact.createdBy !== request.ownerProcess ||
      !["provider_response", "native_usage", "other"].includes(artifact.kind) ||
      !(
        (provenance.method === "provider_generated" &&
          provenance.commandId === request.commandId &&
          provenance.attemptId === request.attemptId &&
          provenance.sourceArtifactIds.length === 1 &&
          provenance.sourceArtifactIds[0] === request.requestArtifactId) ||
        (provenance.method === "application_generated" &&
          provenance.purpose === "provider_failure_evidence" &&
          provenance.commandId === request.commandId &&
          provenance.attemptId === request.attemptId &&
          provenance.sourceArtifactIds.length === 1 &&
          provenance.sourceArtifactIds[0] === request.requestArtifactId)
      )
    ) {
      throw new TypeError("Provider failure artifact provenance is invalid");
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
    if (row === undefined)
      throw new AuthorityIntegrityError("Attempt reservation is missing");
    return {
      calls: row.calls,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsdMicros: row.cost_usd_micros,
    };
  }

  private recoveryCounts(request: CompleteProviderFailureEvidence) {
    const row = this.dependencies.database
      .prepare(
        `SELECT
           sum(CASE WHEN json_extract(payload_json, '$.attemptKind') = 'transport_retry' THEN 1 ELSE 0 END) AS retries,
           sum(CASE WHEN json_extract(payload_json, '$.attemptKind') = 'schema_repair' THEN 1 ELSE 0 END) AS repairs
         FROM audit_entries WHERE run_id = ? AND fact_type = 'command_attempt_started'
           AND json_extract(payload_json, '$.commandId') = ?`,
      )
      .get(request.runId, request.commandId) as {
      retries: number | null;
      repairs: number | null;
    };
    return { retriesUsed: row.retries ?? 0, repairsUsed: row.repairs ?? 0 };
  }

  private reconcileUsage(
    request: CompleteProviderFailureEvidence,
    reservation: CompleteProviderFailureEvidence["actualUsage"],
    actual: CompleteProviderFailureEvidence["actualUsage"],
    createdAt: string,
  ): void {
    const insert = this.dependencies.database.prepare(
      `INSERT INTO usage_ledger
         (usage_entry_id, run_id, command_id, attempt_id, kind, calls,
          input_tokens, output_tokens, cost_usd_micros,
          native_usage_artifact_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [kind, usage] of [
      ["release", reservation],
      [
        request.failureKind === "unknown_outcome"
          ? "conservative_charge"
          : "actual",
        actual,
      ],
    ] as const) {
      insert.run(
        `${request.attemptId}:${kind}`,
        request.runId,
        request.commandId,
        request.attemptId,
        kind,
        usage.calls,
        usage.inputTokens,
        usage.outputTokens,
        usage.costUsdMicros,
        request.nativeUsageArtifact?.artifactId ?? null,
        createdAt,
      );
    }
  }

  private appendAudit(
    request: CompleteProviderFailureEvidence,
    stateVersion: number,
    reservation: CompleteProviderFailureEvidence["actualUsage"],
    actual: CompleteProviderFailureEvidence["actualUsage"],
    disposition: ProviderFailureDisposition,
  ): void {
    const evidence = [
      { kind: "artifact", artifactId: request.outcomeArtifact.artifactId },
      ...(request.nativeUsageArtifact === undefined
        ? []
        : [
            {
              kind: "artifact",
              artifactId: request.nativeUsageArtifact.artifactId,
            },
          ]),
    ];
    appendAuditEntries({
      database: this.dependencies.database,
      workspaceId: this.dependencies.workspaceId,
      runId: request.runId,
      stateVersionBefore: stateVersion,
      stateVersionAfter: stateVersion,
      correlationId: request.correlationId,
      facts: [
        {
          type:
            disposition.status === "unknown"
              ? "command_attempt_unknown"
              : "command_attempt_completed",
          actor: { kind: "system", component: "executor", version: "0.0.0" },
          reason:
            "Persist the classified provider failure and recovery decision",
          evidence,
          payload: {
            commandId: request.commandId,
            attemptId: request.attemptId,
            requestArtifactId: request.requestArtifactId,
            outcomeArtifactId: request.outcomeArtifact.artifactId,
            nativeUsageArtifactId:
              request.nativeUsageArtifact?.artifactId ?? null,
            providerEvidence: request.providerEvidence,
            failureKind: request.failureKind,
            failureClass: disposition.failureClass,
            recovery: disposition.recovery,
          },
        },
        {
          type: "budget_reconciled",
          actor: { kind: "system", component: "executor", version: "0.0.0" },
          reason:
            "Release the reservation and account for the failed provider attempt",
          evidence,
          payload: {
            commandId: request.commandId,
            attemptId: request.attemptId,
            reserved: reservation,
            actual,
          },
        },
      ],
      now: this.dependencies.now,
    });
  }
}
