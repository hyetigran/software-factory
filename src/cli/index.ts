#!/usr/bin/env node

import { runCli } from "./run.js";

process.exitCode = runCli(process.argv.slice(2), (line) => {
  process.stdout.write(`${line}\n`);
});
