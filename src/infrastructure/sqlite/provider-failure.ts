import type { DatabaseSync } from "node:sqlite";

import type { StagedArtifactRegistration } from "../../application/artifact-port.js";
import type {
  CompleteProviderFailureEvidence,
  ExecutionPolicy,
  ProviderFailureDisposition,
} from "../../application/execution-port.js";
import { commandIsValid } from "../../application/command-validation.js";
import type {
  PersistableAuditFact,
  PersistableCommand,
} from "../../application/authority-port.js";
import { canonicalJson } from "../../domain/canonical-json.js";
import type { BudgetReservation } from "../../domain/index.js";
import { createHash } from "node:crypto";
import {
  providerEvidenceMatchesRecording,
  providerResponseMatchesEvidence,
} from "./provider-completion.js";
import { isAuthenticOpenAiExecution } from "../providers/openai.js";
import { isAuthenticAnthropicExecution } from "../providers/anthropic.js";
import { isAuthenticReplayExecution } from "../providers/replay.js";
import { decideProviderFailure } from "../../application/provider-failure-policy.js";
import { ProviderAttemptAccounting } from "./provider-attempt-accounting.js";
import {
  providerSettlementMode,
  resultDiscardedFact,
} from "./provider-attempt-settlement.js";

type Dependencies = {
  database: DatabaseSync;
  now: () => string;
  readStagedArtifactBytes(artifact: StagedArtifactRegistration): Uint8Array;
  readObjectBytes(contentHash: string): Uint8Array;
  persistArtifactMetadata(artifact: StagedArtifactRegistration): void;
};

type AttemptRow = {
  run_id: string;
  command_status: string;
  accepted_attempt_id: string | null;
  triggering_state_version: number;
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
  result_artifact_id: string | null;
  result_content_hash: string | null;
  native_usage_artifact_id: string | null;
  native_usage_content_hash: string | null;
  actual_calls: number | null;
  actual_input_tokens: number | null;
  actual_output_tokens: number | null;
  actual_cost_usd_micros: number | null;
};

export class SqliteProviderFailure {
  private readonly accounting: ProviderAttemptAccounting;

  constructor(private readonly dependencies: Dependencies) {
    this.accounting = new ProviderAttemptAccounting(dependencies.database);
  }

  settle(
    request: CompleteProviderFailureEvidence,
    policy: ExecutionPolicy,
  ):
    | { status: "eligible" }
    | {
        status: "settled";
        completion: ProviderFailureDisposition & {
          stateVersion: number;
          auditFacts: PersistableAuditFact[];
        };
      } {
    const row = this.loadAttempt(request);
    const explicitlyExpected =
      this.dependencies.database
        .prepare(
          `SELECT 1 FROM audit_entries
            WHERE run_id = ? AND fact_type = 'command_attempt_started'
              AND json_extract(payload_json, '$.attemptId') = ?
              AND json_extract(payload_json, '$.attemptKind') = 'human_rerun'
              AND json_extract(payload_json, '$.humanAuthorizationId') IS NOT NULL`,
        )
        .get(request.runId, request.attemptId) !== undefined;
    const mode = providerSettlementMode({
      state: {
        commandStatus: row.command_status,
        acceptedAttemptId: row.accepted_attempt_id,
        triggeringStateVersion: row.triggering_state_version,
        attemptStatus: row.attempt_status,
        currentStateVersion: row.state_version,
      },
      settledStatuses: ["failed", "unknown", "discarded"],
      explicitlyExpected,
    });
    if (mode === "exact_replay") {
      return {
        status: "settled",
        completion: this.reconcileSettled(request, policy, row),
      };
    }
    if (mode === "eligible") {
      return { status: "eligible" };
    }
    if (mode === "discard") {
      return {
        status: "settled",
        completion: this.complete(request, policy, false),
      };
    }
    throw new TypeError("Provider failure settlement is not eligible");
  }

