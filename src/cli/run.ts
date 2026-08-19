import { join, resolve } from "node:path";
import { access } from "node:fs/promises";

import { ContentAddressedArtifactStore } from "../infrastructure/artifacts/object-store.js";
import { AuthorityIntegrityError } from "../infrastructure/sqlite/errors.js";
import { SqliteAuthority } from "../infrastructure/sqlite/authority.js";

export const CliExit = {
  success: 0,
  usage: 2,
  notFound: 3,
  integrity: 4,
  conflict: 5,
  internal: 10,
} as const;

type Writer = (line: string) => void;

type CliDependencies = {
  cwd: () => string;
};

const defaultDependencies: CliDependencies = { cwd: () => process.cwd() };

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
    const usage =
      "Usage: factory init | run list | run status <run-id> | inspect state <run-id> | inspect audit [run-id] [--json]";
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

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function output(
  write: Writer,
  json: boolean,
  command: string,
  data: unknown,
  human: string,
): void {
  write(json ? JSON.stringify({ ok: true, command, data }) : human);
}

function outputError(
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

export async function runCliAsync(
  args: string[],
  write: Writer,
  dependencies: CliDependencies = defaultDependencies,
): Promise<number> {
  if (
    args.includes("--version") ||
    args.length === 0 ||
    args.includes("--help")
  ) {
    return runCli(args, write);
  }
  const json = args.includes("--json");
  const projectRoot = resolve(option(args, "--project") ?? dependencies.cwd());
  const positional = args.filter(
    (arg, index) =>
      arg !== "--json" &&
      arg !== "--project" &&
      args[index - 1] !== "--project",
  );
  const command = positional.join(" ");
  const recognized =
    (positional[0] === "init" && positional.length === 1) ||
    (positional[0] === "run" &&
      positional[1] === "list" &&
      positional.length === 2) ||
    ((positional[0] === "run" && positional[1] === "status") ||
    (positional[0] === "inspect" && positional[1] === "state")
      ? positional.length === 3
      : false) ||
    (positional[0] === "inspect" &&
      positional[1] === "audit" &&
      positional.length <= 3);
  if (!recognized) {
    outputError(
      write,
      json,
      command,
      "USAGE_ERROR",
      `Unknown command: ${command}`,
    );
    return CliExit.usage;
  }
  let authority: SqliteAuthority | undefined;
  try {
    if (positional[0] !== "init") {
      try {
        await access(join(projectRoot, ".factory", "state.db"));
      } catch {
        outputError(
          write,
          json,
          command,
          "WORKSPACE_NOT_FOUND",
          `Software Factory workspace not found: ${projectRoot}`,
          { projectRoot },
        );
        return CliExit.notFound;
      }
    }
    const store = await ContentAddressedArtifactStore.open(projectRoot);
    authority = SqliteAuthority.open(join(store.workspace.root, "state.db"), {
      artifactStore: store,
    });
    if (positional[0] === "init" && positional.length === 1) {
      output(
        write,
        json,
        "init",
        { projectRoot, workspaceRoot: store.workspace.root },
        `Initialized Software Factory workspace at ${store.workspace.root}`,
      );
      return CliExit.success;
    }
    if (
      positional[0] === "run" &&
      positional[1] === "list" &&
      positional.length === 2
    ) {
      const runs = authority.listRuns();
      output(
        write,
        json,
        "run list",
        { runs },
        runs.length === 0
          ? "No runs"
          : runs
              .map((run) => `${run.runId}\t${run.state}\tv${run.stateVersion}`)
              .join("\n"),
      );
      return CliExit.success;
    }
    if (
      ((positional[0] === "run" && positional[1] === "status") ||
        (positional[0] === "inspect" && positional[1] === "state")) &&
      positional.length === 3
    ) {
      const runId = positional[2] ?? "";
      const state = authority.loadRun<object>(runId);
      if (state === null) {
        outputError(
          write,
          json,
          command,
          "RUN_NOT_FOUND",
          `Run not found: ${runId}`,
          { runId },
        );
        return CliExit.notFound;
      }
      output(write, json, command, { state }, JSON.stringify(state, null, 2));
      return CliExit.success;
    }
    if (
      positional[0] === "inspect" &&
      positional[1] === "audit" &&
      positional.length <= 3
    ) {
      const runId = positional[2];
      const entries = authority
        .listAuditEntries()
        .filter((entry) => runId === undefined || entry.runId === runId);
      output(
        write,
        json,
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
    throw new Error(`CLI command was not handled: ${command}`);
  } catch (error) {
    const integrity = error instanceof AuthorityIntegrityError;
    const message = error instanceof Error ? error.message : String(error);
    write(
      json
        ? JSON.stringify({
            ok: false,
            command,
            error: {
              code: integrity ? "INTEGRITY_ERROR" : "INTERNAL_ERROR",
              message,
            },
          })
        : `Error: ${message}`,
    );
    return integrity ? CliExit.integrity : CliExit.internal;
  } finally {
    authority?.close();
  }
}
