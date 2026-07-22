#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const METRICS = ["inputTokens", "outputTokens", "chatCalls", "cacheReadTokens", "cacheWriteTokens", "cacheHits"];
const REQUIRED_METRICS = new Set(["inputTokens", "outputTokens", "chatCalls"]);
const CLIENTS = new Set(["github-copilot-vscode", "github-copilot-cli"]);
const TIERS = new Set(["simple", "standard", "complex"]);
const IAC_TRACKS = new Set(["neutral", "bicep", "terraform"]);
const SCENARIO_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SAMPLE_ID = /^[0-9a-f]{64}$/u;

function summarizeMetric(samples, metric) {
  const values = samples
    .map((sample) => sample.metrics[metric])
    .filter((measurement) => measurement.status === "measured")
    .map((measurement) => measurement.value);
  return {
    measuredSamples: values.length,
    unavailableSamples: samples.length - values.length,
    ...(values.length === samples.length
      ? {
          total: values.reduce((total, value) => total + value, 0),
          average: Math.round(values.reduce((total, value) => total + value, 0) / values.length),
        }
      : {}),
  };
}

function assertSample(sample) {
  if (sample?.schemaVersion !== "1.0.0" || !SAMPLE_ID.test(sample.sampleId)) {
    throw new Error("every input must be a normalized client context sample");
  }
  if (
    !CLIENTS.has(sample.client?.id) ||
    typeof sample.client?.version !== "string" ||
    sample.client.version.trim() === "" ||
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
    sample.scenario.id,
    sample.scenario.tier,
    sample.scenario.iacTrack,
    sample.scenario.retry,
  ]);
}

export function aggregateClientContextSamples(samples) {
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
      const [client, scenarioId, tier, iacTrack, retry] = JSON.parse(key);
      return {
        client,
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
  };
}

function main() {
  try {
    const args = process.argv.slice(2);
    const outputIndex = args.indexOf("--output");
    const outputPath = outputIndex >= 0 ? args.splice(outputIndex, 2)[1] : undefined;
    if (outputIndex >= 0 && !outputPath) throw new Error("--output requires a value");
    const samples = args.map((path) => JSON.parse(readFileSync(path, "utf8")));
    const output = `${JSON.stringify(aggregateClientContextSamples(samples), null, 2)}\n`;
    if (outputPath) writeFileSync(outputPath, output);
    else process.stdout.write(output);
  } catch (error) {
    process.stderr.write(`client context aggregate: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
