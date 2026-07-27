import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  validateContextBaselineReceipt,
  validateModernizationOwnership,
} from "../scripts/validate-modernization-ownership.mjs";

const schema = JSON.parse(
  readFileSync(new URL("../registry/schemas/modernization-ownership.schema.json", import.meta.url), "utf8"),
);
const receipt = JSON.parse(
  readFileSync(new URL("../registry/client-context-baseline-receipt.json", import.meta.url), "utf8"),
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
  receipt,
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

test("context baseline receipt rejects incomplete, duplicated, and wrong-version evidence", () => {
  const invalid = structuredClone(options.receipt);
  invalid.clients[0].version = "latest";
  invalid.sampleIds[1] = invalid.sampleIds[0];
  invalid.sourceDigests.pop();
  invalid.requiredMetrics.chatCalls = 11;
  const errors = validateContextBaselineReceipt(invalid);
  assert.ok(errors.some((error) => error.includes("approved matrix contract")));
  assert.ok(errors.some((error) => error.includes("sampleIds")));
  assert.ok(errors.some((error) => error.includes("sourceDigests")));
  assert.ok(errors.some((error) => error.includes("required metric coverage")));
});

test("context baseline receipt rejects valid-looking digest substitution", () => {
  const substituted = structuredClone(options.receipt);
  substituted.aggregateSha256 = "f".repeat(64);
  substituted.sampleIds[0] = "c".repeat(64);
  substituted.sampleIds.sort();
  substituted.sourceDigests[0] = "d".repeat(64);
  substituted.sourceDigests.sort();
  const errors = validateContextBaselineReceipt(substituted);
  assert.deepEqual(errors, [
    "tools/registry/client-context-baseline-receipt.json: canonical receipt digest does not match accepted evidence",
  ]);
});
