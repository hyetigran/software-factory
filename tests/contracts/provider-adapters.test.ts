import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import { canonicalJson } from "../../src/domain/canonical-json.js";

import type { ProviderRequest } from "../../src/application/provider-port.js";
import { OpenAiResponsesAdapter } from "../../src/infrastructure/providers/openai.js";
import { AnthropicMessagesAdapter } from "../../src/infrastructure/providers/anthropic.js";
import {
  StrictReplayAdapter,
  UnrecordedRequestError,
} from "../../src/infrastructure/providers/replay.js";
import type { ProviderCassetteStore } from "../../src/infrastructure/providers/replay.js";
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
      artifactId: "ledger_1",
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
        preflight: {
          canonicalModelId: "frontier-pinned",
          structuredOutput: true as const,
          contextWindowTokens: 100_000,
          maxOutputTokens: 10_000,
          inputTokens: 100,
        },
      },
      recording: {},
    };
    const resultIdentity = structuredClone(completed) as unknown as Record<
      string,
      unknown
    >;
    delete resultIdentity.recording;
    const resultHash = createHash("sha256")
      .update(canonicalJson(resultIdentity))
      .digest("hex");
    const replay = new StrictReplayAdapter(formatter, {
      lookup: vi
        .fn()
        .mockImplementation(
          (identity: Parameters<ProviderCassetteStore["lookup"]>[0]) => {
            const manifestBytes = Buffer.from(
              canonicalJson({
                schemaVersion: 1,
                ...identity,
                endpoint: "https://api.openai.com/v1/responses",
                apiVersion: null,
                behaviorHeaders: {},
                preflight: completed.evidence.preflight,
                resultHash,
                rawResponseHash: null,
                nativeUsageHash: null,
              }),
            );
            return Promise.resolve({
              manifestBytes,
              manifestContentHash: createHash("sha256")
                .update(manifestBytes)
                .digest("hex"),
              execution: completed,
            });
          },
        ),
    });
    const replayRequest = structuredClone({
      ...baseRequest,
      provider: "openai" as const,
    });
    const replayCall = replay.prepare(replayRequest);
    replayRequest.modelId = "mutated-after-prepare";
    replayRequest.correlationId = "mutated-correlation";
    await expect(replayCall.dispatch()).resolves.toMatchObject({
      structured: { plan: "recorded" },
    });
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

    const invalidNumbers = new OpenAiResponsesAdapter(
      { send },
      () => "secret",
      {
        ...preflight,
        countInputTokens: () => Number.NaN,
      },
    );
    expect(() =>
      invalidNumbers.prepare({ ...baseRequest, provider: "openai" }),
    ).toThrow("Provider request is invalid");
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

  it("dispatches immutable prepared bytes once and records timeout identity", async () => {
    const send = vi.fn<HttpTransport["send"]>().mockResolvedValue({
      status: 200,
      headers: {},
      body: Buffer.from(
        JSON.stringify({
          id: "response_immutable",
          model: "frontier-pinned",
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: '{"plan":"ok"}' }],
            },
          ],
          usage: {},
        }),
      ),
    });
    const request = structuredClone({
      ...baseRequest,
      provider: "openai" as const,
    });
    const adapter = new OpenAiResponsesAdapter(
      { send },
      () => "secret",
      preflight,
    );
    const prepared = adapter.prepare(request);
    const normalizedRequestHash = prepared.normalizedRequestHash;
    prepared.redactedRequestBytes[0] = 0;
    prepared.identity.endpoint = "https://mutated.invalid";
    expect(() => {
      Object.defineProperty(prepared, "normalizedRequestHash", {
        value: "0".repeat(64),
      });
    }).toThrow();
    (request.outputSchema as { properties: object }).properties = {};
    await expect(prepared.dispatch()).resolves.toMatchObject({
      kind: "completed",
    });
    expect(
      JSON.parse(String(send.mock.calls[0]?.[0].body)) as unknown,
    ).toMatchObject({
      text: { format: { schema: { required: ["plan"] } } },
    });
    expect(JSON.parse(String(prepared.redactedRequestBytes))).toMatchObject({
      timeoutMs: 30_000,
      preflight: { inputTokens: 100 },
    });
    expect(prepared.identity.endpoint).toBe(
      "https://api.openai.com/v1/responses",
    );
    expect(prepared.normalizedRequestHash).toBe(normalizedRequestHash);
    expect(() => prepared.dispatch()).toThrow("already been dispatched");
  });

  it("isolates Anthropic dispatch and evidence from post-prepare mutation", async () => {
    const send = vi.fn<HttpTransport["send"]>().mockResolvedValue({
      status: 200,
      headers: {},
      body: Buffer.from(
        JSON.stringify({
          id: "message_immutable",
          model: "frontier-pinned",
          stop_reason: "end_turn",
          content: [{ type: "text", text: '{"plan":"ok"}' }],
          usage: {},
        }),
      ),
    });
    const request = structuredClone({
      ...baseRequest,
      provider: "anthropic" as const,
    });
    const adapter = new AnthropicMessagesAdapter(
      { send },
      () => "secret",
      preflight,
    );
    const prepared = adapter.prepare(request);
    request.modelId = "mutated-after-prepare";
    request.timeoutMs = 1;
    (request.outputSchema as { properties: object }).properties = {};
    await expect(prepared.dispatch()).resolves.toMatchObject({
      kind: "completed",
      evidence: { requestedModel: "frontier-pinned" },
    });
    expect(send.mock.calls[0]?.[0].timeoutMs).toBe(30_000);
  });

  it("classifies only semantic model errors as unavailable", async () => {
    for (const provider of ["openai", "anthropic"] as const) {
      const unavailableBody =
        provider === "openai"
          ? { error: { code: "model_not_found", message: "missing" } }
          : {
              type: "error",
              error: {
                type: "not_found_error",
                message: "frontier-pinned was not found",
              },
            };
      for (const [body, kind] of [
        [Buffer.from(JSON.stringify(unavailableBody)), "model_unavailable"],
        [Buffer.from("gateway route missing"), "transport_failure"],
      ] as const) {
        const transport: HttpTransport = {
          send: vi.fn().mockResolvedValue({ status: 404, headers: {}, body }),
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
    }
  });

  it("rejects successful responses missing model, response ID, or usage", async () => {
    for (const provider of ["openai", "anthropic"] as const) {
      const body =
        provider === "openai"
          ? {
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: '{"plan":"ok"}' }],
                },
              ],
            }
          : {
              stop_reason: "end_turn",
              content: [{ type: "text", text: '{"plan":"ok"}' }],
            };
      const transport: HttpTransport = {
        send: vi.fn().mockResolvedValue({
          status: 200,
          headers: {},
          body: Buffer.from(JSON.stringify(body)),
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
        retryable: false,
      });
    }
  });

  it("preserves late results from both providers after cancellation", async () => {
    for (const provider of ["openai", "anthropic"] as const) {
      const responseBody =
        provider === "openai"
          ? {
              id: "response_after_cancel",
              model: "frontier-pinned",
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: '{"plan":"late"}' }],
                },
              ],
              usage: { input_tokens: 2, output_tokens: 1 },
            }
          : {
              id: "message_after_cancel",
              model: "frontier-pinned",
              stop_reason: "end_turn",
              content: [{ type: "text", text: '{"plan":"late"}' }],
              usage: { input_tokens: 2, output_tokens: 1 },
            };
      const raw = Buffer.from(JSON.stringify(responseBody));
      let resolveResponse:
        | ((value: {
            status: number;
            headers: Record<string, string>;
            body: Uint8Array;
          }) => void)
        | undefined;
      const response = new Promise<{
        status: number;
        headers: Record<string, string>;
        body: Uint8Array;
      }>((resolve) => {
        resolveResponse = resolve;
      });
      const transport: HttpTransport = { send: vi.fn(() => response) };
      const adapter =
        provider === "openai"
          ? new OpenAiResponsesAdapter(transport, () => "secret", preflight)
          : new AnthropicMessagesAdapter(transport, () => "secret", preflight);
      const pending = adapter.prepare({ ...baseRequest, provider }).dispatch();
      const attemptState = "cancelled" as const;
      resolveResponse?.({ status: 200, headers: {}, body: raw });
      const result = await pending;
      expect(attemptState).toBe("cancelled");
      expect(result.recording.rawResponseBytes).toEqual(raw);
      expect(result.recording.nativeUsageBytes).toBeDefined();
    }
  });
});
