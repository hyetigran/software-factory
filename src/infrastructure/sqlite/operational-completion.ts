import type { DatabaseSync } from "node:sqlite";

import type {
  PersistableCommand,
  PersistableTransition,
} from "../../application/authority-port.js";
import { commandIsValid } from "../../application/command-validation.js";
import type {
  CompleteAttemptRequest,
  CompletedCommandAttempt,
} from "../../application/execution-port.js";
import type { StagedArtifactRegistration } from "../../application/artifact-port.js";
import { appendAuditEntries } from "./audit-journal.js";
import { AuthorityIntegrityError } from "./errors.js";
import { localCommandSpecification } from "../../application/local-command-specification.js";
import { LocalCompletionEvidence } from "./local-completion-evidence.js";

type OperationalCompletionDependencies = {
  database: DatabaseSync;
  workspaceId: string;
  now: () => string;
  assertWritable: () => void;
  verifyAuditChain: () => void;
  verifyStagedArtifact: (artifact: StagedArtifactRegistration) => void;
  readStagedArtifactBytes: (artifact: StagedArtifactRegistration) => Buffer;
  readRegisteredObject: (contentHash: string) => Buffer;
  persistArtifactMetadata: (artifact: StagedArtifactRegistration) => void;
  quarantine: (reason: string) => void;
  persistTransition: (
    runId: string,
    expectedStateVersion: number,
    result: PersistableTransition<object>,
  ) => void;
};

type CompletionRow = {
  run_id: string;
  accepted_attempt_id: string | null;
  triggering_state_version: number;
  specification_json: string;
  attempt_status: string;
  correlation_id: string;
  result_artifact_id: string | null;
  native_usage_artifact_id: string | null;
  result_content_hash: string | null;
  usage_content_hash: string | null;
  actual_calls: number | null;
  actual_input_tokens: number | null;
  actual_output_tokens: number | null;
  actual_cost_usd_micros: number | null;
  owner_process: string | null;
  lease_attempt_id: string | null;
  state_version: number;
};

function parseCommand(value: string): PersistableCommand {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AuthorityIntegrityError(
      "Logical command JSON must be an object during completion",
    );
  }
  return parsed as PersistableCommand;
}

export class SqliteOperationalCompletion {
  private readonly evidence: LocalCompletionEvidence;

  constructor(
    private readonly dependencies: OperationalCompletionDependencies,
  ) {
    this.evidence = new LocalCompletionEvidence(
      dependencies.database,
      dependencies.readStagedArtifactBytes,
      dependencies.readRegisteredObject,
    );
  }

