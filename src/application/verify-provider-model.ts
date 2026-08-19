import { createHash } from "node:crypto";

import { canonicalJson } from "../domain/canonical-json.js";
import type {
  ArtifactRegistrationPort,
  ArtifactStagingPort,
  StagedArtifactRegistration,
} from "./artifact-port.js";

export type ProviderIdentity = {
  provider: "openai" | "anthropic";
  modelId: string;
};

export type ProviderCatalogObservation = ProviderIdentity & {
  returnedModelId: string;
  rawResponseBytes: Uint8Array;
};

export interface ProviderCatalogPort {
  lookup(identity: ProviderIdentity): Promise<ProviderCatalogObservation>;
}

type VerifiedProviderModelData = ProviderIdentity & {
  catalogArtifact: StagedArtifactRegistration;
};

export class VerifiedProviderModel {
  readonly #value: VerifiedProviderModelData;

  private constructor(value: VerifiedProviderModelData) {
    this.#value = structuredClone(value);
    Object.freeze(this);
  }

  static async verify(input: {
    identity: ProviderIdentity;
    allowlistArtifactId: string;
    catalogArtifactId: string;
    createdBy: string;
    catalog: ProviderCatalogPort;
    staging: ArtifactStagingPort;
    registration: ArtifactRegistrationPort;
  }): Promise<VerifiedProviderModel> {
    const { identity } = input;
    if (
      (identity.provider !== "openai" && identity.provider !== "anthropic") ||
      identity.modelId.trim().length === 0 ||
      input.allowlistArtifactId.trim().length === 0 ||
      input.catalogArtifactId.trim().length === 0 ||
      input.createdBy.trim().length === 0
    ) {
      throw new TypeError("Provider catalog verification identity is invalid");
    }
    const observation = await input.catalog.lookup(structuredClone(identity));
    if (
      observation.provider !== identity.provider ||
      observation.modelId !== identity.modelId ||
      observation.returnedModelId !== identity.modelId ||
      observation.rawResponseBytes.byteLength === 0
    ) {
      throw new ProviderModelUnavailableError(identity);
    }
    const requested = {
      artifactId: input.catalogArtifactId,
      kind: "provider_catalog" as const,
      mediaType: "application/json",
      schemaId: "provider-model-catalog-response.v1",
      createdBy: input.createdBy,
      provenance: {
        method: "provider_catalog" as const,
        sourceArtifactIds: [input.allowlistArtifactId],
        provider: identity.provider,
        modelId: identity.modelId,
      },
    };
    const artifact = await input.staging.stageArtifact(
      observation.rawResponseBytes,
      requested,
    );
    if (
      artifact.schemaVersion !== 1 ||
      artifact.artifactId !== requested.artifactId ||
      artifact.kind !== requested.kind ||
      artifact.mediaType !== requested.mediaType ||
      artifact.schemaId !== requested.schemaId ||
      artifact.createdBy !== requested.createdBy ||
      artifact.byteLength !== observation.rawResponseBytes.byteLength ||
      artifact.contentHash !==
        createHash("sha256")
          .update(observation.rawResponseBytes)
          .digest("hex") ||
      canonicalJson(artifact.provenance) !== canonicalJson(requested.provenance)
    ) {
      throw new TypeError("Staged provider catalog evidence is invalid");
    }
    await input.registration.registerArtifact(artifact);
    return new VerifiedProviderModel({
      ...identity,
      catalogArtifact: artifact,
    });
  }

  evidence(): VerifiedProviderModelData {
    return structuredClone(this.#value);
  }
}

export class ProviderModelUnavailableError extends Error {
  constructor(readonly identity: ProviderIdentity) {
    super(
      `Pinned provider model is unavailable: ${identity.provider}/${identity.modelId}`,
    );
    this.name = "ProviderModelUnavailableError";
  }
}
