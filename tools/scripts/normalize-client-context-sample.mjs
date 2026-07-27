#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const CLIENTS = new Set(["github-copilot-vscode", "github-copilot-cli"]);
const TIERS = new Set(["simple", "standard", "complex"]);
const IAC_TRACKS = new Set(["neutral", "bicep", "terraform"]);
const EVIDENCE_KINDS = new Set(["fixture", "live"]);
const OPTION_NAMES = new Map([
  ["--source", "source"],
  ["--client", "client"],
  ["--client-version", "clientVersion"],
  ["--extension-version", "extensionVersion"],
  ["--scenario-id", "scenarioId"],
  ["--tier", "tier"],
  ["--iac-track", "iacTrack"],
  ["--evidence-kind", "evidenceKind"],
  ["--output", "output"],
]);
const PROHIBITED_KEYS = /(?:prompt|response|message|content|transcript|tool.*(?:argument|result)|credential|secret)/iu;
const SCENARIO_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SAMPLE_ID = /^[0-9a-f]{64}$/u;
const METRICS = ["inputTokens", "outputTokens", "chatCalls", "cacheReadTokens", "cacheWriteTokens", "cacheHits"];

function requirePlainObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${name} must be a plain object`);
  return value;
}

function requireExactKeys(value, keys, name) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${name} has unsupported or missing fields`);
  }
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string`);
  return value;
}

function requireChoice(value, name, choices) {
  requireString(value, name);
  if (!choices.has(value)) throw new Error(`${name} has unsupported value: ${value}`);
  return value;
}

function requireScenarioId(value) {
  requireString(value, "scenarioId");
  if (!SCENARIO_ID.test(value)) throw new Error("scenarioId must be a lowercase kebab-case identifier");
  return value;
}

function requireCounter(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
  return value;
}

function rejectContentFields(value, path = "source") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectContentFields(entry, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (PROHIBITED_KEYS.test(key)) throw new Error(`${path}.${key} is a prohibited content-bearing field`);
    rejectContentFields(entry, `${path}.${key}`);
  }
}

function measured(value, name) {
  return { status: "measured", value: requireCounter(value, name) };
}

function optionalCounter(value, name) {
  return value === undefined || value === null ? { status: "unavailable" } : measured(value, name);
}

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

export function clientContextSampleId(sample) {
  return createHash("sha256").update(stableJson(sample)).digest("hex");
}

function validateMeasurement(measurement, name, required) {
  requirePlainObject(measurement, name);
  if (measurement.status === "measured") {
    requireExactKeys(measurement, ["status", "value"], name);
    requireCounter(measurement.value, `${name}.value`);
    return;
  }
  if (measurement.status === "unavailable" && !required) {
    requireExactKeys(measurement, ["status"], name);
    return;
  }
  throw new Error(`${name} has an invalid status`);
}

export function validateNormalizedClientContextSample(sample) {
  requirePlainObject(sample, "sample");
  requireExactKeys(sample, ["schemaVersion", "client", "scenario", "evidence", "metrics", "sampleId"], "sample");
  if (sample.schemaVersion !== "1.0.0" || !SAMPLE_ID.test(sample.sampleId)) {
    throw new Error("sample must use client-context-sample schemaVersion 1.0.0");
  }

  requirePlainObject(sample.client, "sample.client");
  const clientId = requireChoice(sample.client.id, "sample.client.id", CLIENTS);
  requireExactKeys(
    sample.client,
    clientId === "github-copilot-vscode" ? ["id", "version", "extensionVersion"] : ["id", "version"],
    "sample.client",
  );
  requireString(sample.client.version, "sample.client.version");
  if (clientId === "github-copilot-vscode") {
    requireString(sample.client.extensionVersion, "sample.client.extensionVersion");
  }

  requirePlainObject(sample.scenario, "sample.scenario");
  requireExactKeys(sample.scenario, ["id", "tier", "iacTrack", "retry"], "sample.scenario");
  requireScenarioId(sample.scenario.id);
  requireChoice(sample.scenario.tier, "sample.scenario.tier", TIERS);
  requireChoice(sample.scenario.iacTrack, "sample.scenario.iacTrack", IAC_TRACKS);
  if (typeof sample.scenario.retry !== "boolean") throw new Error("sample.scenario.retry must be a boolean");

  requirePlainObject(sample.evidence, "sample.evidence");
  requireExactKeys(
    sample.evidence,
    clientId === "github-copilot-vscode"
      ? ["kind", "sourceFormat", "contentCapture", "sourceDigest"]
      : ["kind", "sourceFormat", "contentCapture"],
    "sample.evidence",
  );
  requireChoice(sample.evidence.kind, "sample.evidence.kind", EVIDENCE_KINDS);
  if (sample.evidence.sourceFormat !== "apex-debug-profile" || sample.evidence.contentCapture !== false) {
    throw new Error("sample.evidence must attest apex-debug-profile with content capture disabled");
  }
  if (clientId === "github-copilot-vscode" && !SAMPLE_ID.test(sample.evidence.sourceDigest)) {
    throw new Error("sample.evidence.sourceDigest must be a SHA-256 digest");
  }

  requirePlainObject(sample.metrics, "sample.metrics");
  requireExactKeys(sample.metrics, METRICS, "sample.metrics");
  for (const metric of METRICS) {
    validateMeasurement(
      sample.metrics[metric],
      `sample.metrics.${metric}`,
      ["inputTokens", "outputTokens", "chatCalls"].includes(metric),
    );
  }

  const { sampleId, ...body } = sample;
  if (sampleId !== clientContextSampleId(body)) throw new Error("sampleId does not match normalized sample content");
  return sample;
}

export function normalizeClientContextSample(source, metadata) {
  requirePlainObject(source, "source");
  const { content_capture: contentCapture, ...profile } = source;
  rejectContentFields(profile);
  const clientId = requireChoice(metadata.client, "client", CLIENTS);
  const extensionVersion =
    clientId === "github-copilot-vscode" ? requireString(metadata.extensionVersion, "extensionVersion") : undefined;
  requireExactKeys(
    source,
    clientId === "github-copilot-vscode"
      ? ["schemaVersion", "format", "content_capture", "source_sha256", "producer", "totals"]
      : ["schemaVersion", "format", "content_capture", "totals"],
    "source",
  );
  if (source.schemaVersion !== "1.0.0" || source.format !== "apex-debug-profile") {
    throw new Error("source must use apex-debug-profile schemaVersion 1.0.0");
  }
  if (contentCapture !== false) {
    throw new Error("source must attest content_capture false");
  }
  if (clientId === "github-copilot-vscode") {
    if (!SAMPLE_ID.test(source.source_sha256)) throw new Error("source.source_sha256 must be a SHA-256 digest");
    requirePlainObject(source.producer, "source.producer");
    requireExactKeys(source.producer, ["name", "version"], "source.producer");
    if (source.producer.name !== "copilot-chat" || source.producer.version !== extensionVersion) {
      throw new Error("source producer does not match the VS Code client metadata");
    }
  }
  const totals = requirePlainObject(source.totals, "source.totals");
  const allowedTotals = [
    "input_tokens",
    "output_tokens",
    "chat_calls",
    "cache_read_tokens",
    "cache_write_tokens",
    "cache_hits",
  ];
  if (Object.keys(totals).some((key) => !allowedTotals.includes(key)))
    throw new Error("source.totals has unsupported fields");

  const sample = {
    schemaVersion: "1.0.0",
    client: {
      id: clientId,
      version: requireString(metadata.clientVersion, "clientVersion"),
      ...(clientId === "github-copilot-vscode" ? { extensionVersion } : {}),
    },
    scenario: {
      id: requireScenarioId(metadata.scenarioId),
      tier: requireChoice(metadata.tier, "tier", TIERS),
      iacTrack: requireChoice(metadata.iacTrack, "iacTrack", IAC_TRACKS),
      retry: metadata.retry === true,
    },
    evidence: {
      kind: requireChoice(metadata.evidenceKind, "evidenceKind", EVIDENCE_KINDS),
      sourceFormat: source.format,
      contentCapture: false,
      ...(clientId === "github-copilot-vscode" ? { sourceDigest: source.source_sha256 } : {}),
    },
    metrics: {
      inputTokens: measured(totals.input_tokens, "totals.input_tokens"),
      outputTokens: measured(totals.output_tokens, "totals.output_tokens"),
      chatCalls: measured(totals.chat_calls, "totals.chat_calls"),
      cacheReadTokens: optionalCounter(totals.cache_read_tokens, "totals.cache_read_tokens"),
      cacheWriteTokens: optionalCounter(totals.cache_write_tokens, "totals.cache_write_tokens"),
      cacheHits: optionalCounter(totals.cache_hits, "totals.cache_hits"),
    },
  };
  return validateNormalizedClientContextSample({ ...sample, sampleId: clientContextSampleId(sample) });
}

export function parseArgs(args) {
  const options = Object.assign(Object.create(null), { retry: false });
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--retry") {
      if (seen.has(argument)) throw new Error(`${argument} may be specified only once`);
      seen.add(argument);
      options.retry = true;
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`unexpected argument: ${argument}`);
    const name = OPTION_NAMES.get(argument);
    if (!name) throw new Error(`unsupported option: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    if (seen.has(argument)) throw new Error(`${argument} may be specified only once`);
    seen.add(argument);
    options[name] = value;
    index += 1;
  }
  for (const name of ["source", "client", "clientVersion", "scenarioId", "tier", "iacTrack", "evidenceKind"]) {
    if (!options[name])
      throw new Error(`--${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  if (options.client === "github-copilot-vscode" && !options.extensionVersion) {
    throw new Error("--extension-version is required for github-copilot-vscode");
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const source = JSON.parse(readFileSync(options.source, "utf8"));
    const sample = normalizeClientContextSample(source, options);
    const output = `${JSON.stringify(sample, null, 2)}\n`;
    if (options.output) writeFileSync(options.output, output);
    else process.stdout.write(output);
  } catch (error) {
    process.stderr.write(`client context sample: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
