import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, open, readFile, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  artifactRegistrationIsValid,
  type ArtifactKind,
  type ArtifactProvenance,
  type ArtifactRegistration,
  type StagedArtifactRegistration,
} from "../../application/artifact-port.js";
import {
  initializeWorkspace,
  type WorkspacePaths,
} from "../platform/workspace.js";
import {
  ArtifactIntegrityError,
  readVerifiedObject,
} from "./object-verifier.js";

export { ArtifactIntegrityError } from "./object-verifier.js";

export {
  initializeWorkspace,
  type WorkspacePaths,
} from "../platform/workspace.js";

export type StagedObject = {
  contentHash: string;
  byteLength: number;
  objectPath: string;
};

export type CopiedSource = StagedObject & {
  provenancePath: string;
};

export type { ArtifactKind, ArtifactProvenance, ArtifactRegistration };

export type StagedArtifactDescriptor = StagedArtifactRegistration & {
  objectPath: string;
};

export type ArtifactStoreHooks = {
  beforePublish?: (context: {
    contentHash: string;
    objectPath: string;
  }) => Promise<void>;
  beforeObjectOpen?: (context: {
    contentHash: string;
    objectPath: string;
  }) => Promise<void>;
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class ContentAddressedArtifactStore {
  private constructor(
    readonly workspace: WorkspacePaths,
    private readonly hooks: ArtifactStoreHooks,
  ) {}

  static async open(
    projectRoot: string,
    hooks: ArtifactStoreHooks = {},
  ): Promise<ContentAddressedArtifactStore> {
    return new ContentAddressedArtifactStore(
      await initializeWorkspace(projectRoot),
      hooks,
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
      await handle.chmod(0o400);
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
      await this.hooks.beforePublish?.({ contentHash, objectPath });
      try {
        await link(temporaryPath, objectPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
        const winner = await this.readVerified(contentHash);
        if (!winner.equals(bytes)) {
          throw new ArtifactIntegrityError(
            `Published object does not match its content hash: ${contentHash}`,
          );
        }
      }
      await unlink(temporaryPath);
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

  async stageArtifact(
    bytes: Uint8Array,
    registration: ArtifactRegistration,
  ): Promise<StagedArtifactDescriptor> {
    if (!artifactRegistrationIsValid(registration)) {
      throw new TypeError("Artifact registration is invalid");
    }
    const staged = await this.stage(bytes);
    return {
      schemaVersion: 1,
      artifactId: registration.artifactId,
      kind: registration.kind,
      contentHash: staged.contentHash,
      byteLength: staged.byteLength,
      mediaType: registration.mediaType,
      ...(registration.schemaId === undefined
        ? {}
        : { schemaId: registration.schemaId }),
      createdBy: registration.createdBy,
      provenance: registration.provenance,
      objectPath: staged.objectPath,
    };
  }

  async readVerified(contentHash: string): Promise<Buffer> {
    return readVerifiedObject(
      this.workspace.objects,
      contentHash,
      async (objectPath) =>
        this.hooks.beforeObjectOpen?.({ contentHash, objectPath }),
    );
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
    try {
      return await this.readVerified(contentHash);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }
}
