#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WorkflowEngine } from "../../packages/kernel/dist/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

try {
  const engine = new WorkflowEngine(JSON.parse(readFileSync(path.join(repoRoot, "config/workflow.v1.json"), "utf8")));
  console.log(`Current vNext workflow is valid (${engine.manifest.nodes.length} nodes)`);
} catch (error) {
  console.error(`Invalid vNext workflow: ${error.message}`);
  process.exitCode = 1;
}
