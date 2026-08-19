import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

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
    const configurationPath = join(projectRoot, "run-config.json");
    await writeFile(
      configurationPath,
      JSON.stringify({
        schema_version: 1,
        budgets: {
          max_cost_usd: 10,
        },
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

    const sourceArtifactId = (
      started.data.state as unknown as { sourceArtifactId: string }
    ).sourceArtifactId;
    await writeFile(
      join(projectRoot, "ledger.json"),
      JSON.stringify({
        schema_version: 1,
        ledger_id: "ledger_v1",
        version: 1,
        source_artifact_id: sourceArtifactId,
        requirements: [
          {
            requirement_id: "requirement_1",
            display_id: "REQ-1",
            statement: "Build it safely.",
            status: "active",
            source_ranges: [{ start_byte: 0, end_byte: 10 }],
            lineage_roots: ["requirement_1"],
            change_kind: "original",
          },
        ],
        source_exclusions: [
          {
            exclusion_id: "exclusion_1",
            source_range: {
              start_byte: 10,
              end_byte: Buffer.byteLength(
                "# Requirements\n\nBuild it safely.\n",
              ),
            },
            reason: "Non-requirement heading",
          },
        ],
      }),
    );
    const submitLines: string[] = [];
    await expect(
      runCliAsync(
        ["submit", "ledger", started.data.runId, "ledger.json", "--json"],
        (line) => submitLines.push(line),
        operations,
        projectRoot,
      ),
    ).resolves.toBe(CliExit.success);
    const submitted = JSON.parse(submitLines[0] ?? "null") as {
      ok: boolean;
      command: string;
      data: {
        ledgerArtifactId: string;
        state: object;
      };
    };
    expect(submitted).toMatchObject({
      ok: true,
      command: "submit ledger",
      data: {
        state: {
          state: "draft",
          stateVersion: 2,
          currentLedger: {
            versionId: "ledger_v1",
            validationStatus: "pending",
          },
        },
      },
    });
    expect(submitted.data.ledgerArtifactId).toMatch(/^ledger_/u);

    const rejectedLines: string[] = [];
    await expect(
      runCliAsync(
        ["execute", "next", started.data.runId, "--json"],
        (line) => rejectedLines.push(line),
        operations,
        projectRoot,
      ),
    ).resolves.toBe(CliExit.conflict);
    expect(JSON.parse(rejectedLines[0] ?? "null")).toMatchObject({
      ok: false,
      command: "execute next",
      error: { code: "CONFLICT" },
    });

    const exclusionLines: string[] = [];
    await expect(
      runCliAsync(
        [
          "approve",
          "exclusion",
          started.data.runId,
          "exclusion_1",
          "10",
          String(Buffer.byteLength("# Requirements\n\nBuild it safely.\n")),
          "Non-requirement heading",
          "--json",
        ],
        (line) => exclusionLines.push(line),
        operations,
        projectRoot,
      ),
    ).resolves.toBe(CliExit.success);
    expect(JSON.parse(exclusionLines[0] ?? "null")).toMatchObject({
      ok: true,
      command: "approve exclusion",
      data: {
        state: {
          stateVersion: 3,
          sourceExclusions: [{ exclusionId: "exclusion_1" }],
        },
      },
    });

    const executeLines: string[] = [];
    await expect(
      runCliAsync(
        ["execute", "next", started.data.runId, "--json"],
        (line) => executeLines.push(line),
        operations,
        projectRoot,
      ),
    ).resolves.toBe(CliExit.success);
    const executed = JSON.parse(executeLines[0] ?? "null") as {
      data: {
        execution: {
          commandId: string;
          commandType: string;
          resultArtifactId: string;
        };
      };
    };
    expect(executed).toMatchObject({
      ok: true,
      command: "execute next",
      data: { execution: { commandType: "validate_ledger" } },
    });
    const database = new DatabaseSync(
      join(projectRoot, ".factory", "state.db"),
    );
    try {
      expect(
        database
          .prepare("SELECT status FROM logical_commands WHERE command_id = ?")
          .get(executed.data.execution.commandId),
      ).toEqual({ status: "succeeded" });
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM mutation_lease").get(),
      ).toEqual({ count: 0 });
      expect(
        database
          .prepare("SELECT kind FROM artifacts WHERE artifact_id = ?")
          .get(executed.data.execution.resultArtifactId),
      ).toEqual({ kind: "coverage_report" });
    } finally {
      database.close();
    }
    await expect(
      operations.loadRun(projectRoot, started.data.runId),
    ).resolves.toMatchObject({
      stateVersion: 4,
      currentLedger: {
        validationStatus: "validated",
        validation: {
          coverageReportArtifactId: executed.data.execution.resultArtifactId,
          coverageComplete: true,
        },
      },
    });
    await expect(
      operations.listAudit(projectRoot, started.data.runId),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ factType: "ledger_validation_completed" }),
        expect.objectContaining({ factType: "command_attempt_completed" }),
      ]),
    );
    const renderLines: string[] = [];
    await expect(
      runCliAsync(
        ["execute", "next", started.data.runId, "--json"],
        (line) => renderLines.push(line),
        operations,
        projectRoot,
      ),
    ).resolves.toBe(CliExit.success);
    expect(JSON.parse(renderLines[0] ?? "null")).toMatchObject({
      ok: true,
      command: "execute next",
      data: { execution: { commandType: "render_ledger" } },
    });
    await expect(
      operations.loadRun(projectRoot, started.data.runId),
    ).resolves.toMatchObject({
      stateVersion: 5,
      currentLedger: {
        validationStatus: "validated",
        renderedProjection: { renderedStateVersion: 5 },
      },
    });
    const approvalLines: string[] = [];
    await expect(
      runCliAsync(
        ["approve", "ledger", started.data.runId, "--json"],
        (line) => approvalLines.push(line),
        operations,
        projectRoot,
      ),
    ).resolves.toBe(CliExit.success);
    expect(JSON.parse(approvalLines[0] ?? "null")).toMatchObject({
      ok: true,
      command: "approve ledger",
      data: {
        state: {
          state: "requirements_approved",
          stateVersion: 6,
          currentLedger: { validationStatus: "approved" },
        },
        coverageReportArtifactId: executed.data.execution.resultArtifactId,
      },
    });
    const previewLines: string[] = [];
    await expect(
      runCliAsync(
        ["plan", "preview", started.data.runId, "--json"],
        (line) => previewLines.push(line),
        operations,
        projectRoot,
      ),
    ).resolves.toBe(CliExit.success);
    const previewEnvelope = JSON.parse(previewLines[0] ?? "null") as {
      data: Awaited<ReturnType<WorkspaceOperations["previewPlanningBoundary"]>>;
    };
    expect(previewEnvelope).toMatchObject({
      ok: true,
      command: "plan preview",
      data: { providerBoundaryDisclosure: { mode: "live" } },
    });
    const boundaryPreview = previewEnvelope.data;
    const leaseDatabase = new DatabaseSync(
      join(projectRoot, ".factory", "state.db"),
    );
    try {
      const leaseCommand = leaseDatabase
        .prepare(
          "SELECT command_id FROM logical_commands WHERE run_id = ? AND command_type = 'render_ledger_approval'",
        )
        .get(started.data.runId) as { command_id: string };
      leaseDatabase
        .prepare(
          `INSERT INTO mutation_lease
             (singleton, command_id, attempt_id, owner_process, acquired_at, heartbeat_at)
           VALUES (1, ?, NULL, 'concurrent-test', ?, ?)`,
        )
        .run(
          leaseCommand.command_id,
          new Date().toISOString(),
          new Date().toISOString(),
        );
      const blockedLines: string[] = [];
      await expect(
        runCliAsync(
          [
            "plan",
            "request",
            started.data.runId,
            "--accept-policy",
            "--accept-budgets",
            "--ack-provider-boundary",
            boundaryPreview.providerBoundaryDisclosureHash,
            "--json",
          ],
          (line) => blockedLines.push(line),
          operations,
          projectRoot,
        ),
      ).resolves.toBe(CliExit.conflict);
      expect(JSON.parse(blockedLines[0] ?? "null")).toMatchObject({
        ok: false,
        error: { code: "CONFLICT" },
      });
      leaseDatabase
        .prepare("DELETE FROM mutation_lease WHERE singleton = 1")
        .run();
    } finally {
      leaseDatabase.close();
    }
    const planningLines: string[] = [];
    await expect(
      runCliAsync(
        [
          "plan",
          "request",
          started.data.runId,
          "--accept-policy",
          "--accept-budgets",
          "--ack-provider-boundary",
          boundaryPreview.providerBoundaryDisclosureHash,
          "--json",
        ],
        (line) => planningLines.push(line),
        operations,
        projectRoot,
      ),
    ).resolves.toBe(CliExit.success);
    const planning = JSON.parse(planningLines[0] ?? "null") as {
      data: { commandId: string };
    };
    expect(planning).toMatchObject({
      ok: true,
      command: "plan request",
      data: {
        state: { state: "planning", stateVersion: 7 },
        providerBoundaryDisclosure: {
          mode: "live",
          provider: "openai",
          modelId: "gpt-5.6-terra",
          externalTransmission: true,
          transmittedArtifactClasses: [
            "system_prompt",
            "requirements_ledger",
            "output_schema",
          ],
          providerStorage: "minimize",
          retentionApplicability: "provider_terms_apply",
        },
        providerBoundaryDisclosureHash:
          boundaryPreview.providerBoundaryDisclosureHash,
      },
    });
    const planningDatabase = new DatabaseSync(
      join(projectRoot, ".factory", "state.db"),
    );
    try {
      expect(
        planningDatabase
          .prepare(
            "SELECT command_type, status FROM logical_commands WHERE command_id = ?",
          )
          .get(planning.data.commandId),
      ).toEqual({ command_type: "generate_plan", status: "planned" });
    } finally {
      planningDatabase.close();
    }

    const conflictLines: string[] = [];
    const conflictExit = await runCliAsync(
      [
        "run",
        "start",
        "requirements.md",
        configured.data.configurationArtifactId,
        "--json",
      ],
      (line) => conflictLines.push(line),
      operations,
      projectRoot,
    );
    expect(conflictExit).toBe(CliExit.conflict);
    expect(JSON.parse(conflictLines[0] ?? "null")).toMatchObject({
      ok: false,
      command: "run start",
      error: { code: "CONFLICT" },
    });
  });

  it("merges defaults, project configuration, and explicit overrides", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "factory-cli-"));
    await writeFile(
      join(projectRoot, "project.json"),
      JSON.stringify({
        schema_version: 1,
        budgets: { max_cost_usd: 10 },
        request_settings: { planner: { timeout_ms: 90000 } },
      }),
    );
    await writeFile(
      join(projectRoot, "override.json"),
      JSON.stringify({
        schema_version: 1,
        budgets: { max_cost_usd: 7 },
        recording_mode: "strict_replay",
      }),
    );
    const operations = createWorkspaceOperations();
    await operations.initialize(projectRoot);

    const configured = await operations.configure(
      projectRoot,
      "project.json",
      "override.json",
    );
    const objectBytes = await import("node:fs/promises").then(({ readFile }) =>
      readFile(
        join(
          projectRoot,
          ".factory",
          "objects",
          configured.configurationContentHash,
        ),
      ),
    );
    const resolved = JSON.parse(objectBytes.toString("utf8")) as {
      recordingMode: string;
      budgetAcceptanceRequired: boolean;
      hardCeilings: { costUsdMicros: number };
      providerRequestSettings: {
        planner: { timeoutMs: number };
        reviewer: { timeoutMs: number };
      };
    };
    expect(resolved).toMatchObject({
      recordingMode: "strict_replay",
      budgetAcceptanceRequired: true,
      hardCeilings: { costUsdMicros: 7_000_000 },
      providerRequestSettings: {
        planner: { timeoutMs: 90000 },
        reviewer: { timeoutMs: 120000 },
      },
    });
  });

  it("rejects inexact cost policy without registering partial metadata", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "factory-cli-"));
    const operations = createWorkspaceOperations();
    await operations.initialize(projectRoot);
    await writeFile(
      join(projectRoot, "invalid.json"),
      JSON.stringify({
        schema_version: 1,
        budgets: { max_cost_usd: 0.0000014 },
      }),
    );
    const databasePath = join(projectRoot, ".factory", "state.db");
    const count = () => {
      const database = new DatabaseSync(databasePath);
      try {
        return (
          database.prepare("SELECT COUNT(*) AS count FROM artifacts").get() as {
            count: number;
          }
        ).count;
      } finally {
        database.close();
      }
    };
    const before = count();
    const lines: string[] = [];

    await expect(
      runCliAsync(
        ["configure", "invalid.json", "--json"],
        (line) => lines.push(line),
        operations,
        projectRoot,
      ),
    ).resolves.toBe(CliExit.usage);

    expect(count()).toBe(before);
    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      ok: false,
      command: "configure",
      error: { code: "INVALID_INPUT" },
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
      submitLedger: vi.fn(),
      approveSourceExclusion: vi.fn(),
      executeNext: vi.fn(),
      approveLedger: vi.fn(),
      requestPlanning: vi.fn(),
      previewPlanningBoundary: vi.fn(),
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
      submitLedger: vi.fn(),
      approveSourceExclusion: vi.fn(),
      executeNext: vi.fn(),
      approveLedger: vi.fn(),
      requestPlanning: vi.fn(),
      previewPlanningBoundary: vi.fn(),
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
      submitLedger: vi.fn(),
      approveSourceExclusion: vi.fn(),
      executeNext: vi.fn(),
      approveLedger: vi.fn(),
      requestPlanning: vi.fn(),
      previewPlanningBoundary: vi.fn(),
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
