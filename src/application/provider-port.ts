export type ProviderRequest = {
  provider: "openai" | "anthropic";
  role: "planner" | "reviewer" | "schema_repair";
  modelId: string;
  logicalCommandKey: string;
  correlationId: string;
  systemPrompt: string;
  inputArtifacts: Array<{
    kind: string;
    content: string;
    contentHash: string;
  }>;
  outputSchema: object;
  maxOutputTokens: number;
  reasoning?: string;
  timeoutMs: number;
  providerStorage: "minimize" | "required_feature_opt_in";
};

export type ProviderEvidence = {
  requestedModel: string;
  returnedModel?: string;
  endpoint: string;
  apiVersion?: string;
  behaviorHeaders: Record<string, string>;
  providerRequestId?: string;
  providerResponseId?: string;
  correlationId: string;
  completionStatus?: string;
};

export type ProviderResult =
  | { kind: "completed"; structured: unknown; evidence: ProviderEvidence }
  | { kind: "refused"; evidence: ProviderEvidence }
  | { kind: "truncated"; evidence: ProviderEvidence }
  | {
      kind: "schema_invalid";
      raw: unknown;
      errors: unknown[];
      evidence: ProviderEvidence;
    }
  | {
      kind: "transport_failure";
      retryable: boolean;
      evidence: ProviderEvidence;
    }
  | { kind: "unknown_outcome"; evidence: ProviderEvidence }
  | { kind: "model_unavailable"; evidence: ProviderEvidence }
  | {
      kind: "model_mismatch";
      returnedModel: string;
      evidence: ProviderEvidence;
    };

export type ProviderRecording = {
  rawResponseBytes?: Uint8Array;
  nativeUsageBytes?: Uint8Array;
};

export type ProviderExecution = ProviderResult & {
  recording: ProviderRecording;
};

export type PreparedProviderCall = {
  redactedRequestBytes: Uint8Array;
  normalizedRequestHash: string;
  dispatch(): Promise<ProviderExecution>;
};

export interface ProviderAdapter {
  prepare(request: ProviderRequest): PreparedProviderCall;
}