  complete(
    request: CompleteAttemptRequest,
    domain?: {
      expectedStateVersion: number;
      result: PersistableTransition<object>;
    },
  ): CompletedCommandAttempt {
    const { database } = this.dependencies;
    database.exec("BEGIN IMMEDIATE");
    try {
      this.dependencies.assertWritable();
      this.dependencies.verifyAuditChain();
      this.dependencies.verifyStagedArtifact(request.resultArtifact);
      this.dependencies.verifyStagedArtifact(request.nativeUsageArtifact);
      if (Object.keys(request.providerEvidence).length !== 0) {
        throw new TypeError(
          "Operational local completion cannot carry provider evidence",
        );
      }
      this.dependencies.persistArtifactMetadata(request.resultArtifact);
      this.dependencies.persistArtifactMetadata(request.nativeUsageArtifact);

      const row = database
        .prepare(
          `SELECT c.run_id, c.accepted_attempt_id,
                  c.triggering_state_version, c.specification_json,
                  a.status AS attempt_status, a.correlation_id,
                  a.result_artifact_id, a.native_usage_artifact_id,
                  ra.content_hash AS result_content_hash,
                  ua.content_hash AS usage_content_hash,
                  actual.calls AS actual_calls,
                  actual.input_tokens AS actual_input_tokens,
                  actual.output_tokens AS actual_output_tokens,
                  actual.cost_usd_micros AS actual_cost_usd_micros,
                  l.owner_process, l.attempt_id AS lease_attempt_id,
                  r.state_version
             FROM logical_commands c
             JOIN command_attempts a ON a.command_id = c.command_id
             JOIN runs r ON r.run_id = c.run_id
             LEFT JOIN artifacts ra ON ra.artifact_id = a.result_artifact_id
             LEFT JOIN artifacts ua ON ua.artifact_id = a.native_usage_artifact_id
             LEFT JOIN usage_ledger actual
               ON actual.attempt_id = a.attempt_id AND actual.kind = 'actual'
             LEFT JOIN mutation_lease l ON l.singleton = 1
            WHERE c.command_id = ? AND a.attempt_id = ?`,
        )
        .get(request.commandId, request.attemptId) as CompletionRow | undefined;
      if (row === undefined || row.run_id !== request.runId) {
        throw new TypeError("Command attempt completion is not eligible");
      }
      if (["completed", "discarded"].includes(row.attempt_status)) {
        this.assertIdempotent(row, request);
        database.exec("COMMIT");
        return this.outcome(
          request,
          row.accepted_attempt_id === request.attemptId,
        );
      }
      if (
        row.attempt_status !== "started" ||
        row.correlation_id !== request.correlationId ||
        row.lease_attempt_id !== request.attemptId ||
        row.owner_process !== request.ownerProcess
      ) {
        throw new TypeError("Command attempt completion is not eligible");
      }

      const command = parseCommand(row.specification_json);
      if (!commandIsValid(command)) {
        throw new AuthorityIntegrityError(
          "Logical command envelope is invalid during completion",
        );
      }
      const specification = localCommandSpecification(command);
      if (specification === null || command.provider !== "local") {
        throw new TypeError(
          "State-changing command outcomes require an atomic domain transition",
        );
      }
      if (specification.stateChanging !== (domain !== undefined)) {
        throw new TypeError(
          "State-changing local completion requires its exact domain outcome",
        );
      }
      this.evidence.assertProvenance(request, command);
      this.evidence.assertUsage(request);
      if (domain === undefined)
        this.evidence.assertOperationalResult(request, command);
      const reservation = this.loadReservation(request.attemptId);
      const actual = request.actualUsage;
      if (
        Object.values(actual).some((value) => value !== 0) ||
        actual.calls > reservation.calls ||
        actual.inputTokens > reservation.inputTokens ||
        actual.outputTokens > reservation.outputTokens ||
        actual.costUsdMicros > reservation.costUsdMicros
      ) {
        throw new TypeError("Actual usage exceeds the reserved maximum");
      }

      const completedAt = this.dependencies.now();
      const explicitlyExpected =
        database
          .prepare(
            `SELECT 1 FROM audit_entries
              WHERE run_id = ? AND fact_type = 'command_attempt_started'
                AND json_extract(payload_json, '$.attemptId') = ?
                AND json_extract(payload_json, '$.attemptKind') = 'human_rerun'
                AND json_extract(payload_json, '$.humanAuthorizationId') IS NOT NULL`,
          )
          .get(request.runId, request.attemptId) !== undefined;
      const accepted =
        row.accepted_attempt_id === null &&
        (row.state_version === row.triggering_state_version ||
          explicitlyExpected);
      if (domain !== undefined) {
        if (command.commandType === "validate_ledger")
          this.evidence.assertValidationDomain(
            request,
            command,
            domain,
            accepted,
          );
        else if (command.commandType === "render_ledger")
          this.evidence.assertLedgerRenderDomain(request, domain, accepted);
        else this.evidence.assertPlanRenderDomain(request, domain, accepted);
      }
      database
        .prepare(
          `UPDATE command_attempts
              SET status = ?, result_artifact_id = ?,
                  native_usage_artifact_id = ?, completed_at = ?
            WHERE attempt_id = ?`,
        )
        .run(
          accepted ? "completed" : "discarded",
          request.resultArtifact.artifactId,
          request.nativeUsageArtifact.artifactId,
          completedAt,
          request.attemptId,
        );
      if (accepted) {
        database
          .prepare(
            `UPDATE logical_commands
                SET status = 'succeeded', accepted_attempt_id = ?
              WHERE command_id = ?`,
          )
          .run(request.attemptId, request.commandId);
        if (domain !== undefined) {
          this.dependencies.persistTransition(
            request.runId,
            domain.expectedStateVersion,
            domain.result,
          );
        }
      } else if (row.accepted_attempt_id === null) {
        database
          .prepare(
            "UPDATE logical_commands SET status = 'cancelled' WHERE command_id = ?",
          )
          .run(request.commandId);
      }
      this.reconcileUsage(request, reservation, completedAt);
      this.appendCompletionAudit(
        request,
        {
          ...row,
          state_version:
            domain === undefined || !accepted
              ? row.state_version
              : Number(
                  (domain.result.nextState as Record<string, unknown>)
                    .stateVersion,
                ),
        },
        reservation,
        accepted,
      );
      database.prepare("DELETE FROM mutation_lease WHERE singleton = 1").run();
      database.exec("COMMIT");
      return this.outcome(request, accepted);
    } catch (error) {
      database.exec("ROLLBACK");
      if (error instanceof AuthorityIntegrityError) {
        this.dependencies.quarantine(error.message);
      }
      throw error;
    }
  }

