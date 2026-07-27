#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { validateNormalizedClientContextSample } from "./normalize-client-context-sample.mjs";

const METRICS = ["inputTokens", "outputTokens", "chatCalls", "cacheReadTokens", "cacheWriteTokens", "cacheHits"];
const REQUIRED_METRICS = new Set(["inputTokens", "outputTokens", "chatCalls"]);
const CLIENTS = new Set(["github-copilot-vscode", "github-copilot-cli"]);
const TIERS = new Set(["simple", "standard", "complex"]);
const IAC_TRACKS = new Set(["neutral", "bicep", "terraform"]);
const SCENARIO_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MATRIX_ID = "milestone-o-stratified-v1";
const MATRIX_SAMPLE_COUNT = 12;
const APPROVED_CLIENTS = [
  { id: "github-copilot-vscode", version: "1.130.0", extensionVersion: "0.58.0" },
  { id: "github-copilot-cli", version: "1.0.73" },
];
const APPROVED_CELLS = [
  {
    id: "simple-neutral-normal",
    scenarioId: "requirements-simple-neutral",
    tier: "simple",
    iacTrack: "neutral",
    retry: false,
  },
  {
    id: "simple-neutral-retry",
    scenarioId: "requirements-simple-neutral",
    tier: "simple",
    iacTrack: "neutral",
    retry: true,
  },
  {
    id: "standard-bicep-normal",
    scenarioId: "architecture-standard-bicep",
    tier: "standard",
    iacTrack: "bicep",
    retry: false,
  },
  {
    id: "standard-bicep-retry",
    scenarioId: "architecture-standard-bicep",
    tier: "standard",
    iacTrack: "bicep",
    retry: true,
  },
  {
    id: "standard-terraform-normal",
    scenarioId: "architecture-standard-terraform",
    tier: "standard",
    iacTrack: "terraform",
    retry: false,
  },
  {
    id: "standard-terraform-retry",
    scenarioId: "architecture-standard-terraform",
    tier: "standard",
    iacTrack: "terraform",
    retry: true,
  },
];
const MATRIX_KEYS = new Set([
  "$schema",
  "schemaVersion",
  "id",
  "evidenceKind",
  "requiredSamples",
  "optionalMetricsPolicy",
  "clients",
  "cells",
]);

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

function matrixCellKey(client, cell) {
  return JSON.stringify([
    client.id,
    client.version,
    client.extensionVersion ?? null,
    cell.scenarioId ?? cell.id,
    cell.tier,
    cell.iacTrack,
    cell.retry,
  ]);
}

export function validateClientContextMatrix(matrix) {
  if (matrix === null || typeof matrix !== "object" || Array.isArray(matrix)) {
    throw new Error("matrix must be an object");
  }
  if (
    Object.keys(matrix).length !== MATRIX_KEYS.size ||
    Object.keys(matrix).some((key) => !MATRIX_KEYS.has(key)) ||
    matrix.$schema !== "schemas/client-context-matrix.schema.json" ||
    matrix.schemaVersion !== "1.0.0" ||
    matrix.id !== MATRIX_ID ||
    matrix.evidenceKind !== "live" ||
    matrix.requiredSamples !== MATRIX_SAMPLE_COUNT ||
    matrix.optionalMetricsPolicy !== "report-only" ||
    stableJson(matrix.clients) !== stableJson(APPROVED_CLIENTS) ||
    stableJson(matrix.cells) !== stableJson(APPROVED_CELLS)
  ) {
    throw new Error("matrix must match the approved milestone-o-stratified-v1 contract");
  }
  return matrix;
}

export function evaluateClientContextCoverage(samples, matrix) {
  validateClientContextMatrix(matrix);
  const expected = new Set(matrix.clients.flatMap((client) => matrix.cells.map((cell) => matrixCellKey(client, cell))));
  const covered = new Set();
  const sourceDigests = new Set();
  for (const sample of samples) {
    if (sample.evidence.kind !== matrix.evidenceKind) throw new Error("matrix aggregation accepts live samples only");
    const key = matrixCellKey(sample.client, sample.scenario);
    if (!expected.has(key)) throw new Error(`sample ${sample.sampleId} is outside the approved matrix`);
    if (covered.has(key)) throw new Error(`multiple samples cover the same approved matrix cell: ${sample.sampleId}`);
    if (sourceDigests.has(sample.evidence.sourceDigest)) {
      throw new Error(`source digest is reused across approved matrix cells: ${sample.evidence.sourceDigest}`);
    }
    covered.add(key);
    sourceDigests.add(sample.evidence.sourceDigest);
  }
  const missing = [];
  for (const client of matrix.clients) {
    for (const cell of matrix.cells) {
      if (!covered.has(matrixCellKey(client, cell))) missing.push({ client, ...cell });
    }
  }
  return {
    matrixId: matrix.id,
    requiredSamples: matrix.requiredSamples,
    coveredSamples: matrix.requiredSamples - missing.length,
    complete: missing.length === 0,
    optionalMetricsPolicy: matrix.optionalMetricsPolicy,
    missing,
  };
}

