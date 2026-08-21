#!/usr/bin/env node
/** Capture a read-only repository baseline for a future authorized optimization gate. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildOptimizationGateInventory, collectTrackedPaths } from "./validate-optimization-gate.mjs";

const MANIFEST_PATH = "tools/registry/optimization-gate.v1.json";
const SCHEMA_PATH = "tools/registry/schemas/optimization-baseline-receipt.schema.json";

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

function gitValue(args, runGit = execFileSync) {
  return runGit("git", args, { encoding: "utf8" }).trim();
}

export function parseOutputPath(args) {
  const index = args.indexOf("--output");
  if (index === -1 || args[index + 1] === undefined || args[index + 1].startsWith("-")) {
    throw new Error("--output <path> is required");
  }
  if (args.length !== 2) throw new Error("only --output <path> is supported");
  return args[index + 1];
}

export function buildOptimizationBaseline({ manifest, observedAt, trackedPaths, stat = statSync, runGit }) {
  const inventory = buildOptimizationGateInventory({ manifest, trackedPaths }).sort(({ path: left }, { path: right }) =>
    left.localeCompare(right),
  );
  const grouped = new Map(manifest.surfaces.map(({ id }) => [id, { id, trackedPathCount: 0, byteCount: 0 }]));
  for (const entry of inventory) {
    const surface = grouped.get(entry.surface);
    if (surface === undefined) throw new Error(`unowned tracked path: ${entry.path}`);
    surface.trackedPathCount += 1;
    surface.byteCount += stat(entry.path).size;
  }
  const inventoryHash = createHash("sha256")
    .update(JSON.stringify(canonicalValue(inventory)))
    .digest("hex");
  return {
    schemaVersion: "1.0.0",
    observedAt,
    candidate: {
      commit: gitValue(["rev-parse", "HEAD"], runGit),
      tree: gitValue(["rev-parse", "HEAD^{tree}"], runGit),
    },
    inventory: { trackedPathCount: trackedPaths.length, sha256: inventoryHash },
    surfaces: [...grouped.values()],
    authorization: { status: "not-granted" },
  };
}

export function validateOptimizationBaseline(receipt, schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  if (ajv.validate(schema, receipt)) return [];
  return (ajv.errors ?? []).map(({ instancePath, message }) => `schema ${instancePath || "/"}: ${message}`);
}

function main() {
  try {
    const outputPath = resolve(parseOutputPath(process.argv.slice(2)));
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
    const receipt = buildOptimizationBaseline({
      manifest,
      observedAt: new Date().toISOString(),
      trackedPaths: collectTrackedPaths(),
    });
    const errors = validateOptimizationBaseline(receipt, schema);
    if (errors.length > 0) throw new Error(errors.join("; "));
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    console.log(`✅ Optimization baseline captured at ${outputPath}`);
    return 0;
  } catch (error) {
    console.error(`❌ Optimization baseline capture failed: ${error.message}`);
    return 1;
  }
}

if (process.argv[1]?.endsWith("capture-optimization-baseline.mjs")) process.exitCode = main();
