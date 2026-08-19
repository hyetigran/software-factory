import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "software-factory-"));
const npmEnvironment = {
  ...process.env,
  npm_config_cache: join(temporaryDirectory, "npm-cache"),
};

try {
  execFileSync("npm", ["pack", "--pack-destination", temporaryDirectory], {
    env: npmEnvironment,
    stdio: "pipe",
  });
  const tarball = readdirSync(temporaryDirectory).find((file) =>
    file.endsWith(".tgz"),
  );
  if (tarball === undefined) {
    throw new Error("npm pack did not produce a tarball");
  }

  const installDirectory = join(temporaryDirectory, "install");
  mkdirSync(installDirectory);
  writeFileSync(join(installDirectory, "package.json"), "{}\n");
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(temporaryDirectory, tarball),
    ],
    {
      cwd: installDirectory,
      env: npmEnvironment,
      stdio: "pipe",
    },
  );

  const output = execFileSync(
    join(installDirectory, "node_modules", ".bin", "factory"),
    ["--version"],
    { encoding: "utf8" },
  ).trim();
  if (output !== "0.0.0") {
    throw new Error(`Unexpected factory version: ${output}`);
  }
  const projectDirectory = join(temporaryDirectory, "project");
  mkdirSync(projectDirectory);
  const executable = join(installDirectory, "node_modules", ".bin", "factory");
  execFileSync(executable, ["init"], {
    cwd: projectDirectory,
    env: npmEnvironment,
    stdio: "pipe",
  });
  const configured = JSON.parse(
    execFileSync(executable, ["configure", "--json"], {
      cwd: projectDirectory,
      env: npmEnvironment,
      encoding: "utf8",
    }),
  );
  if (configured.ok !== true || configured.command !== "configure") {
    throw new Error("Packed CLI could not resolve packaged controls");
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
