#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import { reportRegistryValidation, requestedReportFormat } from "./_lib/registry-validator-reporter.mjs";

const MANIFEST = "tools/registry/modernization-ownership.json";
const SCHEMA = "tools/registry/schemas/modernization-ownership.schema.json";
const DOCUMENT = "docs/vnext/MODERNIZATION-INVENTORY.md";
const REQUIRED_BASELINES = ["ci", "context", "dependencies", "diagnostics", "drift", "hooks"];

export function validateModernizationOwnership({ manifest, schema, document, scripts, glob = globSync }) {
  const errors = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  if (!ajv.validate(schema, manifest)) {
    errors.push(...(ajv.errors ?? []).map((error) => `schema ${error.instancePath || "/"}: ${error.message}`));
    return errors;
  }

  const ids = manifest.surfaces.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) errors.push("surface IDs must be unique");
  const decisionIds = manifest.decisions.map(({ id }) => id);
  if (new Set(decisionIds).size !== decisionIds.length) errors.push("decision IDs must be unique");
  const baselineIds = manifest.baselines.map(({ id }) => id).sort();
  if (baselineIds.join("\0") !== REQUIRED_BASELINES.join("\0")) {
    errors.push(`baselines must contain exactly: ${REQUIRED_BASELINES.join(", ")}`);
  }

  for (const item of [...manifest.surfaces, ...manifest.baselines]) {
    for (const sourceRef of item.sourceRefs) {
      if (glob(sourceRef, { cwd: process.cwd(), nodir: true }).length === 0) {
        errors.push(`${item.id}: sourceRef matches no files: ${sourceRef}`);
      }
    }
  }
  for (const surface of manifest.surfaces) {
    if (surface.classification !== "keep" && !decisionIds.includes(surface.decisionRef)) {
      errors.push(`${surface.id}: ${surface.classification} requires a valid decisionRef`);
    }
    for (const command of surface.proofCommands) {
      const match = command.match(/^npm run ([^ ]+)$/);
      if (match && scripts[match[1]] === undefined) errors.push(`${surface.id}: unknown npm script: ${match[1]}`);
    }
    if (!document.includes(`\`${surface.id}\``)) errors.push(`${surface.id}: missing from ${DOCUMENT}`);
  }
  for (const decision of manifest.decisions) {
    if (!document.includes(`\`${decision.id}\``)) errors.push(`${decision.id}: missing from ${DOCUMENT}`);
  }
  return errors;
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
  const document = readFileSync(DOCUMENT, "utf8");
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  const errors = validateModernizationOwnership({ manifest, schema, document, scripts });
  process.exitCode = reportRegistryValidation({
    title: "Modernization Ownership Validator",
    source: MANIFEST,
    errors,
    passMessage: "Modernization ownership inventory is valid",
    format: requestedReportFormat(process.argv.slice(2)),
  });
}

if (process.argv[1]?.endsWith("validate-modernization-ownership.mjs")) main();
