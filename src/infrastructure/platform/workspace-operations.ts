import { join } from "node:path";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";

import type { WorkspaceOperations } from "../../application/workspace-operations.js";
import { WorkspaceOperationError } from "../../application/workspace-operations.js";
import { ContentAddressedArtifactStore } from "../artifacts/object-store.js";
import { SqliteAuthority } from "../sqlite/authority.js";
import { SqliteReadModel } from "../sqlite/read-model.js";
import { readVerifiedObject } from "../artifacts/object-verifier.js";
import { startRun } from "../../application/start-run.js";
import {
  resolvedConfigurationIsValid,
  resolvedConfigurationPolicyHash,
  type ResolvedConfigurationSnapshot,
} from "../../application/stage-configuration.js";
import {
  resolveAndRegisterConfiguration,
  type PackagedControl,
} from "../../application/resolve-configuration.js";

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

async function packagedControls(): Promise<{
  version: string;
  schema: unknown;
  controls: PackagedControl[];
}> {
  const packageMetadata = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  ) as { version: string };
  const definitions: Array<[PackagedControl["key"], string, string, string?]> =
    [
      [
        "runConfigurationSchema",
        "schemas/run-config.v1.schema.json",
        "application/schema+json",
      ],
      [
        "requirementsSchema",
        "schemas/requirements-ledger.v1.schema.json",
        "application/schema+json",
      ],
      [
        "artifactSchema",
        "schemas/artifact.v1.schema.json",
        "application/schema+json",
      ],
      ["planSchema", "schemas/plan.v1.schema.json", "application/schema+json"],
      [
        "reviewSchema",
        "schemas/review.v1.schema.json",
        "application/schema+json",
      ],
      [
        "terminalManifestSchema",
        "schemas/terminal-manifest.v1.schema.json",
        "application/schema+json",
      ],
      ["taxonomy", "config/review-taxonomy.v1.json", "application/json"],
      [
        "componentRegistry",
        "config/component-registry.v1.json",
        "application/json",
      ],
      [
        "plannerPrompt",
        "config/prompts/planner.v1.md",
        "text/markdown; charset=utf-8",
      ],
      [
        "reviewerPrompt",
        "config/prompts/reviewer.v1.md",
        "text/markdown; charset=utf-8",
      ],
      [
        "remediationPrompt",
        "config/prompts/remediation.v1.md",
        "text/markdown; charset=utf-8",
      ],
      [
        "remediationSchema",
        "schemas/plan.v1.schema.json",
        "application/schema+json",
      ],
      [
        "schemaRepairPrompt",
        "config/prompts/schema-repair.v1.md",
        "text/markdown; charset=utf-8",
      ],
      [
        "reviewPolicy",
        "config/review-rubric.v1.md",
        "text/markdown; charset=utf-8",
      ],
      [
        "frontierAllowlist",
        "config/frontier-models.v1.json",
        "application/json",
      ],
      ["budgetDefaults", "config/default-budgets.v1.json", "application/json"],
      ["productDefaults", "config/product.v1.json", "application/json"],
    ];
  return {
    version: packageMetadata.version,
    schema: JSON.parse(
      await readFile(
        join(packageRoot, "schemas/run-config.v1.schema.json"),
        "utf8",
      ),
    ) as unknown,
    controls: await Promise.all(
      definitions.map(async ([key, packagePath, mediaType, schemaId]) => ({
        key,
        packagePath,
        bytes: await readFile(join(packageRoot, packagePath)),
        mediaType,
        ...(schemaId === undefined ? {} : { schemaId }),
      })),
    ),
  };
}

