export const artifactKinds = [
  "raw_requirements",
  "requirements_ledger",
  "coverage_report",
  "structured_plan",
  "rendered_plan",
  "external_edit",
  "review",
  "provider_request",
  "provider_response",
  "native_usage",
  "terminal_manifest",
  "terminal_report",
  "backup_manifest",
  "other",
] as const;

export type ArtifactKind = (typeof artifactKinds)[number];

export type ArtifactProvenance =
  | { method: "copied"; sourcePath: string }
  | { method: "packaged"; packagePath: string; packageVersion: string }
  | { method: "human_submitted"; sourceArtifactIds?: string[] }
  | { method: "resolved_configuration"; sourceArtifactIds: string[] }
  | {
      method: "provider_generated";
      sourceArtifactIds: string[];
      commandId: string;
      attemptId: string;
    }
  | {
      method: "application_generated";
      purpose:
        | "provider_request"
        | "structured_provider_output"
        | "provider_failure_evidence"
        | "ledger_validation"
        | "local_usage"
        | "terminal_policy_decision"
        | "terminal_budget_report"
        | "terminal_failure_diagnostic";
      sourceArtifactIds: string[];
      commandId: string;
      attemptId: string;
    }
  | {
      method: "deterministic_render";
      sourceArtifactIds: string[];
      commandId: string;
    }
  | {
      method: "external_edit";
      sourceArtifactIds: string[];
      expectedContentHash: string;
    }
  | { method: "exported"; sourceArtifactIds: string[] };

export type ArtifactRegistration = {
  artifactId: string;
  kind: ArtifactKind;
  mediaType: string;
  schemaId?: string;
  createdBy: string;
  provenance: ArtifactProvenance;
};

export type StagedArtifactRegistration = ArtifactRegistration & {
  schemaVersion: 1;
  contentHash: string;
  byteLength: number;
};

export interface ArtifactStagingPort {
  stageArtifact(
    bytes: Uint8Array,
    registration: ArtifactRegistration,
  ): Promise<StagedArtifactRegistration>;
}

export interface ArtifactRegistrationPort {
  registerArtifact(descriptor: StagedArtifactRegistration): Promise<void>;
}

export interface ArtifactBatchRegistrationPort extends ArtifactRegistrationPort {
  registerArtifacts(descriptors: StagedArtifactRegistration[]): Promise<void>;
}

function exactKeys(value: object, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function identifiers(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    new Set(value).size === value.length &&
    value.every((entry) => typeof entry === "string" && entry.trim().length > 0)
  );
}

export function artifactRegistrationIsValid(
  registration: ArtifactRegistration,
): boolean {
  const provenance = registration.provenance;
  const provenanceValid = (() => {
    switch (provenance.method) {
      case "copied":
        return (
          exactKeys(provenance, ["method", "sourcePath"]) &&
          provenance.sourcePath.trim().length > 0
        );
      case "packaged":
        return (
          exactKeys(provenance, ["method", "packagePath", "packageVersion"]) &&
          provenance.packagePath.trim().length > 0 &&
          provenance.packageVersion.trim().length > 0
        );
      case "resolved_configuration":
        return (
          exactKeys(provenance, ["method", "sourceArtifactIds"]) &&
          identifiers(provenance.sourceArtifactIds)
        );
      case "human_submitted":
        return (
          exactKeys(
            provenance,
            provenance.sourceArtifactIds === undefined
              ? ["method"]
              : ["method", "sourceArtifactIds"],
          ) &&
          (provenance.sourceArtifactIds === undefined ||
            identifiers(provenance.sourceArtifactIds))
        );
      case "provider_generated":
        return (
          exactKeys(provenance, [
            "method",
            "sourceArtifactIds",
            "commandId",
            "attemptId",
          ]) &&
          identifiers(provenance.sourceArtifactIds) &&
          provenance.commandId.trim().length > 0 &&
          provenance.attemptId.trim().length > 0
        );
      case "application_generated":
        return (
          exactKeys(provenance, [
            "method",
            "purpose",
            "sourceArtifactIds",
            "commandId",
            "attemptId",
          ]) &&
          [
            "provider_request",
            "structured_provider_output",
            "provider_failure_evidence",
            "ledger_validation",
            "local_usage",
          ].includes(provenance.purpose) &&
          identifiers(provenance.sourceArtifactIds) &&
          provenance.commandId.trim().length > 0 &&
          provenance.attemptId.trim().length > 0
        );
      case "deterministic_render":
        return (
          exactKeys(provenance, ["method", "sourceArtifactIds", "commandId"]) &&
          identifiers(provenance.sourceArtifactIds) &&
          provenance.commandId.trim().length > 0
        );
      case "external_edit":
        return (
          exactKeys(provenance, [
            "method",
            "sourceArtifactIds",
            "expectedContentHash",
          ]) &&
          identifiers(provenance.sourceArtifactIds) &&
          /^[a-f0-9]{64}$/u.test(provenance.expectedContentHash)
        );
      case "exported":
        return (
          exactKeys(provenance, ["method", "sourceArtifactIds"]) &&
          identifiers(provenance.sourceArtifactIds)
        );
    }
  })();
  return (
    /^[A-Za-z][A-Za-z0-9_-]{2,127}$/u.test(registration.artifactId) &&
    (artifactKinds as readonly string[]).includes(registration.kind) &&
    registration.mediaType.trim().length > 0 &&
    registration.createdBy.trim().length > 0 &&
    provenanceValid
  );
}
