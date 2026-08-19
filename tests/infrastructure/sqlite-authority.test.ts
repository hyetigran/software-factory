import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  transition,
  type NonterminalRunState,
  type RunStarted,
} from "../../src/domain/index.js";
import {
  AuthorityIntegrityError,
  SqliteAuthority,
  StaleStateError,
  type PersistableTransition,
} from "../../src/infrastructure/sqlite/authority.js";

type TestState = Record<string, unknown> & {
  runId: string;
  stateVersion: number;
  state: "draft" | "halted";
  sourceArtifactId: string;
  configurationArtifactId: string;
  policyHash: string;
  policyLocked: boolean;
};

const directories: string[] = [];

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "factory-sqlite-test-"));
  directories.push(directory);
  return join(directory, ".factory", "factory.sqlite3");
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

function transitionResult(
  runId: string,
  stateVersion: number,
  commandId = `command_${stateVersion}`,
  commandKey = String(stateVersion).repeat(64),
): PersistableTransition<TestState> {
  return {
    nextState: {
      runId,
      stateVersion,
      state: "draft",
      sourceArtifactId: "artifact_source",
      configurationArtifactId: "artifact_configuration",
      policyHash: "a".repeat(64),
      policyLocked: false,
    },
    commands: [
      {
        commandId,
        commandKey,
        commandType: "render_plan",
        schemaVersion: 1,
        runId,
        triggeringStateVersion: stateVersion,
        purposeId: `purpose_${stateVersion}`,
      },
    ],
    auditFacts: [
      {
        type: "command_planned",
        actor: { kind: "system", component: "test", version: "1" },
        reason: "exercise atomic authority",
        evidence: [],
        payload: { commandId, commandKey },
      },
    ],
  };
}

function registerRunArtifacts(authority: SqliteAuthority): void {
  for (const [artifactId, kind, contentHash] of [
    ["artifact_source", "raw_requirements", "b".repeat(64)],
    ["artifact_configuration", "other", "c".repeat(64)],
  ] as const) {
    authority.registerArtifact({
      schemaVersion: 1,
      artifactId,
      kind,
      contentHash,
      byteLength: 1,
      mediaType: "application/octet-stream",
      createdBy: "system:test",
      provenance: { method: "human_submitted" },
      objectPath: `/objects/${contentHash}`,
    });
  }
}

describe("SQLite authority", () => {
  it("accepts the public pure-domain transition without an adapter DTO", async () => {
    const path = await databasePath();
    const authority = SqliteAuthority.open(path);
    registerRunArtifacts(authority);
    const input: RunStarted = {
      type: "RunStarted",
      runId: "run_domain",
      expectedStateVersion: 0,
      sourceArtifactId: "artifact_source",
      sourceContentHash: "b".repeat(64),
      sourceProvenancePath: "/project/requirements.md",
      sourceObjectVerified: true,
      configurationArtifactId: "artifact_configuration",
      configurationContentHash: "c".repeat(64),
      auditChainVerified: true,
      databaseIntegrityVerified: true,
      schemaCompatible: true,
      mutationLeaseAvailable: true,
      renderCommandId: "command_render_source",
      actor: {
        kind: "human",
        displayName: "Tigran",
        osAccount: "tig",
      },
    };
    const policy = {
      policyHash: "a".repeat(64),
      plannerAssignment: { provider: "openai" as const, modelId: "gpt-pinned" },
      reviewerAssignment: {
        provider: "anthropic" as const,
        modelId: "claude-pinned",
      },
    };

    authority.commitTransition<NonterminalRunState>({
      runId: input.runId,
      expectedStateVersion: input.expectedStateVersion,
      transition: (previousState) => transition(previousState, input, policy),
    });

    expect(authority.loadRun(input.runId)).toEqual(
      expect.objectContaining({ state: "draft", stateVersion: 1 }),
    );
    expect(
      authority.listAuditEntries().map(({ factType }) => factType),
    ).toEqual(["run_started", "source_registered", "command_planned"]);
    authority.close();
  });

  it("atomically persists state, commands, and a verifiable audit chain", async () => {
    const path = await databasePath();
    const authority = SqliteAuthority.open(path, {
      now: () => "2026-08-19T00:00:00.000Z",
    });
    registerRunArtifacts(authority);

    authority.commitTransition<TestState>({
      runId: "run_one",
      expectedStateVersion: 0,
      causationId: "input_one",
      correlationId: "correlation_one",
      transition: () => transitionResult("run_one", 1),
    });

    expect(authority.loadRun<TestState>("run_one")?.stateVersion).toBe(1);
    expect(authority.listCommands("run_one")).toHaveLength(1);
    expect(authority.listAuditEntries()).toEqual([
      expect.objectContaining({
        sequence: 1,
        stateVersionBefore: 0,
        stateVersionAfter: 1,
        previousEntryHash: "0".repeat(64),
        causationId: "input_one",
        correlationId: "correlation_one",
      }),
    ]);
    expect(() => authority.verifyIntegrity()).not.toThrow();
    authority.close();
  });

  it("rolls back state and audit when command insertion fails", async () => {
    const path = await databasePath();
    const authority = SqliteAuthority.open(path);
    registerRunArtifacts(authority);
    authority.commitTransition<TestState>({
      runId: "run_one",
      expectedStateVersion: 0,
      transition: () => transitionResult("run_one", 1),
    });

    expect(() =>
      authority.commitTransition<TestState>({
        runId: "run_one",
        expectedStateVersion: 1,
        transition: () =>
          transitionResult("run_one", 2, "command_2", "1".repeat(64)),
      }),
    ).toThrow();

    expect(authority.loadRun<TestState>("run_one")?.stateVersion).toBe(1);
    expect(authority.listCommands("run_one")).toHaveLength(1);
    expect(authority.listAuditEntries()).toHaveLength(1);
    authority.close();
  });

  it("rejects stale writes and a second active run", async () => {
    const path = await databasePath();
    const authority = SqliteAuthority.open(path);
    registerRunArtifacts(authority);
    authority.commitTransition<TestState>({
      runId: "run_one",
      expectedStateVersion: 0,
      transition: () => transitionResult("run_one", 1),
    });

    expect(() =>
      authority.commitTransition<TestState>({
        runId: "run_one",
        expectedStateVersion: 0,
        transition: () => transitionResult("run_one", 2),
      }),
    ).toThrow(StaleStateError);
    expect(() =>
      authority.commitTransition<TestState>({
        runId: "run_two",
        expectedStateVersion: 0,
        transition: () => transitionResult("run_two", 1, "command_other"),
      }),
    ).toThrow();
    expect(authority.loadRun<TestState>("run_two")).toBeNull();
    authority.close();
  });

  it("detects audit entry tampering", async () => {
    const path = await databasePath();
    const authority = SqliteAuthority.open(path);
    registerRunArtifacts(authority);
    authority.commitTransition<TestState>({
      runId: "run_one",
      expectedStateVersion: 0,
      transition: () => transitionResult("run_one", 1),
    });
    authority.close();

    const raw = new DatabaseSync(path);
    raw
      .prepare("UPDATE audit_entries SET payload_json = ? WHERE sequence = 1")
      .run("{}");
    raw.close();

    const reopened = SqliteAuthority.open(path);
    expect(() => reopened.verifyIntegrity()).toThrow(AuthorityIntegrityError);
    reopened.close();
  });
});
