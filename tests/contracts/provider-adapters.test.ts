import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ProviderRequest } from "../../src/application/provider-port.js";
import { OpenAiResponsesAdapter } from "../../src/infrastructure/providers/openai.js";
import { AnthropicMessagesAdapter } from "../../src/infrastructure/providers/anthropic.js";
import {
  StrictReplayAdapter,
  UnrecordedRequestError,
} from "../../src/infrastructure/providers/replay.js";
import type {
  HttpTransport,
  ProviderPreflight,
} from "../../src/infrastructure/providers/transport.js";

const inputContent = '{"requirements":["traceability"]}';
const baseRequest: Omit<ProviderRequest, "provider"> = {
  role: "planner",
  modelId: "frontier-pinned",
  logicalCommandKey: "a".repeat(64),
  correlationId: "correlation_1",
  systemPrompt: "Produce a plan.",
  inputArtifacts: [
    {
      kind: "requirements_ledger",
      content: inputContent,
      contentHash: createHash("sha256").update(inputContent).digest("hex"),
    },
  ],
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["plan"],
    properties: { plan: { type: "string" } },
  },
  maxOutputTokens: 2048,
  timeoutMs: 30_000,
  providerStorage: "minimize",
};

const preflight: ProviderPreflight = {
  resolve: (request) => ({
    canonicalModelId: request.modelId,
    structuredOutput: true,
    contextWindowTokens: 100_000,
    maxOutputTokens: 10_000,
  }),
  schemaSupported: () => true,
  countInputTokens: () => 100,
};