function summarizeMetric(samples, metric) {
  const values = samples
    .map((sample) => sample.metrics[metric])
    .filter((measurement) => measurement.status === "measured")
    .map((measurement) => measurement.value);
  const total = values.reduce((sum, value) => {
    const result = sum + value;
    if (!Number.isSafeInteger(result)) throw new Error(`${metric} aggregate exceeds the safe integer range`);
    return result;
  }, 0);
  return {
    measuredSamples: values.length,
    unavailableSamples: samples.length - values.length,
    ...(values.length === samples.length
      ? {
          total,
          average: Math.round(total / values.length),
        }
      : {}),
  };
}

function assertSample(sample) {
  try {
    validateNormalizedClientContextSample(sample);
  } catch (error) {
    throw new Error(`every input must be a normalized client context sample: ${error.message}`, { cause: error });
  }
  if (
    !CLIENTS.has(sample.client?.id) ||
    typeof sample.client?.version !== "string" ||
    sample.client.version.trim() === "" ||
    (sample.client.id === "github-copilot-vscode" &&
      (typeof sample.client.extensionVersion !== "string" || sample.client.extensionVersion.trim() === "")) ||
    !SCENARIO_ID.test(sample.scenario?.id) ||
    !TIERS.has(sample.scenario?.tier) ||
    !IAC_TRACKS.has(sample.scenario?.iacTrack) ||
    typeof sample.scenario?.retry !== "boolean" ||
    !sample.metrics
  ) {
    throw new Error(`sample ${sample.sampleId} is missing grouping or metric fields`);
  }
  for (const metric of METRICS) {
    const measurement = sample.metrics[metric];
    if (!measurement || !["measured", "unavailable"].includes(measurement.status)) {
      throw new Error(`sample ${sample.sampleId} has an invalid ${metric} measurement`);
    }
    if (REQUIRED_METRICS.has(metric) && measurement.status !== "measured") {
      throw new Error(`sample ${sample.sampleId} requires a measured ${metric}`);
    }
    if (measurement.status === "measured" && (!Number.isSafeInteger(measurement.value) || measurement.value < 0)) {
      throw new Error(`sample ${sample.sampleId} has an invalid ${metric} value`);
    }
    if (measurement.status === "unavailable" && Object.hasOwn(measurement, "value")) {
      throw new Error(`sample ${sample.sampleId} has a value for unavailable ${metric}`);
    }
  }
}

function groupKey(sample) {
  return JSON.stringify([
    sample.client.id,
    sample.client.version,
    sample.client.extensionVersion ?? null,
    sample.evidence.kind,
    sample.scenario.id,
    sample.scenario.tier,
    sample.scenario.iacTrack,
    sample.scenario.retry,
  ]);
}

export function aggregateClientContextSamples(samples, matrix) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error("at least one sample is required");
  const ids = new Set();
  const groups = new Map();
  for (const sample of samples) {
    assertSample(sample);
    if (ids.has(sample.sampleId)) throw new Error(`duplicate sampleId: ${sample.sampleId}`);
    ids.add(sample.sampleId);
    const key = groupKey(sample);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  }

  const summaries = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, groupedSamples]) => {
      const [client, clientVersion, extensionVersion, evidenceKind, scenarioId, tier, iacTrack, retry] =
        JSON.parse(key);
      return {
        client,
        clientVersion,
        ...(extensionVersion === null ? {} : { extensionVersion }),
        evidenceKind,
        scenarioId,
        tier,
        iacTrack,
        retry,
        sampleCount: groupedSamples.length,
        metrics: Object.fromEntries(METRICS.map((metric) => [metric, summarizeMetric(groupedSamples, metric)])),
      };
    });

  return {
    schemaVersion: "1.0.0",
    sampleCount: samples.length,
    sampleIds: [...ids].sort(),
    summaries,
    ...(matrix ? { coverage: evaluateClientContextCoverage(samples, matrix) } : {}),
  };
}

export function parseAggregateArgs(args) {
  const options = Object.create(null);
  const samples = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      samples.push(argument);
      continue;
    }
    if (!new Set(["--matrix", "--output"]).has(argument)) throw new Error(`unsupported option: ${argument}`);
    if (Object.hasOwn(options, argument)) throw new Error(`${argument} may be specified only once`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[argument] = value;
    index += 1;
  }
  if (samples.length === 0) throw new Error("at least one sample path is required");
  if (!options["--matrix"]) throw new Error("--matrix is required");
  return { samples, matrixPath: options["--matrix"], outputPath: options["--output"] };
}

function main() {
  try {
    const options = parseAggregateArgs(process.argv.slice(2));
    const samples = options.samples.map((path) => JSON.parse(readFileSync(path, "utf8")));
    const matrix = JSON.parse(readFileSync(options.matrixPath, "utf8"));
    const output = `${JSON.stringify(aggregateClientContextSamples(samples, matrix), null, 2)}\n`;
    if (options.outputPath) writeFileSync(options.outputPath, output);
    else process.stdout.write(output);
  } catch (error) {
    process.stderr.write(`client context aggregate: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
