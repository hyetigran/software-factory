import { resolve } from "node:path";

import {
  WorkspaceOperationError,
  type WorkspaceOperations,
} from "../application/workspace-operations.js";

export const CliExit = {
  success: 0,
  usage: 2,
  notFound: 3,
  integrity: 4,
  conflict: 5,
  internal: 10,
} as const;

type Writer = (line: string) => void;
type ParsedCommand =
  | { kind: "init"; publicName: "init"; json: boolean; projectRoot: string }
  | {
      kind: "plan_request";
      publicName: "plan request";
      json: boolean;
      projectRoot: string;
      runId: string;
    }
  | {
      kind: "approve_ledger";
      publicName: "approve ledger";
      json: boolean;
      projectRoot: string;
      runId: string;
    }
  | {
      kind: "execute_next";
      publicName: "execute next";
      json: boolean;
      projectRoot: string;
      runId: string;
    }
  | {
      kind: "approve_exclusion";
      publicName: "approve exclusion";
      json: boolean;
      projectRoot: string;
      runId: string;
      exclusionId: string;
      startOffset: number;
      endOffset: number;
      reason: string;
    }
  | {
      kind: "submit_ledger";
      publicName: "submit ledger";
      json: boolean;
      projectRoot: string;
      runId: string;
      ledgerPath: string;
    }
  | {
      kind: "configure";
      publicName: "configure";
      json: boolean;
      projectRoot: string;
      configurationPath?: string;
      overrideConfigurationPath?: string;
    }
  | {
      kind: "run_list";
      publicName: "run list";
      json: boolean;
      projectRoot: string;
    }
  | {
      kind: "run_start";
      publicName: "run start";
      json: boolean;
      projectRoot: string;
      sourcePath: string;
      configurationArtifactId: string;
    }
  | {
      kind: "run_state";
      publicName: "run status" | "inspect state";
      json: boolean;
      projectRoot: string;
      runId: string;
    }
  | {
      kind: "audit";
      publicName: "inspect audit";
      json: boolean;
      projectRoot: string;
      runId?: string;
    }
  | {
      kind: "artifacts";
      publicName: "inspect artifacts";
      json: boolean;
      projectRoot: string;
      runId?: string;
    }
  | {
      kind: "findings" | "usage" | "gates";
      publicName: "inspect findings" | "inspect usage" | "inspect gates";
      json: boolean;
      projectRoot: string;
      runId: string;
    };

const usage =
  "Usage: factory init | configure [project-config.json] [overrides.json] | run start <source.md> <configuration-artifact-id> | run list | run status <run-id> | submit ledger <run-id> <ledger.json> | approve ledger <run-id> | approve exclusion <run-id> <id> <start> <end> <reason> | plan request <run-id> --accept-policy --accept-budgets --ack-provider-boundary | execute next <run-id> | inspect <state|findings|usage|gates> <run-id> | inspect <audit|artifacts> [run-id] [--json] [--project <path>]";

export function runCli(args: string[], write: Writer): number {
  if (args.includes("--version")) {
    write(
      args.includes("--json")
        ? JSON.stringify({
            ok: true,
            command: "version",
            data: { version: "0.0.0" },
          })
        : "0.0.0",
    );
    return CliExit.success;
  }
  if (args.length === 0 || args.includes("--help")) {
    write(
      args.includes("--json")
        ? JSON.stringify({ ok: true, command: "help", data: { usage } })
        : usage,
    );
    return CliExit.success;
  }
  write("This command requires the asynchronous CLI entry point");
  return CliExit.usage;
}

