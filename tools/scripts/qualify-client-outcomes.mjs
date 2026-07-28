#!/usr/bin/env node
/** Generate a parity-only aggregate from an explicit outcome/comparison path manifest. */

import fs from "node:fs";
import path from "node:path";
import { CLIENT_OUTCOME_SCENARIO_IDS, contractMetadata } from "../../packages/contracts/dist/index.js";
import { canonicalJson } from "../../packages/kernel/dist/index.js";
import { qualifyClientOutcomes } from "./compare-client-outcomes.mjs";
import { readBoundedJson, sanitizedClientOutcomeError } from "./collect-client-outcome.mjs";

const COMPARISON_SCHEMA_ID = "https://schemas.apexops.dev/client-outcome-comparison-v1.json";
const OUTCOME_SCHEMA_ID = "https://schemas.apexops.dev/client-outcome-v1.json";
const MANIFEST_MAX_BYTES = 65_536;

function resolveInputPath(manifestPath, value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096 || value.includes("\0")) {
    throw new TypeError("MANIFEST_PATH_INVALID");
  }
  return path.resolve(path.dirname(manifestPath), value);
}

function readTriplets(manifestPath) {
  const manifest = readBoundedJson(manifestPath, MANIFEST_MAX_BYTES);
  if (
    manifest?.schemaVersion !== "1.0.0" ||
    !Array.isArray(manifest.triplets) ||
    manifest.triplets.length !== CLIENT_OUTCOME_SCENARIO_IDS.length ||
    Object.keys(manifest).some((key) => !["schemaVersion", "triplets"].includes(key))
  ) {
    throw new TypeError("QUALIFICATION_MANIFEST_INVALID");
  }
  const outcomeMaxBytes = contractMetadata[OUTCOME_SCHEMA_ID].maxBytes;
  const comparisonMaxBytes = contractMetadata[COMPARISON_SCHEMA_ID].maxBytes;
  const paths = new Set();
  return manifest.triplets.map((entry) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join(",") !== "cliOutcomePath,comparisonPath,scenarioId,vscodeOutcomePath"
    ) {
      throw new TypeError("QUALIFICATION_MANIFEST_ENTRY_INVALID");
    }
    const vscodePath = resolveInputPath(manifestPath, entry.vscodeOutcomePath);
    const cliPath = resolveInputPath(manifestPath, entry.cliOutcomePath);
    const comparisonPath = resolveInputPath(manifestPath, entry.comparisonPath);
    for (const inputPath of [vscodePath, cliPath, comparisonPath]) {
      if (paths.has(inputPath)) throw new TypeError("QUALIFICATION_MANIFEST_PATH_DUPLICATE");
      paths.add(inputPath);
    }
    const outcomes = [readBoundedJson(vscodePath, outcomeMaxBytes), readBoundedJson(cliPath, outcomeMaxBytes)];
    const comparison = readBoundedJson(comparisonPath, comparisonMaxBytes);
    if (
      comparison.scenarioId !== entry.scenarioId ||
      outcomes.some((outcome) => outcome.scenarioId !== entry.scenarioId)
    ) {
      throw new TypeError("QUALIFICATION_MANIFEST_SCENARIO_MISMATCH");
    }
    return { outcomes, comparison };
  });
}

function main() {
  try {
    if (process.argv.length !== 4) throw new TypeError("USAGE_INVALID");
    const outputPath = process.argv[2];
    const qualification = qualifyClientOutcomes(readTriplets(process.argv[3]));
    fs.writeFileSync(outputPath, `${canonicalJson(qualification)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return 0;
  } catch (error) {
    console.error(`CLIENT_OUTCOME_QUALIFICATION_FAILED:${sanitizedClientOutcomeError(error)}`);
    return 2;
  }
}

process.exitCode = main();
