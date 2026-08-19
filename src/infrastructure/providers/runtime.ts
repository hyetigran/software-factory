import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { CredentialReference } from "../../application/stage-configuration.js";
import type {
  HttpTransport,
  HttpTransportRequest,
  HttpTransportResponse,
} from "./transport.js";

const execFileAsync = promisify(execFile);

export class ProviderTransportError extends Error {
  constructor(
    message: string,
    readonly dispatched: boolean,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderTransportError";
  }
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class FetchHttpTransport implements HttpTransport {
  constructor(
    private readonly fetchImplementation: FetchLike = globalThis.fetch,
  ) {}

  async send(request: HttpTransportRequest): Promise<HttpTransportResponse> {
    if (
      !URL.canParse(request.url) ||
      !Number.isInteger(request.timeoutMs) ||
      request.timeoutMs < 1
    ) {
      throw new ProviderTransportError(
        "Provider transport request is invalid",
        false,
        false,
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await this.fetchImplementation(request.url, {
        method: "POST",
        headers: request.headers,
        body: Buffer.from(request.body),
        signal: controller.signal,
      });
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: new Uint8Array(await response.arrayBuffer()),
      };
    } catch (error) {
      if (error instanceof ProviderTransportError) throw error;
      throw new ProviderTransportError(
        controller.signal.aborted
          ? "Provider request timed out after dispatch"
          : "Provider request failed after dispatch",
        true,
        true,
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type CredentialResolutionDependencies = {
  environment?: NodeJS.ProcessEnv;
  readOsCredential?: (reference: string) => Promise<string>;
};

async function readMacOsCredential(reference: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "/usr/bin/security",
    ["find-generic-password", "-s", reference, "-w"],
    { encoding: "utf8", maxBuffer: 64 * 1024 },
  );
  return stdout.trim();
}

export async function resolveProviderCredential(
  reference: CredentialReference,
  dependencies: CredentialResolutionDependencies = {},
): Promise<string> {
  const value =
    reference.kind === "environment"
      ? (dependencies.environment ?? process.env)[reference.reference]
      : await (dependencies.readOsCredential ?? readMacOsCredential)(
          reference.reference,
        );
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Provider credential reference is unavailable: ${reference.reference}`,
    );
  }
  return value.trim();
}
