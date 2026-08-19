import type {
  PreparedProviderCall,
  ProviderAdapter,
  ProviderExecution,
  ProviderRequest,
} from "../../application/provider-port.js";
import { assertJsonSchema } from "../../application/json-schema-validator.js";

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
    provider: ProviderRequest["provider"];
    modelId: string;
    logicalCommandKey: string;
    normalizedRequestHash: string;
    execution: ProviderExecution;
  } | null>;
}

export class StrictReplayAdapter implements ProviderAdapter {
  constructor(
    private readonly formatter: ProviderAdapter,
    private readonly cassettes: ProviderCassetteStore,
  ) {}

  prepare(request: ProviderRequest): PreparedProviderCall {
    const prepared = this.formatter.prepare(request);
    let dispatched = false;
    return {
      redactedRequestBytes: prepared.redactedRequestBytes,
      normalizedRequestHash: prepared.normalizedRequestHash,
      dispatch: async () => {
        if (dispatched) {
          throw new Error("Prepared provider call has already been dispatched");
        }
        dispatched = true;
        const recorded = await this.cassettes.lookup({
          provider: request.provider,
          modelId: request.modelId,
          logicalCommandKey: request.logicalCommandKey,
          normalizedRequestHash: prepared.normalizedRequestHash,
        });
        if (recorded === null) {
          throw new UnrecordedRequestError(prepared.normalizedRequestHash);
        }
        if (
          recorded.provider !== request.provider ||
          recorded.modelId !== request.modelId ||
          recorded.logicalCommandKey !== request.logicalCommandKey ||
          recorded.normalizedRequestHash !== prepared.normalizedRequestHash ||
          recorded.execution.evidence.requestedModel !== request.modelId ||
          recorded.execution.evidence.correlationId !== request.correlationId ||
          (recorded.execution.evidence.returnedModel !== undefined &&
            recorded.execution.evidence.returnedModel !== request.modelId)
        ) {
          throw new TypeError("Provider recording identity does not match");
        }
        if (recorded.execution.kind === "completed") {
          assertJsonSchema(recorded.execution.structured, request.outputSchema);
        }
        return structuredClone(recorded.execution);
      },
    };
  }
}
