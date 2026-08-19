export function structuredTextFromProviderResponse(
  provider: "openai" | "anthropic",
  response: Record<string, unknown>,
): string | undefined {
  const blocks: unknown[] =
    provider === "openai"
      ? Array.isArray(response.output)
        ? response.output.flatMap((item) => {
            if (
              item === null ||
              typeof item !== "object" ||
              Array.isArray(item)
            ) {
              return [];
            }
            const content = (item as Record<string, unknown>).content;
            return Array.isArray(content) ? (content as unknown[]) : [];
          })
        : []
      : Array.isArray(response.content)
        ? (response.content as unknown[])
        : [];
  const expectedType = provider === "openai" ? "output_text" : "text";
  const texts = blocks
    .filter(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === "object" && !Array.isArray(item),
    )
    .filter(
      ({ type, text }) => type === expectedType && typeof text === "string",
    )
    .map(({ text }) => text as string);
  return texts.length === 0 ? undefined : texts.join("");
}
