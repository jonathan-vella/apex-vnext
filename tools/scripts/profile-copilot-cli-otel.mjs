#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const INPUT_TOKENS = "gen_ai.usage.input_tokens";
const OUTPUT_TOKENS = "gen_ai.usage.output_tokens";
const CACHE_WRITE_TOKENS = "gen_ai.usage.cache_creation.input_tokens";
const ALLOWED_OPTIONS = new Set(["source", "output", "content-capture"]);

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

export function profileCopilotCliOtel(text, { contentCapture } = {}) {
  if (contentCapture !== false) throw new Error("content capture must be explicitly attested as disabled");
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
  return { schemaVersion: "1.0.0", format: "apex-debug-profile", content_capture: false, totals };
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
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const profile = profileCopilotCliOtel(readFileSync(options.source, "utf8"), { contentCapture: false });
    const output = `${JSON.stringify(profile, null, 2)}\n`;
    if (options.output) writeFileSync(options.output, output);
    else process.stdout.write(output);
  } catch (error) {
    process.stderr.write(`Copilot CLI OTel profile: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
