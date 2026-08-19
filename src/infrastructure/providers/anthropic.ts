import { assertJsonSchema } from "../../application/json-schema-validator.js";
import type {
  HttpTransport,
  ProviderAdapter,
  ProviderExecution,
  ProviderRequest,
} from "../../application/provider-port.js";
import {
  assertProviderRequest,
  bytes,
  evidence,
  labeledInputs,
  objectFromBytes,
} from "./common.js";

const endpoint = "https://api.anthropic.com/v1/messages";
const apiVersion = "2023-06-01";

export class AnthropicMessagesAdapter implements ProviderAdapter {
  constructor(
    private readonly transport: HttpTransport,
    private readonly credential: () => string,
  ) {}

  async execute(request: ProviderRequest): Promise<ProviderExecution> {
    assertProviderRequest(request, "anthropic");
    const body = {
      model: request.modelId,
      max_tokens: request.maxOutputTokens,
      system: request.systemPrompt,
      messages: [{ role: "user", content: labeledInputs(request) }],
      output_config: {
        format: { type: "json_schema", schema: request.outputSchema },
        ...(request.reasoning === undefined
          ? {}
          : { effort: request.reasoning }),
      },
    };
    const visibleHeaders = {
      "content-type": "application/json",
      "anthropic-version": apiVersion,
    };
    const redactedRequestBytes = bytes({
      method: "POST",
      endpoint,
      headers: visibleHeaders,
      body,
    });
    let response;
    try {
      response = await this.transport.send({
        url: endpoint,
        headers: { ...visibleHeaders, "x-api-key": this.credential() },
        body: bytes(body),
        timeoutMs: request.timeoutMs,
      });
    } catch (error) {
      const failure = error as { dispatched?: boolean; retryable?: boolean };
      const common = evidence({
        request,
        endpoint,
        apiVersion,
        behaviorHeaders: { "anthropic-version": apiVersion },
      });
      return {
        kind:
          failure.dispatched === true ? "unknown_outcome" : "transport_failure",
        ...(failure.dispatched === true
          ? {}
          : { retryable: failure.retryable === true }),
        evidence: common,
        recording: { redactedRequestBytes },
      } as ProviderExecution;
    }
    const rawResponseBytes = Buffer.from(response.body);
    const parsed = objectFromBytes(rawResponseBytes);
    const common = evidence({
      request,
      endpoint,
      apiVersion,
      behaviorHeaders: { "anthropic-version": apiVersion },
      returnedModel: parsed.model,
      ...(response.headers["request-id"] === undefined
        ? {}
        : { providerRequestId: response.headers["request-id"] }),
      providerResponseId: parsed.id,
      completionStatus: parsed.stop_reason,
    });
    const recording = {
      redactedRequestBytes,
      rawResponseBytes,
      ...(parsed.usage === undefined
        ? {}
        : { nativeUsageBytes: bytes(parsed.usage) }),
    };
    if (response.status < 200 || response.status >= 300) {
      return {
        kind: "transport_failure",
        retryable: response.status === 429 || response.status >= 500,
        evidence: common,
        recording,
      };
    }
    if (typeof parsed.model === "string" && parsed.model !== request.modelId) {
      return {
        kind: "model_mismatch",
        returnedModel: parsed.model,
        evidence: common,
        recording,
      };
    }
    if (parsed.stop_reason === "refusal") {
      return { kind: "refused", evidence: common, recording };
    }
    if (
      parsed.stop_reason === "max_tokens" ||
      parsed.stop_reason === "model_context_window_exceeded"
    ) {
      return { kind: "truncated", evidence: common, recording };
    }
    const content = Array.isArray(parsed.content) ? parsed.content : [];
    const text = content
      .filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      )
      .filter(
        ({ type, text: value }) => type === "text" && typeof value === "string",
      )
      .map(({ text: value }) => value as string)
      .join("");
    let structured: unknown;
    try {
      structured = JSON.parse(text) as unknown;
      assertJsonSchema(structured, request.outputSchema);
    } catch (error) {
      return {
        kind: "schema_invalid",
        raw: text,
        errors: [error instanceof Error ? error.message : String(error)],
        evidence: common,
        recording,
      };
    }
    return { kind: "completed", structured, evidence: common, recording };
  }
}
