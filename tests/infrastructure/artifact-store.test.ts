import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { stageResolvedConfiguration } from "../../src/application/stage-configuration.js";
import {
  ArtifactIntegrityError,
  ContentAddressedArtifactStore,
  initializeWorkspace,
} from "../../src/infrastructure/artifacts/object-store.js";

const workspaces: string[] = [];

async function temporaryProject(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "factory-artifacts-test-"));
  workspaces.push(path);
  return path;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    workspaces
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("workspace and content-addressed artifact store", () => {
  it("initializes restrictive local state and preserves Git ignore content", async () => {
    const project = await temporaryProject();
    await writeFile(join(project, ".gitignore"), "dist/\n", "utf8");

    const workspace = await initializeWorkspace(project);
    await initializeWorkspace(project);

    expect(await readFile(join(project, ".gitignore"), "utf8")).toBe(
      "dist/\n.factory/\n",
    );
    for (const path of [
      workspace.root,
      workspace.objects,
      workspace.cassettes,
      workspace.locks,
    ]) {
      expect((await lstat(path)).mode & 0o777).toBe(0o700);
    }
  });

  it("atomically stores exact bytes by SHA-256 and deduplicates them", async () => {
    const project = await temporaryProject();
    const store = await ContentAddressedArtifactStore.open(project);
    const bytes = Buffer.from("immutable requirements\n", "utf8");

    const first = await store.stage(bytes);
    const second = await store.stage(bytes);

    expect(first).toEqual(second);
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.byteLength).toBe(bytes.length);
    expect(await store.readVerified(first.contentHash)).toEqual(bytes);
    expect((await lstat(first.objectPath)).mode & 0o777).toBe(0o400);
  });

  it("returns complete artifact metadata for the authoritative commit", async () => {
    const project = await temporaryProject();
    const store = await ContentAddressedArtifactStore.open(project);

    const descriptor = await store.stageArtifact(Buffer.from("{}", "utf8"), {
      artifactId: "artifact_ledger_01JTEST",
      kind: "requirements_ledger",
      mediaType: "application/json",
      schemaId: "requirements-ledger.v1",
      createdBy: "human:tig",
      provenance: {
        method: "human_submitted",
        sourceArtifactIds: ["artifact_source_01JTEST"],
      },
    });

    expect(descriptor).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        artifactId: "artifact_ledger_01JTEST",
        kind: "requirements_ledger",
        byteLength: 2,
        mediaType: "application/json",
        schemaId: "requirements-ledger.v1",
        createdBy: "human:tig",
      }),
    );
    await expect(
      store.stageArtifact(Buffer.from("edited", "utf8"), {
        artifactId: "artifact_external_edit_01JTEST",
        kind: "external_edit",
        mediaType: "text/markdown",
        createdBy: "system:projection-watch",
        provenance: {
          method: "external_edit",
          sourceArtifactIds: ["artifact_plan_01JTEST"],
          expectedContentHash: "a".repeat(64),
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ kind: "external_edit" }));
    await expect(
      store.stageArtifact(Buffer.from("copied", "utf8"), {
        artifactId: "artifact_copied_invalid_01JTEST",
        kind: "raw_requirements",
        mediaType: "text/plain",
        createdBy: "system:test",
        provenance: { method: "copied" } as never,
      }),
    ).rejects.toThrow("registration is invalid");
    await expect(
      store.stageArtifact(Buffer.from("unknown", "utf8"), {
        artifactId: "artifact_unknown_kind_01JTEST",
        kind: "invented_kind" as never,
        mediaType: "application/octet-stream",
        createdBy: "system:test",
        provenance: { method: "human_submitted" },
      }),
    ).rejects.toThrow("registration is invalid");
    await expect(
      store.stageArtifact(Buffer.from("provider", "utf8"), {
        artifactId: "artifact_provider_invalid_01JTEST",
        kind: "review",
        mediaType: "application/json",
        createdBy: "reviewer:test",
        provenance: {
          method: "provider_generated",
          sourceArtifactIds: ["artifact_plan_01JTEST"],
          commandId: "",
          attemptId: "",
        },
      }),
    ).rejects.toThrow("registration is invalid");
    await expect(
      store.stageArtifact(Buffer.from("submitted", "utf8"), {
        artifactId: "artifact_submitted_invalid_01JTEST",
        kind: "requirements_ledger",
        mediaType: "application/json",
        createdBy: "human:tig",
        provenance: {
          method: "human_submitted",
          credential: "opaque-value",
        } as never,
      }),
    ).rejects.toThrow("registration is invalid");
  });

  it("stages deterministic complete configuration and rejects credential values", async () => {
    const project = await temporaryProject();
    const store = await ContentAddressedArtifactStore.open(project);
    const configuration = {
      schemaVersion: 1 as const,
      policyHash: "a".repeat(64),
      plannerAssignment: { provider: "openai" as const, modelId: "gpt-pinned" },
      reviewerAssignment: {
        provider: "anthropic" as const,
        modelId: "claude-pinned",
      },
      artifactHashes: {
        requirementsSchema: "b".repeat(64),
        artifactSchema: "c".repeat(64),
        planSchema: "d".repeat(64),
        reviewSchema: "e".repeat(64),
        taxonomy: "f".repeat(64),
        componentRegistry: "1".repeat(64),
        plannerPrompt: "2".repeat(64),
        reviewerPrompt: "3".repeat(64),
        reviewPolicy: "4".repeat(64),
      },
      hardCeilings: {
        calls: 4,
        physicalAttempts: 6,
        inputTokens: 100_000,
        outputTokens: 40_000,
        costUsdMicros: 100_000_000,
        retries: 2,
        repairs: 1,
        remediationCycles: 3,
        closureCycles: 2,
      },
      credentialReferences: {
        openai: { kind: "environment" as const, reference: "OPENAI_API_KEY" },
        anthropic: {
          kind: "os_credential_store" as const,
          reference: "service:software-factory/account:anthropic",
        },
      },
    };

    const staged = await stageResolvedConfiguration(store, configuration, {
      artifactId: "artifact_configuration_01JTEST",
      createdBy: "human:tig",
    });
    const repeated = await stageResolvedConfiguration(store, configuration, {
      artifactId: "artifact_configuration_02JTEST",
      createdBy: "human:tig",
    });

    expect(staged.contentHash).toBe(repeated.contentHash);
    expect(staged.schemaId).toBe("software-factory/resolved-configuration.v1");
    await expect(
      stageResolvedConfiguration(
        store,
        { ...configuration, apiKey: "secret-value" } as typeof configuration,
        {
          artifactId: "artifact_configuration_bad_01JTEST",
          createdBy: "human:tig",
        },
      ),
    ).rejects.toThrow("secret-free");
    await expect(
      stageResolvedConfiguration(
        store,
        {
          ...configuration,
          credentialReferences: {
            openai: configuration.credentialReferences.openai,
            anthropic: {
              kind: "os_credential_store",
              reference: "service:software-factory/account:anthropic",
              credential: "opaque-value",
            },
          },
        } as unknown as typeof configuration,
        {
          artifactId: "artifact_configuration_os_secret_01JTEST",
          createdBy: "human:tig",
        },
      ),
    ).rejects.toThrow("secret-free");
    await expect(
      stageResolvedConfiguration(
        store,
        {
          ...configuration,
          credentialReferences: {
            openai: configuration.credentialReferences.openai,
          },
        },
        {
          artifactId: "artifact_configuration_missing_provider_01JTEST",
          createdBy: "human:tig",
        },
      ),
    ).rejects.toThrow("secret-free");
    await expect(
      stageResolvedConfiguration(
        store,
        {
          ...configuration,
          hardCeilings: {
            calls: 0,
            physicalAttempts: 0,
            inputTokens: 0,
            outputTokens: 0,
            costUsdMicros: 0,
            retries: 0,
            repairs: 0,
            remediationCycles: 0,
            closureCycles: 0,
          },
        },
        {
          artifactId: "artifact_configuration_zero_bounds_01JTEST",
          createdBy: "human:tig",
        },
      ),
    ).rejects.toThrow("secret-free");
    await expect(
      stageResolvedConfiguration(
        store,
        {
          ...configuration,
          hardCeilings: {
            ...configuration.hardCeilings,
            physicalAttempts: undefined,
          },
        } as unknown as typeof configuration,
        {
          artifactId: "artifact_configuration_missing_attempts_01JTEST",
          createdBy: "human:tig",
        },
      ),
    ).rejects.toThrow("secret-free");
    await expect(
      stageResolvedConfiguration(
        store,
        {
          ...configuration,
          credentialReferences: {
            openai: { kind: "environment", reference: "sk-live-secret-value" },
          },
        },
        {
          artifactId: "artifact_configuration_secret_01JTEST",
          createdBy: "human:tig",
        },
      ),
    ).rejects.toThrow("secret-free");
    await expect(
      stageResolvedConfiguration(
        store,
        {
          ...configuration,
          artifactHashes: {
            ...configuration.artifactHashes,
            taxonomy: undefined,
          },
        } as unknown as typeof configuration,
        {
          artifactId: "artifact_configuration_partial_01JTEST",
          createdBy: "human:tig",
        },
      ),
    ).rejects.toThrow("secret-free");
    await expect(
      stageResolvedConfiguration(
        store,
        {
          ...configuration,
          hardCeilings: {
            ...configuration.hardCeilings,
            closureCycles: undefined,
          },
        } as unknown as typeof configuration,
        {
          artifactId: "artifact_configuration_bounds_01JTEST",
          createdBy: "human:tig",
        },
      ),
    ).rejects.toThrow("secret-free");
  });

  it("copies a regular source once and preserves its original provenance path", async () => {
    const project = await temporaryProject();
    const sourcePath = join(project, "requirements.md");
    await writeFile(sourcePath, "version one", "utf8");
    const store = await ContentAddressedArtifactStore.open(project);

    const copied = await store.copySource(sourcePath);
    await writeFile(sourcePath, "version two", "utf8");

    expect(copied.provenancePath).toBe(sourcePath);
    expect(
      (await store.readVerified(copied.contentHash)).toString("utf8"),
    ).toBe("version one");
  });

  it("rejects symlink sources and detects object corruption", async () => {
    const project = await temporaryProject();
    const sourcePath = join(project, "requirements.md");
    const linkPath = join(project, "requirements-link.md");
    await writeFile(sourcePath, "requirements", "utf8");
    await symlink(sourcePath, linkPath);
    const store = await ContentAddressedArtifactStore.open(project);

    await expect(store.copySource(linkPath)).rejects.toThrow("regular file");

    const staged = await store.stage(Buffer.from("trusted", "utf8"));
    await chmod(staged.objectPath, 0o600);
    await writeFile(staged.objectPath, "tampered", "utf8");
    await expect(store.readVerified(staged.contentHash)).rejects.toBeInstanceOf(
      ArtifactIntegrityError,
    );
  });

  it("never follows Git-ignore or object symlinks", async () => {
    const project = await temporaryProject();
    const outside = join(project, "outside.txt");
    await writeFile(outside, "do not modify", "utf8");
    await symlink(outside, join(project, ".gitignore"));

    await expect(initializeWorkspace(project)).rejects.toThrow("regular file");
    expect(await readFile(outside, "utf8")).toBe("do not modify");

    await unlink(join(project, ".gitignore"));
    const store = await ContentAddressedArtifactStore.open(project);
    const staged = await store.stage(Buffer.from("object", "utf8"));
    await chmod(staged.objectPath, 0o600);
    await unlink(staged.objectPath);
    await symlink(outside, staged.objectPath);
    await expect(store.readVerified(staged.contentHash)).rejects.toBeInstanceOf(
      ArtifactIntegrityError,
    );
  });

  it("never replaces a publication-race winner and opens objects no-follow", async () => {
    const project = await temporaryProject();
    let racedObjectPath = "";
    const racingStore = await ContentAddressedArtifactStore.open(project, {
      beforePublish: async ({ objectPath }) => {
        racedObjectPath = objectPath;
        await writeFile(objectPath, "corrupt race winner", { mode: 0o400 });
      },
    });

    await expect(
      racingStore.stage(Buffer.from("candidate", "utf8")),
    ).rejects.toBeInstanceOf(ArtifactIntegrityError);
    expect(await readFile(racedObjectPath, "utf8")).toBe("corrupt race winner");

    await chmod(racedObjectPath, 0o600);
    await unlink(racedObjectPath);
    const baseStore = await ContentAddressedArtifactStore.open(project);
    const staged = await baseStore.stage(
      Buffer.from("verified object", "utf8"),
    );
    const outside = join(project, "outside-race.txt");
    await writeFile(outside, "outside", "utf8");
    let swap = true;
    const swappingStore = await ContentAddressedArtifactStore.open(project, {
      beforeObjectOpen: async ({ objectPath }) => {
        if (!swap) return;
        swap = false;
        await chmod(objectPath, 0o600);
        await unlink(objectPath);
        await symlink(outside, objectPath);
      },
    });

    await expect(
      swappingStore.readVerified(staged.contentHash),
    ).rejects.toBeInstanceOf(ArtifactIntegrityError);
  });
});
