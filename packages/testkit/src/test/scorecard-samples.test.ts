import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  collectCacheResults,
  collectCapabilityResults,
  collectQualificationMeasurements,
  collectValidationMutationResults,
  tempWorkspace,
} from "../index.js";

test("validation mutations exercise 100 unique task-envelope boundaries without escape", () => {
  const results = collectValidationMutationResults();
  assert.equal(results.length, 100);
  assert.equal(new Set(results.map(({ caseId }) => caseId)).size, 100);
  assert.equal(new Set(results.map(({ caseId }) => caseId?.replace(/-\d{3}$/, ""))).size, 20);
  assert.ok(results.every(({ escaped }) => !escaped));
});

test("capability samples exercise compatible, incompatible, required-missing, and optional-missing checks", async (context) => {
  const root = await tempWorkspace(context, "apex-capability-scorecard-");
  const packageJson = join(root, "package.json");
  await writeFile(packageJson, `${JSON.stringify({ version: "1.2.3" })}\n`, "utf8");
  const results = await collectCapabilityResults(packageJson);
  assert.equal(results.length, 100);
  assert.equal(new Set(results.map(({ caseId }) => caseId)).size, 100);
  assert.ok(results.every(({ success }) => success));
  assert.ok(
    ["compatible", "incompatible", "required-missing", "optional-missing"].every((mode) =>
      results.some(({ caseId }) => caseId?.startsWith(mode)),
    ),
  );
});

test("cache samples mutate dependency, config, and toolchain keys and verify invalidation", async (context) => {
  const root = await tempWorkspace(context, "apex-cache-scorecard-");
  const results = await collectCacheResults(root);
  assert.equal(results.length, 100);
  assert.equal(new Set(results.map(({ caseId }) => caseId)).size, 100);
  assert.ok(results.every(({ success }) => success));
  assert.ok(
    ["dependency", "config", "toolchain"].every((mode) => results.some(({ caseId }) => caseId?.startsWith(mode))),
  );
});

test("scorecard collectors reject non-positive sample counts", async () => {
  assert.throws(() => collectValidationMutationResults(0), /positive integer/);
  await assert.rejects(() => collectCapabilityResults("package.json", 0), /positive integer/);
  await assert.rejects(() => collectCacheResults(".", 0), /positive integer/);
});

test("real collector outcomes produce complete blocking scorecard measurements", async (context) => {
  const root = await tempWorkspace(context, "apex-scorecard-pipeline-");
  const packageJson = join(root, "package.json");
  await writeFile(packageJson, `${JSON.stringify({ version: "1.2.3" })}\n`, "utf8");
  const [mutationResults, capabilityResults, cacheResults] = await Promise.all([
    collectValidationMutationResults(),
    collectCapabilityResults(packageJson),
    collectCacheResults(join(root, "cache")),
  ]);
  const measurements = collectQualificationMeasurements({
    mutationResults,
    capabilityResults,
    cacheResults,
    clock: () => new Date("2026-07-20T16:47:46.000Z"),
    commandVersions: { testkit: "0.1.0" },
    toolVersions: { node: process.version },
  }).measurements;
  assert.deepEqual(
    ["deterministic-validation-escape-rate", "capability-failure-rate", "cache-correctness-rate"].map((metric) => {
      const measurement = measurements.find((candidate) => candidate.metric === metric);
      return { metric, value: measurement?.value, samples: measurement?.samples };
    }),
    [
      { metric: "deterministic-validation-escape-rate", value: 0, samples: 100 },
      { metric: "capability-failure-rate", value: 0, samples: 100 },
      { metric: "cache-correctness-rate", value: 1, samples: 100 },
    ],
  );
});
