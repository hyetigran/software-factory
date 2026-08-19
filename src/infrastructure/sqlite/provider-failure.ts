import type { DatabaseSync } from "node:sqlite";

import type { StagedArtifactRegistration } from "../../application/artifact-port.js";
import type {
  CompleteProviderFailureEvidence,
  ExecutionPolicy,
  ProviderFailureDisposition,
} from "../../application/execution-port.js";
import { commandIsValid } from "../../application/command-validation.js";
import type { PersistableCommand } from "../../application/authority-port.js";
import { canonicalJson } from "../../domain/canonical-json.js";
import type { BudgetReservation } from "../../domain/index.js";
import { createHash } from "node:crypto";
import { appendAuditEntries } from "./audit-journal.js";
import { AuthorityIntegrityError } from "./errors.js";
import {
  providerEvidenceMatchesRecording,
  providerResponseMatchesEvidence,
} from "./provider-completion.js";
import { providerExecutionIsAuthentic } from "../providers/execution-capability.js";

type Dependencies = {
  database: DatabaseSync;
  workspaceId: string;
  now: () => string;
  readStagedArtifactBytes(artifact: StagedArtifactRegistration): Uint8Array;
  readObjectBytes(contentHash: string): Uint8Array;
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
  specification_json: string;
  configuration_artifact_id: string;
  configuration_content_hash: string;
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
    failureClass: "transport_retryable",
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
    recovery: "pinned_model_unavailable",
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
    const command = JSON.parse(row.specification_json) as PersistableCommand;
    const failureKind =
      request.execution.kind === "refused"
        ? "refusal"
        : request.execution.kind === "transport_failure"
          ? request.execution.retryable
            ? "transport_retryable"
            : "transport_nonretryable"
          : request.execution.kind;
    const evidence = request.execution.evidence;
    if (
      row.run_id !== request.runId ||
      row.command_status !== "running" ||
      row.attempt_status !== "started" ||
      row.correlation_id !== request.correlationId ||
      row.owner_process !== request.ownerProcess ||
      row.lease_attempt_id !== request.attemptId ||
      row.request_artifact_id !== request.requestArtifactId ||
      row.request_content_hash !== request.requestContentHash ||
      policy.runId !== request.runId ||
      !providerExecutionIsAuthentic(request.execution) ||
      policy.configurationArtifactId !== row.configuration_artifact_id ||
      policy.configurationHash !== row.configuration_content_hash ||
      createHash("sha256")
        .update(canonicalJson(policy.configuration))
        .digest("hex") !== policy.configurationHash ||
      !commandIsValid(command) ||
      command.providerRequestPolicy?.configurationArtifactId !==
        policy.configurationArtifactId ||
      command.providerRequestPolicy.configurationContentHash !==
        policy.configurationHash ||
      evidence.requestedModel !== command.modelId ||
      evidence.correlationId !== request.correlationId ||
      !providerEvidenceMatchesRecording(
        evidence,
        request.correlationId,
        this.dependencies.readObjectBytes(row.request_content_hash),
      )
    ) {
      throw new TypeError(
        "Provider failure is not bound to the active attempt",
      );
    }
    this.assertOutcomeArtifact(request);
    const outcomeBytes = this.dependencies.readStagedArtifactBytes(
      request.outcomeArtifact,
    );
    const rawResponseBytes = request.execution.recording.rawResponseBytes;
    const expectedOutcomeBytes =
      rawResponseBytes ??
      Buffer.from(
        canonicalJson({
          kind: request.execution.kind,
          evidence: request.execution.evidence,
        }),
      );
    if (
      createHash("sha256").update(outcomeBytes).digest("hex") !==
        createHash("sha256").update(expectedOutcomeBytes).digest("hex") ||
      (rawResponseBytes !== undefined &&
        !providerResponseMatchesEvidence(evidence, outcomeBytes))
    ) {
      throw new TypeError("Provider failure outcome bytes are invalid");
    }
    this.dependencies.persistArtifactMetadata(request.outcomeArtifact);
    if (request.nativeUsageArtifact !== undefined) {
      this.assertNativeUsageArtifact(request.nativeUsageArtifact, request);
      const usageBytes = this.dependencies.readStagedArtifactBytes(
        request.nativeUsageArtifact,
      );
      const expectedUsageBytes = request.execution.recording.nativeUsageBytes;
      if (
        expectedUsageBytes === undefined ||
        createHash("sha256").update(usageBytes).digest("hex") !==
          createHash("sha256").update(expectedUsageBytes).digest("hex")
      ) {
        throw new TypeError("Provider failure usage bytes are invalid");
      }
      this.dependencies.persistArtifactMetadata(request.nativeUsageArtifact);
    }
    const reservation = this.loadReservation(request.attemptId);
    const normalizedActual = this.normalizedUsage(request, reservation);
    const counts = this.recoveryCounts(request);
    const selected = mapping[failureKind];
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
        evidence.providerRequestId ?? null,
        evidence.providerResponseId ?? null,
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
      failureKind,
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
                r.state_version, r.configuration_artifact_id,
                configuration.content_hash AS configuration_content_hash,
                c.specification_json,
                pr.artifact_id AS request_artifact_id,
                pr.content_hash AS request_content_hash
           FROM logical_commands c
           JOIN command_attempts a ON a.command_id = c.command_id
           JOIN runs r ON r.run_id = c.run_id
           JOIN artifacts configuration
             ON configuration.artifact_id = r.configuration_artifact_id
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

  private assertOutcomeArtifact(
    request: CompleteProviderFailureEvidence,
  ): void {
    const artifact = request.outcomeArtifact;
    const provenance = artifact.provenance;
    const hasRawResponse =
      request.execution.recording.rawResponseBytes !== undefined;
    if (
      artifact.createdBy !== request.ownerProcess ||
      !(
        (hasRawResponse &&
          artifact.kind === "provider_response" &&
          provenance.method === "provider_generated" &&
          provenance.commandId === request.commandId &&
          provenance.attemptId === request.attemptId &&
          provenance.sourceArtifactIds.length === 1 &&
          provenance.sourceArtifactIds[0] === request.requestArtifactId) ||
        (!hasRawResponse &&
          artifact.kind === "other" &&
          provenance.method === "application_generated" &&
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

  private assertNativeUsageArtifact(
    artifact: StagedArtifactRegistration,
    request: CompleteProviderFailureEvidence,
  ): void {
    const provenance = artifact.provenance;
    if (
      artifact.kind !== "native_usage" ||
      artifact.createdBy !== request.ownerProcess ||
      provenance.method !== "provider_generated" ||
      provenance.commandId !== request.commandId ||
      provenance.attemptId !== request.attemptId ||
      provenance.sourceArtifactIds.length !== 1 ||
      provenance.sourceArtifactIds[0] !== request.requestArtifactId
    ) {
      throw new TypeError("Provider native usage provenance is invalid");
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

  private normalizedUsage(
    request: CompleteProviderFailureEvidence,
    reservation: {
      calls: number;
      inputTokens: number;
      outputTokens: number;
      costUsdMicros: number;
    },
  ) {
    if (request.execution.kind === "unknown_outcome") return reservation;
    const nativeBytes = request.execution.recording.nativeUsageBytes;
    if (nativeBytes === undefined) {
      if (
        request.execution.kind !== "transport_failure" &&
        request.execution.kind !== "model_unavailable"
      ) {
        throw new TypeError(
          "Dispatched provider failure requires native usage",
        );
      }
      const dispatched =
        request.execution.recording.rawResponseBytes !== undefined;
      return {
        calls: dispatched ? 1 : 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsdMicros: dispatched ? reservation.costUsdMicros : 0,
      };
    }
    try {
      const usage = JSON.parse(Buffer.from(nativeBytes).toString("utf8")) as {
        input_tokens?: unknown;
        output_tokens?: unknown;
      };
      if (
        !Number.isInteger(usage.input_tokens) ||
        !Number.isInteger(usage.output_tokens) ||
        Number(usage.input_tokens) < 0 ||
        Number(usage.output_tokens) < 0
      ) {
        throw new TypeError("Provider native usage is invalid");
      }
      const actual = {
        calls: 1,
        inputTokens: Number(usage.input_tokens),
        outputTokens: Number(usage.output_tokens),
        costUsdMicros: reservation.costUsdMicros,
      };
      if (
        actual.calls > reservation.calls ||
        actual.inputTokens > reservation.inputTokens ||
        actual.outputTokens > reservation.outputTokens
      ) {
        throw new TypeError("Provider failure usage exceeds reservation");
      }
      return actual;
    } catch (error) {
      if (error instanceof TypeError) throw error;
      throw new TypeError("Provider native usage is invalid", { cause: error });
    }
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
    reservation: BudgetReservation,
    actual: BudgetReservation,
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
        request.execution.kind === "unknown_outcome"
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
    reservation: BudgetReservation,
    actual: BudgetReservation,
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
            providerEvidence: request.execution.evidence,
            failureKind: disposition.failureKind,
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
