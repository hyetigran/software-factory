import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export type WorkspacePaths = {
  projectRoot: string;
  root: string;
  objects: string;
  cassettes: string;
  locks: string;
};

export type StagedObject = {
  contentHash: string;
  byteLength: number;
  objectPath: string;
};

export type CopiedSource = StagedObject & {
  provenancePath: string;
};

export class ArtifactIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactIntegrityError";
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Workspace path is not a regular directory: ${path}`);
  }
  await chmod(path, 0o700);
}

async function ensureFactoryIgnored(projectRoot: string): Promise<void> {
  const ignorePath = join(projectRoot, ".gitignore");
  let existing = "";
  try {
    const metadata = await lstat(ignorePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Git ignore path is not a regular file: ${ignorePath}`);
    }
    existing = await readFile(ignorePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  if (!existing.split(/\r?\n/u).includes(".factory/")) {
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    const handle = await open(
      ignorePath,
      constants.O_APPEND |
        constants.O_CREAT |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(`${prefix}.factory/\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

export async function initializeWorkspace(
  projectRootInput: string,
): Promise<WorkspacePaths> {
  const projectRoot = resolve(projectRootInput);
  const projectMetadata = await lstat(projectRoot);
  if (!projectMetadata.isDirectory() || projectMetadata.isSymbolicLink()) {
    throw new Error(`Project root is not a regular directory: ${projectRoot}`);
  }

  const root = join(projectRoot, ".factory");
  const paths: WorkspacePaths = {
    projectRoot,
    root,
    objects: join(root, "objects"),
    cassettes: join(root, "cassettes"),
    locks: join(root, "locks"),
  };
  await ensurePrivateDirectory(paths.root);
  await Promise.all([
    ensurePrivateDirectory(paths.objects),
    ensurePrivateDirectory(join(paths.objects, ".tmp")),
    ensurePrivateDirectory(paths.cassettes),
    ensurePrivateDirectory(paths.locks),
  ]);
  const privateIgnorePath = join(paths.root, ".gitignore");
  const privateIgnore = await open(
    privateIgnorePath,
    constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await privateIgnore.writeFile("*\n", "utf8");
    await privateIgnore.sync();
  } finally {
    await privateIgnore.close();
  }
  await ensureFactoryIgnored(projectRoot);
  return paths;
}

export class ContentAddressedArtifactStore {
  private constructor(readonly workspace: WorkspacePaths) {}

  static async open(
    projectRoot: string,
  ): Promise<ContentAddressedArtifactStore> {
    return new ContentAddressedArtifactStore(
      await initializeWorkspace(projectRoot),
    );
  }

  async stage(bytesInput: Uint8Array): Promise<StagedObject> {
    const bytes = Buffer.from(bytesInput);
    const contentHash = sha256(bytes);
    const objectPath = join(this.workspace.objects, contentHash);
    const existing = await this.readIfPresent(contentHash);
    if (existing !== null) {
      if (!existing.equals(bytes)) {
        throw new ArtifactIntegrityError(
          `Existing object does not match its content hash: ${contentHash}`,
        );
      }
      return { contentHash, byteLength: bytes.length, objectPath };
    }

    const temporaryPath = join(
      this.workspace.objects,
      ".tmp",
      `${contentHash}.${randomUUID()}.tmp`,
    );
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      const stagedBytes = await readFile(temporaryPath);
      if (sha256(stagedBytes) !== contentHash || !stagedBytes.equals(bytes)) {
        throw new ArtifactIntegrityError(
          "Temporary object verification failed",
        );
      }
      await rename(temporaryPath, objectPath);
      await chmod(objectPath, 0o400);
      const directory = await open(this.workspace.objects, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }

    return { contentHash, byteLength: bytes.length, objectPath };
  }

  async readVerified(contentHash: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/u.test(contentHash)) {
      throw new ArtifactIntegrityError(`Invalid content hash: ${contentHash}`);
    }
    const objectPath = join(this.workspace.objects, contentHash);
    const metadata = await lstat(objectPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new ArtifactIntegrityError(
        `Object path is not a regular file: ${contentHash}`,
      );
    }
    const bytes = await readFile(objectPath);
    if (sha256(bytes) !== contentHash) {
      throw new ArtifactIntegrityError(
        `Object content does not match its address: ${contentHash}`,
      );
    }
    return bytes;
  }

  async copySource(sourcePathInput: string): Promise<CopiedSource> {
    const provenancePath = isAbsolute(sourcePathInput)
      ? resolve(sourcePathInput)
      : resolve(this.workspace.projectRoot, sourcePathInput);
    let handle;
    try {
      handle = await open(
        provenancePath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const metadata = await handle.stat();
      if (!metadata.isFile()) {
        throw new Error(`Source is not a regular file: ${provenancePath}`);
      }
      const bytes = await handle.readFile();
      return { ...(await this.stage(bytes)), provenancePath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOOP") {
        throw new Error(`Source is not a regular file: ${provenancePath}`, {
          cause: error,
        });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private async readIfPresent(contentHash: string): Promise<Buffer | null> {
    const path = join(this.workspace.objects, contentHash);
    try {
      await access(path, constants.R_OK);
      return await this.readVerified(contentHash);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }
}
