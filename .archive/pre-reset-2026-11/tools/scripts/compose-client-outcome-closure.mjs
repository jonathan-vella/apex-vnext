#!/usr/bin/env node
/** Compose a deterministic live client closure from collector-generated outcomes. */

import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  CLIENT_OUTCOME_CLIENT_IDS,
  CLIENT_OUTCOME_SCENARIO_IDS,
  contractMetadata,
} from "../../packages/contracts/dist/index.js";
import { canonicalJson, sha256Json } from "../../packages/kernel/dist/index.js";
import {
  compareClientOutcomes,
  qualifyClientOutcomes,
  verifyClientOutcomeQualification,
} from "./compare-client-outcomes.mjs";
import { readBoundedJson, sanitizedClientOutcomeError } from "./collect-client-outcome.mjs";
import { resolveInputPath } from "./qualify-client-outcomes.mjs";

const OUTCOME_SCHEMA_ID = "https://schemas.apexops.dev/client-outcome-v1.json";
const MANIFEST_MAX_BYTES = 65_536;

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function readOutcomePairs(manifestPath) {
  const manifest = readBoundedJson(manifestPath, MANIFEST_MAX_BYTES);
  if (
    manifest?.schemaVersion !== "1.0.0" ||
    !Array.isArray(manifest.outcomes) ||
    manifest.outcomes.length !== CLIENT_OUTCOME_SCENARIO_IDS.length * CLIENT_OUTCOME_CLIENT_IDS.length ||
    Object.keys(manifest).sort().join(",") !== "outcomes,schemaVersion"
  ) {
    throw new TypeError("CLOSURE_MANIFEST_INVALID");
  }
  const paths = new Set();
  const pairs = new Map();
  const maxBytes = contractMetadata[OUTCOME_SCHEMA_ID].maxBytes;
  for (const entry of manifest.outcomes) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join(",") !== "clientId,outcomePath,scenarioId" ||
      !CLIENT_OUTCOME_SCENARIO_IDS.includes(entry.scenarioId) ||
      !CLIENT_OUTCOME_CLIENT_IDS.includes(entry.clientId)
    ) {
      throw new TypeError("CLOSURE_MANIFEST_ENTRY_INVALID");
    }
    const inputPath = resolveInputPath(manifestPath, entry.outcomePath);
    if (paths.has(inputPath)) throw new TypeError("CLOSURE_MANIFEST_PATH_DUPLICATE");
    paths.add(inputPath);
    const outcome = readBoundedJson(inputPath, maxBytes);
    if (
      outcome.scenarioId !== entry.scenarioId ||
      outcome.client?.id !== entry.clientId ||
      outcome.evidenceKind !== "live"
    ) {
      throw new TypeError("CLOSURE_OUTCOME_BINDING_INVALID");
    }
    const key = `${entry.scenarioId}:${entry.clientId}`;
    if (pairs.has(key)) throw new TypeError("CLOSURE_OUTCOME_DUPLICATE");
    pairs.set(key, outcome);
  }
  return CLIENT_OUTCOME_SCENARIO_IDS.map((scenarioId) => ({
    scenarioId,
    outcomes: CLIENT_OUTCOME_CLIENT_IDS.map((clientId) => {
      const outcome = pairs.get(`${scenarioId}:${clientId}`);
      if (outcome === undefined) throw new TypeError("CLOSURE_OUTCOME_MISSING");
      return outcome;
    }),
  }));
}

function payload(path, kind, value) {
  const bytes = Buffer.from(canonicalJson(value), "utf8");
  return {
    path,
    kind,
    value,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function composeClientOutcomeClosure({ manifest, output }) {
  const manifestPath = resolve(manifest);
  const outputPath = resolve(output);
  const parent = await realpath(dirname(outputPath));
  if (resolve(parent, basename(outputPath)) !== outputPath || (await pathExists(outputPath))) {
    throw new TypeError("CLOSURE_OUTPUT_INVALID");
  }
  const pairs = readOutcomePairs(manifestPath);
  const triplets = pairs.map(({ outcomes }) => ({ outcomes, comparison: compareClientOutcomes(...outcomes) }));
  const qualification = qualifyClientOutcomes(triplets);
  verifyClientOutcomeQualification(qualification, triplets);

  const outcomePayloads = pairs.flatMap(({ scenarioId, outcomes }) =>
    outcomes.map((outcome) =>
      payload(
        join("outcomes", `${scenarioId}-${outcome.client.id === "github-copilot-vscode" ? "vscode" : "cli"}.json`),
        "client-outcome",
        outcome,
      ),
    ),
  );
  const comparisonPayloads = triplets.map(({ comparison }) =>
    payload(join("comparisons", `${comparison.scenarioId}.json`), "client-outcome-comparison", comparison),
  );
  const qualificationPayload = payload("client-qualification.json", "client-qualification", qualification);
  const closure = {
    schemaVersion: "1.0.0",
    kind: "client-outcome-closure-v1",
    outcomes: outcomePayloads.map(({ path, kind, bytes, sha256 }) => ({ path, kind, bytes: bytes.length, sha256 })),
    comparisons: comparisonPayloads.map(({ path, kind, bytes, sha256 }) => ({
      path,
      kind,
      bytes: bytes.length,
      sha256,
    })),
    qualification: {
      path: qualificationPayload.path,
      kind: qualificationPayload.kind,
      bytes: qualificationPayload.bytes.length,
      sha256: qualificationPayload.sha256,
      qualificationId: qualification.qualificationId,
    },
    qualifiesClientParity: true,
    qualifiesRelease: false,
  };
  const index = { ...closure, closureId: sha256Json(closure) };
  const staging = await mkdtemp(join(parent, ".apex-client-closure-"));
  try {
    for (const item of [...outcomePayloads, ...comparisonPayloads, qualificationPayload]) {
      const destination = join(staging, item.path);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, item.bytes, { flag: "wx", mode: 0o600 });
    }
    await writeFile(join(staging, "closure.json"), `${canonicalJson(index)}\n`, { flag: "wx", mode: 0o600 });
    if (await pathExists(outputPath)) throw new TypeError("CLOSURE_OUTPUT_INVALID");
    await rename(staging, outputPath);
    return index;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  try {
    if (process.argv.length !== 4) throw new TypeError("USAGE_INVALID");
    const result = await composeClientOutcomeClosure({ output: process.argv[2], manifest: process.argv[3] });
    process.stdout.write(`${canonicalJson(result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`CLIENT_OUTCOME_CLOSURE_FAILED:${sanitizedClientOutcomeError(error)}\n`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
