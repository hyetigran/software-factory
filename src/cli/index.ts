#!/usr/bin/env node

import { runCliAsync } from "./run.js";

process.exitCode = await runCliAsync(process.argv.slice(2), (line) => {
  process.stdout.write(`${line}\n`);
});
