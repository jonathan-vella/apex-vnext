#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { WorkflowEngine } from "../../packages/kernel/dist/index.js";

try {
  const engine = new WorkflowEngine(JSON.parse(readFileSync("config/workflow.v1.json", "utf8")));
  console.log(`Current vNext workflow is valid (${engine.manifest.nodes.length} nodes)`);
} catch (error) {
  console.error(`Invalid vNext workflow: ${error.message}`);
  process.exitCode = 1;
}
