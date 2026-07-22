#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const CLIENTS = new Set(["github-copilot-vscode", "github-copilot-cli"]);
const TIERS = new Set(["simple", "standard", "complex"]);
const IAC_TRACKS = new Set(["neutral", "bicep", "terraform"]);
const EVIDENCE_KINDS = new Set(["fixture", "live"]);
const PROHIBITED_KEYS = /(?:prompt|response|message|content|transcript|tool.*(?:argument|result)|credential|secret)/iu;

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string`);
  return value;
}

function requireChoice(value, name, choices) {
  requireString(value, name);
  if (!choices.has(value)) throw new Error(`${name} has unsupported value: ${value}`);
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

export function normalizeClientContextSample(source, metadata) {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("source must be a profiler JSON object");
  }
  rejectContentFields(source);
  if (source.schemaVersion !== "1.0.0" || source.format !== "apex-debug-profile") {
    throw new Error("source must use apex-debug-profile schemaVersion 1.0.0");
  }
  const totals = source.totals;
  if (totals === null || typeof totals !== "object" || Array.isArray(totals)) {
    throw new Error("source.totals must be an object");
  }

  const sample = {
    schemaVersion: "1.0.0",
    client: {
      id: requireChoice(metadata.client, "client", CLIENTS),
      version: requireString(metadata.clientVersion, "clientVersion"),
    },
    scenario: {
      id: requireString(metadata.scenarioId, "scenarioId"),
      tier: requireChoice(metadata.tier, "tier", TIERS),
      iacTrack: requireChoice(metadata.iacTrack, "iacTrack", IAC_TRACKS),
      retry: metadata.retry === true,
    },
    evidence: {
      kind: requireChoice(metadata.evidenceKind, "evidenceKind", EVIDENCE_KINDS),
      sourceFormat: source.format,
      contentCapture: false,
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
  const sampleId = createHash("sha256").update(stableJson(sample)).digest("hex");
  return { ...sample, sampleId };
}

export function parseArgs(args) {
  const options = { retry: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--retry") {
      options.retry = true;
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`unexpected argument: ${argument}`);
    const name = argument.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[name] = value;
    index += 1;
  }
  for (const name of ["source", "client", "clientVersion", "scenarioId", "tier", "iacTrack", "evidenceKind"]) {
    if (!options[name])
      throw new Error(`--${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)} is required`);
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
