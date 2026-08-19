import { join } from "node:path";

import type { WorkspaceOperations } from "../../application/workspace-operations.js";
import { WorkspaceOperationError } from "../../application/workspace-operations.js";
import { ContentAddressedArtifactStore } from "../artifacts/object-store.js";
import { SqliteAuthority } from "../sqlite/authority.js";
import { SqliteReadModel } from "../sqlite/read-model.js";

export function createWorkspaceOperations(): WorkspaceOperations {
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
      const readModel = await SqliteReadModel.open(projectRoot);
      try {
        return readModel.listRuns();
      } finally {
        readModel.close();
      }
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
  };
}
