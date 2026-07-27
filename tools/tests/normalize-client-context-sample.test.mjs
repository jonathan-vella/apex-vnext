import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { aggregateClientContextSamples } from "../scripts/aggregate-client-context-samples.mjs";
import { normalizeClientContextSample, parseArgs } from "../scripts/normalize-client-context-sample.mjs";
import { parseArgs as parseProfilerArgs, profileCopilotCliOtel } from "../scripts/profile-copilot-cli-otel.mjs";
import {
  assertDistinctPaths,
  parseArgs as parseVscodeArgs,
  profileVscodeOtel,
} from "../scripts/profile-vscode-otel.mjs";

const schema = JSON.parse(
  readFileSync(new URL("../registry/schemas/client-context-sample.schema.json", import.meta.url), "utf8"),
);
const validateSample = new Ajv2020({ allErrors: true }).compile(schema);

function source(totals = {}) {
  return {
    schemaVersion: "1.0.0",
    format: "apex-debug-profile",
    content_capture: false,
    totals: {
      input_tokens: 45_000,
      output_tokens: 1_200,
      chat_calls: 3,
      ...totals,
    },
  };
}

function vscodeSource(totals = {}) {
  return {
    ...source(totals),
    source_sha256: "a".repeat(64),
    producer: { name: "copilot-chat", version: "0.58.0" },
  };
}

function metadata(client = "github-copilot-vscode") {
  return {
    client,
    clientVersion: client === "github-copilot-cli" ? "1.0.73" : "1.130.0",
    ...(client === "github-copilot-vscode" ? { extensionVersion: "0.58.0" } : {}),
    scenarioId: "requirements-standard-bicep",
    tier: "standard",
    iacTrack: "bicep",
    evidenceKind: "fixture",
    retry: false,
  };
}

function cliRecord(name, attributes = {}) {
  return JSON.stringify({
    type: "span",
    name,
    attributes,
    events: [{ message: "must never be copied" }],
  });
}

function profileCli(text) {
  return profileCopilotCliOtel(text, { contentCapture: false });
}

function vscodeRecord(eventName, attributes = {}) {
  return JSON.stringify({
    _body: "must never be copied",
    attributes: { "event.name": eventName, ...attributes },
    instrumentationScope: { name: "copilot-chat", version: "0.58.0" },
  });
}

test("profiles only VS Code inference records without double-counting turns", () => {
  const text = [
    vscodeRecord("gen_ai.client.inference.operation.details", {
      "gen_ai.operation.name": "chat",
      "gen_ai.usage.input_tokens": 1_000,
      "gen_ai.usage.output_tokens": 50,
      "gen_ai.response.id": "must never be copied",
    }),
    vscodeRecord("copilot_chat.agent.turn", {
      "gen_ai.usage.input_tokens": 1_000,
      "gen_ai.usage.output_tokens": 50,
    }),
    JSON.stringify({ scopeMetrics: [{ metrics: [{ name: "gen_ai.client.token.usage" }] }] }),
  ].join("\n");
  const profile = profileVscodeOtel(text, { contentCapture: false, producerVersion: "0.58.0" });

  assert.deepEqual(profile, {
    ...source({ input_tokens: 1_000, output_tokens: 50, chat_calls: 1 }),
    source_sha256: profile.source_sha256,
    producer: { name: "copilot-chat", version: "0.58.0" },
  });
  assert.equal(profile.source_sha256, createHash("sha256").update(text).digest("hex"));
  assert.doesNotMatch(JSON.stringify(profile), /body|model|response|scopeMetrics/iu);
});

