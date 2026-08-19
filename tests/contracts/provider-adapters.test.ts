import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type {
  HttpTransport,
  ProviderRequest,
} from "../../src/application/provider-port.js";
import { OpenAiResponsesAdapter } from "../../src/infrastructure/providers/openai.js";
import { AnthropicMessagesAdapter } from "../../src/infrastructure/providers/anthropic.js";

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
    const adapter = new OpenAiResponsesAdapter({ send }, () => "secret");

    const result = await adapter.execute({
      ...baseRequest,
      provider: "openai",
    });

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
    expect(String(result.recording.redactedRequestBytes)).not.toContain(
      "secret",
    );
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
    const adapter = new AnthropicMessagesAdapter({ send }, () => "secret");

    const result = await adapter.execute({
      ...baseRequest,
      provider: "anthropic",
    });

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
          ? new OpenAiResponsesAdapter(transport, () => "secret")
          : new AnthropicMessagesAdapter(transport, () => "secret");
      return adapter.execute({ ...baseRequest, provider });
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
            ? new OpenAiResponsesAdapter(transport, () => "secret")
            : new AnthropicMessagesAdapter(transport, () => "secret");
        await expect(
          adapter.execute({ ...baseRequest, provider }),
        ).resolves.toMatchObject({ kind });
      }
    });
  });
});
