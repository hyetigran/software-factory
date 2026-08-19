import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type WorkspacePaths = {
  projectRoot: string;
  root: string;
  objects: string;
  cassettes: string;
  locks: string;
};

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
  const privateIgnore = await open(
    join(paths.root, ".gitignore"),
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
