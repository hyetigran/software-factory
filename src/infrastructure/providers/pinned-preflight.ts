import { canonicalJson } from "../../domain/canonical-json.js";
import type { ProviderRequest } from "../../application/provider-port.js";
import type { ResolvedConfigurationSnapshot } from "../../application/stage-configuration.js";
import type {
  ProviderModelCapability,
  ProviderPreflight,
} from "./transport.js";

const schemaKeywords = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "title",
  "description",
  "type",
  "const",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "allOf",
  "anyOf",
  "oneOf",
]);

function schemaUsesKnownSubset(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  if (Array.isArray(value)) return value.every(schemaUsesKnownSubset);
  return Object.entries(value).every(
    ([key, nested]) =>
      schemaKeywords.has(key) &&
      (key === "properties" || key === "$defs"
        ? nested !== null &&
          typeof nested === "object" &&
          !Array.isArray(nested) &&
          Object.values(nested as Record<string, unknown>).every(
            schemaUsesKnownSubset,
          )
        : schemaUsesKnownSubset(nested)),
  );
}

function capabilityForRequest(
  configuration: ResolvedConfigurationSnapshot,
  request: ProviderRequest,
): ProviderModelCapability | null {
  const candidates = [
    {
      assignment: configuration.plannerAssignment,
      capability: configuration.modelCapabilities.planner,
    },
    {
      assignment: configuration.reviewerAssignment,
      capability: configuration.modelCapabilities.reviewer,
    },
  ];
  const match = candidates.find(
    ({ assignment }) =>
      assignment.provider === request.provider &&
      assignment.modelId === request.modelId,
  );
  return match?.capability ?? null;
}

export class PinnedProviderPreflight implements ProviderPreflight {
  constructor(private readonly configuration: ResolvedConfigurationSnapshot) {}

  resolve(request: ProviderRequest): ProviderModelCapability | null {
    const capability = capabilityForRequest(this.configuration, request);
    return capability === null ? null : structuredClone(capability);
  }

  schemaSupported(
    _provider: ProviderRequest["provider"],
    schema: object,
  ): boolean {
    return schemaUsesKnownSubset(schema);
  }

  countInputTokens(request: ProviderRequest): number {
    const bytes = Buffer.byteLength(
      canonicalJson({
        role: request.role,
        systemPrompt: request.systemPrompt,
        inputArtifacts: request.inputArtifacts.map(
          ({ artifactId, kind, content, contentHash }) => ({
            artifactId,
            kind,
            contentHash,
            contentEncoding: "base64",
            content: Buffer.from(content).toString("base64"),
          }),
        ),
        outputSchema: request.outputSchema,
      }),
    );
    return bytes;
  }
}