describe("provider adapter contract", () => {
  it("maps an OpenAI structured response and preserves native evidence", async () => {
    const send = vi.fn<HttpTransport["send"]>().mockResolvedValue({
      status: 200,
      headers: { "x-request-id": "req_openai" },
      body: Buffer.from(
        JSON.stringify({
          id: "resp_openai",
          model: "frontier-pinned",
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: '{"plan":"ok"}' }],
            },
          ],
          usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
        }),
      ),
    });
    const adapter = new OpenAiResponsesAdapter(
      { send },
      () => "secret",
      preflight,
    );

    const prepared = adapter.prepare({
      ...baseRequest,
      provider: "openai",
    });
    expect(send).not.toHaveBeenCalled();
    const result = await prepared.dispatch();

    expect(result).toMatchObject({
      kind: "completed",
      structured: { plan: "ok" },
      evidence: {
        requestedModel: "frontier-pinned",
        returnedModel: "frontier-pinned",
        providerRequestId: "req_openai",
        providerResponseId: "resp_openai",
      },
    });
    expect(JSON.parse(String(send.mock.calls[0]?.[0].body))).toMatchObject({
      model: "frontier-pinned",
      store: false,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(String(prepared.redactedRequestBytes)).not.toContain("secret");
    expect(JSON.parse(String(result.recording.nativeUsageBytes))).toEqual({
      input_tokens: 12,
      output_tokens: 4,
      total_tokens: 16,
    });
  });

  it("maps an Anthropic structured response and preserves request-id", async () => {
    const send = vi.fn<HttpTransport["send"]>().mockResolvedValue({
      status: 200,
      headers: { "request-id": "req_anthropic" },
      body: Buffer.from(
        JSON.stringify({
          id: "msg_anthropic",
          type: "message",
          model: "frontier-pinned",
          stop_reason: "end_turn",
          content: [{ type: "text", text: '{"plan":"ok"}' }],
          usage: {
            input_tokens: 10,
            output_tokens: 3,
            cache_creation_input_tokens: 2,
            cache_read_input_tokens: 1,
          },
        }),
      ),
    });
    const adapter = new AnthropicMessagesAdapter(
      { send },
      () => "secret",
      preflight,
    );

    const prepared = adapter.prepare({
      ...baseRequest,
      provider: "anthropic",
    });
    expect(send).not.toHaveBeenCalled();
    const result = await prepared.dispatch();

    expect(result).toMatchObject({
      kind: "completed",
      structured: { plan: "ok" },
      evidence: {
        providerRequestId: "req_anthropic",
        providerResponseId: "msg_anthropic",
      },
    });
    expect(JSON.parse(String(send.mock.calls[0]?.[0].body))).toMatchObject({
      model: "frontier-pinned",
      output_config: { format: { type: "json_schema" } },
    });
    expect(send.mock.calls[0]?.[0].headers["anthropic-version"]).toBe(
      "2023-06-01",
    );
  });

  describe.each(["openai", "anthropic"] as const)("%s outcomes", (provider) => {
    function executeResponse(body: object, status = 200) {
      const transport: HttpTransport = {
        send: vi.fn().mockResolvedValue({
          status,
          headers: {},
          body: Buffer.from(JSON.stringify(body)),
        }),
      };
      const adapter =
        provider === "openai"
          ? new OpenAiResponsesAdapter(transport, () => "secret", preflight)
          : new AnthropicMessagesAdapter(transport, () => "secret", preflight);
      return adapter.prepare({ ...baseRequest, provider }).dispatch();
    }

    it("classifies refusal, truncation, schema failure, and model drift", async () => {
      const refusal =
        provider === "openai"
          ? {
              id: "response_refused",
              model: "frontier-pinned",
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "refusal", refusal: "no" }],
                },
              ],
              usage: {},
            }
          : {
              id: "message_refused",
              model: "frontier-pinned",
              stop_reason: "refusal",
              content: [],
              usage: {},
            };
      await expect(executeResponse(refusal)).resolves.toMatchObject({
        kind: "refused",
      });

      const truncated =
        provider === "openai"
          ? {
              id: "response_short",
              model: "frontier-pinned",
              status: "incomplete",
              incomplete_details: { reason: "max_output_tokens" },
              output: [],
              usage: {},
            }
          : {
              id: "message_short",
              model: "frontier-pinned",
              stop_reason: "max_tokens",
              content: [],
              usage: {},
            };
      await expect(executeResponse(truncated)).resolves.toMatchObject({
        kind: "truncated",
      });

      const invalid =
        provider === "openai"
          ? {
              id: "response_invalid",
              model: "frontier-pinned",
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "{}" }],
                },
              ],
              usage: {},
            }
          : {
              id: "message_invalid",
              model: "frontier-pinned",
              stop_reason: "end_turn",
              content: [{ type: "text", text: "{}" }],
              usage: {},
            };
      await expect(executeResponse(invalid)).resolves.toMatchObject({
        kind: "schema_invalid",
      });

      const mismatch =
        provider === "openai"
          ? {
              id: "response_drift",
              model: "different-model",
              status: "completed",
              output: [],
              usage: {},
            }
          : {
              id: "message_drift",
              model: "different-model",
              stop_reason: "end_turn",
              content: [],
              usage: {},
            };
      await expect(executeResponse(mismatch)).resolves.toMatchObject({
        kind: "model_mismatch",
        returnedModel: "different-model",
      });
    });

    it("distinguishes retryable pre-dispatch failure from unknown outcome", async () => {
      const retryable = Object.assign(new Error("connect failed"), {
        dispatched: false,
        retryable: true,
      });
      const unknown = Object.assign(new Error("socket closed"), {
        dispatched: true,
        retryable: false,
      });
      for (const [error, kind] of [
        [retryable, "transport_failure"],
        [unknown, "unknown_outcome"],
      ] as const) {
        const transport: HttpTransport = {
          send: vi.fn().mockRejectedValue(error),
        };
        const adapter =
          provider === "openai"
            ? new OpenAiResponsesAdapter(transport, () => "secret", preflight)
            : new AnthropicMessagesAdapter(
                transport,
                () => "secret",
                preflight,
              );
        await expect(
          adapter.prepare({ ...baseRequest, provider }).dispatch(),
        ).resolves.toMatchObject({ kind });
      }
    });
  });

  it("strict replay returns a matching cassette without live HTTP", async () => {
    const send = vi.fn<HttpTransport["send"]>();
    const formatter = new OpenAiResponsesAdapter(
      { send },
      () => "secret",
      preflight,
    );
    const completed = {
      kind: "completed" as const,
      structured: { plan: "recorded" },
      evidence: {
        requestedModel: "frontier-pinned",
        endpoint: "https://api.openai.com/v1/responses",
        behaviorHeaders: {},
        correlationId: "correlation_1",
      },
      recording: {},
    };
    const replay = new StrictReplayAdapter(formatter, {
      lookup: vi.fn().mockResolvedValue(completed),
    });
    await expect(
      replay.prepare({ ...baseRequest, provider: "openai" }).dispatch(),
    ).resolves.toMatchObject({ structured: { plan: "recorded" } });
    expect(send).not.toHaveBeenCalled();

    const miss = new StrictReplayAdapter(formatter, {
      lookup: vi.fn().mockResolvedValue(null),
    });
    await expect(
      miss.prepare({ ...baseRequest, provider: "openai" }).dispatch(),
    ).rejects.toBeInstanceOf(UnrecordedRequestError);
  });

  it("rejects unsupported capability before constructing a live call", () => {
    const send = vi.fn<HttpTransport["send"]>();
    const adapter = new OpenAiResponsesAdapter({ send }, () => "secret", {
      ...preflight,
      resolve: () => null,
    });
    expect(() =>
      adapter.prepare({ ...baseRequest, provider: "openai" }),
    ).toThrow("Provider request is invalid");
    expect(send).not.toHaveBeenCalled();
  });

  it("maps arbitrary HTTP failures before attempting JSON decoding", async () => {
    for (const provider of ["openai", "anthropic"] as const) {
      const transport: HttpTransport = {
        send: vi.fn().mockResolvedValue({
          status: 502,
          headers: {},
          body: Buffer.from("upstream unavailable"),
        }),
      };
      const adapter =
        provider === "openai"
          ? new OpenAiResponsesAdapter(transport, () => "secret", preflight)
          : new AnthropicMessagesAdapter(transport, () => "secret", preflight);
      await expect(
        adapter.prepare({ ...baseRequest, provider }).dispatch(),
      ).resolves.toMatchObject({
        kind: "transport_failure",
        retryable: true,
      });
    }
  });
});
