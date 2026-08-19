import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type {
  ArtifactRegistration,
  StagedArtifactRegistration,
} from "../../src/application/artifact-port.js";
import {
  ProviderModelUnavailableError,
  VerifiedProviderModel,
} from "../../src/application/verify-provider-model.js";
import { HttpProviderModelCatalog } from "../../src/infrastructure/providers/model-catalog.js";
import type { HttpTransport } from "../../src/infrastructure/providers/transport.js";

function staged(
  bytes: Uint8Array,
  registration: ArtifactRegistration,
): StagedArtifactRegistration {
  return {
    ...registration,
    schemaVersion: 1,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.byteLength,
  };
}

describe("provider model catalog verification", () => {
  it.each([
    {
      provider: "openai" as const,
      modelId: "gpt-pinned",
      expectedUrl: "https://api.openai.com/v1/models/gpt-pinned",
      expectedHeaders: { authorization: "Bearer secret" },
    },
    {
      provider: "anthropic" as const,
      modelId: "claude-pinned",
      expectedUrl: "https://api.anthropic.com/v1/models/claude-pinned",
      expectedHeaders: {
        "x-api-key": "secret",
        "anthropic-version": "2023-06-01",
      },
    },
  ])(
    "authenticates and preserves exact $provider catalog evidence before minting",
    async ({ provider, modelId, expectedUrl, expectedHeaders }) => {
      const rawResponseBytes = Buffer.from(JSON.stringify({ id: modelId }));
      const send = vi.fn<HttpTransport["send"]>().mockResolvedValue({
        status: 200,
        headers: {},
        body: rawResponseBytes,
      });
      const catalog = new HttpProviderModelCatalog(
        { send },
        () => "secret",
        5_000,
      );
      const stageArtifact = vi
        .fn()
        .mockImplementation(
          (bytes: Uint8Array, registration: ArtifactRegistration) =>
            Promise.resolve(staged(bytes, registration)),
        );
      const registerArtifact = vi.fn().mockResolvedValue(undefined);

      const capability = await VerifiedProviderModel.verify({
        identity: { provider, modelId },
        allowlistArtifactId: "allowlist_1",
        catalogArtifactId: "catalog_1",
        createdBy: "factory",
        catalog,
        staging: { stageArtifact },
        registration: { registerArtifact },
      });

      expect(send).toHaveBeenCalledWith({
        method: "GET",
        url: expectedUrl,
        headers: expectedHeaders,
        body: new Uint8Array(),
        timeoutMs: 5_000,
      });
      expect(stageArtifact).toHaveBeenCalledWith(
        rawResponseBytes,
        expect.objectContaining({
          kind: "provider_catalog",
          provenance: {
            method: "provider_catalog",
            sourceArtifactIds: ["allowlist_1"],
            provider,
            modelId,
          },
        }),
      );
      expect(registerArtifact).toHaveBeenCalledOnce();
      expect(capability.evidence()).toMatchObject({
        provider,
        modelId,
        catalogArtifact: { artifactId: "catalog_1" },
      });
    },
  );

  it("rejects aliases and unavailable models without registering evidence", async () => {
    const send = vi.fn<HttpTransport["send"]>().mockResolvedValue({
      status: 200,
      headers: {},
      body: Buffer.from('{"id":"different-model"}'),
    });
    const registerArtifact = vi.fn();
    await expect(
      VerifiedProviderModel.verify({
        identity: { provider: "openai", modelId: "pinned-model" },
        allowlistArtifactId: "allowlist_1",
        catalogArtifactId: "catalog_1",
        createdBy: "factory",
        catalog: new HttpProviderModelCatalog({ send }, () => "secret", 5_000),
        staging: { stageArtifact: vi.fn() },
        registration: { registerArtifact },
      }),
    ).rejects.toBeInstanceOf(ProviderModelUnavailableError);
    expect(registerArtifact).not.toHaveBeenCalled();
  });

  it("does not expose mutable capability evidence", async () => {
    const rawResponseBytes = Buffer.from('{"id":"pinned-model"}');
    const capability = await VerifiedProviderModel.verify({
      identity: { provider: "openai", modelId: "pinned-model" },
      allowlistArtifactId: "allowlist_1",
      catalogArtifactId: "catalog_1",
      createdBy: "factory",
      catalog: {
        lookup: (identity) =>
          Promise.resolve({
            ...identity,
            returnedModelId: identity.modelId,
            rawResponseBytes,
          }),
      },
      staging: {
        stageArtifact: (bytes, registration) =>
          Promise.resolve(staged(bytes, registration)),
      },
      registration: { registerArtifact: () => Promise.resolve() },
    });
    const first = capability.evidence();
    first.catalogArtifact.artifactId = "mutated";
    expect(capability.evidence().catalogArtifact.artifactId).toBe("catalog_1");
  });
});
