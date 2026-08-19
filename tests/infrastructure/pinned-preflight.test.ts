import { describe, expect, it } from "vitest";

import { PinnedProviderPreflight } from "../../src/infrastructure/providers/pinned-preflight.js";
import type { ResolvedConfigurationSnapshot } from "../../src/application/stage-configuration.js";
import type { ProviderRequest } from "../../src/application/provider-port.js";

const configuration = {
  plannerAssignment: { provider: "openai", modelId: "planner-pinned" },
  reviewerAssignment: { provider: "anthropic", modelId: "reviewer-pinned" },
  modelCapabilities: {
    planner: {
      canonicalModelId: "planner-pinned",
      structuredOutput: true,
      contextWindowTokens: 100_000,
      maxOutputTokens: 10_000,
    },
    reviewer: {
      canonicalModelId: "reviewer-pinned",
      structuredOutput: true,
      contextWindowTokens: 80_000,
      maxOutputTokens: 8_000,
    },
  },
} as ResolvedConfigurationSnapshot;

const request = {
  provider: "openai",
  role: "planner",
  modelId: "planner-pinned",
  logicalCommandKey: "a".repeat(64),
  correlationId: "correlation_1",
  systemPromptArtifactId: "prompt_1",
  systemPromptContentHash: "b".repeat(64),
  systemPrompt: "Plan the implementation",
  inputArtifacts: [
    {
      artifactId: "ledger_1",
      kind: "requirements_ledger",
      content: '{"requirements":[]}',
      contentHash: "c".repeat(64),
    },
  ],
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["result"],
    properties: { result: { type: "string", minLength: 1 } },
  },
  outputSchemaArtifactId: "schema_1",
  outputSchemaContentHash: "d".repeat(64),
  maxOutputTokens: 1_000,
  timeoutMs: 30_000,
  providerStorage: "minimize",
} satisfies ProviderRequest;

describe("PinnedProviderPreflight", () => {
  it("returns only the exact pinned provider/model capability", () => {
    const preflight = new PinnedProviderPreflight(configuration);
    expect(preflight.resolve(request)).toEqual(
      configuration.modelCapabilities.planner,
    );
    expect(
      preflight.resolve({ ...request, modelId: "floating-alias" }),
    ).toBeNull();
  });

  it("rejects schema keywords outside the closed provider subset", () => {
    const preflight = new PinnedProviderPreflight(configuration);
    expect(preflight.schemaSupported("openai", request.outputSchema)).toBe(
      true,
    );
    expect(
      preflight.schemaSupported("openai", {
        ...request.outputSchema,
        unevaluatedProperties: false,
      }),
    ).toBe(false);
  });

  it("uses a conservative UTF-8 byte upper bound for input tokens", () => {
    const preflight = new PinnedProviderPreflight(configuration);
    const ascii = preflight.countInputTokens(request);
    const multibyte = preflight.countInputTokens({
      ...request,
      systemPrompt: "🧭".repeat(100),
    });
    expect(ascii).toBeGreaterThan(0);
    expect(multibyte).toBeGreaterThan(400);
  });
});
