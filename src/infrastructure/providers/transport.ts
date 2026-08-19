import type { ProviderRequest } from "../../application/provider-port.js";

export type HttpTransportRequest = {
  method?: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
  timeoutMs: number;
};

export type HttpTransportResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
};

export interface HttpTransport {
  send(request: HttpTransportRequest): Promise<HttpTransportResponse>;
}

export type ProviderModelCapability = {
  canonicalModelId: string;
  structuredOutput: boolean;
  contextWindowTokens: number;
  maxOutputTokens: number;
};

export interface ProviderPreflight {
  resolve(request: ProviderRequest): ProviderModelCapability | null;
  schemaSupported(
    provider: ProviderRequest["provider"],
    schema: object,
  ): boolean;
  countInputTokens(request: ProviderRequest): number;
}
