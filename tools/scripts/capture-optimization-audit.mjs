#!/usr/bin/env node
/** Capture a candidate-tree, read-only optimization audit receipt. */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildOptimizationGateInventory } from "./validate-optimization-gate.mjs";

const MANIFEST_PATH = "tools/registry/optimization-gate.v1.json";
const SCHEMA_PATH = "tools/registry/schemas/optimization-audit-receipt.schema.json";

function gitValue(args, runGit = execFileSync) {
  return runGit("git", args, { encoding: "utf8" }).trim();
}

export function parseAuditArguments(args) {
  const outputIndex = args.indexOf("--output");
  const observedAtIndex = args.indexOf("--collected-at");
  if (
    outputIndex === -1 ||
    observedAtIndex === -1 ||
    outputIndex + 1 >= args.length ||
    observedAtIndex + 1 >= args.length
  ) {
    throw new Error("--output <path> and --collected-at <timestamp> are required");
  }
  if (args.length !== 4) throw new Error("only --output <path> --collected-at <timestamp> is supported");
  return { output: args[outputIndex + 1], observedAt: args[observedAtIndex + 1] };
}

function candidatePaths(commit, runGit) {
  return gitValue(["ls-tree", "-r", "--name-only", commit], runGit).split("\n").filter(Boolean).sort();
}

export function buildOptimizationAudit({ manifest, observedAt, runGit = execFileSync }) {
  if (manifest.state !== "authorized" || manifest.authorization.budget.maxTrackedMutations !== 0) {
    throw new Error("authorized read-only gate with zero tracked mutations is required");
  }
  const paths = candidatePaths(manifest.candidate.commit, runGit);
  const inventory = buildOptimizationGateInventory({ manifest, trackedPaths: paths });
  const entries = inventory.map((entry) => {
    if (entry.surface === null) throw new Error(`unowned candidate path: ${entry.path}`);
    return {
      ...entry,
      byteCount: Number(gitValue(["cat-file", "-s", `${manifest.candidate.commit}:${entry.path}`], runGit)),
    };
  });
  const packageJson = JSON.parse(gitValue(["show", `${manifest.candidate.commit}:package.json`], runGit));
  return {
    schemaVersion: "1.0.0",
    observedAt,
    candidate: { commit: manifest.candidate.commit, tree: manifest.candidate.tree },
    authorization: { status: "read-only-audit", maxTrackedMutations: 0 },
    inventory: entries,
    scripts: Object.entries(packageJson.scripts ?? {})
      .map(([name, command]) => ({ name, command }))
      .sort(({ name: left }, { name: right }) => left.localeCompare(right)),
  };
}

export function validateOptimizationAudit(receipt, schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  if (ajv.validate(schema, receipt)) return [];
  return (ajv.errors ?? []).map(({ instancePath, message }) => `schema ${instancePath || "/"}: ${message}`);
}

function main() {
  try {
    const { output, observedAt } = parseAuditArguments(process.argv.slice(2));
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
    const receipt = buildOptimizationAudit({ manifest, observedAt });
    const errors = validateOptimizationAudit(receipt, schema);
    if (errors.length > 0) throw new Error(errors.join("; "));
    const outputPath = resolve(output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    console.log(`✅ Optimization audit captured at ${outputPath}`);
    return 0;
  } catch (error) {
    console.error(`❌ Optimization audit capture failed: ${error.message}`);
    return 1;
  }
}

if (process.argv[1]?.endsWith("capture-optimization-audit.mjs")) process.exitCode = main();
