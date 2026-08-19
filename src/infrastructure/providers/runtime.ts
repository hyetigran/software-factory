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

export class ProviderCredentialError extends Error {
  constructor(
    readonly reference: string,
    options?: ErrorOptions,
  ) {
    super(
      `Provider credential reference is unavailable: ${reference}`,
      options,
    );
    this.name = "ProviderCredentialError";
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
    let preparedRequest: Request;
    try {
      const url = new URL(request.url);
      if (url.protocol !== "https:")
        throw new TypeError("Provider URL must use HTTPS");
      preparedRequest = new Request(url, {
        method: request.method ?? "POST",
        headers: request.headers,
        ...((request.method ?? "POST") === "GET"
          ? {}
          : { body: Buffer.from(request.body) }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      throw new ProviderTransportError(
        "Provider request could not be constructed",
        false,
        false,
        { cause: error },
      );
    }
    try {
      const response = await this.fetchImplementation(preparedRequest);
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: new Uint8Array(await response.arrayBuffer()),
      };
    } catch (error) {
      if (error instanceof ProviderTransportError) throw error;
      const dispatched =
        controller.signal.aborted || !preDispatchFailure(error);
      throw new ProviderTransportError(
        dispatched
          ? "Provider request outcome is unknown after dispatch"
          : "Provider connection failed before dispatch",
        dispatched,
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
  platform?: NodeJS.Platform;
};

const preDispatchCodes = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "UND_ERR_CONNECT_TIMEOUT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
]);

function preDispatchFailure(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current === null || typeof current !== "object") return false;
    const candidate = current as { code?: unknown; cause?: unknown };
    if (
      typeof candidate.code === "string" &&
      preDispatchCodes.has(candidate.code)
    )
      return true;
    current = candidate.cause;
  }
  return false;
}

async function readMacOsCredential(reference: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "/usr/bin/security",
    ["find-generic-password", "-s", reference, "-w"],
    { encoding: "utf8", maxBuffer: 64 * 1024 },
  );
  return stdout.replace(/\r?\n$/u, "");
}

async function readLinuxCredential(reference: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "secret-tool",
    ["lookup", "service", reference],
    { encoding: "utf8", maxBuffer: 64 * 1024 },
  );
  return stdout.replace(/\r?\n$/u, "");
}

function defaultOsCredentialReader(platform: NodeJS.Platform) {
  if (platform === "darwin") return readMacOsCredential;
  if (platform === "linux") return readLinuxCredential;
  return (reference: string): Promise<string> =>
    Promise.reject(new ProviderCredentialError(reference));
}

export async function resolveProviderCredential(
  reference: CredentialReference,
  dependencies: CredentialResolutionDependencies = {},
): Promise<string> {
  let value: string | undefined;
  try {
    value =
      reference.kind === "environment"
        ? (dependencies.environment ?? process.env)[reference.reference]
        : await (
            dependencies.readOsCredential ??
            defaultOsCredentialReader(dependencies.platform ?? process.platform)
          )(reference.reference);
  } catch (error) {
    if (error instanceof ProviderCredentialError) throw error;
    throw new ProviderCredentialError(reference.reference);
  }
  if (typeof value !== "string" || value.trim().length === 0)
    throw new ProviderCredentialError(reference.reference);
  return value;
}
