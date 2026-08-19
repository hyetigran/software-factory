import { createHash } from "node:crypto";

import { assertJsonSchema } from "../../application/json-schema-validator.js";
import type {
  ProviderAdapter,
  ProviderExecution,
  ProviderRequest,
  PreparedProviderCall,
} from "../../application/provider-port.js";
import {
  assertProviderRequest,
  bytes,
  evidence,
  labeledInputs,
  objectFromBytes,
  textFromOpenAi,
} from "./common.js";
import type { HttpTransport, ProviderPreflight } from "./transport.js";

const endpoint = "https://api.openai.com/v1/responses";

export class OpenAiResponsesAdapter implements ProviderAdapter {
  constructor(
    private readonly transport: HttpTransport,
    private readonly credential: () => string,
    private readonly preflight: ProviderPreflight,
  ) {}

  prepare(request: ProviderRequest): PreparedProviderCall {
    assertProviderRequest(request, "openai", this.preflight);
    const body = {
      model: request.modelId,
      instructions: request.systemPrompt,
      input: labeledInputs(request),
      max_output_tokens: request.maxOutputTokens,
      store: request.providerStorage !== "minimize",
      text: {
        format: {
          type: "json_schema",
          name: `${request.role}_result`,
          strict: true,
          schema: request.outputSchema,
        },
      },
      ...(request.reasoning === undefined
        ? {}
        : { reasoning: { effort: request.reasoning } }),
    };
    const redactedRequestBytes = bytes({
      method: "POST",
      endpoint,
      headers: {
        "content-type": "application/json",
        "x-client-request-id": request.correlationId,
      },
      body,
    });
    return {
      redactedRequestBytes,
      normalizedRequestHash: createHash("sha256")
        .update(redactedRequestBytes)
        .digest("hex"),
      dispatch: () => this.dispatch(request, body),
    };
  }

  private async dispatch(
    request: ProviderRequest,
    body: object,
  ): Promise<ProviderExecution> {
    let response;
    try {
      response = await this.transport.send({
        url: endpoint,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.credential()}`,
          "x-client-request-id": request.correlationId,
        },
        body: bytes(body),
        timeoutMs: request.timeoutMs,
      });
    } catch (error) {
      const failure = error as { dispatched?: boolean; retryable?: boolean };
      const common = evidence({ request, endpoint, behaviorHeaders: {} });
      return {
        kind:
          failure.dispatched === true ? "unknown_outcome" : "transport_failure",
        ...(failure.dispatched === true
          ? {}
          : { retryable: failure.retryable === true }),
        evidence: common,
        recording: {},
      } as ProviderExecution;
    }
    const rawResponseBytes = Buffer.from(response.body);
    if (response.status < 200 || response.status >= 300) {
      return {
        kind:
          response.status === 404 ? "model_unavailable" : "transport_failure",
        ...(response.status === 404
          ? {}
          : { retryable: response.status === 429 || response.status >= 500 }),
        evidence: evidence({
          request,
          endpoint,
          behaviorHeaders: {},
          ...(response.headers["x-request-id"] === undefined
            ? {}
            : { providerRequestId: response.headers["x-request-id"] }),
          completionStatus: `http_${response.status}`,
        }),
        recording: { rawResponseBytes },
      } as ProviderExecution;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = objectFromBytes(rawResponseBytes);
    } catch {
      return {
        kind: "transport_failure",
        retryable: false,
        evidence: evidence({
          request,
          endpoint,
          behaviorHeaders: {},
          completionStatus: "malformed_success",
        }),
        recording: { rawResponseBytes },
      };
    }
    const common = evidence({
      request,
      endpoint,
      behaviorHeaders: {},
      returnedModel: parsed.model,
      ...(response.headers["x-request-id"] === undefined
        ? {}
        : { providerRequestId: response.headers["x-request-id"] }),
      providerResponseId: parsed.id,
      completionStatus: parsed.status,
    });
    const recording = {
      rawResponseBytes,
      ...(parsed.usage === undefined
        ? {}
        : { nativeUsageBytes: bytes(parsed.usage) }),
    };
    if (typeof parsed.model === "string" && parsed.model !== request.modelId) {
      return {
        kind: "model_mismatch",
        returnedModel: parsed.model,
        evidence: common,
        recording,
      };
    }
    const extracted = textFromOpenAi(parsed);
    if (extracted.refused) {
      return { kind: "refused", evidence: common, recording };
    }
    if (parsed.status === "incomplete") {
      const details =
        parsed.incomplete_details !== null &&
        typeof parsed.incomplete_details === "object" &&
        !Array.isArray(parsed.incomplete_details)
          ? (parsed.incomplete_details as Record<string, unknown>)
          : {};
      const reason = details.reason;
      if (
        reason === "max_output_tokens" ||
        reason === "max_tokens" ||
        reason === "context_length_exceeded"
      ) {
        return { kind: "truncated", evidence: common, recording };
      }
      if (reason === "content_filter") {
        return { kind: "refused", evidence: common, recording };
      }
      return {
        kind: "transport_failure",
        retryable: false,
        evidence: common,
        recording,
      };
    }
    if (extracted.text === undefined) {
      return {
        kind: "schema_invalid",
        raw: parsed,
        errors: ["Structured response text is missing"],
        evidence: common,
        recording,
      };
    }
    let structured: unknown;
    try {
      structured = JSON.parse(extracted.text) as unknown;
      assertJsonSchema(structured, request.outputSchema);
    } catch (error) {
      return {
        kind: "schema_invalid",
        raw: extracted.text,
        errors: [error instanceof Error ? error.message : String(error)],
        evidence: common,
        recording,
      };
    }
    return { kind: "completed", structured, evidence: common, recording };
  }
}
