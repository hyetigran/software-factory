import type {
  ProviderCatalogObservation,
  ProviderCatalogPort,
  ProviderIdentity,
} from "../../application/verify-provider-model.js";
import { ProviderModelUnavailableError } from "../../application/verify-provider-model.js";
import type { HttpTransport } from "./transport.js";

const anthropicVersion = "2023-06-01";

function endpoint(identity: ProviderIdentity): string {
  const id = encodeURIComponent(identity.modelId);
  return identity.provider === "openai"
    ? `https://api.openai.com/v1/models/${id}`
    : `https://api.anthropic.com/v1/models/${id}`;
}

function returnedModelId(bytes: Uint8Array): string | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const id = (value as Record<string, unknown>).id;
    return typeof id === "string" && id.trim().length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

export class HttpProviderModelCatalog implements ProviderCatalogPort {
  constructor(
    private readonly transport: HttpTransport,
    private readonly credential: (
      provider: ProviderIdentity["provider"],
    ) => string,
    private readonly timeoutMs: number,
  ) {}

  async lookup(
    identity: ProviderIdentity,
  ): Promise<ProviderCatalogObservation> {
    const credential = this.credential(identity.provider);
    const response = await this.transport.send({
      method: "GET",
      url: endpoint(identity),
      headers:
        identity.provider === "openai"
          ? { authorization: `Bearer ${credential}` }
          : {
              "x-api-key": credential,
              "anthropic-version": anthropicVersion,
            },
      body: new Uint8Array(),
      timeoutMs: this.timeoutMs,
    });
    const returned = returnedModelId(response.body);
    if (
      response.status < 200 ||
      response.status >= 300 ||
      returned !== identity.modelId
    ) {
      throw new ProviderModelUnavailableError(identity);
    }
    return {
      ...identity,
      returnedModelId: returned,
      rawResponseBytes: Buffer.from(response.body),
    };
  }
}