export function createWorkspaceOperations(): WorkspaceOperations {
  async function withReadModel<T>(
    projectRoot: string,
    read: (model: SqliteReadModel) => T | Promise<T>,
  ): Promise<T> {
    const model = await SqliteReadModel.open(projectRoot);
    try {
      return await read(model);
    } finally {
      model.close();
    }
  }
  return {
    async initialize(projectRoot) {
      const store = await ContentAddressedArtifactStore.open(projectRoot);
      const authority = SqliteAuthority.open(
        join(store.workspace.root, "state.db"),
        {
          artifactStore: store,
        },
      );
      authority.close();
      return { workspaceRoot: store.workspace.root };
    },
    async configure(projectRoot, configurationPath) {
      const store = await ContentAddressedArtifactStore.open(projectRoot);
      const authority = SqliteAuthority.open(
        join(store.workspace.root, "state.db"),
        {
          artifactStore: store,
        },
      );
      try {
        const packaged = await packagedControls();
        const result = await resolveAndRegisterConfiguration({
          configurationBytes: await readFile(
            resolve(projectRoot, configurationPath),
          ),
          configurationSchema: packaged.schema,
          controls: packaged.controls,
          staging: store,
          registration: authority,
          packageVersion: packaged.version,
          createdBy: `human:${userInfo().username}`,
        });
        return {
          configurationArtifactId: result.artifact.artifactId,
          configurationContentHash: result.artifact.contentHash,
          policyHash: result.configuration.policyHash,
        };
      } finally {
        authority.close();
      }
    },
    async startRun(projectRoot, sourcePath, configurationArtifactId) {
      const configurationMetadata = await withReadModel(projectRoot, (model) =>
        model
          .listArtifacts()
          .find((artifact) => artifact.artifactId === configurationArtifactId),
      );
      if (
        configurationMetadata === undefined ||
        configurationMetadata.schemaId !==
          "software-factory/resolved-configuration.v1" ||
        (
          configurationMetadata.metadata as {
            provenance?: { method?: unknown };
          }
        ).provenance?.method !== "resolved_configuration"
      ) {
        throw new WorkspaceOperationError(
          "RUN_NOT_FOUND",
          `Configuration artifact not found: ${configurationArtifactId}`,
          { configurationArtifactId },
        );
      }
      const store = await ContentAddressedArtifactStore.open(projectRoot);
      const configurationBytes = await store.readVerified(
        configurationMetadata.contentHash,
      );
      const configuration = JSON.parse(
        configurationBytes.toString("utf8"),
      ) as ResolvedConfigurationSnapshot;
      if (!resolvedConfigurationIsValid(configuration)) {
        throw new WorkspaceOperationError(
          "INTEGRITY_ERROR",
          `Resolved configuration is invalid: ${configurationArtifactId}`,
        );
      }
      if (
        configuration.policyHash !==
        resolvedConfigurationPolicyHash(configuration)
      ) {
        throw new WorkspaceOperationError(
          "INTEGRITY_ERROR",
          `Resolved configuration policy identity is invalid: ${configurationArtifactId}`,
        );
      }
      const registeredArtifacts = await withReadModel(projectRoot, (model) =>
        model.listArtifacts(),
      );
      const registeredHashes = new Set(
        registeredArtifacts.map((artifact) => artifact.contentHash),
      );
      for (const contentHash of Object.values(configuration.artifactHashes)) {
        if (!registeredHashes.has(contentHash)) {
          throw new WorkspaceOperationError(
            "INTEGRITY_ERROR",
            `Configured control artifact is not registered: ${contentHash}`,
          );
        }
        await store.readVerified(contentHash);
      }
      const productBytes = await store.readVerified(
        configuration.artifactHashes.productDefaults,
      );
      const product = JSON.parse(productBytes.toString("utf8")) as {
        source_input?: { max_bytes?: unknown };
      };
      const maximumSourceBytes = product.source_input?.max_bytes;
      if (
        !Number.isInteger(maximumSourceBytes) ||
        (maximumSourceBytes as number) < 1
      ) {
        throw new WorkspaceOperationError(
          "INTEGRITY_ERROR",
          "Source artifact violates the pinned source-size policy",
        );
      }
      const copied = await store.copySource(resolve(projectRoot, sourcePath));
      if (
        copied.byteLength < 1 ||
        copied.byteLength > (maximumSourceBytes as number)
      ) {
        throw new WorkspaceOperationError(
          "INTEGRITY_ERROR",
          "Source artifact violates the pinned source-size policy",
        );
      }
      const sourceArtifact = {
        schemaVersion: 1 as const,
        artifactId: `source_${copied.contentHash.slice(0, 24)}`,
        kind: "raw_requirements" as const,
        contentHash: copied.contentHash,
        byteLength: copied.byteLength,
        mediaType: "text/markdown; charset=utf-8",
        createdBy: `human:${userInfo().username}`,
        provenance: {
          method: "copied" as const,
          sourcePath: copied.provenancePath,
        },
      };
      const authority = SqliteAuthority.open(
        join(store.workspace.root, "state.db"),
        {
          artifactStore: store,
        },
      );
      try {
        return await startRun({
          authority,
          sourceArtifact,
          sourceProvenancePath: copied.provenancePath,
          configurationArtifactId,
          configurationContentHash: configurationMetadata.contentHash,
          configuration,
          actor: {
            kind: "human",
            displayName: configuration.humanActorDisplayName,
            osAccount: userInfo().username,
          },
        });
      } finally {
        authority.close();
      }
    },
    async listRuns(projectRoot) {
      return withReadModel(projectRoot, (model) => model.listRuns());
    },
    async loadRun(projectRoot, runId) {
      const readModel = await SqliteReadModel.open(projectRoot);
      try {
        return readModel.loadRun(runId);
      } finally {
        readModel.close();
      }
    },
    async listAudit(projectRoot, runId) {
      const readModel = await SqliteReadModel.open(projectRoot);
      try {
        if (runId !== undefined && readModel.loadRun(runId) === null) {
          throw new WorkspaceOperationError(
            "RUN_NOT_FOUND",
            `Run not found: ${runId}`,
            { runId },
          );
        }
        return readModel.listAudit(runId);
      } finally {
        readModel.close();
      }
    },
    async listArtifacts(projectRoot, runId) {
      return withReadModel(projectRoot, async (model) => {
        if (runId !== undefined && model.loadRun(runId) === null) {
          throw new WorkspaceOperationError(
            "RUN_NOT_FOUND",
            `Run not found: ${runId}`,
            { runId },
          );
        }
        const artifacts = model.listArtifacts(runId);
        for (const artifact of artifacts) {
          try {
            const bytes = await readVerifiedObject(
              join(projectRoot, ".factory", "objects"),
              artifact.contentHash,
            );
            if (bytes.byteLength !== artifact.byteLength)
              throw new Error("length mismatch");
          } catch (error) {
            throw new WorkspaceOperationError(
              "INTEGRITY_ERROR",
              `Artifact body is missing or corrupt: ${artifact.artifactId}`,
              {
                artifactId: artifact.artifactId,
                cause: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }
        return artifacts.map((artifact) => ({
          ...artifact,
          objectVerified: true as const,
        }));
      });
    },
    async listFindings(projectRoot, runId) {
      return withReadModel(projectRoot, (model) => {
        if (model.loadRun(runId) === null)
          throw new WorkspaceOperationError(
            "RUN_NOT_FOUND",
            `Run not found: ${runId}`,
            { runId },
          );
        return model.listFindings(runId);
      });
    },
    async loadUsage(projectRoot, runId) {
      return withReadModel(projectRoot, (model) => {
        if (model.loadRun(runId) === null)
          throw new WorkspaceOperationError(
            "RUN_NOT_FOUND",
            `Run not found: ${runId}`,
            { runId },
          );
        return model.loadUsage(runId);
      });
    },
    async listGates(projectRoot, runId) {
      return withReadModel(projectRoot, (model) => {
        if (model.loadRun(runId) === null)
          throw new WorkspaceOperationError(
            "RUN_NOT_FOUND",
            `Run not found: ${runId}`,
            { runId },
          );
        return model.listGates(runId);
      });
    },
  };
}
