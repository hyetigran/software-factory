import { createHash } from "node:crypto";

import { canonicalJson } from "../domain/canonical-json.js";
import type { ProviderModelAssignment } from "../domain/index.js";
import type {
  ArtifactRegistrationPort,
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

type RunConfigurationInput = {
  schema_version: 1;
  planner: {
    provider: "openai" | "anthropic";
    model_id: string;
    reasoning?: string;
  };
  reviewer: {
    provider: "openai" | "anthropic";
    model_id: string;
    reasoning?: string;
  };
  policy: {
    taxonomy_hash: string;
    component_registry_hash: string;
    prompt_hashes: Record<string, string>;
    schema_hashes: Record<string, string>;
    rubric_hash: string;
    frontier_allowlist_hash: string;
  };
  budgets: {
    max_live_calls: number;
    max_physical_attempts: number;
    max_schema_repairs_per_command: number;
    max_transport_retries_per_command: number;
    max_remediation_cycles: number;
    max_closure_cycles: number;
    max_input_tokens: number;
    max_output_tokens: number;
    max_cost_usd: number;
  };
  recording_mode: "record" | "strict_replay";
  provider_storage: "minimize" | "required_feature_opt_in";
  human_actor: { display_name: string };
};

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function artifactId(prefix: string, contentHash: string): string {
  return `${prefix}_${contentHash.slice(0, 24)}`.replaceAll(
    /[^A-Za-z0-9_-]/gu,
    "_",
  );
}

export async function resolveAndRegisterConfiguration(input: {
  configurationBytes: Uint8Array;
  configurationSchema: unknown;
  controls: PackagedControl[];
  staging: ArtifactStagingPort;
  registration: ArtifactRegistrationPort;
  packageVersion: string;
  createdBy: string;
}): Promise<{
  configuration: ResolvedConfigurationSnapshot;
  artifact: StagedArtifactRegistration;
  controlArtifacts: StagedArtifactRegistration[];
}> {
  const parsed: unknown = JSON.parse(
    Buffer.from(input.configurationBytes).toString("utf8"),
  );
  assertJsonSchema(parsed, input.configurationSchema);
  const source = parsed as RunConfigurationInput;
  if (source.provider_storage !== "minimize") {
    throw new TypeError(
      "Resolved configuration v1 supports provider storage minimization only",
    );
  }
  const controlArtifacts: StagedArtifactRegistration[] = [];
  const artifactsByHash = new Map<string, StagedArtifactRegistration>();
  const hashes = {} as ResolvedArtifactPins;
  for (const control of input.controls) {
    const contentHash = hash(control.bytes);
    let artifact = artifactsByHash.get(contentHash);
    if (artifact === undefined) {
      artifact = await input.staging.stageArtifact(control.bytes, {
        artifactId: artifactId("control", contentHash),
        kind: "other",
        mediaType: control.mediaType,
        ...(control.schemaId === undefined
          ? {}
          : { schemaId: control.schemaId }),
        createdBy: `system:software-factory@${input.packageVersion}`,
        provenance: {
          method: "packaged",
          packagePath: control.packagePath,
          packageVersion: input.packageVersion,
        },
      });
      await input.registration.registerArtifact(artifact);
      artifactsByHash.set(contentHash, artifact);
      controlArtifacts.push(artifact);
    }
    hashes[control.key] = contentHash;
  }
  const expectedPolicy = {
    taxonomy_hash: hashes.taxonomy,
    component_registry_hash: hashes.componentRegistry,
    prompt_hashes: {
      planner: hashes.plannerPrompt,
      reviewer: hashes.reviewerPrompt,
      remediation: hashes.remediationPrompt,
      schema_repair: hashes.schemaRepairPrompt,
    },
    schema_hashes: {
      requirements: hashes.requirementsSchema,
      artifact: hashes.artifactSchema,
      plan: hashes.planSchema,
      review: hashes.reviewSchema,
      remediation: hashes.remediationSchema,
    },
    rubric_hash: hashes.reviewPolicy,
    frontier_allowlist_hash: hashes.frontierAllowlist,
  };
  if (canonicalJson(source.policy) !== canonicalJson(expectedPolicy)) {
    throw new TypeError(
      "Run configuration policy hashes do not match packaged controls",
    );
  }
  const allowlistControl = input.controls.find(
    (control) => control.key === "frontierAllowlist",
  );
  if (allowlistControl === undefined)
    throw new TypeError("Frontier allowlist is missing");
  const allowlist = JSON.parse(
    Buffer.from(allowlistControl.bytes).toString("utf8"),
  ) as {
    models?: Array<{ provider?: unknown; model_id?: unknown }>;
  };
  for (const worker of [source.planner, source.reviewer]) {
    if (
      !allowlist.models?.some(
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
    source.planner.provider === source.reviewer.provider ||
    source.planner.model_id === source.reviewer.model_id
  ) {
    throw new TypeError(
      "Default Planner and Reviewer assignments must use different providers and models",
    );
  }
  const assignment = (
    worker: RunConfigurationInput["planner"],
  ): ProviderModelAssignment => ({
    provider: worker.provider,
    modelId: worker.model_id,
  });
  const configuration: ResolvedConfigurationSnapshot = {
    schemaVersion: 1,
    policyHash: "0".repeat(64),
    plannerAssignment: assignment(source.planner),
    reviewerAssignment: assignment(source.reviewer),
    artifactHashes: {
      runConfigurationSchema: hashes.runConfigurationSchema,
      requirementsSchema: hashes.requirementsSchema,
      artifactSchema: hashes.artifactSchema,
      planSchema: hashes.planSchema,
      reviewSchema: hashes.reviewSchema,
      terminalManifestSchema: hashes.terminalManifestSchema,
      taxonomy: hashes.taxonomy,
      componentRegistry: hashes.componentRegistry,
      plannerPrompt: hashes.plannerPrompt,
      reviewerPrompt: hashes.reviewerPrompt,
      remediationPrompt: hashes.remediationPrompt,
      remediationSchema: hashes.remediationSchema,
      schemaRepairPrompt: hashes.schemaRepairPrompt,
      reviewPolicy: hashes.reviewPolicy,
      frontierAllowlist: hashes.frontierAllowlist,
      budgetDefaults: hashes.budgetDefaults,
      productDefaults: hashes.productDefaults,
    },
    providerRequestSettings: {
      planner: {
        timeoutMs: 120_000,
        reasoning: source.planner.reasoning ?? null,
      },
      reviewer: {
        timeoutMs: 120_000,
        reasoning: source.reviewer.reasoning ?? null,
      },
      remediation: {
        timeoutMs: 120_000,
        reasoning: source.planner.reasoning ?? null,
      },
      schemaRepair: {
        timeoutMs: 60_000,
        reasoning: source.planner.reasoning ?? null,
      },
    },
    recordingMode: source.recording_mode,
    humanActorDisplayName: source.human_actor.display_name,
    providerStorage: "minimize",
    hardCeilings: {
      calls: source.budgets.max_live_calls,
      physicalAttempts: source.budgets.max_physical_attempts,
      inputTokens: source.budgets.max_input_tokens,
      outputTokens: source.budgets.max_output_tokens,
      costUsdMicros: Math.round(source.budgets.max_cost_usd * 1_000_000),
      retries: source.budgets.max_transport_retries_per_command,
      repairs: source.budgets.max_schema_repairs_per_command,
      remediationCycles: source.budgets.max_remediation_cycles,
      closureCycles: source.budgets.max_closure_cycles,
    },
    credentialReferences: Object.fromEntries(
      [...new Set([source.planner.provider, source.reviewer.provider])].map(
        (provider) => [
          provider,
          {
            kind: "environment" as const,
            reference:
              provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY",
          },
        ],
      ),
    ),
  };
  if (!Number.isSafeInteger(configuration.hardCeilings.costUsdMicros)) {
    throw new TypeError(
      "Configured cost ceiling cannot be represented exactly",
    );
  }
  configuration.policyHash = resolvedConfigurationPolicyHash(configuration);
  const sourceArtifact = await input.staging.stageArtifact(
    input.configurationBytes,
    {
      artifactId: artifactId(
        "configuration_input",
        hash(input.configurationBytes),
      ),
      kind: "other",
      mediaType: "application/json",
      schemaId: "software-factory/run-config.v1",
      createdBy: input.createdBy,
      provenance: { method: "human_submitted" },
    },
  );
  await input.registration.registerArtifact(sourceArtifact);
  if (!resolvedConfigurationIsValid(configuration)) {
    throw new TypeError("Resolved configuration is invalid");
  }
  const configurationBytes = Buffer.from(canonicalJson(configuration));
  const artifact = await input.staging.stageArtifact(configurationBytes, {
    artifactId: artifactId("configuration", hash(configurationBytes)),
    kind: "other",
    mediaType: "application/json",
    schemaId: "software-factory/resolved-configuration.v1",
    createdBy: input.createdBy,
    provenance: {
      method: "resolved_configuration",
      sourceArtifactIds: [
        sourceArtifact.artifactId,
        ...controlArtifacts.map((item) => item.artifactId),
      ],
    },
  });
  await input.registration.registerArtifact(artifact);
  return { configuration, artifact, controlArtifacts };
}
