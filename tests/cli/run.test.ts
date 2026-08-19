import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CliExit, runCli, runCliAsync } from "../../src/cli/run.js";
import { createWorkspaceOperations } from "../../src/infrastructure/platform/workspace-operations.js";
import type { WorkspaceOperations } from "../../src/application/workspace-operations.js";

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
      createWorkspaceOperations(),
      projectRoot,
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
    await runCliAsync(
      ["init"],
      vi.fn(),
      createWorkspaceOperations(),
      projectRoot,
    );

    await expect(
      runCliAsync(
        ["run", "list", "--json"],
        (line) => listLines.push(line),
        createWorkspaceOperations(),
        projectRoot,
      ),
    ).resolves.toBe(CliExit.success);
    expect(JSON.parse(listLines[0] ?? "null")).toMatchObject({
      ok: true,
      command: "run_list",
      data: { runs: [] },
    });

    const statusLines: string[] = [];
    await expect(
      runCliAsync(
        ["run", "status", "run_missing", "--json"],
        (line) => statusLines.push(line),
        createWorkspaceOperations(),
        projectRoot,
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
      runCliAsync(
        ["unknown"],
        vi.fn(),
        createWorkspaceOperations(),
        projectRoot,
      ),
    ).resolves.toBe(CliExit.usage);
  });

  it.each([
    ["missing", ["run", "list", "--project"]],
    ["option value", ["run", "list", "--project", "--json"]],
    ["duplicate", ["run", "list", "--project", ".", "--project", "."]],
    ["unknown", ["run", "list", "--wat"]],
  ])("rejects %s options before filesystem access", async (_name, args) => {
    const listRuns = vi.fn();
    const operations: WorkspaceOperations = {
      initialize: vi.fn(),
      listRuns,
      loadRun: vi.fn(),
      listAudit: vi.fn(),
    };

    await expect(
      runCliAsync(args, vi.fn(), operations, "/must-not-be-opened"),
    ).resolves.toBe(CliExit.usage);
    expect(listRuns).not.toHaveBeenCalled();
  });

  it("does not create workspace files during inspection", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "factory-cli-"));
    const operations = createWorkspaceOperations();
    await runCliAsync(["init"], vi.fn(), operations, projectRoot);
    const before = await readdir(projectRoot, { recursive: true });

    await expect(
      runCliAsync(["run", "list"], vi.fn(), operations, projectRoot),
    ).resolves.toBe(CliExit.success);

    expect(await readdir(projectRoot, { recursive: true })).toEqual(before);
  });

  it("returns not found for audit inspection of a missing run", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "factory-cli-"));
    const operations = createWorkspaceOperations();
    await runCliAsync(["init"], vi.fn(), operations, projectRoot);

    await expect(
      runCliAsync(
        ["inspect", "audit", "run_missing"],
        vi.fn(),
        operations,
        projectRoot,
      ),
    ).resolves.toBe(CliExit.notFound);
  });
});
