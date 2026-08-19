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

export type ResolvedConfigurationSnapshot = {
  schemaVersion: 1;
  policyHash: string;
  plannerAssignment: ProviderModelAssignment;
  reviewerAssignment: ProviderModelAssignment;
  artifactHashes: Record<string, string>;
  budgets: Record<string, number>;
  credentialReferences: Record<string, CredentialReference>;
};

const allowedKeys = new Set([
  "schemaVersion",
  "policyHash",
  "plannerAssignment",
  "reviewerAssignment",
  "artifactHashes",
  "budgets",
  "credentialReferences",
]);

function assignmentIsValid(assignment: ProviderModelAssignment): boolean {
  return (
    (assignment.provider === "openai" || assignment.provider === "anthropic") &&
    assignment.modelId.trim().length > 0
  );
}

function configurationIsValid(value: ResolvedConfigurationSnapshot): boolean {
  return (
    value.schemaVersion === 1 &&
    /^[a-f0-9]{64}$/u.test(value.policyHash) &&
    assignmentIsValid(value.plannerAssignment) &&
    assignmentIsValid(value.reviewerAssignment) &&
    Object.values(value.artifactHashes).every((hash) =>
      /^[a-f0-9]{64}$/u.test(hash),
    ) &&
    Object.values(value.budgets).every(
      (budget) => Number.isInteger(budget) && budget >= 0,
    ) &&
    Object.values(value.credentialReferences).every(
      (reference) =>
        (reference.kind === "environment" ||
          reference.kind === "os_credential_store") &&
        reference.reference.trim().length > 0,
    )
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
