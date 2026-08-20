export type NormalizedProviderUsage = {
  inputTokens: number;
  outputTokens: number;
};

export function normalizedProviderUsage(
  provider: "openai" | "anthropic",
  bytes: Uint8Array,
): NormalizedProviderUsage {
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new TypeError(`${provider} native usage is invalid`);
  const usage = parsed as Record<string, unknown>;
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  if (
    !Number.isInteger(inputTokens) ||
    Number(inputTokens) < 0 ||
    !Number.isInteger(outputTokens) ||
    Number(outputTokens) < 0
  )
    throw new TypeError(`${provider} native usage is invalid`);
  return {
    inputTokens: Number(inputTokens),
    outputTokens: Number(outputTokens),
  };
}
