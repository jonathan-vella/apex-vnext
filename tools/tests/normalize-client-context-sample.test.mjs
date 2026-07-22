import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { aggregateClientContextSamples } from "../scripts/aggregate-client-context-samples.mjs";
import { normalizeClientContextSample, parseArgs } from "../scripts/normalize-client-context-sample.mjs";

const schema = JSON.parse(
  readFileSync(new URL("../registry/schemas/client-context-sample.schema.json", import.meta.url), "utf8"),
);
const validateSample = new Ajv2020({ allErrors: true }).compile(schema);

function source(totals = {}) {
  return {
    schemaVersion: "1.0.0",
    format: "apex-debug-profile",
    totals: {
      input_tokens: 45_000,
      output_tokens: 1_200,
      chat_calls: 3,
      ...totals,
    },
  };
}

function metadata(client = "github-copilot-vscode") {
  return {
    client,
    clientVersion: client === "github-copilot-cli" ? "1.0.73" : "1.109.0",
    scenarioId: "requirements-standard-bicep",
    tier: "standard",
    iacTrack: "bicep",
    evidenceKind: "fixture",
    retry: false,
  };
}

test("normalizes deterministic samples for both supported clients", () => {
  const vscode = normalizeClientContextSample(source(), metadata());
  const repeated = normalizeClientContextSample(source(), metadata());
  const cli = normalizeClientContextSample(source(), metadata("github-copilot-cli"));

  assert.deepEqual(vscode, repeated);
  assert.match(vscode.sampleId, /^[0-9a-f]{64}$/u);
  assert.notEqual(vscode.sampleId, cli.sampleId);
  assert.equal(vscode.evidence.contentCapture, false);
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
    () => normalizeClientContextSample(source({ input_tokens: -1 }), metadata()),
    /input_tokens must be a non-negative safe integer/u,
  );
  assert.throws(
    () => normalizeClientContextSample(source({ cache_hits: 0.5 }), metadata()),
    /cache_hits must be a non-negative safe integer/u,
  );
  assert.throws(
    () => normalizeClientContextSample(source({ cache_hits: -1 }), metadata()),
    /cache_hits must be a non-negative safe integer/u,
  );
  assert.throws(
    () => normalizeClientContextSample(source(), { ...metadata(), scenarioId: "Step 1 Requirements" }),
    /scenarioId must be a lowercase kebab-case identifier/u,
  );
  assert.throws(
    () => normalizeClientContextSample({ ...source(), schemaVersion: "2.0.0" }, metadata()),
    /source must use apex-debug-profile schemaVersion 1.0.0/u,
  );
  assert.throws(
    () => normalizeClientContextSample({ ...source(), format: "unknown-profile" }, metadata()),
    /source must use apex-debug-profile schemaVersion 1.0.0/u,
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
  assert.equal(args.clientVersion, "1.0.73");
  assert.equal(args.output, "sample.json");
  assert.throws(() => parseArgs(["--source"]), /--source requires a value/u);
  assert.throws(() => parseArgs([]), /--source is required/u);
});

test("aggregates samples deterministically without claiming partial cache metrics", () => {
  const vscode = normalizeClientContextSample(source(), metadata());
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
  const sample = normalizeClientContextSample(source(), metadata());
  assert.throws(() => aggregateClientContextSamples([sample, sample]), /duplicate sampleId/u);
});

test("rejects malformed normalized samples before aggregation", () => {
  const sample = normalizeClientContextSample(source(), metadata());
  assert.throws(
    () => aggregateClientContextSamples([{ ...sample, sampleId: "not-a-digest" }]),
    /every input must be a normalized client context sample/u,
  );
  assert.throws(
    () => aggregateClientContextSamples([{ ...sample, client: { ...sample.client, id: "unknown" } }]),
    /missing grouping or metric fields/u,
  );
  assert.throws(
    () =>
      aggregateClientContextSamples([
        { ...sample, metrics: { ...sample.metrics, inputTokens: { status: "unavailable" } } },
      ]),
    /requires a measured inputTokens/u,
  );
  assert.throws(
    () =>
      aggregateClientContextSamples([
        { ...sample, metrics: { ...sample.metrics, cacheHits: { status: "measured", value: -1 } } },
      ]),
    /invalid cacheHits value/u,
  );
});

test("keeps distinct scenarios in separate aggregate groups", () => {
  const requirements = normalizeClientContextSample(source(), metadata());
  const architecture = normalizeClientContextSample(source(), {
    ...metadata(),
    scenarioId: "architecture-standard-bicep",
  });
  const aggregate = aggregateClientContextSamples([requirements, architecture]);

  assert.deepEqual(
    aggregate.summaries.map(({ scenarioId }) => scenarioId),
    ["architecture-standard-bicep", "requirements-standard-bicep"],
  );
});