test("fails closed on malformed VS Code inference records and options", () => {
  assert.throws(() => profileVscodeOtel("{}"), /content capture must be explicitly attested as disabled/u);
  assert.throws(
    () =>
      profileVscodeOtel(
        vscodeRecord("gen_ai.client.inference.operation.details", {
          "gen_ai.operation.name": "chat",
          "gen_ai.usage.input_tokens": 1,
        }),
        { contentCapture: false, producerVersion: "0.58.0" },
      ),
    /output_tokens must be a non-negative safe integer/u,
  );
  assert.throws(
    () =>
      profileVscodeOtel(
        vscodeRecord("gen_ai.client.inference.operation.details", {
          "gen_ai.operation.name": "embed",
          "gen_ai.usage.input_tokens": 1,
          "gen_ai.usage.output_tokens": 1,
        }),
        { contentCapture: false, producerVersion: "0.58.0" },
      ),
    /must use the chat operation/u,
  );
  assert.throws(
    () =>
      profileVscodeOtel(
        JSON.stringify({
          attributes: {
            "event.name": "gen_ai.client.inference.operation.details",
            "gen_ai.operation.name": "chat",
            "gen_ai.usage.input_tokens": 1,
            "gen_ai.usage.output_tokens": 1,
          },
          instrumentationScope: { name: "foreign-producer", version: "0.58.0" },
        }),
        { contentCapture: false, producerVersion: "0.58.0" },
      ),
    /unsupported producer/u,
  );
  assert.throws(() => parseVscodeArgs(["--ouptut", "profile.json"]), /unsupported option/u);
  assert.throws(() => parseVscodeArgs(["--source", "otel.jsonl"]), /--content-capture false is required/u);
  assert.throws(
    () => parseVscodeArgs(["--source", "otel.jsonl", "--content-capture", "false"]),
    /--producer-version is required/u,
  );
});

