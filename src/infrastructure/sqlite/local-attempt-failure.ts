import type { DatabaseSync } from "node:sqlite";

import type { FailLocalAttemptRequest } from "../../application/execution-port.js";
import type { PersistableCommand } from "../../application/authority-port.js";
import { appendAuditEntries } from "./audit-journal.js";
import { AuthorityIntegrityError } from "./errors.js";

type Dependencies = {
  database: DatabaseSync;
  workspaceId: string;
  now: () => string;
  assertWritable: () => void;
  verifyAuditChain: () => void;
  quarantine: (reason: string) => void;
};

export class SqliteLocalAttemptFailure {
  constructor(private readonly dependencies: Dependencies) {}

  fail(request: FailLocalAttemptRequest): void {
    const { database } = this.dependencies;
    database.exec("BEGIN IMMEDIATE");
    try {
      this.dependencies.assertWritable();
      this.dependencies.verifyAuditChain();
      const row = database
        .prepare(
          `SELECT c.run_id, c.specification_json, a.status AS attempt_status,
                  a.correlation_id, l.owner_process,
                  l.attempt_id AS lease_attempt_id, r.state_version
             FROM logical_commands c
             JOIN command_attempts a ON a.command_id = c.command_id
             JOIN runs r ON r.run_id = c.run_id
             LEFT JOIN mutation_lease l ON l.singleton = 1
            WHERE c.command_id = ? AND a.attempt_id = ?`,
        )
        .get(request.commandId, request.attemptId) as
        | {
            run_id: string;
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
        row.attempt_status !== "started" ||
        row.correlation_id !== request.correlationId ||
        row.owner_process !== request.ownerProcess ||
        row.lease_attempt_id !== request.attemptId
      )
        throw new TypeError("Local attempt failure is not eligible");
      const command = JSON.parse(row.specification_json) as PersistableCommand;
      if (command.provider !== "local")
        throw new TypeError("Only local attempts use local failure settlement");
      const reservation = this.loadReservation(request.attemptId);
      const completedAt = this.dependencies.now();
      database
        .prepare(
          `UPDATE command_attempts SET status = 'failed', failure_class = ?,
             completed_at = ? WHERE attempt_id = ?`,
        )
        .run(
          request.failureKind === "integrity"
            ? "provider_error"
            : "invalid_output",
          completedAt,
          request.attemptId,
        );
      database
        .prepare(
          "UPDATE logical_commands SET status = 'failed' WHERE command_id = ?",
        )
        .run(request.commandId);
      const zero = {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsdMicros: 0,
      };
      for (const [kind, usage] of [
        ["release", reservation],
        ["actual", zero],
      ] as const) {
        database
          .prepare(
            `INSERT INTO usage_ledger
               (usage_entry_id, run_id, command_id, attempt_id, kind,
                calls, input_tokens, output_tokens, cost_usd_micros, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            completedAt,
          );
      }
      appendAuditEntries({
        database,
        workspaceId: this.dependencies.workspaceId,
        runId: request.runId,
        stateVersionBefore: row.state_version,
        stateVersionAfter: row.state_version,
        correlationId: request.correlationId,
        facts: [
          {
            type: "command_attempt_failed",
            actor: { kind: "system", component: "executor", version: "0.0.0" },
            reason: "Record deterministic local execution failure",
            evidence: [],
            payload: {
              commandId: request.commandId,
              attemptId: request.attemptId,
              failureClass:
                request.failureKind === "integrity"
                  ? "integrity"
                  : "invalid_output",
              message: request.failureMessage,
            },
          },
          {
            type: "budget_reconciled",
            actor: { kind: "system", component: "executor", version: "0.0.0" },
            reason: "Release local command reservation after failure",
            evidence: [],
            payload: {
              commandId: request.commandId,
              reservation,
              actual: zero,
            },
          },
        ],
        now: this.dependencies.now,
      });
      database
        .prepare(
          "DELETE FROM mutation_lease WHERE singleton = 1 AND attempt_id = ?",
        )
        .run(request.attemptId);
      database.exec("COMMIT");
      if (request.failureKind === "integrity")
        this.dependencies.quarantine(
          `Local command authoritative input failed integrity: ${request.failureMessage}`,
        );
    } catch (error) {
      database.exec("ROLLBACK");
      if (error instanceof AuthorityIntegrityError)
        this.dependencies.quarantine(error.message);
      throw error;
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
}