function parseArgs(args: string[], cwd: string): ParsedCommand {
  let json = false;
  let project: string | undefined;
  let acceptPolicy = false;
  let acceptBudgets = false;
  let acknowledgeProvider = false;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? "";
    if (token === "--json") {
      if (json) throw new TypeError("Duplicate option: --json");
      json = true;
    } else if (token === "--accept-policy") {
      if (acceptPolicy)
        throw new TypeError("Duplicate option: --accept-policy");
      acceptPolicy = true;
    } else if (token === "--accept-budgets") {
      if (acceptBudgets)
        throw new TypeError("Duplicate option: --accept-budgets");
      acceptBudgets = true;
    } else if (token === "--ack-provider-boundary") {
      if (acknowledgeProvider)
        throw new TypeError("Duplicate option: --ack-provider-boundary");
      acknowledgeProvider = true;
    } else if (token === "--project") {
      const value = args[index + 1];
      if (
        project !== undefined ||
        value === undefined ||
        value.startsWith("--")
      ) {
        throw new TypeError("--project requires exactly one path");
      }
      project = value;
      index += 1;
    } else if (token.startsWith("--")) {
      throw new TypeError(`Unknown option: ${token}`);
    } else {
      positional.push(token);
    }
  }
  const projectRoot = resolve(project ?? cwd);
  const planningRequest =
    positional.length === 3 &&
    positional[0] === "plan" &&
    positional[1] === "request";
  if (
    (acceptPolicy || acceptBudgets || acknowledgeProvider) &&
    !planningRequest
  )
    throw new TypeError("Planning acceptance options require plan request");
  if (planningRequest) {
    if (!acceptPolicy || !acceptBudgets || !acknowledgeProvider)
      throw new TypeError(
        "plan request requires --accept-policy, --accept-budgets, and --ack-provider-boundary",
      );
    return {
      kind: "plan_request",
      publicName: "plan request",
      json,
      projectRoot,
      runId: positional[2] ?? "",
    };
  }
  if (positional.length === 1 && positional[0] === "init") {
    return { kind: "init", publicName: "init", json, projectRoot };
  }
  if (
    positional.length === 3 &&
    positional[0] === "approve" &&
    positional[1] === "ledger"
  ) {
    return {
      kind: "approve_ledger",
      publicName: "approve ledger",
      json,
      projectRoot,
      runId: positional[2] ?? "",
    };
  }
  if (
    positional.length === 3 &&
    positional[0] === "execute" &&
    positional[1] === "next"
  ) {
    return {
      kind: "execute_next",
      publicName: "execute next",
      json,
      projectRoot,
      runId: positional[2] ?? "",
    };
  }
  if (
    positional.length === 7 &&
    positional[0] === "approve" &&
    positional[1] === "exclusion"
  ) {
    const startOffset = Number(positional[4]);
    const endOffset = Number(positional[5]);
    if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset))
      throw new TypeError("Exclusion offsets must be integers");
    return {
      kind: "approve_exclusion",
      publicName: "approve exclusion",
      json,
      projectRoot,
      runId: positional[2] ?? "",
      exclusionId: positional[3] ?? "",
      startOffset,
      endOffset,
      reason: positional[6] ?? "",
    };
  }
  if (
    positional.length === 4 &&
    positional[0] === "submit" &&
    positional[1] === "ledger"
  ) {
    return {
      kind: "submit_ledger",
      publicName: "submit ledger",
      json,
      projectRoot,
      runId: positional[2] ?? "",
      ledgerPath: positional[3] ?? "",
    };
  }
  if (
    positional[0] === "configure" &&
    positional.length >= 1 &&
    positional.length <= 3
  ) {
    return {
      kind: "configure",
      publicName: "configure",
      json,
      projectRoot,
      ...(positional[1] === undefined
        ? {}
        : { configurationPath: positional[1] }),
      ...(positional[2] === undefined
        ? {}
        : { overrideConfigurationPath: positional[2] }),
    };
  }
  if (
    positional.length === 4 &&
    positional[0] === "run" &&
    positional[1] === "start"
  ) {
    return {
      kind: "run_start",
      publicName: "run start",
      json,
      projectRoot,
      sourcePath: positional[2] ?? "",
      configurationArtifactId: positional[3] ?? "",
    };
  }
  if (
    positional.length === 2 &&
    positional[0] === "run" &&
    positional[1] === "list"
  ) {
    return { kind: "run_list", publicName: "run list", json, projectRoot };
  }
  if (
    positional[0] === "inspect" &&
    positional[1] === "artifacts" &&
    positional.length >= 2 &&
    positional.length <= 3
  ) {
    return {
      kind: "artifacts",
      publicName: "inspect artifacts",
      json,
      projectRoot,
      ...(positional[2] === undefined ? {} : { runId: positional[2] }),
    };
  }
  if (
    positional[0] === "inspect" &&
    ["findings", "usage", "gates"].includes(positional[1] ?? "") &&
    positional.length === 3
  ) {
    const kind = positional[1] as "findings" | "usage" | "gates";
    return {
      kind,
      publicName: `inspect ${kind}`,
      json,
      projectRoot,
      runId: positional[2] ?? "",
    };
  }
  if (
    positional.length === 3 &&
    ((positional[0] === "run" && positional[1] === "status") ||
      (positional[0] === "inspect" && positional[1] === "state"))
  ) {
    return {
      kind: "run_state",
      publicName: positional[0] === "run" ? "run status" : "inspect state",
      json,
      projectRoot,
      runId: positional[2] ?? "",
    };
  }
  if (
    positional[0] === "inspect" &&
    positional[1] === "audit" &&
    positional.length >= 2 &&
    positional.length <= 3
  ) {
    return {
      kind: "audit",
      publicName: "inspect audit",
      json,
      projectRoot,
      ...(positional[2] === undefined ? {} : { runId: positional[2] }),
    };
  }
  throw new TypeError(`Unknown command: ${positional.join(" ")}`);
}

