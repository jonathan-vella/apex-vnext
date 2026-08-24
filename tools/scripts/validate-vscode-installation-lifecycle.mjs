#!/usr/bin/env node
/** Validate the VS Code installation lifecycle qualification matrix. */

import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";

const MATRIX_PATH = "tools/registry/vscode-installation-lifecycle.v1.json";
const SCHEMA_PATH = "tools/registry/schemas/vscode-installation-lifecycle.schema.json";
const REQUIRED_IDS = new Set([
  "VSCODE-LIFECYCLE-001",
  "VSCODE-LIFECYCLE-002",
  "VSCODE-LIFECYCLE-003",
  "VSCODE-LIFECYCLE-004",
  "VSCODE-LIFECYCLE-005",
]);

export function validateVscodeInstallationLifecycle(matrix, schema) {
  const errors = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  if (!ajv.validate(schema, matrix)) {
    return (ajv.errors ?? []).map(({ instancePath, message }) => `schema ${instancePath || "/"}: ${message}`);
  }
  const ids = matrix.scenarios.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) errors.push("scenario IDs must be unique");
  if (ids.length !== REQUIRED_IDS.size || ids.some((id) => !REQUIRED_IDS.has(id))) {
    errors.push("scenario IDs must match the approved VS Code lifecycle matrix");
  }
  for (const scenario of matrix.scenarios) {
    for (const path of scenario.deterministicEvidence) {
      if (!existsSync(path)) errors.push(`${scenario.id}: deterministic evidence path is missing: ${path}`);
    }
    if (scenario.liveStatus === "passed" && scenario.liveEvidenceRef === undefined) {
      errors.push(`${scenario.id}: passed live status requires live evidence`);
    }
    if (scenario.liveStatus !== "passed" && scenario.liveEvidenceRef !== undefined) {
      errors.push(`${scenario.id}: non-passed live status cannot claim live evidence`);
    }
  }
  return errors.sort();
}

function main() {
  const matrix = JSON.parse(readFileSync(MATRIX_PATH, "utf8"));
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const errors = validateVscodeInstallationLifecycle(matrix, schema);
  for (const error of errors) console.error(`❌ ${MATRIX_PATH}: ${error}`);
  if (errors.length === 0) console.log("✅ VS Code installation lifecycle matrix is valid");
  return errors.length === 0 ? 0 : 1;
}

if (process.argv[1]?.endsWith("validate-vscode-installation-lifecycle.mjs")) process.exitCode = main();
