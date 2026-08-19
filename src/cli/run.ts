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
      kind: "run_list";
      publicName: "run list";
      json: boolean;
      projectRoot: string;
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
    };

const usage =
  "Usage: factory init | run list | run status <run-id> | inspect state <run-id> | inspect audit [run-id] [--json] [--project <path>]";

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
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? "";
    if (token === "--json") {
      if (json) throw new TypeError("Duplicate option: --json");
      json = true;
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
  if (positional.length === 1 && positional[0] === "init") {
    return { kind: "init", publicName: "init", json, projectRoot };
  }
  if (
    positional.length === 2 &&
    positional[0] === "run" &&
    positional[1] === "list"
  ) {
    return { kind: "run_list", publicName: "run list", json, projectRoot };
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
      return CliExit.notFound;
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
    }
  } catch (error) {
    if (error instanceof WorkspaceOperationError) {
      writeError(
        write,
        command.json,
        command.kind,
        error.code,
        error.message,
        error.details,
      );
      return exitFor(error);
    }
    const message = error instanceof Error ? error.message : String(error);
    writeError(write, command.json, command.kind, "INTERNAL_ERROR", message);
    return CliExit.internal;
  }
}