  private assertIdempotent(
    row: CompletionRow,
    request: CompleteAttemptRequest,
  ): void {
    if (
      row.correlation_id !== request.correlationId ||
      row.result_artifact_id !== request.resultArtifact.artifactId ||
      row.native_usage_artifact_id !== request.nativeUsageArtifact.artifactId ||
      row.result_content_hash !== request.resultArtifact.contentHash ||
      row.usage_content_hash !== request.nativeUsageArtifact.contentHash ||
      row.actual_calls !== request.actualUsage.calls ||
      row.actual_input_tokens !== request.actualUsage.inputTokens ||
      row.actual_output_tokens !== request.actualUsage.outputTokens ||
      row.actual_cost_usd_micros !== request.actualUsage.costUsdMicros
    ) {
      throw new TypeError("Completed attempt evidence conflicts");
    }
  }

  private loadReservation(attemptId: string) {
    const row = this.dependencies.database
      .prepare(
        `SELECT calls, input_tokens, output_tokens, cost_usd_micros
           FROM usage_ledger
          WHERE attempt_id = ? AND kind = 'reservation'`,
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
    request: CompleteAttemptRequest,
    reservation: CompleteAttemptRequest["actualUsage"],
    completedAt: string,
  ): void {
    for (const [kind, usage] of [
      ["release", reservation],
      ["actual", request.actualUsage],
    ] as const) {
      this.dependencies.database
        .prepare(
          `INSERT INTO usage_ledger
             (usage_entry_id, run_id, command_id, attempt_id, kind,
              calls, input_tokens, output_tokens, cost_usd_micros,
              native_usage_artifact_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `${request.attemptId}:${kind}`,
          request.runId,
          request.commandId,
          request.attemptId,
          kind,
          usage.calls,
          usage.inputTokens,
          usage.outputTokens,
          usage.costUsdMicros,
          request.nativeUsageArtifact.artifactId,
          completedAt,
        );
    }
  }

  private appendCompletionAudit(
    request: CompleteAttemptRequest,
    row: CompletionRow,
    reservation: CompleteAttemptRequest["actualUsage"],
    accepted: boolean,
  ): void {
    const artifactEvidence = [
      {
        kind: "artifact",
        artifactId: request.resultArtifact.artifactId,
        contentHash: request.resultArtifact.contentHash,
      },
      {
        kind: "artifact",
        artifactId: request.nativeUsageArtifact.artifactId,
        contentHash: request.nativeUsageArtifact.contentHash,
      },
    ];
    appendAuditEntries({
      database: this.dependencies.database,
      workspaceId: this.dependencies.workspaceId,
      runId: request.runId,
      stateVersionBefore: row.state_version,
      stateVersionAfter: row.state_version,
      correlationId: request.correlationId,
      facts: [
        {
          type: "command_attempt_completed",
          actor: { kind: "system", component: "executor", version: "0.0.0" },
          reason: "Persist the verified physical command result",
          evidence: artifactEvidence,
          payload: {
            commandId: request.commandId,
            attemptId: request.attemptId,
            resultArtifactId: request.resultArtifact.artifactId,
            nativeUsageArtifactId: request.nativeUsageArtifact.artifactId,
            acceptedAsLogicalResult: accepted,
            providerEvidence: request.providerEvidence,
          },
        },
        {
          type: "budget_reconciled",
          actor: { kind: "system", component: "executor", version: "0.0.0" },
          reason: "Replace the conservative reservation with actual usage",
          evidence: [artifactEvidence[1]],
          payload: {
            commandId: request.commandId,
            reservation,
            actual: request.actualUsage,
          },
        },
        ...(accepted
          ? []
          : [
              {
                type: "result_discarded",
                actor: {
                  kind: "system",
                  component: "executor",
                  version: "0.0.0",
                },
                reason:
                  "The command result is stale or a logical result was already accepted",
                evidence: [artifactEvidence[0]],
                payload: {
                  commandId: request.commandId,
                  attemptId: request.attemptId,
                  acceptedAttemptId: row.accepted_attempt_id,
                  triggeringStateVersion: row.triggering_state_version,
                  currentStateVersion: row.state_version,
                },
              },
            ]),
      ],
      now: this.dependencies.now,
    });
  }

  private outcome(
    request: CompleteAttemptRequest,
    accepted: boolean,
  ): CompletedCommandAttempt {
    return {
      status: "completed",
      runId: request.runId,
      commandId: request.commandId,
      attemptId: request.attemptId,
      acceptedAsLogicalResult: accepted,
    };
  }
}
