#!/usr/bin/env node
/** Build a candidate-bound context receipt from normalized live client samples. */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { aggregateClientContextSamples } from "./aggregate-client-context-samples.mjs";

const GATE_PATH = "tools/registry/optimization-gate.v1.json";
const MATRIX_PATH = "tools/registry/client-context-matrix.json";
const SCHEMA_PATH = "tools/registry/schemas/optimization-context-receipt.schema.json";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function parseContextReceiptArgs(args) {
  const options = Object.create(null);
  const samples = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      samples.push(value);
      continue;
    }
    if (!new Set(["--output", "--collected-at"]).has(value)) throw new Error(`unsupported option: ${value}`);
    if (Object.hasOwn(options, value)) throw new Error(`${value} may be specified only once`);
    const argument = args[index + 1];
    if (!argument || argument.startsWith("--")) throw new Error(`${value} requires a value`);
    options[value] = argument;
    index += 1;
  }
  if (samples.length === 0 || !options["--output"] || !options["--collected-at"]) {
    throw new Error("live sample paths, --output, and --collected-at are required");
  }
  return { samples, output: options["--output"], collectedAt: options["--collected-at"] };
}

export function buildOptimizationContextReceipt({ gate, matrix, samples, collectedAt }) {
  if (gate.state !== "authorized" || gate.authorization.status !== "approved") {
    throw new Error("authorized optimization gate is required");
  }
  if (samples.some((sample) => sample.evidence?.kind !== "live" || sample.evidence?.contentCapture !== false)) {
    throw new Error("only content-free live client samples are accepted");
  }
  const aggregate = aggregateClientContextSamples(samples, matrix);
  if (!aggregate.coverage?.complete) throw new Error("live client matrix coverage is incomplete");
  return {
    schemaVersion: "1.0.0",
    collectedAt,
    candidate: { commit: gate.candidate.commit, tree: gate.candidate.tree },
    authorization: { status: "live-client-measurement-required" },
    matrixId: matrix.id,
    aggregate: {
      sha256: createHash("sha256").update(stableJson(aggregate)).digest("hex"),
      sampleCount: aggregate.sampleCount,
      coverageComplete: aggregate.coverage.complete,
    },
    evidence: { kind: "live", contentCapture: false },
  };
}

export function validateOptimizationContextReceipt(receipt, schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  if (ajv.validate(schema, receipt)) return [];
  return (ajv.errors ?? []).map(({ instancePath, message }) => `schema ${instancePath || "/"}: ${message}`);
}

function main() {
  try {
    const { samples: samplePaths, output, collectedAt } = parseContextReceiptArgs(process.argv.slice(2));
    const gate = JSON.parse(readFileSync(GATE_PATH, "utf8"));
    const matrix = JSON.parse(readFileSync(MATRIX_PATH, "utf8"));
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
    const samples = samplePaths.map((path) => JSON.parse(readFileSync(path, "utf8")));
    const receipt = buildOptimizationContextReceipt({ gate, matrix, samples, collectedAt });
    const errors = validateOptimizationContextReceipt(receipt, schema);
    if (errors.length > 0) throw new Error(errors.join("; "));
    writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    console.log(`✅ Optimization context receipt written to ${output}`);
    return 0;
  } catch (error) {
    console.error(`❌ Optimization context receipt failed: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
