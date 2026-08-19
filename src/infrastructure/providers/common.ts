import { createHash } from "node:crypto";

import type {
  ProviderEvidence,
  ProviderRequest,
} from "../../application/provider-port.js";
import { canonicalJson } from "../../domain/canonical-json.js";

export function assertProviderRequest(
  request: ProviderRequest,
  provider: ProviderRequest["provider"],
): void {
  if (
    request.provider !== provider ||
    request.modelId.trim().length === 0 ||
    !/^[a-f0-9]{64}$/u.test(request.logicalCommandKey) ||
    request.correlationId.trim().length === 0 ||
    request.systemPrompt.trim().length === 0 ||
    request.inputArtifacts.length === 0 ||
    !Number.isInteger(request.maxOutputTokens) ||
    request.maxOutputTokens < 1 ||
    !Number.isInteger(request.timeoutMs) ||
    request.timeoutMs < 1 ||
    request.inputArtifacts.some(
      ({ kind, content, contentHash }) =>
        kind.trim().length === 0 ||
        createHash("sha256").update(content).digest("hex") !== contentHash,
    )
  ) {
    throw new TypeError("Provider request is invalid");
  }
}

export function labeledInputs(request: ProviderRequest): string {
  return request.inputArtifacts
    .map(
      ({ kind, content, contentHash }) =>
        `<artifact kind=${JSON.stringify(kind)} sha256=${JSON.stringify(contentHash)}>\n${content}\n</artifact>`,
    )
    .join("\n\n");
}

export function bytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value));
}

export function objectFromBytes(value: Uint8Array): Record<string, unknown> {
  const parsed: unknown = JSON.parse(Buffer.from(value).toString("utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Provider response must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function evidence(input: {
  request: ProviderRequest;
  endpoint: string;
  apiVersion?: string;
  behaviorHeaders: Record<string, string>;
  returnedModel?: unknown;
  providerRequestId?: string;
  providerResponseId?: unknown;
  completionStatus?: unknown;
}): ProviderEvidence {
  return {
    requestedModel: input.request.modelId,
    ...(typeof input.returnedModel === "string"
      ? { returnedModel: input.returnedModel }
      : {}),
    endpoint: input.endpoint,
    ...(input.apiVersion === undefined ? {} : { apiVersion: input.apiVersion }),
    behaviorHeaders: input.behaviorHeaders,
    ...(input.providerRequestId === undefined
      ? {}
      : { providerRequestId: input.providerRequestId }),
    ...(typeof input.providerResponseId === "string"
      ? { providerResponseId: input.providerResponseId }
      : {}),
    correlationId: input.request.correlationId,
    ...(typeof input.completionStatus === "string"
      ? { completionStatus: input.completionStatus }
      : {}),
  };
}

export function textFromOpenAi(response: Record<string, unknown>): {
  text?: string;
  refused: boolean;
} {
  const output = Array.isArray(response.output) ? response.output : [];
  const content = output.flatMap((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const blocks = (item as Record<string, unknown>).content;
    return Array.isArray(blocks) ? (blocks as unknown[]) : [];
  });
  const refusal = content.some(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).type === "refusal",
  );
  const texts = content
    .filter(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === "object" && !Array.isArray(item),
    )
    .filter(
      ({ type, text }) => type === "output_text" && typeof text === "string",
    )
    .map(({ text }) => text as string);
  return {
    ...(texts.length === 0 ? {} : { text: texts.join("") }),
    refused: refusal,
  };
}