function writeSuccess(
  write: Writer,
  command: ParsedCommand,
  data: unknown,
  human: string,
): void {
  write(
    command.json
      ? JSON.stringify({ ok: true, command: command.publicName, data })
      : human,
  );
}

function writeError(
  write: Writer,
  json: boolean,
  command: string,
  code: string,
  message: string,
  details: object = {},
): void {
  write(
    json
      ? JSON.stringify({
          ok: false,
          command,
          error: { code, message, ...details },
        })
      : message,
  );
}

function exitFor(error: WorkspaceOperationError): number {
  switch (error.code) {
    case "WORKSPACE_NOT_FOUND":
    case "RUN_NOT_FOUND":
    case "INPUT_NOT_FOUND":
      return CliExit.notFound;
    case "INVALID_INPUT":
      return CliExit.usage;
    case "SCHEMA_INCOMPATIBLE":
    case "INTEGRITY_ERROR":
      return CliExit.integrity;
    case "CONFLICT":
      return CliExit.conflict;
  }
}

export async function runCliAsync(
  args: string[],
  write: Writer,
  operations: WorkspaceOperations,
  cwd = process.cwd(),
): Promise<number> {
  if (
    args.includes("--version") ||
    args.length === 0 ||
    args.includes("--help")
  ) {
    return runCli(args, write);
  }
  let command: ParsedCommand;
  try {
    command = parseArgs(args, cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeError(
      write,
      args.includes("--json"),
      args.filter((argument) => !argument.startsWith("--")).join(" "),
      "USAGE_ERROR",
      message,
    );
    return CliExit.usage;
  }
  try {
    switch (command.kind) {
      case "init": {
        const initialized = await operations.initialize(command.projectRoot);
        writeSuccess(
          write,
          command,
          { projectRoot: command.projectRoot, ...initialized },
          `Initialized Software Factory workspace at ${initialized.workspaceRoot}`,
        );
        return CliExit.success;
      }
      case "configure": {
        const configured = await operations.configure(
          command.projectRoot,
          command.configurationPath,
          command.overrideConfigurationPath,
        );
        writeSuccess(
          write,
          command,
          configured,
          `Configuration artifact: ${configured.configurationArtifactId}\nPolicy hash: ${configured.policyHash}`,
        );
        return CliExit.success;
      }
      case "run_list": {
        const runs = await operations.listRuns(command.projectRoot);
        writeSuccess(
          write,
          command,
          { runs },
          runs.length === 0
            ? "No runs"
            : runs
                .map(
                  (run) => `${run.runId}\t${run.state}\tv${run.stateVersion}`,
                )
                .join("\n"),
        );
        return CliExit.success;
      }
      case "submit_ledger": {
        const submitted = await operations.submitLedger(
          command.projectRoot,
          command.runId,
          command.ledgerPath,
        );
        writeSuccess(
          write,
          command,
          submitted,
          `Submitted ledger ${submitted.ledgerArtifactId}`,
        );
        return CliExit.success;
      }
      case "approve_exclusion": {
        const approved = await operations.approveSourceExclusion(
          command.projectRoot,
          command.runId,
          command.exclusionId,
          command.startOffset,
          command.endOffset,
          command.reason,
        );
        writeSuccess(
          write,
          command,
          approved,
          `Approved source exclusion ${command.exclusionId}`,
        );
        return CliExit.success;
      }
      case "approve_ledger": {
        const approved = await operations.approveLedger(
          command.projectRoot,
          command.runId,
        );
        writeSuccess(
          write,
          command,
          approved,
          `Approved ledger with coverage ${approved.coverageReportArtifactId}`,
        );
        return CliExit.success;
      }
      case "plan_request": {
        const planned = await operations.requestPlanning(
          command.projectRoot,
          command.runId,
          { policy: true, budgets: true, providerBoundary: true },
        );
        writeSuccess(
          write,
          command,
          planned,
          `Requested planning with command ${planned.commandId}`,
        );
        return CliExit.success;
      }
      case "execute_next": {
        const executed = await operations.executeNext(
          command.projectRoot,
          command.runId,
        );
        writeSuccess(
          write,
          command,
          { execution: executed },
          executed === null
            ? "No eligible local command"
            : `Completed ${executed.commandType} (${executed.commandId})`,
        );
        return CliExit.success;
      }
      case "run_start": {
        const started = await operations.startRun(
          command.projectRoot,
          command.sourcePath,
          command.configurationArtifactId,
        );
        writeSuccess(write, command, started, `Started run ${started.runId}`);
        return CliExit.success;
      }
      case "run_state": {
        const state = await operations.loadRun(
          command.projectRoot,
          command.runId,
        );
        if (state === null) {
          throw new WorkspaceOperationError(
            "RUN_NOT_FOUND",
            `Run not found: ${command.runId}`,
            { runId: command.runId },
          );
        }
        writeSuccess(write, command, { state }, JSON.stringify(state, null, 2));
        return CliExit.success;
      }
      case "audit": {
        const entries = await operations.listAudit(
          command.projectRoot,
          command.runId,
        );
        writeSuccess(
          write,
          command,
          { entries },
          entries.length === 0
            ? "No audit entries"
            : entries
                .map(
                  (entry) =>
                    `${entry.sequence}\t${entry.runId}\t${entry.factType}\tv${entry.stateVersionAfter}`,
                )
                .join("\n"),
        );
        return CliExit.success;
      }
      case "artifacts": {
        const artifacts = await operations.listArtifacts(
          command.projectRoot,
          command.runId,
        );
        writeSuccess(
          write,
          command,
          { artifacts },
          artifacts.length === 0
            ? "No artifacts"
            : artifacts
                .map(
                  (artifact) =>
                    `${artifact.artifactId}\t${artifact.kind}\t${artifact.contentHash}\t${artifact.byteLength}`,
                )
                .join("\n"),
        );
        return CliExit.success;
      }
      case "findings": {
        const findings = await operations.listFindings(
          command.projectRoot,
          command.runId,
        );
        writeSuccess(
          write,
          command,
          { findings },
          findings.length === 0
            ? "No findings"
            : findings
                .map(
                  (finding) =>
                    `${finding.findingId}\t${finding.status}\t${finding.severity}`,
                )
                .join("\n"),
        );
        return CliExit.success;
      }
      case "usage": {
        const usage = await operations.loadUsage(
          command.projectRoot,
          command.runId,
        );
        writeSuccess(
          write,
          command,
          usage,
          `Actual/conservative calls: ${usage.actualAndConservative.calls}\nOutstanding reserved calls: ${usage.outstandingReserved.calls}\nEffective consumed calls: ${usage.effectiveConsumption.calls}\nEffective input tokens: ${usage.effectiveConsumption.inputTokens}\nEffective output tokens: ${usage.effectiveConsumption.outputTokens}\nEffective cost (USD micros): ${usage.effectiveConsumption.costUsdMicros}`,
        );
        return CliExit.success;
      }
      case "gates": {
        const gates = await operations.listGates(
          command.projectRoot,
          command.runId,
        );
        writeSuccess(
          write,
          command,
          { gates },
          gates.length === 0
            ? "No gates"
            : gates
                .map(
                  (gate) => `${gate.gateId}\t${gate.gateType}\t${gate.status}`,
                )
                .join("\n"),
        );
        return CliExit.success;
      }
    }
  } catch (error) {
    if (error instanceof WorkspaceOperationError) {
      writeError(
        write,
        command.json,
        command.publicName,
        error.code,
        error.message,
        error.details,
      );
      return exitFor(error);
    }
    const message = error instanceof Error ? error.message : String(error);
    writeError(
      write,
      command.json,
      command.publicName,
      "INTERNAL_ERROR",
      message,
    );
    return CliExit.internal;
  }
}
