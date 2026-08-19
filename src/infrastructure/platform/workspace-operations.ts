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
import { startConfiguredRun } from "../../application/start-configured-run.js";
import { submitLedger } from "../../application/submit-ledger.js";
import { loadPinnedConfiguration } from "../../application/load-pinned-configuration.js";
import { approveSourceExclusion } from "../../application/approve-source-exclusion.js";
import { executeNextLocalCommand } from "../../application/execute-local-command.js";
import { approveLedger } from "../../application/approve-ledger.js";
import { requestPlanning } from "../../application/request-planning.js";
import {
  DomainTransitionError,
  type NonterminalRunState,
} from "../../domain/index.js";
import {
  resolveAndRegisterConfiguration,
  packagedControlPaths,
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
  const definitions: Array<[PackagedControl["key"], string, string?]> = [
    ["runConfigurationSchema", "application/schema+json"],
    ["projectConfigurationSchema", "application/schema+json"],
    ["resolvedConfigurationSchema", "application/schema+json"],
    ["requirementsSchema", "application/schema+json"],
    ["artifactSchema", "application/schema+json"],
    ["planSchema", "application/schema+json"],
    ["reviewSchema", "application/schema+json"],
    ["terminalManifestSchema", "application/schema+json"],
    ["taxonomy", "application/json"],
    ["componentRegistry", "application/json"],
    ["plannerPrompt", "text/markdown; charset=utf-8"],
    ["reviewerPrompt", "text/markdown; charset=utf-8"],
    ["remediationPrompt", "text/markdown; charset=utf-8"],
    ["remediationSchema", "application/schema+json"],
    ["schemaRepairPrompt", "text/markdown; charset=utf-8"],
    ["reviewPolicy", "text/markdown; charset=utf-8"],
    ["frontierAllowlist", "application/json"],
    ["budgetDefaults", "application/json"],
    ["productDefaults", "application/json"],
    ["providerSettingsDefaults", "application/json"],
  ];
  return {
    version: packageMetadata.version,
    schema: JSON.parse(
      await readFile(
        join(packageRoot, "schemas/project-config.v1.schema.json"),
        "utf8",
      ),
    ) as unknown,
    controls: await Promise.all(
      definitions.map(async ([key, mediaType, schemaId]) => ({
        key,
        packagePath: packagedControlPaths[key],
        bytes: await readFile(join(packageRoot, packagedControlPaths[key])),
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
    async configure(projectRoot, configurationPath, overrideConfigurationPath) {
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
          ...(configurationPath === undefined
            ? {}
            : {
                projectConfigurationBytes: await readFile(
                  resolve(projectRoot, configurationPath),
                ),
              }),
          ...(overrideConfigurationPath === undefined
            ? {}
            : {
                overrideConfigurationBytes: await readFile(
                  resolve(projectRoot, overrideConfigurationPath),
                ),
              }),
          configurationSchema: packaged.schema,
          controls: packaged.controls,
          staging: store,
          registration: authority,
          packageVersion: packaged.version,
          createdBy: `human:${userInfo().username}`,
          defaultActorDisplayName: userInfo().username,
        });
        return {
          configurationArtifactId: result.artifact.artifactId,
          configurationContentHash: result.artifact.contentHash,
          policyHash: result.configuration.policyHash,
        };
      } catch (error) {
        if (error instanceof WorkspaceOperationError) throw error;
        if (
          error !== null &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          throw new WorkspaceOperationError(
            "INPUT_NOT_FOUND",
            "Configuration input file was not found",
          );
        }
        if (error instanceof SyntaxError || error instanceof TypeError) {
          throw new WorkspaceOperationError(
            "INVALID_INPUT",
            `Configuration input is invalid: ${error.message}`,
          );
        }
        throw error;
      } finally {
        authority.close();
      }
    },
    async startRun(projectRoot, sourcePath, configurationArtifactId) {
      const store = await ContentAddressedArtifactStore.open(projectRoot);
      const packageVersion = (
        JSON.parse(
          await readFile(join(packageRoot, "package.json"), "utf8"),
        ) as { version: string }
      ).version;
      const authority = SqliteAuthority.open(
        join(store.workspace.root, "state.db"),
        { artifactStore: store },
      );
      try {
        return await startConfiguredRun({
          authority,
          artifacts: {
            listArtifacts: () =>
              withReadModel(projectRoot, (model) => model.listArtifacts()),
            readVerified: (contentHash) => store.readVerified(contentHash),
            copySource: (path) => store.copySource(resolve(projectRoot, path)),
          },
          sourcePath,
          configurationArtifactId,
          expectedPackageVersion: packageVersion,
          actor: {
            kind: "human",
            displayName: userInfo().username,
            osAccount: userInfo().username,
          },
        });
      } catch (error) {
        if (error instanceof WorkspaceOperationError) throw error;
        if (
          error !== null &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          throw new WorkspaceOperationError(
            "INPUT_NOT_FOUND",
            `Source input was not found: ${sourcePath}`,
            { sourcePath },
          );
        }
        if (error instanceof SyntaxError || error instanceof TypeError) {
          throw new WorkspaceOperationError(
            "INVALID_INPUT",
            `Run input is invalid: ${error.message}`,
          );
        }
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes("one_nonterminal_run") ||
          message.includes("UNIQUE constraint failed: runs.active_slot") ||
          message.includes("UNIQUE constraint failed: runs.workspace_id")
        ) {
          throw new WorkspaceOperationError(
            "CONFLICT",
            "A nonterminal run is already active",
          );
        }
        throw error;
      } finally {
        authority.close();
      }
    },
    async submitLedger(projectRoot, runId, ledgerPath) {
      const store = await ContentAddressedArtifactStore.open(projectRoot);
      const configuration = await loadPinnedConfiguration({
        runId,
        read: {
          loadRun: (id) =>
            withReadModel(projectRoot, (model) => model.loadRun(id)),
          listArtifacts: () =>
            withReadModel(projectRoot, (model) => model.listArtifacts()),
          readVerified: (contentHash) => store.readVerified(contentHash),
        },
      });
      try {
        const authority = SqliteAuthority.open(
          join(store.workspace.root, "state.db"),
          { artifactStore: store },
        );
        try {
          return await submitLedger({
            authority,
            staging: store,
            readVerified: (contentHash) => store.readVerified(contentHash),
            runId,
            ledgerBytes: await readFile(resolve(projectRoot, ledgerPath)),
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
      } catch (error) {
        if (error instanceof WorkspaceOperationError) throw error;
        if (error instanceof DomainTransitionError) {
          throw new WorkspaceOperationError("CONFLICT", error.message, {
            domainCode: error.code,
          });
        }
        if (
          error !== null &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          throw new WorkspaceOperationError(
            "INPUT_NOT_FOUND",
            `Ledger input was not found: ${ledgerPath}`,
          );
        }
        if (error instanceof SyntaxError || error instanceof TypeError) {
          throw new WorkspaceOperationError(
            "INVALID_INPUT",
            `Ledger input is invalid: ${error.message}`,
          );
        }
        throw error;
      }
    },
    async approveSourceExclusion(
      projectRoot,
      runId,
      exclusionId,
      startOffset,
      endOffset,
      reason,
    ) {
      const store = await ContentAddressedArtifactStore.open(projectRoot);
      const state = await withReadModel(projectRoot, (model) =>
        model.loadRun(runId),
      );
      if (state === null)
        throw new WorkspaceOperationError(
          "RUN_NOT_FOUND",
          `Run not found: ${runId}`,
          {
            runId,
          },
        );
      const sourceContentHash = (state as { sourceContentHash?: unknown })
        .sourceContentHash;
      if (typeof sourceContentHash !== "string")
        throw new WorkspaceOperationError(
          "INTEGRITY_ERROR",
          `Run source identity is invalid: ${runId}`,
        );
      let sourceBytes: Uint8Array;
      try {
        sourceBytes = await store.readVerified(sourceContentHash);
      } catch (error) {
        throw new WorkspaceOperationError(
          "INTEGRITY_ERROR",
          `Run source is missing or corrupt: ${runId}`,
          { cause: error instanceof Error ? error.message : String(error) },
        );
      }
      const configuration = await loadPinnedConfiguration({
        runId,
        read: {
          loadRun: (id) =>
            withReadModel(projectRoot, (model) => model.loadRun(id)),
          listArtifacts: () =>
            withReadModel(projectRoot, (model) => model.listArtifacts()),
          readVerified: (contentHash) => store.readVerified(contentHash),
        },
      });
      const authority = SqliteAuthority.open(
        join(store.workspace.root, "state.db"),
        { artifactStore: store },
      );
      try {
        return await approveSourceExclusion({
          authority,
          runId,
          exclusionId,
          startOffset,
          endOffset,
          expectedSourceContentHash: sourceContentHash,
          sourceByteLength: sourceBytes.byteLength,
          reason,
          configuration,
          actor: {
            kind: "human",
            displayName: configuration.humanActorDisplayName,
            osAccount: userInfo().username,
          },
        });
      } catch (error) {
        if (error instanceof DomainTransitionError)
          throw new WorkspaceOperationError("CONFLICT", error.message, {
            domainCode: error.code,
          });
        if (error instanceof TypeError)
          throw new WorkspaceOperationError("INVALID_INPUT", error.message);
        throw error;
      } finally {
        authority.close();
      }
    },
    async executeNext(projectRoot, runId) {
      const store = await ContentAddressedArtifactStore.open(projectRoot);
      const state = await withReadModel(projectRoot, (model) =>
        model.loadRun(runId),
      );
      if (state === null)
        throw new WorkspaceOperationError(
          "RUN_NOT_FOUND",
          `Run not found: ${runId}`,
          { runId },
        );
      const identity = state as {
        configurationArtifactId?: unknown;
        configurationContentHash?: unknown;
        stateVersion?: unknown;
      };
      if (
        typeof identity.configurationArtifactId !== "string" ||
        typeof identity.configurationContentHash !== "string" ||
        !Number.isInteger(identity.stateVersion)
      )
        throw new WorkspaceOperationError(
          "INTEGRITY_ERROR",
          `Run configuration identity is invalid: ${runId}`,
        );
      const [configuration, registeredArtifacts] = await Promise.all([
        loadPinnedConfiguration({
          runId,
          read: {
            loadRun: (id) =>
              withReadModel(projectRoot, (model) => model.loadRun(id)),
            listArtifacts: () =>
              withReadModel(projectRoot, (model) => model.listArtifacts()),
            readVerified: (contentHash) => store.readVerified(contentHash),
          },
        }),
        withReadModel(projectRoot, (model) => model.listArtifacts()),
      ]);
      const authority = SqliteAuthority.open(
        join(store.workspace.root, "state.db"),
        { artifactStore: store },
      );
      try {
        return await executeNextLocalCommand({
          execution: authority,
          staging: store,
          readVerified: (contentHash) => store.readVerified(contentHash),
          registeredArtifacts,
          runId,
          currentState: state as NonterminalRunState,
          configurationArtifactId: identity.configurationArtifactId,
          configurationContentHash: identity.configurationContentHash,
          configuration,
          ownerProcess: `factory-cli:${process.pid}`,
        });
      } finally {
        authority.close();
      }
    },
    async approveLedger(projectRoot, runId) {
      const store = await ContentAddressedArtifactStore.open(projectRoot);
      const state = await withReadModel(projectRoot, (model) =>
        model.loadRun(runId),
      );
      if (state === null)
        throw new WorkspaceOperationError(
          "RUN_NOT_FOUND",
          `Run not found: ${runId}`,
          { runId },
        );
      const reportHash = (
        state as {
          currentLedger?: {
            validation?: { coverageReportContentHash?: unknown };
          };
        }
      ).currentLedger?.validation?.coverageReportContentHash;
      if (typeof reportHash !== "string")
        throw new WorkspaceOperationError(
          "CONFLICT",
          "Ledger has no accepted validation result",
        );
      let coverageReportBytes: Uint8Array;
      try {
        coverageReportBytes = await store.readVerified(reportHash);
      } catch (error) {
        throw new WorkspaceOperationError(
          "INTEGRITY_ERROR",
          "Coverage report is missing or corrupt",
          { cause: error instanceof Error ? error.message : String(error) },
        );
      }
      const configuration = await loadPinnedConfiguration({
        runId,
        read: {
          loadRun: (id) =>
            withReadModel(projectRoot, (model) => model.loadRun(id)),
          listArtifacts: () =>
            withReadModel(projectRoot, (model) => model.listArtifacts()),
          readVerified: (contentHash) => store.readVerified(contentHash),
        },
      });
      const authority = SqliteAuthority.open(
        join(store.workspace.root, "state.db"),
        { artifactStore: store },
      );
      try {
        return await approveLedger({
          authority,
          runId,
          coverageReportBytes,
          configuration,
          actor: {
            kind: "human",
            displayName: configuration.humanActorDisplayName,
            osAccount: userInfo().username,
          },
        });
      } catch (error) {
        if (
          error instanceof WorkspaceOperationError ||
          error instanceof DomainTransitionError
        ) {
          if (error instanceof WorkspaceOperationError) throw error;
          throw new WorkspaceOperationError("CONFLICT", error.message, {
            domainCode: error.code,
          });
        }
        throw error;
      } finally {
        authority.close();
      }
    },
    async requestPlanning(projectRoot, runId, acceptance) {
      const store = await ContentAddressedArtifactStore.open(projectRoot);
      const configuration = await loadPinnedConfiguration({
        runId,
        read: {
          loadRun: (id) =>
            withReadModel(projectRoot, (model) => model.loadRun(id)),
          listArtifacts: () =>
            withReadModel(projectRoot, (model) => model.listArtifacts()),
          readVerified: (contentHash) => store.readVerified(contentHash),
        },
      });
      const registeredArtifacts = await withReadModel(projectRoot, (model) =>
        model.listArtifacts(),
      );
      const authority = SqliteAuthority.open(
        join(store.workspace.root, "state.db"),
        { artifactStore: store },
      );
      try {
        return await requestPlanning({
          authority,
          runId,
          configuration,
          registeredArtifacts,
          policyAccepted: acceptance.policy,
          budgetsAccepted: acceptance.budgets,
          providerBoundaryAcknowledged: acceptance.providerBoundary,
          actor: {
            kind: "human",
            displayName: configuration.humanActorDisplayName,
            osAccount: userInfo().username,
          },
        });
      } catch (error) {
        if (error instanceof WorkspaceOperationError) throw error;
        if (error instanceof DomainTransitionError)
          throw new WorkspaceOperationError("CONFLICT", error.message, {
            domainCode: error.code,
          });
        throw error;
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