  complete(
    request: CompleteProviderFailureEvidence,
    policy: ExecutionPolicy,
    acceptLogicalResult = true,
  ): ProviderFailureDisposition & {
    stateVersion: number;
    auditFacts: PersistableAuditFact[];
  } {
    const row = this.loadAttempt(request);
    if (
      row.run_id !== request.runId ||
      (acceptLogicalResult && row.command_status !== "running") ||
      (acceptLogicalResult && row.accepted_attempt_id !== null) ||
      row.attempt_status !== "started" ||
      row.correlation_id !== request.correlationId ||
      (acceptLogicalResult && row.owner_process !== request.ownerProcess) ||
      (!acceptLogicalResult &&
        row.owner_process !== null &&
        row.owner_process !== request.ownerProcess) ||
      (acceptLogicalResult && row.lease_attempt_id !== request.attemptId) ||
      (!acceptLogicalResult &&
        row.lease_attempt_id !== null &&
        row.lease_attempt_id !== request.attemptId) ||
      row.request_artifact_id !== request.requestArtifactId ||
      row.request_content_hash !== request.requestContentHash
    ) {
      throw new TypeError(
        "Provider failure is not bound to the active attempt",
      );
    }
    this.assertAttemptBinding(request, policy, row);
    const evidence = request.execution.evidence;
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
    const reservation = this.accounting.reservation(request.attemptId);
    const normalizedActual = this.normalizedUsage(request, reservation);
    const counts = this.recoveryCounts(request);
    const decided = decideProviderFailure({
      runId: request.runId,
      commandId: request.commandId,
      attemptId: request.attemptId,
      execution: request.execution,
      counts,
      policy,
    });
    const disposition: ProviderFailureDisposition = acceptLogicalResult
      ? decided
      : { ...decided, status: "discarded", recovery: "none" };
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
        disposition.status,
        disposition.failureClass,
        request.outcomeArtifact.artifactId,
        request.nativeUsageArtifact?.artifactId ?? null,
        evidence.providerRequestId ?? null,
        evidence.providerResponseId ?? null,
        completedAt,
        request.attemptId,
      );
    if (acceptLogicalResult) {
      this.dependencies.database
        .prepare("UPDATE logical_commands SET status = ? WHERE command_id = ?")
        .run(disposition.status, request.commandId);
    } else if (row.accepted_attempt_id === null) {
      this.dependencies.database
        .prepare(
          "UPDATE logical_commands SET status = 'cancelled' WHERE command_id = ?",
        )
        .run(request.commandId);
    }
    this.accounting.reconcile({
      runId: request.runId,
      commandId: request.commandId,
      attemptId: request.attemptId,
      reservation,
      actual: normalizedActual,
      actualKind:
        request.execution.kind === "unknown_outcome"
          ? "conservative_charge"
          : "actual",
      ...(request.nativeUsageArtifact === undefined
        ? {}
        : { nativeUsageArtifactId: request.nativeUsageArtifact.artifactId }),
      createdAt: completedAt,
    });
    return {
      ...disposition,
      stateVersion: row.state_version,
      auditFacts: this.appendAuditFacts(
        request,
        reservation,
        normalizedActual,
        disposition,
        row,
      ),
    };
  }

  private loadAttempt(request: CompleteProviderFailureEvidence): AttemptRow {
    const row = this.dependencies.database
      .prepare(
        `SELECT c.run_id, c.status AS command_status, c.accepted_attempt_id,
                c.triggering_state_version,
                a.status AS attempt_status, a.correlation_id,
                l.owner_process, l.attempt_id AS lease_attempt_id,
                r.state_version, r.configuration_artifact_id,
                configuration.content_hash AS configuration_content_hash,
                c.specification_json,
                a.result_artifact_id, a.native_usage_artifact_id,
                result.content_hash AS result_content_hash,
                usage_artifact.content_hash AS native_usage_content_hash,
                actual.calls AS actual_calls,
                actual.input_tokens AS actual_input_tokens,
                actual.output_tokens AS actual_output_tokens,
                actual.cost_usd_micros AS actual_cost_usd_micros,
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
           LEFT JOIN artifacts result ON result.artifact_id = a.result_artifact_id
           LEFT JOIN artifacts usage_artifact
             ON usage_artifact.artifact_id = a.native_usage_artifact_id
           LEFT JOIN usage_ledger actual
             ON actual.attempt_id = a.attempt_id
            AND actual.kind IN ('actual', 'conservative_charge')
          WHERE c.command_id = ? AND a.attempt_id = ?`,
      )
      .get(request.commandId, request.attemptId) as AttemptRow | undefined;
    if (row === undefined)
      throw new TypeError("Provider attempt is unavailable");
    return row;
  }

  private reconcileSettled(
    request: CompleteProviderFailureEvidence,
    policy: ExecutionPolicy,
    row: AttemptRow,
  ): ProviderFailureDisposition & {
    stateVersion: number;
    auditFacts: PersistableAuditFact[];
  } {
    this.assertAttemptBinding(request, policy, row);
    this.assertOutcomeArtifact(request);
    const outcomeBytes = this.dependencies.readStagedArtifactBytes(
      request.outcomeArtifact,
    );
    const expectedOutcome =
      request.execution.recording.rawResponseBytes ??
      Buffer.from(
        canonicalJson({
          kind: request.execution.kind,
          evidence: request.execution.evidence,
        }),
      );
    this.dependencies.persistArtifactMetadata(request.outcomeArtifact);
    let nativeUsageBytes: Uint8Array | undefined;
    if (request.nativeUsageArtifact !== undefined) {
      this.assertNativeUsageArtifact(request.nativeUsageArtifact, request);
      nativeUsageBytes = this.dependencies.readStagedArtifactBytes(
        request.nativeUsageArtifact,
      );
      this.dependencies.persistArtifactMetadata(request.nativeUsageArtifact);
    }
    const reservation = this.accounting.reservation(request.attemptId);
    const actual = this.normalizedUsage(request, reservation);
    const audit = this.dependencies.database
      .prepare(
        `SELECT payload_json FROM audit_entries
          WHERE run_id = ?
            AND fact_type IN ('command_attempt_completed', 'command_attempt_unknown')
            AND json_extract(payload_json, '$.attemptId') = ?
          ORDER BY sequence DESC LIMIT 1`,
      )
      .get(request.runId, request.attemptId) as
      { payload_json: string } | undefined;
    const payload =
      audit === undefined
        ? undefined
        : (JSON.parse(audit.payload_json) as Record<string, unknown>);
    const derived = decideProviderFailure({
      runId: request.runId,
      commandId: request.commandId,
      attemptId: request.attemptId,
      execution: request.execution,
      counts: this.recoveryCounts(request),
      policy,
    });
    const auditedBounds = payload?.recoveryBounds;
    const boundsValid =
      auditedBounds !== null &&
      typeof auditedBounds === "object" &&
      !Array.isArray(auditedBounds) &&
      Object.keys(auditedBounds).sort().join(",") ===
        ["repairLimit", "repairsUsed", "retriesUsed", "retryLimit"]
          .sort()
          .join(",") &&
      Object.values(auditedBounds).every(
        (value) => Number.isInteger(value) && Number(value) >= 0,
      );
    if (
      row.run_id !== request.runId ||
      row.correlation_id !== request.correlationId ||
      row.request_artifact_id !== request.requestArtifactId ||
      row.request_content_hash !== request.requestContentHash ||
      row.result_artifact_id !== request.outcomeArtifact.artifactId ||
      row.result_content_hash !== request.outcomeArtifact.contentHash ||
      row.native_usage_artifact_id !==
        (request.nativeUsageArtifact?.artifactId ?? null) ||
      row.native_usage_content_hash !==
        (request.nativeUsageArtifact?.contentHash ?? null) ||
      createHash("sha256").update(outcomeBytes).digest("hex") !==
        createHash("sha256").update(expectedOutcome).digest("hex") ||
      (request.execution.recording.rawResponseBytes !== undefined &&
        !providerResponseMatchesEvidence(
          request.execution.evidence,
          outcomeBytes,
        )) ||
      (nativeUsageBytes === undefined) !==
        (request.execution.recording.nativeUsageBytes === undefined) ||
      (nativeUsageBytes !== undefined &&
        createHash("sha256").update(nativeUsageBytes).digest("hex") !==
          createHash("sha256")
            .update(
              request.execution.recording.nativeUsageBytes ?? new Uint8Array(),
            )
            .digest("hex")) ||
      row.actual_calls !== actual.calls ||
      row.actual_input_tokens !== actual.inputTokens ||
      row.actual_output_tokens !== actual.outputTokens ||
      row.actual_cost_usd_micros !== actual.costUsdMicros ||
      payload?.failureKind !== derived.failureKind ||
      payload.failureClass !== derived.failureClass ||
      !boundsValid ||
      ![
        "transport_retry",
        "schema_repair",
        "pinned_model_unavailable",
        "terminal",
        "none",
      ].includes(String(payload.recovery))
    ) {
      throw new TypeError("Settled provider failure evidence conflicts");
    }
    return {
      ...derived,
      status: row.attempt_status as "failed" | "unknown" | "discarded",
      recovery:
        row.attempt_status === "discarded"
          ? "none"
          : (payload.recovery as ProviderFailureDisposition["recovery"]),
      recoveryBounds:
        auditedBounds as ProviderFailureDisposition["recoveryBounds"],
      stateVersion: row.state_version,
      auditFacts: [],
    };
  }

  private assertAttemptBinding(
    request: CompleteProviderFailureEvidence,
    policy: ExecutionPolicy,
    row: AttemptRow,
  ): PersistableCommand {
    const command = JSON.parse(row.specification_json) as PersistableCommand;
    const evidence = request.execution.evidence;
    if (
      policy.runId !== request.runId ||
      !(
        isAuthenticOpenAiExecution(request.execution) ||
        isAuthenticAnthropicExecution(request.execution) ||
        isAuthenticReplayExecution(request.execution)
      ) ||
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
      row.request_content_hash === null ||
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
    return command;
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

  private normalizedUsage(
    request: CompleteProviderFailureEvidence,
    reservation: {
      calls: number;
      inputTokens: number;
      outputTokens: number;
      costUsdMicros: number;
    },
  ): BudgetReservation {
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

  private appendAuditFacts(
    request: CompleteProviderFailureEvidence,
    reservation: BudgetReservation,
    actual: BudgetReservation,
    disposition: ProviderFailureDisposition,
    settlement: Pick<
      AttemptRow,
      "accepted_attempt_id" | "triggering_state_version" | "state_version"
    >,
  ): PersistableAuditFact[] {
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
    return [
      {
        type:
          disposition.status === "unknown"
            ? "command_attempt_unknown"
            : "command_attempt_completed",
        actor: { kind: "system", component: "executor", version: "0.0.0" },
        reason: "Persist the classified provider failure and recovery decision",
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
          recoveryBounds: disposition.recoveryBounds,
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
      ...(disposition.status === "discarded"
        ? [
            resultDiscardedFact({
              commandId: request.commandId,
              attemptId: request.attemptId,
              acceptedAttemptId: settlement.accepted_attempt_id,
              triggeringStateVersion: settlement.triggering_state_version,
              currentStateVersion: settlement.state_version,
              evidence,
            }),
          ]
        : []),
    ];
  }
}
