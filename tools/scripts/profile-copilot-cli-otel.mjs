#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const INPUT_TOKENS = "gen_ai.usage.input_tokens";
const OUTPUT_TOKENS = "gen_ai.usage.output_tokens";
const CACHE_WRITE_TOKENS = "gen_ai.usage.cache_creation.input_tokens";
const PRODUCER_NAME = "github.copilot";
const ALLOWED_OPTIONS = new Set(["source", "output", "content-capture", "producer-version"]);

function counter(attributes, key, lineNumber) {
  if (!(key in attributes)) return null;
  const value = attributes[key];
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`line ${lineNumber}: ${key} must be a non-negative safe integer`);
  }
  return value;
}

function addCounter(total, value, name) {
  const result = total + value;
  if (!Number.isSafeInteger(result)) throw new Error(`${name} total exceeds the safe integer range`);
  return result;
}

function decodeSource(source) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source, "utf8");
  try {
    return { bytes, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch (error) {
    throw new Error("telemetry source must be valid UTF-8", { cause: error });
  }
}

export function assertDistinctPaths(source, output) {
  if (!output) return;
  const sourcePath = realpathSync(source);
  const outputPath = resolve(output);
  if (sourcePath === outputPath) throw new Error("--output must not overwrite --source");
  if (existsSync(outputPath)) {
    const sourceStat = statSync(sourcePath);
    const outputStat = statSync(realpathSync(outputPath));
    if (sourceStat.dev === outputStat.dev && sourceStat.ino === outputStat.ino) {
      throw new Error("--output must not alias --source");
    }
  }
}

export function profileCopilotCliOtel(source, { contentCapture, producerVersion } = {}) {
  if (contentCapture !== false) throw new Error("content capture must be explicitly attested as disabled");
  if (typeof producerVersion !== "string" || producerVersion.trim() === "") {
    throw new Error("producer version must be explicitly attested");
  }
  const { bytes, text } = decodeSource(source);
  const totals = { input_tokens: 0, output_tokens: 0, chat_calls: 0 };
  let cacheWriteTokens = 0;
  let allCacheWritesMeasured = true;
  const lines = text.split(/\r?\n/u);

  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`line ${index + 1}: invalid JSON`);
    }
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`line ${index + 1}: telemetry record must be an object`);
    }
    if (typeof record.name !== "string" || !record.name.startsWith("chat ")) continue;
    if (
      record.instrumentationScope?.name !== PRODUCER_NAME ||
      record.instrumentationScope?.version !== producerVersion
    ) {
      throw new Error(`line ${index + 1}: chat record has an unsupported producer`);
    }
    const attributes = record.attributes;
    if (attributes === null || typeof attributes !== "object" || Array.isArray(attributes)) {
      throw new Error(`line ${index + 1}: chat record attributes must be an object`);
    }

    const inputTokens = counter(attributes, INPUT_TOKENS, index + 1);
    const outputTokens = counter(attributes, OUTPUT_TOKENS, index + 1);
    if (inputTokens === null || outputTokens === null) {
      throw new Error(`line ${index + 1}: chat record is missing exact token counters`);
    }
    totals.input_tokens = addCounter(totals.input_tokens, inputTokens, INPUT_TOKENS);
    totals.output_tokens = addCounter(totals.output_tokens, outputTokens, OUTPUT_TOKENS);
    totals.chat_calls = addCounter(totals.chat_calls, 1, "chat_calls");

    const cacheTokens = counter(attributes, CACHE_WRITE_TOKENS, index + 1);
    if (cacheTokens === null) allCacheWritesMeasured = false;
    else cacheWriteTokens = addCounter(cacheWriteTokens, cacheTokens, CACHE_WRITE_TOKENS);
  }

  if (totals.chat_calls === 0) throw new Error("telemetry contains no chat records");
  if (allCacheWritesMeasured) totals.cache_write_tokens = cacheWriteTokens;
  return {
    schemaVersion: "1.0.0",
    format: "apex-debug-profile",
    content_capture: false,
    source_sha256: createHash("sha256").update(bytes).digest("hex"),
    producer: { name: PRODUCER_NAME, version: producerVersion },
    totals,
  };
}

export function parseArgs(args) {
  const options = Object.create(null);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) throw new Error(`unexpected argument: ${argument}`);
    const name = argument.slice(2);
    if (!ALLOWED_OPTIONS.has(name)) throw new Error(`unsupported option: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    if (Object.hasOwn(options, name)) throw new Error(`${argument} may be specified only once`);
    options[name] = value;
    index += 1;
  }
  if (!options.source) throw new Error("--source is required");
  if (options["content-capture"] !== "false") throw new Error("--content-capture false is required");
  if (!options["producer-version"]) throw new Error("--producer-version is required");
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    assertDistinctPaths(options.source, options.output);
    const profile = profileCopilotCliOtel(readFileSync(options.source), {
      contentCapture: false,
      producerVersion: options["producer-version"],
    });
    const output = `${JSON.stringify(profile, null, 2)}\n`;
    if (options.output) writeFileSync(options.output, output);
    else process.stdout.write(output);
  } catch (error) {
    process.stderr.write(`Copilot CLI OTel profile: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
