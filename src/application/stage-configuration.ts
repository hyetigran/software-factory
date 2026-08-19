import { createHash } from "node:crypto";

import { canonicalJson } from "../domain/canonical-json.js";
import type { ProviderModelAssignment } from "../domain/index.js";
import type {
  ArtifactStagingPort,
  ArtifactRegistration,
  StagedArtifactRegistration,
} from "./artifact-port.js";

export type CredentialReference =
  | { kind: "environment"; reference: string }
  | { kind: "os_credential_store"; reference: string };

export type ResolvedArtifactPins = {
  runConfigurationSchema: string;
  requirementsSchema: string;
  artifactSchema: string;
  planSchema: string;
  reviewSchema: string;
  terminalManifestSchema: string;
  taxonomy: string;
  componentRegistry: string;
  plannerPrompt: string;
  reviewerPrompt: string;
  remediationPrompt: string;
  remediationSchema: string;
  schemaRepairPrompt: string;
  reviewPolicy: string;
  frontierAllowlist: string;
  budgetDefaults: string;
  productDefaults: string;
};

export type ProviderRequestSettings = {
  timeoutMs: number;
  reasoning: string | null;
};

export type ResolvedProviderRequestSettings = {
  planner: ProviderRequestSettings;
  reviewer: ProviderRequestSettings;
  remediation: ProviderRequestSettings;
  schemaRepair: ProviderRequestSettings;
};

export type HardCeilings = {
  calls: number;
  physicalAttempts: number;
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
  providerRequestSettings: ResolvedProviderRequestSettings;
  recordingMode: "record" | "strict_replay";
  humanActorDisplayName: string;
  providerStorage: "minimize";
  hardCeilings: HardCeilings;
  credentialReferences: Record<string, CredentialReference>;
};

export function resolvedConfigurationPolicyHash(
  value: ResolvedConfigurationSnapshot,
): string {
  const identity = structuredClone(value);
  identity.policyHash = "0".repeat(64);
  return createHash("sha256").update(canonicalJson(identity)).digest("hex");
}

const allowedKeys = new Set([
  "schemaVersion",
  "policyHash",
  "plannerAssignment",
  "reviewerAssignment",
  "artifactHashes",
  "providerRequestSettings",
  "recordingMode",
  "humanActorDisplayName",
  "providerStorage",
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
  if (!hasExactKeys(reference, ["kind", "reference"])) return false;
  if (reference.kind === "environment") {
    return /^[A-Z_][A-Z0-9_]{1,127}$/u.test(reference.reference);
  }
  return (
    reference.kind === "os_credential_store" &&
    /^service:[A-Za-z0-9._-]+\/account:[A-Za-z0-9._@-]+$/u.test(
      reference.reference,
    )
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

export function resolvedConfigurationIsValid(
  value: ResolvedConfigurationSnapshot,
): boolean {
  return (
    hasExactKeys(value, [...allowedKeys]) &&
    value.schemaVersion === 1 &&
    /^[a-f0-9]{64}$/u.test(value.policyHash) &&
    hasExactKeys(value.plannerAssignment, ["provider", "modelId"]) &&
    assignmentIsValid(value.plannerAssignment) &&
    hasExactKeys(value.reviewerAssignment, ["provider", "modelId"]) &&
    assignmentIsValid(value.reviewerAssignment) &&
    hasExactKeys(value.artifactHashes, [
      "runConfigurationSchema",
      "requirementsSchema",
      "artifactSchema",
      "planSchema",
      "reviewSchema",
      "terminalManifestSchema",
      "taxonomy",
      "componentRegistry",
      "plannerPrompt",
      "reviewerPrompt",
      "remediationPrompt",
      "remediationSchema",
      "schemaRepairPrompt",
      "reviewPolicy",
      "frontierAllowlist",
      "budgetDefaults",
      "productDefaults",
    ]) &&
    Object.values(value.artifactHashes).every((hash) =>
      /^[a-f0-9]{64}$/u.test(hash),
    ) &&
    hasExactKeys(value.providerRequestSettings, [
      "planner",
      "reviewer",
      "remediation",
      "schemaRepair",
    ]) &&
    Object.values(value.providerRequestSettings).every(
      (settings) =>
        hasExactKeys(settings, ["timeoutMs", "reasoning"]) &&
        Number.isInteger(settings.timeoutMs) &&
        settings.timeoutMs > 0 &&
        (settings.reasoning === null ||
          (typeof settings.reasoning === "string" &&
            settings.reasoning.trim().length > 0)),
    ) &&
    (value.recordingMode === "record" ||
      value.recordingMode === "strict_replay") &&
    value.humanActorDisplayName.trim().length > 0 &&
    value.providerStorage === "minimize" &&
    hasExactKeys(value.hardCeilings, [
      "calls",
      "physicalAttempts",
      "inputTokens",
      "outputTokens",
      "costUsdMicros",
      "retries",
      "repairs",
      "remediationCycles",
      "closureCycles",
    ]) &&
    Object.values(value.hardCeilings).every(Number.isInteger) &&
    value.hardCeilings.calls >= 1 &&
    value.hardCeilings.physicalAttempts >= 1 &&
    value.hardCeilings.inputTokens >= 1 &&
    value.hardCeilings.outputTokens >= 1 &&
    value.hardCeilings.costUsdMicros >= 1 &&
    value.hardCeilings.retries >= 0 &&
    value.hardCeilings.repairs >= 0 &&
    value.hardCeilings.remediationCycles >= 0 &&
    value.hardCeilings.closureCycles >= 1 &&
    hasExactKeys(value.credentialReferences, [
      ...new Set([
        value.plannerAssignment.provider,
        value.reviewerAssignment.provider,
      ]),
    ]) &&
    Object.values(value.credentialReferences).every(
      credentialReferenceIsValid,
    ) &&
    !containsCredentialMaterial(value)
  );
}

export async function stageResolvedConfiguration(
  store: ArtifactStagingPort,
  configurationInput: ResolvedConfigurationSnapshot,
  registration: Pick<ArtifactRegistration, "artifactId" | "createdBy">,
): Promise<StagedArtifactRegistration> {
  if (!resolvedConfigurationIsValid(configurationInput)) {
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
