import { createHash } from "node:crypto";

import type {
  PreparedProviderCall,
  ProviderAdapter,
  ProviderExecution,
  ProviderRequest,
} from "../../application/provider-port.js";
import { sealProviderExecution } from "./execution-capability.js";
import { assertJsonSchema } from "../../application/json-schema-validator.js";
import { canonicalJson } from "../../domain/canonical-json.js";
import { preparedProviderCall } from "./common.js";

export class UnrecordedRequestError extends Error {
  readonly code = "UNRECORDED_REQUEST";

  constructor(normalizedRequestHash: string) {
    super(`No provider recording matches ${normalizedRequestHash}`);
    this.name = "UnrecordedRequestError";
  }
}

export interface ProviderCassetteStore {
  lookup(input: {
    provider: ProviderRequest["provider"];
    modelId: string;
    logicalCommandKey: string;
    normalizedRequestHash: string;
  }): Promise<{
    manifestBytes: Uint8Array;
    manifestContentHash: string;
    execution: ProviderExecution;
  } | null>;
}

export class StrictReplayAdapter implements ProviderAdapter {
  constructor(
    private readonly formatter: ProviderAdapter,
    private readonly cassettes: ProviderCassetteStore,
  ) {}

  prepare(request: ProviderRequest): PreparedProviderCall {
    const preparedRequest = structuredClone(request);
    const prepared = this.formatter.prepare(preparedRequest);
    const expectedIdentity = prepared.identity;
    let dispatched = false;
    return preparedProviderCall({
      redactedRequestBytes: prepared.redactedRequestBytes,
      normalizedRequestHash: prepared.normalizedRequestHash,
      identity: prepared.identity,
      dispatch: async () => {
        if (dispatched) {
          throw new Error("Prepared provider call has already been dispatched");
        }
        dispatched = true;
        const recorded = await this.cassettes.lookup({
          provider: preparedRequest.provider,
          modelId: preparedRequest.modelId,
          logicalCommandKey: preparedRequest.logicalCommandKey,
          normalizedRequestHash: prepared.normalizedRequestHash,
        });
        if (recorded === null) {
          throw new UnrecordedRequestError(prepared.normalizedRequestHash);
        }
        const manifestHash = createHash("sha256")
          .update(recorded.manifestBytes)
          .digest("hex");
        const manifest = parseManifest(recorded.manifestBytes);
        const resultIdentity = structuredClone(
          recorded.execution,
        ) as unknown as Record<string, unknown>;
        delete resultIdentity.recording;
        const resultHash = createHash("sha256")
          .update(canonicalJson(resultIdentity))
          .digest("hex");
        const rawResponseHash = hashOptional(
          recorded.execution.recording.rawResponseBytes,
        );
        const nativeUsageHash = hashOptional(
          recorded.execution.recording.nativeUsageBytes,
        );
        if (
          manifestHash !== recorded.manifestContentHash ||
          manifest.provider !== preparedRequest.provider ||
          manifest.modelId !== preparedRequest.modelId ||
          manifest.logicalCommandKey !== preparedRequest.logicalCommandKey ||
          manifest.normalizedRequestHash !== prepared.normalizedRequestHash ||
          manifest.endpoint !== expectedIdentity.endpoint ||
          manifest.apiVersion !== (expectedIdentity.apiVersion ?? null) ||
          canonicalJson(manifest.behaviorHeaders) !==
            canonicalJson(expectedIdentity.behaviorHeaders) ||
          canonicalJson(manifest.preflight) !==
            canonicalJson(expectedIdentity.preflight) ||
          manifest.resultHash !== resultHash ||
          manifest.rawResponseHash !== rawResponseHash ||
          manifest.nativeUsageHash !== nativeUsageHash ||
          recorded.execution.evidence.requestedModel !==
            preparedRequest.modelId ||
          recorded.execution.evidence.correlationId !==
            preparedRequest.correlationId ||
          (recorded.execution.evidence.returnedModel !== undefined &&
            recorded.execution.evidence.returnedModel !==
              preparedRequest.modelId)
        ) {
          throw new TypeError("Provider recording identity does not match");
        }
        if (recorded.execution.kind === "completed") {
          assertJsonSchema(
            recorded.execution.structured,
            preparedRequest.outputSchema,
          );
        }
        return sealProviderExecution(recorded.execution);
      },
    });
  }
}

type CassetteManifest = {
  schemaVersion: 1;
  provider: ProviderRequest["provider"];
  modelId: string;
  logicalCommandKey: string;
  normalizedRequestHash: string;
  endpoint: string;
  apiVersion: string | null;
  behaviorHeaders: Record<string, string>;
  preflight: PreparedProviderCall["identity"]["preflight"];
  resultHash: string;
  rawResponseHash: string | null;
  nativeUsageHash: string | null;
};

function hashOptional(value: Uint8Array | undefined): string | null {
  return value === undefined
    ? null
    : createHash("sha256").update(value).digest("hex");
}

function parseManifest(bytes: Uint8Array): CassetteManifest {
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).schemaVersion !== 1
  ) {
    throw new TypeError("Provider recording manifest is invalid");
  }
  return parsed as CassetteManifest;
}
