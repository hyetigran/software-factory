import { join } from "node:path";

import type { WorkspaceOperations } from "../../application/workspace-operations.js";
import { WorkspaceOperationError } from "../../application/workspace-operations.js";
import { ContentAddressedArtifactStore } from "../artifacts/object-store.js";
import { SqliteAuthority } from "../sqlite/authority.js";
import { SqliteReadModel } from "../sqlite/read-model.js";

export function createWorkspaceOperations(): WorkspaceOperations {
  async function withReadModel<T>(
    projectRoot: string,
    read: (model: SqliteReadModel) => T,
  ): Promise<T> {
    const model = await SqliteReadModel.open(projectRoot);
    try {
      return read(model);
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
      return withReadModel(projectRoot, (model) => {
        if (runId !== undefined && model.loadRun(runId) === null) {
          throw new WorkspaceOperationError(
            "RUN_NOT_FOUND",
            `Run not found: ${runId}`,
            { runId },
          );
        }
        return model.listArtifacts(runId);
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
