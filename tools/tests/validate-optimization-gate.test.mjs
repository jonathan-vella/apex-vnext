import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildOptimizationGateInventory, validateOptimizationGate } from "../scripts/validate-optimization-gate.mjs";

const manifest = JSON.parse(readFileSync("tools/registry/optimization-gate.v1.json", "utf8"));
const schema = JSON.parse(readFileSync("tools/registry/schemas/optimization-gate.schema.json", "utf8"));
const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
const trackedPaths = ["package.json", ".github/workflows/ci.yml", "packages/kernel/package.json", "docs/vnext/PRD.md"];

test("authorized optimization gate has an exhaustive non-overlapping owned scope", () => {
  assert.deepEqual(validateOptimizationGate({ manifest, schema, scripts, trackedPaths }), []);
});

test("optimization gate rejects unowned, multiply owned, and unknown proof paths", () => {
  assert.ok(
    validateOptimizationGate({
      manifest,
      schema,
      scripts,
      trackedPaths: [...trackedPaths, "unknown/file.txt"],
    }).includes("unowned tracked path: unknown/file.txt"),
  );

  const overlapping = structuredClone(manifest);
  overlapping.surfaces[0].prefixes.push(".github/");
  assert.ok(
    validateOptimizationGate({ manifest: overlapping, schema, scripts, trackedPaths }).some((error) =>
      error.startsWith("multiply owned tracked path: .github/workflows/ci.yml"),
    ),
  );

  const unknownProof = structuredClone(manifest);
  unknownProof.surfaces[0].proofCommands = ["npm run missing:proof"];
  assert.ok(
    validateOptimizationGate({ manifest: unknownProof, schema, scripts, trackedPaths }).includes(
      "repository-root: unknown proof command: npm run missing:proof",
    ),
  );
});

test("inventory assigns canonical owner and consumers under the bounded audit authorization", () => {
  const inventory = buildOptimizationGateInventory({ manifest, trackedPaths });
  assert.deepEqual(inventory[0], {
    path: "package.json",
    surface: "repository-root",
    owner: "Repository maintainers",
    consumers: ["contributors", "release controls"],
  });
  assert.equal(manifest.authorization.status, "approved");
  assert.equal(manifest.authorization.budget.maxTrackedMutations, 0);
});

test("resolved findings do not require deferred-only expiry metadata", () => {
  const resolved = structuredClone(manifest);
  resolved.findings.push({ id: "OPT-001", status: "resolved", owner: "Repository maintainers", rationale: "Fixed." });
  assert.deepEqual(validateOptimizationGate({ manifest: resolved, schema, scripts, trackedPaths }), []);
});
