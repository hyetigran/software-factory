import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CliExit, runCli, runCliAsync } from "../../src/cli/run.js";

describe("factory executable", () => {
  it("reports its version", () => {
    const write = vi.fn();

    const exitCode = runCli(["--version"], write);

    expect(exitCode).toBe(0);
    expect(write).toHaveBeenCalledWith("0.0.0");
  });

  it("initializes a private workspace with JSON output", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "factory-cli-"));
    const lines: string[] = [];

    const exitCode = await runCliAsync(
      ["init", "--json"],
      (line) => lines.push(line),
      { cwd: () => projectRoot },
    );

    expect(exitCode).toBe(CliExit.success);
    expect(JSON.parse(lines[0] ?? "null")).toEqual({
      ok: true,
      command: "init",
      data: {
        projectRoot,
        workspaceRoot: join(projectRoot, ".factory"),
      },
    });
  });

  it("supports stable JSON run-list and not-found responses", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "factory-cli-"));
    const listLines: string[] = [];
    await runCliAsync(["init"], vi.fn(), { cwd: () => projectRoot });

    await expect(
      runCliAsync(["run", "list", "--json"], (line) => listLines.push(line), {
        cwd: () => projectRoot,
      }),
    ).resolves.toBe(CliExit.success);
    expect(JSON.parse(listLines[0] ?? "null")).toMatchObject({
      ok: true,
      command: "run list",
      data: { runs: [] },
    });

    const statusLines: string[] = [];
    await expect(
      runCliAsync(
        ["run", "status", "run_missing", "--json"],
        (line) => statusLines.push(line),
        { cwd: () => projectRoot },
      ),
    ).resolves.toBe(CliExit.notFound);
    expect(JSON.parse(statusLines[0] ?? "null")).toMatchObject({
      ok: false,
      error: { code: "RUN_NOT_FOUND", runId: "run_missing" },
    });
  });

  it("returns a stable usage exit for unknown commands", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "factory-cli-"));
    await expect(
      runCliAsync(["unknown"], vi.fn(), { cwd: () => projectRoot }),
    ).resolves.toBe(CliExit.usage);
  });
});
