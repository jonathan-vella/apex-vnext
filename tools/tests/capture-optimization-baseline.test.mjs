import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildOptimizationBaseline,
  parseOutputPath,
  validateOptimizationBaseline,
} from "../scripts/capture-optimization-baseline.mjs";

const manifest = JSON.parse(readFileSync("tools/registry/optimization-gate.v1.json", "utf8"));
const schema = JSON.parse(readFileSync("tools/registry/schemas/optimization-baseline-receipt.schema.json", "utf8"));
const trackedPaths = [
  "package.json",
  ".github/workflows/ci.yml",
  "packages/kernel/package.json",
  "config/defaults.v1.json",
  "customizations/manifest.json",
  "tools/scripts/example.mjs",
  "docs/vnext/PRD.md",
  "infra/terraform/example.tf",
  ".archive/example.md",
];
const stats = new Map(trackedPaths.map((path, index) => [path, { size: index + 1 }]));

test("baseline capture binds an observed candidate without granting authorization", () => {
  const receipt = buildOptimizationBaseline({
    manifest,
    observedAt: "2026-08-21T00:00:00.000Z",
    trackedPaths,
    stat: (path) => stats.get(path),
    runGit: (_command, args) => (args[1] === "HEAD" ? `${"a".repeat(40)}\n` : `${"b".repeat(40)}\n`),
  });
  assert.deepEqual(validateOptimizationBaseline(receipt, schema), []);
  assert.equal(receipt.authorization.status, "not-granted");
  assert.equal(receipt.inventory.trackedPathCount, trackedPaths.length);
});

test("baseline capture requires an explicit output path", () => {
  assert.throws(() => parseOutputPath([]), /--output <path> is required/);
  assert.throws(() => parseOutputPath(["--output", "baseline.json", "extra"]), /only --output/);
  assert.equal(parseOutputPath(["--output", "baseline.json"]), "baseline.json");
});

test("baseline capture rejects unowned paths and normalizes inventory ordering", () => {
  const build = (paths) =>
    buildOptimizationBaseline({
      manifest,
      observedAt: "2026-08-21T00:00:00.000Z",
      trackedPaths: paths,
      stat: (path) => stats.get(path),
      runGit: (_command, args) => (args[1] === "HEAD" ? `${"a".repeat(40)}\n` : `${"b".repeat(40)}\n`),
    });
  assert.equal(build(trackedPaths).inventory.sha256, build([...trackedPaths].reverse()).inventory.sha256);
  assert.throws(() => build([...trackedPaths, "unknown/file.txt"]), /unowned tracked path: unknown\/file.txt/);
});
