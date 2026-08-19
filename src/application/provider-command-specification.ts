type ProviderCommandType =
  | "generate_plan"
  | "baseline_review"
  | "generate_remediation"
  | "closure_review";

type Specification = {
  exactFields: readonly string[];
  stringFields: readonly string[];
  inputArtifactFields: readonly string[];
  stringSetFields?: readonly string[];
  allowsEmptySetFields?: readonly string[];
  requiresIndependence?: boolean;
};

const specifications: Record<ProviderCommandType, Specification> = {
  generate_plan: {
    exactFields: [
      "ledgerVersionId",
      "ledgerArtifactId",
      "promptArtifactId",
      "outputSchemaArtifactId",
      "providerStorage",
    ],
    stringFields: [
      "ledgerVersionId",
      "ledgerArtifactId",
      "promptArtifactId",
      "outputSchemaArtifactId",
    ],
    inputArtifactFields: ["ledgerArtifactId"],
  },
  baseline_review: {
    exactFields: [
      "ledgerVersionId",
      "ledgerArtifactId",
      "planVersionId",
      "planArtifactId",
      "renderPlanCommandId",
      "reviewerPromptArtifactId",
      "reviewSchemaArtifactId",
      "taxonomyArtifactId",
      "componentRegistryArtifactId",
      "reviewPolicyArtifactId",
      "evidenceArtifactIds",
      "independence",
      "providerStorage",
    ],
    stringFields: [
      "ledgerVersionId",
      "ledgerArtifactId",
      "planVersionId",
      "planArtifactId",
      "renderPlanCommandId",
      "reviewerPromptArtifactId",
      "reviewSchemaArtifactId",
      "taxonomyArtifactId",
      "componentRegistryArtifactId",
      "reviewPolicyArtifactId",
    ],
    inputArtifactFields: [
      "ledgerArtifactId",
      "planArtifactId",
      "taxonomyArtifactId",
      "componentRegistryArtifactId",
      "reviewPolicyArtifactId",
      "evidenceArtifactIds",
    ],
    stringSetFields: ["evidenceArtifactIds"],
    requiresIndependence: true,
  },
  generate_remediation: {
    exactFields: [
      "ledgerVersionId",
      "ledgerArtifactId",
      "planVersionId",
      "planArtifactId",
      "reviewArtifactId",
      "renderedPlanArtifactId",
      "taxonomyArtifactId",
      "componentRegistryArtifactId",
      "reviewPolicyArtifactId",
      "evidenceArtifactIds",
      "promptArtifactId",
      "outputSchemaArtifactId",
      "blockingFindingIds",
      "providerStorage",
    ],
    stringFields: [
      "ledgerVersionId",
      "ledgerArtifactId",
      "planVersionId",
      "planArtifactId",
      "reviewArtifactId",
      "renderedPlanArtifactId",
      "taxonomyArtifactId",
      "componentRegistryArtifactId",
      "reviewPolicyArtifactId",
      "promptArtifactId",
      "outputSchemaArtifactId",
    ],
    inputArtifactFields: [
      "ledgerArtifactId",
      "planArtifactId",
      "reviewArtifactId",
      "renderedPlanArtifactId",
      "taxonomyArtifactId",
      "componentRegistryArtifactId",
      "reviewPolicyArtifactId",
      "evidenceArtifactIds",
    ],
    stringSetFields: ["evidenceArtifactIds", "blockingFindingIds"],
  },
  closure_review: {
    exactFields: [
      "ledgerVersionId",
      "ledgerArtifactId",
      "planVersionId",
      "planArtifactId",
      "baselineReviewArtifactId",
      "renderedPlanArtifactId",
      "reviewerPromptArtifactId",
      "reviewSchemaArtifactId",
      "taxonomyArtifactId",
      "componentRegistryArtifactId",
      "reviewPolicyArtifactId",
      "evidenceArtifactIds",
      "findingIds",
      "independence",
      "providerStorage",
    ],
    stringFields: [
      "ledgerVersionId",
      "ledgerArtifactId",
      "planVersionId",
      "planArtifactId",
      "baselineReviewArtifactId",
      "renderedPlanArtifactId",
      "reviewerPromptArtifactId",
      "reviewSchemaArtifactId",
      "taxonomyArtifactId",
      "componentRegistryArtifactId",
      "reviewPolicyArtifactId",
    ],
    inputArtifactFields: [
      "ledgerArtifactId",
      "planArtifactId",
      "baselineReviewArtifactId",
      "renderedPlanArtifactId",
      "taxonomyArtifactId",
      "componentRegistryArtifactId",
      "reviewPolicyArtifactId",
      "evidenceArtifactIds",
    ],
    stringSetFields: ["evidenceArtifactIds", "findingIds"],
    allowsEmptySetFields: ["findingIds"],
    requiresIndependence: true,
  },
};

export function providerCommandSpecification(
  commandType: string,
): Specification | null {
  return specifications[commandType as ProviderCommandType] ?? null;
}

function stringSet(value: unknown, allowEmpty = false): boolean {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every((item) => typeof item === "string" && item.length > 0) &&
    new Set(value).size === value.length
  );
}

function independence(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const item = value as Record<string, unknown>;
  return item.reduced === false
    ? Object.keys(item).length === 1
    : item.reduced === true &&
        Object.keys(item).sort().join(",") === "overrideEvidence,reduced" &&
        item.overrideEvidence !== null &&
        typeof item.overrideEvidence === "object" &&
        !Array.isArray(item.overrideEvidence) &&
        Object.keys(item.overrideEvidence).sort().join(",") ===
          "artifactId,contentHash" &&
        typeof (item.overrideEvidence as Record<string, unknown>).artifactId ===
          "string" &&
        (
          (item.overrideEvidence as Record<string, unknown>)
            .artifactId as string
        ).length > 0 &&
        typeof (item.overrideEvidence as Record<string, unknown>)
          .contentHash === "string" &&
        /^[a-f0-9]{64}$/u.test(
          (item.overrideEvidence as Record<string, unknown>)
            .contentHash as string,
        );
}

export function providerCommandPayloadIsValid(
  commandType: string,
  payload: Record<string, unknown>,
): boolean | null {
  const specification = providerCommandSpecification(commandType);
  if (specification === null) return null;
  return (
    Object.keys(payload).sort().join(",") ===
      [...specification.exactFields].sort().join(",") &&
    specification.stringFields.every(
      (field) =>
        typeof payload[field] === "string" &&
        (payload[field] as string).length > 0,
    ) &&
    (specification.stringSetFields ?? []).every((field) =>
      stringSet(
        payload[field],
        specification.allowsEmptySetFields?.includes(field) ?? false,
      ),
    ) &&
    (!specification.requiresIndependence ||
      independence(payload.independence)) &&
    payload.providerStorage === "minimize"
  );
}
