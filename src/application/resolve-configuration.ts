import { createHash } from "node:crypto";

import { canonicalJson } from "../domain/canonical-json.js";
import type { ProviderModelAssignment } from "../domain/index.js";
import type {
  ArtifactBatchRegistrationPort,
  ArtifactStagingPort,
  StagedArtifactRegistration,
} from "./artifact-port.js";
import { assertJsonSchema } from "./json-schema-validator.js";
import {
  resolvedConfigurationIsValid,
  resolvedConfigurationPolicyHash,
  type ResolvedArtifactPins,
  type ResolvedConfigurationSnapshot,
} from "./stage-configuration.js";

export type PackagedControl = {
  key: keyof ResolvedArtifactPins;
  packagePath: string;
  bytes: Uint8Array;
  mediaType: string;
  schemaId?: string;
};

export const packagedControlPaths: Record<keyof ResolvedArtifactPins, string> =
  {
    projectConfigurationSchema: "schemas/project-config.v1.schema.json",
    resolvedConfigurationSchema:
      "schemas/resolved-configuration.v1.schema.json",
    runConfigurationSchema: "schemas/run-config.v1.schema.json",
    requirementsSchema: "schemas/requirements-ledger.v1.schema.json",
    artifactSchema: "schemas/artifact.v1.schema.json",
    planSchema: "schemas/plan.v1.schema.json",
    reviewSchema: "schemas/review.v1.schema.json",
    terminalManifestSchema: "schemas/terminal-manifest.v1.schema.json",
    taxonomy: "config/review-taxonomy.v1.json",
    componentRegistry: "config/component-registry.v1.json",
    plannerPrompt: "config/prompts/planner.v1.md",
    reviewerPrompt: "config/prompts/reviewer.v1.md",
    remediationPrompt: "config/prompts/remediation.v1.md",
    remediationSchema: "schemas/plan.v1.schema.json",
    schemaRepairPrompt: "config/prompts/schema-repair.v1.md",
    reviewPolicy: "config/review-rubric.v1.md",
    frontierAllowlist: "config/frontier-models.v1.json",
    budgetDefaults: "config/default-budgets.v1.json",
    productDefaults: "config/product.v1.json",
    providerSettingsDefaults: "config/default-provider-settings.v1.json",
  };

type Worker = { provider: "openai" | "anthropic"; model_id: string };
type Settings = { timeout_ms: number; reasoning: string | null };
type PartialConfiguration = {
  schema_version: 1;
  planner?: Worker;
  reviewer?: Worker;
  budgets?: Partial<Budgets>;
  request_settings?: Partial<
    Record<
      "planner" | "reviewer" | "remediation" | "schema_repair",
      Partial<Settings>
    >
  >;
  recording_mode?: "record" | "strict_replay";
  provider_storage?: "minimize";
  human_actor?: { display_name: string };
};
type Budgets = {
  requires_explicit_acceptance_before_live_run: boolean;
  max_live_calls: number;
  max_physical_attempts: number;
  max_schema_repairs_per_command: number;
  max_transport_retries_per_command: number;
  max_remediation_cycles: number;
  max_closure_cycles: number;
  max_input_tokens: number;
  max_output_tokens: number;
  max_cost_usd: number;
  provider_request_maxima: Record<
    "planner" | "reviewer" | "remediation" | "schema_repair",
    {
      max_input_tokens: number;
      max_output_tokens: number;
      max_cost_usd: number;
    }
  >;
};

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const id = (prefix: string, hash: string) => `${prefix}_${hash.slice(0, 24)}`;
const json = <T>(bytes: Uint8Array): T =>
  JSON.parse(Buffer.from(bytes).toString("utf8")) as T;

function merge(
  base: PartialConfiguration,
  update: PartialConfiguration,
): PartialConfiguration {
  const requestMaxima = {
    ...base.budgets?.provider_request_maxima,
    ...Object.fromEntries(
      Object.entries(update.budgets?.provider_request_maxima ?? {}).map(
        ([key, value]) => [
          key,
          {
            ...base.budgets?.provider_request_maxima?.[
              key as keyof Budgets["provider_request_maxima"]
            ],
            ...value,
          },
        ],
      ),
    ),
  } as Budgets["provider_request_maxima"];
  return {
    ...base,
    ...update,
    budgets: {
      ...base.budgets,
      ...update.budgets,
      provider_request_maxima: requestMaxima,
    },
    request_settings: {
      ...base.request_settings,
      ...Object.fromEntries(
        Object.entries(update.request_settings ?? {}).map(([key, value]) => [
          key,
          {
            ...base.request_settings?.[
              key as keyof NonNullable<PartialConfiguration["request_settings"]>
            ],
            ...value,
          },
        ]),
      ),
    },
  };
}

