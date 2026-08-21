import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildOptimizationContextReceipt,
  parseContextReceiptArgs,
  validateOptimizationContextReceipt,
} from "../scripts/build-optimization-context-receipt.mjs";
import { normalizeClientContextSample } from "../scripts/normalize-client-context-sample.mjs";

const gate = JSON.parse(readFileSync("tools/registry/optimization-gate.v1.json", "utf8"));
const matrix = JSON.parse(readFileSync("tools/registry/client-context-matrix.json", "utf8"));
const schema = JSON.parse(readFileSync("tools/registry/schemas/optimization-context-receipt.schema.json", "utf8"));

function sample(client, cell, digest) {
  return normalizeClientContextSample(
    {
      schemaVersion: "1.0.0",
      format: "apex-debug-profile",
      content_capture: false,
      source_sha256: digest,
      producer: {
        name: client === "github-copilot-cli" ? "github.copilot" : "copilot-chat",
        version: client === "github-copilot-cli" ? "1.0.73" : "0.58.0",
      },
      totals: { input_tokens: 100, output_tokens: 10, chat_calls: 1 },
    },
    {
      client,
      clientVersion: client === "github-copilot-cli" ? "1.0.73" : "1.130.0",
      ...(client === "github-copilot-vscode" ? { extensionVersion: "0.58.0" } : {}),
      scenarioId: cell.scenarioId,
      tier: cell.tier,
      iacTrack: cell.iacTrack,
      retry: cell.retry,
      evidenceKind: "live",
    },
  );
}

const liveSamples = matrix.clients.flatMap((client, clientIndex) =>
  matrix.cells.map((cell, cellIndex) =>
    sample(client.id, cell, createHash("sha256").update(`${clientIndex}:${cellIndex}`).digest("hex")),
  ),
);

test("context receipt binds complete content-free live matrix evidence to the authorized candidate", () => {
  const receipt = buildOptimizationContextReceipt({
    gate,
    matrix,
    samples: liveSamples,
    collectedAt: "2026-08-21T00:00:00.000Z",
  });
  assert.deepEqual(validateOptimizationContextReceipt(receipt, schema), []);
  assert.deepEqual(receipt.candidate, { commit: gate.candidate.commit, tree: gate.candidate.tree });
  assert.equal(receipt.aggregate.coverageComplete, true);
});

test("context receipt rejects fixture evidence and incomplete live coverage", () => {
  const fixture = structuredClone(liveSamples);
  fixture[0].evidence.kind = "fixture";
  assert.throws(
    () => buildOptimizationContextReceipt({ gate, matrix, samples: fixture, collectedAt: "2026-08-21T00:00:00.000Z" }),
    /only content-free live client samples/,
  );
  assert.throws(
    () =>
      buildOptimizationContextReceipt({
        gate,
        matrix,
        samples: liveSamples.slice(1),
        collectedAt: "2026-08-21T00:00:00.000Z",
      }),
    /coverage is incomplete/,
  );
  assert.throws(() => parseContextReceiptArgs(["--output", "receipt.json"]), /required/);
});
