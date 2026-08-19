import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, open, readFile, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  initializeWorkspace,
  type WorkspacePaths,
} from "../platform/workspace.js";

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

export type ArtifactKind =
  | "raw_requirements"
  | "requirements_ledger"
  | "coverage_report"
  | "structured_plan"
  | "rendered_plan"
  | "external_edit"
  | "review"
  | "provider_request"
  | "provider_response"
  | "native_usage"
  | "terminal_manifest"
  | "terminal_report"
  | "backup_manifest"
  | "other";

export type ArtifactProvenance =
  | { method: "copied"; sourcePath: string }
  | { method: "human_submitted"; sourceArtifactIds?: string[] }
  | {
      method: "provider_generated";
      sourceArtifactIds: string[];
      commandId: string;
      attemptId: string;
    }
  | {
      method: "deterministic_render";
      sourceArtifactIds: string[];
      commandId: string;
    }
  | { method: "exported"; sourceArtifactIds: string[] };

export type ArtifactRegistration = {
  artifactId: string;
  kind: ArtifactKind;
  mediaType: string;
  schemaId?: string;
  createdBy: string;
  provenance: ArtifactProvenance;
};

export type StagedArtifactDescriptor = {
  schemaVersion: 1;
  artifactId: string;
  kind: ArtifactKind;
  contentHash: string;
  byteLength: number;
  mediaType: string;
  schemaId?: string;
  createdBy: string;
  provenance: ArtifactProvenance;
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

export class ArtifactIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArtifactIntegrityError";
  }
}

function identifiersAreValid(values: unknown): values is string[] {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    new Set(values).size === values.length &&
    values.every(
      (value) => typeof value === "string" && value.trim().length > 0,
    )
  );
}

function provenanceIsValid(provenance: ArtifactProvenance): boolean {
  switch (provenance.method) {
    case "copied":
      return (
        typeof provenance.sourcePath === "string" &&
        provenance.sourcePath.trim().length > 0
      );
    case "human_submitted":
      return (
        provenance.sourceArtifactIds === undefined ||
        identifiersAreValid(provenance.sourceArtifactIds)
      );
    case "provider_generated":
      return (
        identifiersAreValid(provenance.sourceArtifactIds) &&
        typeof provenance.commandId === "string" &&
        provenance.commandId.trim().length > 0 &&
        typeof provenance.attemptId === "string" &&
        provenance.attemptId.trim().length > 0
      );
    case "deterministic_render":
      return (
        identifiersAreValid(provenance.sourceArtifactIds) &&
        typeof provenance.commandId === "string" &&
        provenance.commandId.trim().length > 0
      );
    case "exported":
      return identifiersAreValid(provenance.sourceArtifactIds);
  }
}

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
    if (
      !/^[A-Za-z][A-Za-z0-9_-]{2,127}$/u.test(registration.artifactId) ||
      registration.mediaType.trim().length === 0 ||
      registration.createdBy.trim().length === 0 ||
      !provenanceIsValid(registration.provenance)
    ) {
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
    if (!/^[a-f0-9]{64}$/u.test(contentHash)) {
      throw new ArtifactIntegrityError(`Invalid content hash: ${contentHash}`);
    }
    let handle;
    const objectPath = join(this.workspace.objects, contentHash);
    try {
      await this.hooks.beforeObjectOpen?.({ contentHash, objectPath });
      handle = await open(
        objectPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const metadata = await handle.stat();
      if (!metadata.isFile()) {
        throw new ArtifactIntegrityError(
          `Object path is not a regular file: ${contentHash}`,
        );
      }
      const bytes = await handle.readFile();
      if (sha256(bytes) !== contentHash) {
        throw new ArtifactIntegrityError(
          `Object content does not match its address: ${contentHash}`,
        );
      }
      return bytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOOP") {
        throw new ArtifactIntegrityError(
          `Object path is not a regular file: ${contentHash}`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      await handle?.close();
    }
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
