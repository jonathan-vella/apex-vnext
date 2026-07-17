import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateModernizationOwnership } from "../scripts/validate-modernization-ownership.mjs";

const schema = JSON.parse(
  readFileSync(new URL("../registry/schemas/modernization-ownership.schema.json", import.meta.url), "utf8"),
);

const manifest = {
  schemaVersion: "1.0.0",
  candidate: "a".repeat(40),
  surfaces: [
    {
      id: "example-surface",
      category: "runtime",
      classification: "keep",
      canonicalOwner: "config/example.json",
      sourceRefs: ["config/example.json"],
      consumers: ["example consumer"],
      proofCommands: ["npm run validate:example"],
      removalGate: "Replacement has equivalent proof.",
      rationale: "Example fixture.",
    },
  ],
  baselines: ["context", "ci", "hooks", "dependencies", "diagnostics", "drift"].map((id) => ({
    id,
    status: "captured",
    sourceRefs: ["config/example.json"],
    measurement: "fixture",
    evidence: "fixture",
  })),
  decisions: [
    {
      id: "OWN-001",
      status: "decided",
      decision: "Keep the fixture owner.",
      rationale: "Fixture rationale.",
      owner: "test",
      gate: "Fixture proof passes.",
    },
  ],
};

const options = {
  manifest,
  schema,
  document: "| `example-surface` | `OWN-001` |",
  scripts: { "validate:example": "echo ok" },
  glob: () => ["config/example.json"],
};

test("valid modernization inventory passes", () => {
  assert.deepEqual(validateModernizationOwnership(options), []);
});

test("inventory rejects missing sources, proof scripts, baseline domains, and documentation", () => {
  const invalid = structuredClone(manifest);
  invalid.baselines.at(-1).id = "context";
  invalid.surfaces[0].classification = "consolidate";
  invalid.surfaces[0].proofCommands = ["npm run missing"];
  const errors = validateModernizationOwnership({
    ...options,
    manifest: invalid,
    document: "",
    glob: () => [],
  });
  assert.ok(errors.some((error) => error.includes("baselines must contain exactly")));
  assert.ok(errors.some((error) => error.includes("sourceRef matches no files")));
  assert.ok(errors.some((error) => error.includes("unknown npm script")));
  assert.ok(errors.some((error) => error.includes("missing from")));
});
