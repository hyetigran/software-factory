# Provider Adapter Protocol v1

This protocol defines the behavior required from the OpenAI and Anthropic production adapters. Provider documentation changes over time; links and capability assumptions were verified on 2026-08-18.

## Common request

```ts
interface ProviderRequest {
  provider: "openai" | "anthropic";
  role: "planner" | "reviewer" | "schema_repair";
  modelId: string;
  logicalCommandKey: string;
  correlationId: string;
  systemPrompt: string;
  inputArtifacts: Array<{ kind: string; content: string; contentHash: string }>;
  outputSchema: object;
  maxOutputTokens: number;
  reasoning?: string;
  timeoutMs: number;
  providerStorage: "minimize" | "required_feature_opt_in";
}
```

The adapter rejects a request unless the model is in the pinned run allowlist, every content hash verifies, the schema is supported by the adapter's declared subset, and the request fits the provider/model context preflight.

## Common result

```ts
type ProviderResult =
  | { kind: "completed"; structured: unknown; evidence: ProviderEvidence }
  | { kind: "refused"; evidence: ProviderEvidence }
  | { kind: "truncated"; evidence: ProviderEvidence }
  | { kind: "schema_invalid"; raw: unknown; errors: unknown[]; evidence: ProviderEvidence }
  | { kind: "transport_failure"; retryable: boolean; evidence: ProviderEvidence }
  | { kind: "unknown_outcome"; evidence: ProviderEvidence };

interface ProviderEvidence {
  requestedModel: string;
  returnedModel?: string;
  endpoint: string;
  apiVersion?: string;
  behaviorHeaders: Record<string, string>;
  providerRequestId?: string;
  providerResponseId?: string;
  correlationId: string;
  rawRequestArtifactId: string;
  rawResponseArtifactId?: string;
  nativeUsageArtifactId?: string;
  completionStatus?: string;
}
```

Authorization headers and credential values are removed before request recording. Native usage is stored whole; normalized accounting is a separate projection.

## Error mapping

| Condition | Common result |
|---|---|
| Valid complete structured output | `completed` |
| Provider safety/policy refusal | `refused` |
| Maximum output or context limit reached | `truncated` |
| Complete response fails local schema validation | `schema_invalid` |
| Explicit retryable HTTP/network error before ambiguous dispatch | `transport_failure` |
| Timeout or disconnect after dispatch may have occurred | `unknown_outcome` |
| Model ID absent or retired | domain input `PinnedModelUnavailable` |

Refusal and truncation never enter blind schema repair. Adapter exceptions never bypass this mapping.

## OpenAI adapter

- Endpoint: Responses API.
- Structured output: JSON Schema through `text.format` with strict mode where supported.
- Correlation: send unique `X-Client-Request-Id`; record returned `x-request-id` and response ID.
- Storage: request `store: false` when supported unless the user explicitly enabled a storage-dependent feature.
- Usage: preserve the complete response `usage`, including cached and reasoning-token details.
- Model identity: record requested and response model IDs; a mismatch fails acceptance pending explicit diagnosis.
- Idempotency: `X-Client-Request-Id` is correlation evidence only. The adapter assumes no synchronous request deduplication guarantee.

Official references:

- https://platform.openai.com/docs/api-reference/responses
- https://platform.openai.com/docs/api-reference/debugging-requests
- https://platform.openai.com/docs/models/default-usage-policies-by-endpoint
- https://platform.openai.com/docs/api-reference/models
- https://platform.openai.com/pricing

## Anthropic adapter

- Endpoint: Messages API.
- Structured output: `output_config.format` using JSON Schema on supported models.
- Correlation: record returned `request-id` and Message ID; send the application correlation ID only through a documented safe metadata field when supported, otherwise keep it local.
- Storage: do not opt into server-side features requiring retention unless the run explicitly permits them.
- Usage: preserve the complete Message `usage`, including cache creation/read fields.
- Model identity: use canonical model IDs; record requested and returned IDs and reject unexplained mismatch.
- Idempotency: provider request IDs are correlation evidence only. The adapter assumes no synchronous request deduplication guarantee.

Official references:

- https://platform.claude.com/docs/en/api/messages/create
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- https://platform.claude.com/docs/en/api/overview
- https://platform.claude.com/docs/en/about-claude/models/overview
- https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions

## Model capability preflight

At initialization and before a first live use of a model, the adapter:

1. Queries the provider model catalog where available.
2. Confirms the exact ID exists and structured output is supported.
3. Records context and output limits as provider evidence.
4. Validates the selected schema against known provider subsets.
5. Refuses floating substitution.

A later unavailable pinned model halts the run. Updating the frontier allowlist or default assignment changes review-policy identity.

## Request construction

Instructions, schema, taxonomy, and artifact bodies occupy distinct labeled sections. Artifact bodies are encoded as untrusted data and cannot alter role, schema, tool access, network destination, or authorization.

The approved requirements ledger is the only normative requirements artifact sent to planning and review. Raw requirements may be used by deterministic coverage tooling and human review but are not sent as a second normative prompt input.

## Recording and strict replay

Before dispatch, persist the redacted exact request artifact. After response, stage the raw response and native usage before committing the attempt outcome.

The cassette key hashes provider, endpoint/API version, behavior headers, requested model, exact normalized request, output schema, prompt hashes, and policy hash.

Strict replay returns the recorded common result and evidence without initializing a network client. A miss returns `UNRECORDED_REQUEST`. A fresh invocation is called rerun and always creates a new physical attempt.

## Contract tests

Each adapter fixture suite covers completion, refusal, truncation, schema-invalid output, retryable transport failure, ambiguous timeout, unavailable model, requested/returned model mismatch, native usage preservation, secret redaction, storage minimization, cassette hit, cassette miss, and result arrival after cancellation.