test("hashes exact VS Code source bytes and rejects source aliases", (context) => {
  const valid = Buffer.from(
    vscodeRecord("gen_ai.client.inference.operation.details", {
      "gen_ai.operation.name": "chat",
      "gen_ai.usage.input_tokens": 1,
      "gen_ai.usage.output_tokens": 1,
    }),
  );
  const profile = profileVscodeOtel(valid, { contentCapture: false, producerVersion: "0.58.0" });
  assert.equal(profile.source_sha256, createHash("sha256").update(valid).digest("hex"));
  assert.throws(
    () =>
      profileVscodeOtel(Buffer.concat([valid, Buffer.from([0xff])]), {
        contentCapture: false,
        producerVersion: "0.58.0",
      }),
    /valid UTF-8/u,
  );

  const root = mkdtempSync(join(tmpdir(), "apex-vscode-otel-paths-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const sourcePath = join(root, "source.jsonl");
  const aliasPath = join(root, "alias.jsonl");
  writeFileSync(sourcePath, valid);
  symlinkSync(sourcePath, aliasPath);
  assert.throws(() => assertDistinctPaths(sourcePath, sourcePath), /must not overwrite/u);
  assert.throws(() => assertDistinctPaths(sourcePath, aliasPath), /must not alias/u);
});

test("profiles only allowlisted Copilot CLI counters", () => {
  const profile = profileCli(
    [
      cliRecord("invoke_agent", { "gen_ai.tool.definitions": "must never be copied" }),
      cliRecord("chat model-a", {
        "gen_ai.usage.input_tokens": 12_000,
        "gen_ai.usage.output_tokens": 300,
        "gen_ai.usage.cache_creation.input_tokens": 11_500,
        "gen_ai.response.id": "must never be copied",
      }),
      cliRecord("chat model-b", {
        "gen_ai.usage.input_tokens": 2_000,
        "gen_ai.usage.output_tokens": 100,
        "gen_ai.usage.cache_creation.input_tokens": 1_800,
      }),
    ].join("\n"),
  );

  assert.deepEqual(
    profile,
    source({
      input_tokens: 14_000,
      output_tokens: 400,
      chat_calls: 2,
      cache_write_tokens: 13_300,
    }),
  );
  assert.doesNotMatch(JSON.stringify(profile), /model|message|response|tool/iu);
});

test("rejects malformed Copilot CLI counters without inferring missing values", () => {
  assert.throws(() => profileCopilotCliOtel("{}"), /content capture must be explicitly attested as disabled/u);
  assert.throws(() => profileCli("not-json"), /line 1: invalid JSON/u);
  assert.throws(() => profileCli(`\n\nnot-json`), /line 3: invalid JSON/u);
  assert.throws(() => profileCli(cliRecord("invoke_agent")), /no chat records/u);
  assert.throws(
    () => profileCli(cliRecord("chat model", { "gen_ai.usage.input_tokens": 1 })),
    /missing exact token counters/u,
  );
  assert.throws(
    () =>
      profileCli(
        cliRecord("chat model", {
          "gen_ai.usage.input_tokens": -1,
          "gen_ai.usage.output_tokens": 1,
        }),
      ),
    /input_tokens must be a non-negative safe integer/u,
  );
  assert.throws(
    () =>
      profileCli(
        [
          cliRecord("chat model", {
            "gen_ai.usage.input_tokens": Number.MAX_SAFE_INTEGER,
            "gen_ai.usage.output_tokens": 1,
          }),
          cliRecord("chat model", {
            "gen_ai.usage.input_tokens": 1,
            "gen_ai.usage.output_tokens": 1,
          }),
        ].join("\n"),
      ),
    /total exceeds the safe integer range/u,
  );
});

test("reports cache writes only when every chat record measures them", () => {
  const profile = profileCli(
    [
      cliRecord("chat model", {
        "gen_ai.usage.input_tokens": 10,
        "gen_ai.usage.output_tokens": 2,
        "gen_ai.usage.cache_creation.input_tokens": 8,
      }),
      cliRecord("chat model", {
        "gen_ai.usage.input_tokens": 5,
        "gen_ai.usage.output_tokens": 1,
      }),
    ].join("\n"),
  );

  assert.equal(profile.totals.cache_write_tokens, undefined);
});

test("strictly parses Copilot CLI profiler options", () => {
  const options = parseProfilerArgs([
    "--source",
    "otel.jsonl",
    "--content-capture",
    "false",
    "--output",
    "profile.json",
  ]);
  assert.equal(Object.getPrototypeOf(options), null);
  assert.equal(options.output, "profile.json");
  assert.throws(() => parseProfilerArgs(["--source", "otel.jsonl"]), /--content-capture false is required/u);
  assert.throws(
    () => parseProfilerArgs(["--source", "otel.jsonl", "--content-capture", "true"]),
    /--content-capture false is required/u,
  );
  assert.throws(() => parseProfilerArgs(["--ouptut", "profile.json"]), /unsupported option/u);
  assert.throws(() => parseProfilerArgs(["--__proto__", "polluted"]), /unsupported option/u);
});

test("normalizes deterministic samples for both supported clients", () => {
  const vscode = normalizeClientContextSample(vscodeSource(), metadata());
  const repeated = normalizeClientContextSample(vscodeSource(), metadata());
  const cli = normalizeClientContextSample(source(), metadata("github-copilot-cli"));

  assert.deepEqual(vscode, repeated);
  assert.match(vscode.sampleId, /^[0-9a-f]{64}$/u);
  assert.notEqual(vscode.sampleId, cli.sampleId);
  assert.equal(vscode.client.version, "1.130.0");
  assert.equal(vscode.client.extensionVersion, "0.58.0");
  assert.equal(cli.client.extensionVersion, undefined);
  assert.equal(vscode.evidence.contentCapture, false);
  assert.equal(vscode.evidence.sourceDigest, "a".repeat(64));
  assert.deepEqual(vscode.metrics.cacheReadTokens, { status: "unavailable" });
  assert.deepEqual(vscode.metrics.cacheWriteTokens, { status: "unavailable" });
  assert.deepEqual(vscode.metrics.cacheHits, { status: "unavailable" });
  assert.equal(validateSample(vscode), true, JSON.stringify(validateSample.errors));
  assert.equal(validateSample(cli), true, JSON.stringify(validateSample.errors));
});

test("retains measured cache counters without inferring missing values", () => {
  const sample = normalizeClientContextSample(
    source({ cache_read_tokens: 20_000, cache_write_tokens: 500, cache_hits: 2 }),
    metadata("github-copilot-cli"),
  );

  assert.deepEqual(sample.metrics.cacheReadTokens, { status: "measured", value: 20_000 });
  assert.deepEqual(sample.metrics.cacheWriteTokens, { status: "measured", value: 500 });
  assert.deepEqual(sample.metrics.cacheHits, { status: "measured", value: 2 });
});

test("rejects unsupported clients and malformed counters", () => {
  assert.throws(
    () => normalizeClientContextSample(source(), metadata("unsupported-client")),
    /client has unsupported value/u,
  );
  assert.throws(
    () => normalizeClientContextSample(vscodeSource({ input_tokens: -1 }), metadata()),
    /input_tokens must be a non-negative safe integer/u,
  );
  assert.throws(
    () => normalizeClientContextSample(vscodeSource({ cache_hits: 0.5 }), metadata()),
    /cache_hits must be a non-negative safe integer/u,
  );
  assert.throws(
    () => normalizeClientContextSample(vscodeSource({ cache_hits: -1 }), metadata()),
    /cache_hits must be a non-negative safe integer/u,
  );
  assert.throws(
    () => normalizeClientContextSample(vscodeSource(), { ...metadata(), scenarioId: "Step 1 Requirements" }),
    /scenarioId must be a lowercase kebab-case identifier/u,
  );
  assert.throws(
    () => normalizeClientContextSample({ ...vscodeSource(), schemaVersion: "2.0.0" }, metadata()),
    /source must use apex-debug-profile schemaVersion 1.0.0/u,
  );
  assert.throws(
    () => normalizeClientContextSample({ ...vscodeSource(), format: "unknown-profile" }, metadata()),
    /source must use apex-debug-profile schemaVersion 1.0.0/u,
  );
  assert.throws(
    () => normalizeClientContextSample({ ...vscodeSource(), content_capture: undefined }, metadata()),
    /source must attest content_capture false/u,
  );
  assert.throws(
    () => normalizeClientContextSample(vscodeSource(), { ...metadata(), extensionVersion: undefined }),
    /extensionVersion must be a non-empty string/u,
  );
});

test("rejects content-bearing and secret-bearing source fields", () => {
  assert.throws(
    () => normalizeClientContextSample({ ...source(), prompt: "raw prompt" }, metadata()),
    /prohibited content-bearing field/u,
  );
  assert.throws(
    () => normalizeClientContextSample({ ...source(), nested: { toolCallResult: "raw result" } }, metadata()),
    /prohibited content-bearing field/u,
  );
  assert.throws(
    () => normalizeClientContextSample({ ...source(), apiSecret: "not-a-real-secret" }, metadata()),
    /prohibited content-bearing field/u,
  );
  assert.throws(
    () => normalizeClientContextSample({ ...source(), errors: [{ message: "raw error" }] }, metadata()),
    /prohibited content-bearing field/u,
  );
});

test("parses required CLI metadata and rejects missing values", () => {
  const args = parseArgs([
    "--source",
    "profile.json",
    "--client",
    "github-copilot-cli",
    "--client-version",
    "1.0.73",
    "--scenario-id",
    "requirements-standard-bicep",
    "--tier",
    "standard",
    "--iac-track",
    "bicep",
    "--evidence-kind",
    "fixture",
    "--retry",
    "--output",
    "sample.json",
  ]);

  assert.equal(args.retry, true);
  assert.equal(Object.getPrototypeOf(args), null);
  assert.equal(args.clientVersion, "1.0.73");
  assert.equal(args.output, "sample.json");
  assert.throws(() => parseArgs(["--source"]), /--source requires a value/u);
  assert.throws(() => parseArgs([]), /--source is required/u);
  assert.throws(() => parseArgs(["--__proto__", "polluted"]), /unsupported option/u);
  assert.throws(() => parseArgs(["--clientVersion", "1.0.73"]), /unsupported option/u);
  assert.throws(() => parseArgs(["--retry", "--retry"]), /may be specified only once/u);
});

test("aggregates samples deterministically without claiming partial cache metrics", () => {
  const vscode = normalizeClientContextSample(vscodeSource(), metadata());
  const cli = normalizeClientContextSample(
    source({ cache_read_tokens: 20_000, cache_write_tokens: 500, cache_hits: 2 }),
    metadata("github-copilot-cli"),
  );
  const forward = aggregateClientContextSamples([vscode, cli]);
  const reverse = aggregateClientContextSamples([cli, vscode]);

  assert.deepEqual(forward, reverse);
  assert.equal(forward.sampleCount, 2);
  assert.deepEqual(
    forward.summaries.map(({ client }) => client),
    ["github-copilot-cli", "github-copilot-vscode"],
  );
  assert.deepEqual(forward.summaries[1].metrics.cacheHits, {
    measuredSamples: 0,
    unavailableSamples: 1,
  });
});

test("rejects duplicate sample identifiers", () => {
  const sample = normalizeClientContextSample(vscodeSource(), metadata());
  assert.throws(() => aggregateClientContextSamples([sample, sample]), /duplicate sampleId/u);
});

test("rejects malformed normalized samples before aggregation", () => {
  const sample = normalizeClientContextSample(vscodeSource(), metadata());
  assert.throws(
    () => aggregateClientContextSamples([{ ...sample, sampleId: "not-a-digest" }]),
    /every input must be a normalized client context sample/u,
  );
  assert.throws(
    () => aggregateClientContextSamples([{ ...sample, client: { ...sample.client, id: "unknown" } }]),
    /normalized client context sample/u,
  );
  assert.throws(
    () =>
      aggregateClientContextSamples([
        { ...sample, metrics: { ...sample.metrics, inputTokens: { status: "unavailable" } } },
      ]),
    /normalized client context sample/u,
  );
  assert.throws(
    () =>
      aggregateClientContextSamples([
        { ...sample, metrics: { ...sample.metrics, cacheHits: { status: "measured", value: -1 } } },
      ]),
    /normalized client context sample/u,
  );
  const maximum = normalizeClientContextSample(vscodeSource({ input_tokens: Number.MAX_SAFE_INTEGER }), metadata());
  const one = normalizeClientContextSample(vscodeSource({ input_tokens: 1 }), metadata());
  assert.throws(() => aggregateClientContextSamples([maximum, one]), /aggregate exceeds the safe integer range/u);
  assert.throws(
    () => aggregateClientContextSamples([{ ...sample, evidence: undefined }]),
    /normalized client context sample/u,
  );
  assert.throws(
    () => aggregateClientContextSamples([{ ...sample, unexpected: true }]),
    /normalized client context sample/u,
  );
  assert.throws(
    () =>
      aggregateClientContextSamples([
        { ...sample, metrics: { ...sample.metrics, inputTokens: { status: "measured", value: 99 } } },
      ]),
    /sampleId does not match/u,
  );
});

test("keeps fixture and live evidence in separate aggregate groups", () => {
  const fixture = normalizeClientContextSample(source(), metadata("github-copilot-cli"));
  const live = normalizeClientContextSample(source(), {
    ...metadata("github-copilot-cli"),
    evidenceKind: "live",
  });
  const aggregate = aggregateClientContextSamples([fixture, live]);

  assert.deepEqual(
    aggregate.summaries.map(({ evidenceKind, sampleCount }) => ({ evidenceKind, sampleCount })),
    [
      { evidenceKind: "fixture", sampleCount: 1 },
      { evidenceKind: "live", sampleCount: 1 },
    ],
  );
});

test("schema rejects counters above the JavaScript safe integer range", () => {
  const sample = normalizeClientContextSample(vscodeSource(), metadata());
  sample.metrics.inputTokens.value = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(validateSample(sample), false);
});

test("schema requires source digests only for VS Code samples", () => {
  const vscode = normalizeClientContextSample(vscodeSource(), metadata());
  const cli = normalizeClientContextSample(source(), metadata("github-copilot-cli"));
  const { sourceDigest: _, ...evidenceWithoutDigest } = vscode.evidence;

  assert.equal(validateSample({ ...vscode, evidence: evidenceWithoutDigest }), false);
  assert.equal(validateSample({ ...cli, evidence: { ...cli.evidence, sourceDigest: "a".repeat(64) } }), false);
});

test("rejects inherited profiler contract fields", () => {
  const inherited = Object.create(source());
  assert.throws(() => normalizeClientContextSample(inherited, metadata()), /source must be a plain object/u);
});

test("keeps distinct scenarios in separate aggregate groups", () => {
  const requirements = normalizeClientContextSample(vscodeSource(), metadata());
  const architecture = normalizeClientContextSample(vscodeSource(), {
    ...metadata(),
    scenarioId: "architecture-standard-bicep",
  });
  const aggregate = aggregateClientContextSamples([requirements, architecture]);

  assert.deepEqual(
    aggregate.summaries.map(({ scenarioId }) => scenarioId),
    ["architecture-standard-bicep", "requirements-standard-bicep"],
  );
});