export async function resolveAndRegisterConfiguration(input: {
  projectConfigurationBytes?: Uint8Array;
  overrideConfigurationBytes?: Uint8Array;
  configurationSchema: unknown;
  controls: PackagedControl[];
  staging: ArtifactStagingPort;
  registration: ArtifactBatchRegistrationPort;
  packageVersion: string;
  createdBy: string;
  defaultActorDisplayName: string;
}): Promise<{
  configuration: ResolvedConfigurationSnapshot;
  artifact: StagedArtifactRegistration;
  controlArtifacts: StagedArtifactRegistration[];
}> {
  const control = (key: PackagedControl["key"]) => {
    const found = input.controls.find((item) => item.key === key);
    if (found === undefined)
      throw new TypeError(`Packaged control is missing: ${key}`);
    return found;
  };
  const allowlist = json<{
    default_assignments: { planner: Worker; reviewer: Worker };
    models: Worker[];
  }>(control("frontierAllowlist").bytes);
  const budgetDefaults = json<Budgets>(control("budgetDefaults").bytes);
  const providerDefaults = json<{
    planner: Settings;
    reviewer: Settings;
    remediation: Settings;
    schema_repair: Settings;
    recording_mode: "record" | "strict_replay";
    provider_storage: "minimize";
  }>(control("providerSettingsDefaults").bytes);
  let resolved: PartialConfiguration = {
    schema_version: 1,
    planner: allowlist.default_assignments.planner,
    reviewer: allowlist.default_assignments.reviewer,
    budgets: budgetDefaults,
    request_settings: {
      planner: providerDefaults.planner,
      reviewer: providerDefaults.reviewer,
      remediation: providerDefaults.remediation,
      schema_repair: providerDefaults.schema_repair,
    },
    recording_mode: providerDefaults.recording_mode,
    provider_storage: providerDefaults.provider_storage,
    human_actor: { display_name: input.defaultActorDisplayName },
  };
  const submitted: Array<{ bytes: Uint8Array; role: string }> = [];
  for (const [bytes, role] of [
    [input.projectConfigurationBytes, "project"],
    [input.overrideConfigurationBytes, "override"],
  ] as const) {
    if (bytes === undefined) continue;
    const value = json<PartialConfiguration>(bytes);
    assertJsonSchema(value, input.configurationSchema);
    resolved = merge(resolved, value);
    submitted.push({ bytes, role });
  }
  const planner = resolved.planner;
  const reviewer = resolved.reviewer;
  const budgets = resolved.budgets as Budgets;
  const settings = resolved.request_settings;
  if (planner === undefined || reviewer === undefined)
    throw new TypeError("Provider assignments are incomplete");
  if (
    settings?.planner === undefined ||
    settings.reviewer === undefined ||
    settings.remediation === undefined ||
    settings.schema_repair === undefined
  ) {
    throw new TypeError("Provider request settings are incomplete");
  }
  const completeSettings = (value: Partial<Settings>): Settings => {
    if (
      !Number.isInteger(value.timeout_ms) ||
      (value.timeout_ms ?? 0) < 1 ||
      !(value.reasoning === null || typeof value.reasoning === "string")
    ) {
      throw new TypeError("Provider request settings are invalid");
    }
    return value as Settings;
  };
  const plannerSettings = completeSettings(settings.planner);
  const reviewerSettings = completeSettings(settings.reviewer);
  const remediationSettings = completeSettings(settings.remediation);
  const repairSettings = completeSettings(settings.schema_repair);
  for (const worker of [planner, reviewer]) {
    if (
      !allowlist.models.some(
        (model) =>
          model.provider === worker.provider &&
          model.model_id === worker.model_id,
      )
    ) {
      throw new TypeError(
        `Configured model is not in the pinned allowlist: ${worker.provider}/${worker.model_id}`,
      );
    }
  }
  if (
    planner.provider === reviewer.provider ||
    planner.model_id === reviewer.model_id
  ) {
    throw new TypeError(
      "Planner and Reviewer must use different providers and models",
    );
  }
  const costUsdMicros = budgets.max_cost_usd * 1_000_000;
  if (!Number.isSafeInteger(costUsdMicros) || costUsdMicros < 1) {
    throw new TypeError(
      "Cost ceiling must have at most six decimal places and fit safely",
    );
  }
  const requestBudget = (role: keyof Budgets["provider_request_maxima"]) => {
    const value = budgets.provider_request_maxima?.[role];
    const roleCostUsdMicros = (value?.max_cost_usd ?? 0) * 1_000_000;
    if (
      value === undefined ||
      !Number.isSafeInteger(value.max_input_tokens) ||
      value.max_input_tokens < 1 ||
      !Number.isSafeInteger(value.max_output_tokens) ||
      value.max_output_tokens < 1 ||
      !Number.isSafeInteger(roleCostUsdMicros) ||
      roleCostUsdMicros < 1
    )
      throw new TypeError(`Provider request budget is invalid: ${role}`);
    return {
      calls: 1 as const,
      inputTokens: value.max_input_tokens,
      outputTokens: value.max_output_tokens,
      costUsdMicros: roleCostUsdMicros,
    };
  };

  const staged: StagedArtifactRegistration[] = [];
  const controlsByHash = new Map<string, StagedArtifactRegistration>();
  const hashes = {} as ResolvedArtifactPins;
  for (const item of input.controls) {
    const hash = digest(item.bytes);
    let artifact = controlsByHash.get(hash);
    if (artifact === undefined) {
      artifact = await input.staging.stageArtifact(item.bytes, {
        artifactId: id("control", hash),
        kind: "other",
        mediaType: item.mediaType,
        ...(item.schemaId === undefined ? {} : { schemaId: item.schemaId }),
        createdBy: `system:software-factory@${input.packageVersion}`,
        provenance: {
          method: "packaged",
          packagePath: item.packagePath,
          packageVersion: input.packageVersion,
        },
      });
      controlsByHash.set(hash, artifact);
      staged.push(artifact);
    }
    hashes[item.key] = hash;
  }
  const sourceArtifacts: StagedArtifactRegistration[] = [];
  for (const source of submitted) {
    const hash = digest(source.bytes);
    const artifact = await input.staging.stageArtifact(source.bytes, {
      artifactId: id(`configuration_${source.role}`, hash),
      kind: "other",
      mediaType: "application/json",
      schemaId: "software-factory/project-config.v1",
      createdBy: input.createdBy,
      provenance: { method: "human_submitted" },
    });
    sourceArtifacts.push(artifact);
    staged.push(artifact);
  }
  const assignment = (worker: Worker): ProviderModelAssignment => ({
    provider: worker.provider,
    modelId: worker.model_id,
  });
  const configuration: ResolvedConfigurationSnapshot = {
    schemaVersion: 1,
    policyHash: "0".repeat(64),
    plannerAssignment: assignment(planner),
    reviewerAssignment: assignment(reviewer),
    artifactHashes: hashes,
    providerRequestSettings: {
      planner: {
        timeoutMs: plannerSettings.timeout_ms,
        reasoning: plannerSettings.reasoning,
      },
      reviewer: {
        timeoutMs: reviewerSettings.timeout_ms,
        reasoning: reviewerSettings.reasoning,
      },
      remediation: {
        timeoutMs: remediationSettings.timeout_ms,
        reasoning: remediationSettings.reasoning,
      },
      schemaRepair: {
        timeoutMs: repairSettings.timeout_ms,
        reasoning: repairSettings.reasoning,
      },
    },
    providerRequestBudgets: {
      planner: requestBudget("planner"),
      reviewer: requestBudget("reviewer"),
      remediation: requestBudget("remediation"),
      schemaRepair: requestBudget("schema_repair"),
    },
    recordingMode: resolved.recording_mode ?? "record",
    humanActorDisplayName:
      resolved.human_actor?.display_name ?? input.defaultActorDisplayName,
    providerStorage: "minimize",
    budgetAcceptanceRequired:
      budgets.requires_explicit_acceptance_before_live_run,
    hardCeilings: {
      calls: budgets.max_live_calls,
      physicalAttempts: budgets.max_physical_attempts,
      inputTokens: budgets.max_input_tokens,
      outputTokens: budgets.max_output_tokens,
      costUsdMicros,
      retries: budgets.max_transport_retries_per_command,
      repairs: budgets.max_schema_repairs_per_command,
      remediationCycles: budgets.max_remediation_cycles,
      closureCycles: budgets.max_closure_cycles,
    },
    credentialReferences: Object.fromEntries(
      [...new Set([planner.provider, reviewer.provider])].map((provider) => [
        provider,
        {
          kind: "environment" as const,
          reference:
            provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY",
        },
      ]),
    ),
  };
  configuration.policyHash = resolvedConfigurationPolicyHash(configuration);
  if (!resolvedConfigurationIsValid(configuration))
    throw new TypeError("Resolved configuration is invalid");
  assertJsonSchema(
    configuration,
    json(control("resolvedConfigurationSchema").bytes),
  );
  const bytes = Buffer.from(canonicalJson(configuration));
  const artifact = await input.staging.stageArtifact(bytes, {
    artifactId: id("configuration", digest(bytes)),
    kind: "other",
    mediaType: "application/json",
    schemaId: "software-factory/resolved-configuration.v1",
    createdBy: input.createdBy,
    provenance: {
      method: "resolved_configuration",
      sourceArtifactIds: [...controlsByHash.values(), ...sourceArtifacts].map(
        (item) => item.artifactId,
      ),
    },
  });
  staged.push(artifact);
  await input.registration.registerArtifacts(staged);
  return {
    configuration,
    artifact,
    controlArtifacts: [...controlsByHash.values()],
  };
}
