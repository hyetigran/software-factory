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
});
