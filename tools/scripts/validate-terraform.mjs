#!/usr/bin/env node

import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

function runTerraform(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("terraform", args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

export async function validateTerraformRoots({ root = "infra/terraform", run = runTerraform } = {}) {
  const entries = await readdir(root, { withFileTypes: true });
  const roots = entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name));
  const results = [];

  for (const cwd of roots.sort()) {
    try {
      if (!(await readdir(cwd)).includes("main.tf")) continue;
      const init = await run(cwd, ["init", "-backend=false", "-input=false"]);
      if (init.code !== 0 || init.signal !== null) {
        results.push({ cwd, stage: "init", ...init });
        continue;
      }
      const validate = await run(cwd, ["validate"]);
      if (validate.code !== 0 || validate.signal !== null) results.push({ cwd, stage: "validate", ...validate });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      results.push({ cwd, stage: "init", error });
    }
  }

  return results;
}

async function main() {
  const failures = await validateTerraformRoots();
  if (failures.length === 0) return;
  for (const failure of failures) {
    const detail =
      failure.error instanceof Error ? failure.error.message : `exit=${failure.code} signal=${failure.signal}`;
    console.error(`Terraform ${failure.stage} failed in ${failure.cwd}: ${detail}`);
  }
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("validate-terraform.mjs")) await main();
