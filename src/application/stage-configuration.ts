import { canonicalJson } from "../domain/canonical-json.js";
import type { ProviderModelAssignment } from "../domain/index.js";
import type {
  ArtifactRegistration,
  ContentAddressedArtifactStore,
  StagedArtifactDescriptor,
} from "../infrastructure/artifacts/object-store.js";

export type CredentialReference =
  | { kind: "environment"; reference: string }
  | { kind: "os_credential_store"; reference: string };

export type ResolvedArtifactPins = {
  requirementsSchema: string;
  artifactSchema: string;
  planSchema: string;
  reviewSchema: string;
  taxonomy: string;
  componentRegistry: string;
  plannerPrompt: string;
  reviewerPrompt: string;
  reviewPolicy: string;
};

export type HardCeilings = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
  retries: number;
  repairs: number;
  remediationCycles: number;
  closureCycles: number;
};

export type ResolvedConfigurationSnapshot = {
  schemaVersion: 1;
  policyHash: string;
  plannerAssignment: ProviderModelAssignment;
  reviewerAssignment: ProviderModelAssignment;
  artifactHashes: ResolvedArtifactPins;
  hardCeilings: HardCeilings;
  credentialReferences: Record<string, CredentialReference>;
};

const allowedKeys = new Set([
  "schemaVersion",
  "policyHash",
  "plannerAssignment",
  "reviewerAssignment",
  "artifactHashes",
  "hardCeilings",
  "credentialReferences",
]);

function assignmentIsValid(assignment: ProviderModelAssignment): boolean {
  return (
    (assignment.provider === "openai" || assignment.provider === "anthropic") &&
    assignment.modelId.trim().length > 0
  );
}

function hasExactKeys(value: unknown, keys: string[]): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function credentialReferenceIsValid(reference: CredentialReference): boolean {
  return hasExactKeys(reference, ["kind", "reference"]) &&
    reference.kind === "environment"
    ? /^[A-Z_][A-Z0-9_]{1,127}$/u.test(reference.reference)
    : reference.kind === "os_credential_store" &&
        /^service:[A-Za-z0-9._-]+\/account:[A-Za-z0-9._@-]+$/u.test(
          reference.reference,
        );
}

const secretValuePattern =
  /(?:sk-(?:ant-)?[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._-]+)/iu;
const sensitiveKeyPattern =
  /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|authorization)$/iu;

function containsCredentialMaterial(value: unknown): boolean {
  if (typeof value === "string") return secretValuePattern.test(value);
  if (Array.isArray(value)) return value.some(containsCredentialMaterial);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      sensitiveKeyPattern.test(key) || containsCredentialMaterial(nested),
  );
}

function configurationIsValid(value: ResolvedConfigurationSnapshot): boolean {
  return (
    value.schemaVersion === 1 &&
    /^[a-f0-9]{64}$/u.test(value.policyHash) &&
    hasExactKeys(value.plannerAssignment, ["provider", "modelId"]) &&
    assignmentIsValid(value.plannerAssignment) &&
    hasExactKeys(value.reviewerAssignment, ["provider", "modelId"]) &&
    assignmentIsValid(value.reviewerAssignment) &&
    hasExactKeys(value.artifactHashes, [
      "requirementsSchema",
      "artifactSchema",
      "planSchema",
      "reviewSchema",
      "taxonomy",
      "componentRegistry",
      "plannerPrompt",
      "reviewerPrompt",
      "reviewPolicy",
    ]) &&
    Object.values(value.artifactHashes).every((hash) =>
      /^[a-f0-9]{64}$/u.test(hash),
    ) &&
    hasExactKeys(value.hardCeilings, [
      "calls",
      "inputTokens",
      "outputTokens",
      "costUsdMicros",
      "retries",
      "repairs",
      "remediationCycles",
      "closureCycles",
    ]) &&
    Object.values(value.hardCeilings).every(
      (budget) => Number.isInteger(budget) && budget >= 0,
    ) &&
    Object.values(value.credentialReferences).every(
      credentialReferenceIsValid,
    ) &&
    !containsCredentialMaterial(value)
  );
}

export async function stageResolvedConfiguration(
  store: ContentAddressedArtifactStore,
  configurationInput: ResolvedConfigurationSnapshot,
  registration: Pick<ArtifactRegistration, "artifactId" | "createdBy">,
): Promise<StagedArtifactDescriptor> {
  const runtimeConfiguration = configurationInput as unknown as Record<
    string,
    unknown
  >;
  if (
    Object.keys(runtimeConfiguration).some((key) => !allowedKeys.has(key)) ||
    !configurationIsValid(configurationInput)
  ) {
    throw new TypeError(
      "Resolved configuration must be complete, valid, and secret-free",
    );
  }

  return store.stageArtifact(
    Buffer.from(canonicalJson(configurationInput), "utf8"),
    {
      artifactId: registration.artifactId,
      kind: "other",
      mediaType: "application/json",
      schemaId: "software-factory/resolved-configuration.v1",
      createdBy: registration.createdBy,
      provenance: { method: "human_submitted" },
    },
  );
}
