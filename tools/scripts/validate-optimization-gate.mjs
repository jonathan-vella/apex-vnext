#!/usr/bin/env node
/** Validate the candidate-bound, pre-agent repository optimization gate. */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST_REL_PATH = "tools/registry/optimization-gate.v1.json";
const MANIFEST_PATH = path.join(repoRoot, MANIFEST_REL_PATH);
const SCHEMA_PATH = path.join(repoRoot, "tools/registry/schemas/optimization-gate.schema.json");
const PACKAGE_JSON_PATH = path.join(repoRoot, "package.json");

export function collectTrackedPaths(runGit = execFileSync, root = repoRoot) {
  return runGit("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean).sort();
}

function matchesSurface(path, surface) {
  return surface.paths.includes(path) || surface.prefixes.some((prefix) => path.startsWith(prefix));
}

export function validateOptimizationGate({ manifest, schema, scripts, trackedPaths }) {
  const errors = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  if (!ajv.validate(schema, manifest)) {
    return (ajv.errors ?? []).map(({ instancePath, message }) => `schema ${instancePath || "/"}: ${message}`);
  }

  const ids = manifest.surfaces.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) errors.push("surface IDs must be unique");
  for (const path of trackedPaths) {
    const owners = manifest.surfaces.filter((surface) => matchesSurface(path, surface));
    if (owners.length === 0) errors.push(`unowned tracked path: ${path}`);
    if (owners.length > 1) errors.push(`multiply owned tracked path: ${path}`);
  }
  for (const surface of manifest.surfaces) {
    for (const proof of surface.proofCommands) {
      const script = proof.slice("npm run ".length);
      if (scripts[script] === undefined) errors.push(`${surface.id}: unknown proof command: ${proof}`);
    }
  }
  if (manifest.state === "complete") {
    if (manifest.baselines.some(({ status }) => status !== "captured")) {
      errors.push("complete gate requires every baseline to be captured");
    }
    if (
      manifest.findings.some(
        ({ status, expiry, releaseImpact }) => status === "deferred" && (!expiry || !releaseImpact),
      )
    ) {
      errors.push("complete gate requires deferred findings to have expiry and release impact");
    }
    if (manifest.findings.some(({ status, releaseImpact }) => status === "deferred" && releaseImpact === "blocking")) {
      errors.push("complete gate cannot retain deferred release-blocking findings");
    }
  }
  return errors.sort();
}

export function buildOptimizationGateInventory({ manifest, trackedPaths }) {
  return trackedPaths.map((path) => {
    const surface = manifest.surfaces.find((candidate) => matchesSurface(path, candidate));
    return {
      path,
      surface: surface?.id ?? null,
      owner: surface?.owner ?? null,
      consumers: surface?.consumers ?? [],
    };
  });
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const scripts = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")).scripts ?? {};
  const errors = validateOptimizationGate({ manifest, schema, scripts, trackedPaths: collectTrackedPaths() });
  for (const error of errors) console.error(`❌ ${MANIFEST_REL_PATH}: ${error}`);
  if (errors.length === 0) console.log(`✅ Optimization gate manifest is valid (${manifest.state})`);
  return errors.length === 0 ? 0 : 1;
}

if (process.argv[1]?.endsWith("validate-optimization-gate.mjs")) process.exitCode = main();
