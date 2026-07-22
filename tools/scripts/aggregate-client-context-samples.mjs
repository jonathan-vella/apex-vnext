#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const METRICS = ["inputTokens", "outputTokens", "chatCalls", "cacheReadTokens", "cacheWriteTokens", "cacheHits"];

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
  if (sample?.schemaVersion !== "1.0.0" || typeof sample.sampleId !== "string") {
    throw new Error("every input must be a normalized client context sample");
  }
  if (!sample.client?.id || !sample.scenario?.tier || !sample.scenario?.iacTrack || !sample.metrics) {
    throw new Error(`sample ${sample.sampleId} is missing grouping or metric fields`);
  }
  for (const metric of METRICS) {
    const measurement = sample.metrics[metric];
    if (!measurement || !["measured", "unavailable"].includes(measurement.status)) {
      throw new Error(`sample ${sample.sampleId} has an invalid ${metric} measurement`);
    }
  }
}

export function aggregateClientContextSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error("at least one sample is required");
  const ids = new Set();
  const groups = new Map();
  for (const sample of samples) {
    assertSample(sample);
    if (ids.has(sample.sampleId)) throw new Error(`duplicate sampleId: ${sample.sampleId}`);
    ids.add(sample.sampleId);
    const key = [sample.client.id, sample.scenario.tier, sample.scenario.iacTrack, String(sample.scenario.retry)].join(
      "|",
    );
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  }

  const summaries = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, groupedSamples]) => {
      const [client, tier, iacTrack, retry] = key.split("|");
      return {
        client,
        tier,
        iacTrack,
        retry: retry === "true",
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
