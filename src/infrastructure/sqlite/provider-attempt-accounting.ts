import type { DatabaseSync } from "node:sqlite";

import type { BudgetReservation } from "../../domain/index.js";
import { AuthorityIntegrityError } from "./errors.js";

export class ProviderAttemptAccounting {
  constructor(private readonly database: DatabaseSync) {}

  reservation(attemptId: string): BudgetReservation {
    const row = this.database
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

  reconcile(input: {
    runId: string;
    commandId: string;
    attemptId: string;
    reservation: BudgetReservation;
    actual: BudgetReservation;
    actualKind: "actual" | "conservative_charge";
    nativeUsageArtifactId?: string;
    createdAt: string;
  }): void {
    const insert = this.database.prepare(
      `INSERT INTO usage_ledger
         (usage_entry_id, run_id, command_id, attempt_id, kind, calls,
          input_tokens, output_tokens, cost_usd_micros,
          native_usage_artifact_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [kind, usage] of [
      ["release", input.reservation],
      [input.actualKind, input.actual],
    ] as const) {
      insert.run(
        `${input.attemptId}:${kind}`,
        input.runId,
        input.commandId,
        input.attemptId,
        kind,
        usage.calls,
        usage.inputTokens,
        usage.outputTokens,
        usage.costUsdMicros,
        input.nativeUsageArtifactId ?? null,
        input.createdAt,
      );
    }
  }
}
