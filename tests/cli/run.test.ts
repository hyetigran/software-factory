import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

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

  it("resolves and registers a pinned run configuration", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "factory-cli-"));
    const digest = async (path: string) =>
      createHash("sha256")
        .update(await readFile(resolve(path)))
        .digest("hex");
    const policy = {
      taxonomy_hash: await digest("config/review-taxonomy.v1.json"),
      component_registry_hash: await digest(
        "config/component-registry.v1.json",
      ),
      prompt_hashes: {
        planner: await digest("config/prompts/planner.v1.md"),
        reviewer: await digest("config/prompts/reviewer.v1.md"),
        remediation: await digest("config/prompts/remediation.v1.md"),
        schema_repair: await digest("config/prompts/schema-repair.v1.md"),
      },
      schema_hashes: {
        requirements: await digest(
          "schemas/requirements-ledger.v1.schema.json",
        ),
        artifact: await digest("schemas/artifact.v1.schema.json"),
        plan: await digest("schemas/plan.v1.schema.json"),
        review: await digest("schemas/review.v1.schema.json"),
        remediation: await digest("schemas/plan.v1.schema.json"),
      },
      rubric_hash: await digest("config/review-rubric.v1.md"),
      frontier_allowlist_hash: await digest("config/frontier-models.v1.json"),
    };
    const configurationPath = join(projectRoot, "run-config.json");
    await writeFile(
      configurationPath,
      JSON.stringify({
        schema_version: 1,
        planner: { provider: "openai", model_id: "gpt-5.6-terra" },
        reviewer: { provider: "anthropic", model_id: "claude-sonnet-5" },
        policy,
        budgets: {
          max_live_calls: 12,
          max_physical_attempts: 18,
          max_schema_repairs_per_command: 2,
          max_transport_retries_per_command: 2,
          max_remediation_cycles: 3,
          max_closure_cycles: 2,
          max_input_tokens: 1_000_000,
          max_output_tokens: 150_000,
          max_cost_usd: 25,
        },
        recording_mode: "record",
        provider_storage: "minimize",
        human_actor: { display_name: "Test User" },
      }),
    );
    const operations = createWorkspaceOperations();
    await runCliAsync(["init"], vi.fn(), operations, projectRoot);
    const lines: string[] = [];

    await expect(
      runCliAsync(
        ["configure", "run-config.json", "--json"],
        (line) => lines.push(line),
        operations,
        projectRoot,
      ),
    ).resolves.toBe(CliExit.success);

    const configured = JSON.parse(lines[0] ?? "null") as {
      ok: boolean;
      command: string;
      data: {
        configurationArtifactId: string;
        configurationContentHash: string;
        policyHash: string;
      };
    };
    expect(configured.ok).toBe(true);
    expect(configured.command).toBe("configure");
    expect(configured.data.configurationArtifactId).toMatch(/^configuration_/u);
    expect(configured.data.configurationContentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(configured.data.policyHash).toMatch(/^[a-f0-9]{64}$/u);
    await writeFile(
      join(projectRoot, "requirements.md"),
      "# Requirements\n\nBuild it safely.\n",
    );
    const startLines: string[] = [];

    await expect(
      runCliAsync(
        [
          "run",
          "start",
          "requirements.md",
          configured.data.configurationArtifactId,
          "--json",
        ],
        (line) => startLines.push(line),
        operations,
        projectRoot,
      ),
    ).resolves.toBe(CliExit.success);

    const started = JSON.parse(startLines[0] ?? "null") as {
      ok: boolean;
      command: string;
      data: { runId: string; state: { state: string } };
    };
    expect(started.ok).toBe(true);
    expect(started.command).toBe("run start");
    expect(started.data.runId).toMatch(/^run_/u);
    expect(started.data.state.state).toBe("draft");
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
      command: "run list",
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
      configure: vi.fn(),
      startRun: vi.fn(),
      listRuns,
      loadRun: vi.fn(),
      listAudit: vi.fn(),
      listArtifacts: vi.fn(),
      listFindings: vi.fn(),
      loadUsage: vi.fn(),
      listGates: vi.fn(),
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

  it("rejects tampered authority data without rewriting it", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "factory-cli-"));
    const operations = createWorkspaceOperations();
    await runCliAsync(["init"], vi.fn(), operations, projectRoot);
    const databasePath = join(projectRoot, ".factory", "state.db");
    const database = new DatabaseSync(databasePath);
    database
      .prepare("UPDATE workspaces SET audit_chain_head = ?")
      .run("f".repeat(64));
    database.close();
    const before = await readdir(projectRoot, { recursive: true });

    await expect(
      runCliAsync(["run", "list"], vi.fn(), operations, projectRoot),
    ).resolves.toBe(CliExit.integrity);

    expect(await readdir(projectRoot, { recursive: true })).toEqual(before);
  });

  it("preserves the invoked alias in JSON output", async () => {
    const lines: string[] = [];
    const operations: WorkspaceOperations = {
      initialize: vi.fn(),
      configure: vi.fn(),
      startRun: vi.fn(),
      listRuns: vi.fn(),
      loadRun: vi.fn().mockResolvedValue({ runId: "run_1" }),
      listAudit: vi.fn(),
      listArtifacts: vi.fn(),
      listFindings: vi.fn(),
      loadUsage: vi.fn(),
      listGates: vi.fn(),
    };

    await runCliAsync(
      ["inspect", "state", "run_1", "--json"],
      (line) => lines.push(line),
      operations,
      "/project",
    );

    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      ok: true,
      command: "inspect state",
    });
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

  it.each([
    ["artifacts", "listArtifacts", { artifacts: [] }],
    ["findings", "listFindings", { findings: [] }],
    [
      "usage",
      "loadUsage",
      {
        entries: [],
        actualAndConservative: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
        outstandingReserved: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
        effectiveConsumption: {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicros: 0,
        },
      },
    ],
    ["gates", "listGates", { gates: [] }],
  ] as const)("supports JSON inspection of %s", async (kind, method, value) => {
    const operations = {
      initialize: vi.fn(),
      configure: vi.fn(),
      startRun: vi.fn(),
      listRuns: vi.fn(),
      loadRun: vi.fn(),
      listAudit: vi.fn(),
      listArtifacts: vi.fn(),
      listFindings: vi.fn(),
      loadUsage: vi.fn(),
      listGates: vi.fn(),
    } satisfies WorkspaceOperations;
    operations[method].mockResolvedValue(
      kind === "usage" ? value : Object.values(value)[0],
    );
    const lines: string[] = [];
    const args = [
      "inspect",
      kind,
      ...(kind === "artifacts" ? [] : ["run_1"]),
      "--json",
    ];

    await expect(
      runCliAsync(args, (line) => lines.push(line), operations, "/project"),
    ).resolves.toBe(CliExit.success);

    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      ok: true,
      command: `inspect ${kind}`,
      data: value,
    });
  });
});
