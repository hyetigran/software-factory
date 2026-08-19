import type {
  PreparedProviderCall,
  ProviderAdapter,
  ProviderExecution,
  ProviderRequest,
} from "../../application/provider-port.js";

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
  }): Promise<ProviderExecution | null>;
}

export class StrictReplayAdapter implements ProviderAdapter {
  constructor(
    private readonly formatter: ProviderAdapter,
    private readonly cassettes: ProviderCassetteStore,
  ) {}

  prepare(request: ProviderRequest): PreparedProviderCall {
    const prepared = this.formatter.prepare(request);
    return {
      redactedRequestBytes: prepared.redactedRequestBytes,
      normalizedRequestHash: prepared.normalizedRequestHash,
      dispatch: async () => {
        const recorded = await this.cassettes.lookup({
          provider: request.provider,
          modelId: request.modelId,
          logicalCommandKey: request.logicalCommandKey,
          normalizedRequestHash: prepared.normalizedRequestHash,
        });
        if (recorded === null) {
          throw new UnrecordedRequestError(prepared.normalizedRequestHash);
        }
        return structuredClone(recorded);
      },
    };
  }
}
