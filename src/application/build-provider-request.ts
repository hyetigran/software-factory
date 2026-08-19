import { createHash } from "node:crypto";

import type { PersistableCommand } from "./authority-port.js";
import type { StartedCommandAttempt } from "./execution-port.js";
import type { ProviderRequest } from "./provider-port.js";
import { canonicalJson } from "../domain/canonical-json.js";
import { providerCommandSpecification } from "./provider-command-specification.js";

export type ProviderInputArtifact = {
  artifactId: string;
  contentHash: string;
  kind: string;
  bytes: Uint8Array;
};

function payloadInputIds(command: PersistableCommand): string[] {
  const payload = command.payload as Record<string, unknown>;
  const specification = providerCommandSpecification(command.commandType);
  if (specification === null)
    throw new TypeError("Command is not a supported provider request");
  return specification.inputArtifactFields.flatMap((field) => {
    const value = payload[field];
    if (typeof value === "string") return [value];
    if (Array.isArray(value) && value.every((item) => typeof item === "string"))
      return value;
    throw new TypeError(`Provider command artifact field is invalid: ${field}`);
  });
}

export function buildProviderRequest(input: {
  command: PersistableCommand;
  attempt: StartedCommandAttempt;
  artifacts: ProviderInputArtifact[];
}): ProviderRequest {
  const { command, attempt } = input;
  const policy = command.providerRequestPolicy;
  if (
    policy === undefined ||
    (command.provider !== "openai" && command.provider !== "anthropic") ||
    command.modelId === undefined
  )
    throw new TypeError("Provider command policy is missing");
  const byId = new Map(
    input.artifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  const required = (artifactId: string): ProviderInputArtifact => {
    const artifact = byId.get(artifactId);
    if (artifact === undefined)
      throw new TypeError(`Provider input artifact is missing: ${artifactId}`);
    return artifact;
  };
  const prompt = required(policy.promptArtifactId);
  const schema = required(policy.outputSchemaArtifactId);
  const prerequisiteIds = attempt.resolvedPrerequisiteArtifacts.map(
    ({ artifactId }) => artifactId,
  );
  const inputIds = [
    ...new Set([...payloadInputIds(command), ...prerequisiteIds]),
  ].filter(
    (artifactId) =>
      artifactId !== policy.promptArtifactId &&
      artifactId !== policy.outputSchemaArtifactId,
  );
  const artifacts = inputIds.map(required);
  for (const artifact of [prompt, schema, ...artifacts]) {
    const actualHash = createHash("sha256")
      .update(artifact.bytes)
      .digest("hex");
    if (actualHash !== artifact.contentHash)
      throw new TypeError(
        "Provider input artifact bytes do not match their hash",
      );
  }
  const actualHashes = [
    prompt.contentHash,
    schema.contentHash,
    ...artifacts.map(({ contentHash }) => contentHash),
  ].sort();
  const expectedHashes = [
    ...command.inputArtifactHashes,
    ...attempt.resolvedPrerequisiteArtifacts.map(
      ({ contentHash }) => contentHash,
    ),
  ].sort();
  if (
    new Set(inputIds).size !== inputIds.length ||
    actualHashes.length !== expectedHashes.length ||
    actualHashes.some((hash, index) => hash !== expectedHashes[index]) ||
    prompt.contentHash !== policy.promptContentHash ||
    schema.contentHash !== policy.outputSchemaContentHash
  )
    throw new TypeError("Provider request artifacts do not match the command");
  const outputSchema: unknown = JSON.parse(
    Buffer.from(schema.bytes).toString("utf8"),
  );
  if (
    outputSchema === null ||
    typeof outputSchema !== "object" ||
    Array.isArray(outputSchema)
  )
    throw new TypeError("Provider output schema must be an object");
  return {
    provider: command.provider,
    role: policy.role,
    modelId: command.modelId,
    logicalCommandKey: command.commandKey,
    correlationId: attempt.correlationId,
    systemPromptArtifactId: prompt.artifactId,
    systemPromptContentHash: prompt.contentHash,
    systemPrompt: Buffer.from(prompt.bytes).toString("utf8"),
    inputArtifacts: artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      content: Buffer.from(artifact.bytes).toString("utf8"),
      contentHash: artifact.contentHash,
    })),
    outputSchema: JSON.parse(canonicalJson(outputSchema)) as object,
    outputSchemaArtifactId: schema.artifactId,
    outputSchemaContentHash: schema.contentHash,
    outputSchemaCanonicalHash: createHash("sha256")
      .update(canonicalJson(outputSchema))
      .digest("hex"),
    maxOutputTokens: policy.maxOutputTokens,
    ...(policy.reasoning === null ? {} : { reasoning: policy.reasoning }),
    timeoutMs: policy.timeoutMs,
    providerStorage: policy.providerStorage,
  };
}
