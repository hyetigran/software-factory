#!/usr/bin/env node

import { runCliAsync } from "./run.js";
import { createWorkspaceOperations } from "../infrastructure/platform/workspace-operations.js";

process.exitCode = await runCliAsync(
  process.argv.slice(2),
  (line) => {
    process.stdout.write(`${line}\n`);
  },
  createWorkspaceOperations(),
);
