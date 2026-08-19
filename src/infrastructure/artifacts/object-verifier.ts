import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

export class ArtifactIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArtifactIntegrityError";
  }
}

export async function readVerifiedObject(
  objectsDirectory: string,
  contentHash: string,
  beforeOpen?: (objectPath: string) => Promise<void>,
): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/u.test(contentHash)) {
    throw new ArtifactIntegrityError(`Invalid content hash: ${contentHash}`);
  }
  const objectPath = join(objectsDirectory, contentHash);
  let handle;
  try {
    await beforeOpen?.(objectPath);
    handle = await open(objectPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new ArtifactIntegrityError(
        `Object path is not a regular file: ${contentHash}`,
      );
    }
    const bytes = await handle.readFile();
    if (createHash("sha256").update(bytes).digest("hex") !== contentHash) {
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
