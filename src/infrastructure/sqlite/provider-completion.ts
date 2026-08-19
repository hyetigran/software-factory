import type { DatabaseSync } from "node:sqlite";

import type {
  PersistableAuditFact,
  PersistableCommand,
} from "../../application/authority-port.js";
import { commandIsValid } from "../../application/command-validation.js";
import type {
  CompleteAttemptRequest,
  CompletedCommandAttempt,
} from "../../application/execution-port.js";
import type { StagedArtifactRegistration } from "../../application/artifact-port.js";
import { AuthorityIntegrityError } from "./errors.js";

type Dependencies = {
  database: DatabaseSync;
  now: () => string;
  verifyStagedArtifact(artifact: StagedArtifactRegistration): void;
  persistArtifactMetadata(artifact: StagedArtifactRegistration): void;
};

type Completion = CompletedCommandAttempt & {
  auditFacts: PersistableAuditFact[];
};

export class SqliteProviderCompletion {
  constructor(private readonly dependencies: Dependencies) {}

  complete(request: CompleteAttemptRequest): Completion {
    const row = this.dependencies.database
      .prepare(
        `SELECT c.run_id, c.status AS command_status, c.accepted_attempt_id,
                c.triggering_state_version, c.specification_json,
                a.status AS attempt_status, a.correlation_id,
                l.owner_process, l.attempt_id AS lease_attempt_id,
                r.state_version
           FROM logical_commands c
           JOIN command_attempts a ON a.command_id = c.command_id
           JOIN runs r ON r.run_id = c.run_id
           LEFT JOIN mutation_lease l ON l.singleton = 1
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
    this.assertArtifact(request.resultArtifact, request, "provider_response");
    this.assertArtifact(request.nativeUsageArtifact, request, "native_usage");
    this.dependencies.verifyStagedArtifact(request.resultArtifact);
    this.dependencies.verifyStagedArtifact(request.nativeUsageArtifact);
    this.dependencies.persistArtifactMetadata(request.resultArtifact);
    this.dependencies.persistArtifactMetadata(request.nativeUsageArtifact);
    const reservation = this.loadReservation(request.attemptId);
    if (
      request.actualUsage.calls !== 1 ||
      request.actualUsage.calls > reservation.calls ||
      request.actualUsage.inputTokens > reservation.inputTokens ||
      request.actualUsage.outputTokens > reservation.outputTokens ||
      request.actualUsage.costUsdMicros > reservation.costUsdMicros
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
        request.resultArtifact.artifactId,
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
    this.dependencies.database
      .prepare("DELETE FROM mutation_lease WHERE singleton = 1")
      .run();
    const evidence = [
      { kind: "artifact", artifactId: request.resultArtifact.artifactId },
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
            resultArtifactId: request.resultArtifact.artifactId,
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
          },
        },
      ],
    };
  }

  private assertArtifact(
    artifact: StagedArtifactRegistration,
    request: CompleteAttemptRequest,
    kind: "provider_response" | "native_usage",
  ): void {
    if (
      artifact.kind !== kind ||
      artifact.createdBy !== request.ownerProcess ||
      artifact.provenance.method !== "provider_generated" ||
      artifact.provenance.commandId !== request.commandId ||
      artifact.provenance.attemptId !== request.attemptId
    ) {
      throw new TypeError("Provider completion artifact provenance is invalid");
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
    request: CompleteAttemptRequest,
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
