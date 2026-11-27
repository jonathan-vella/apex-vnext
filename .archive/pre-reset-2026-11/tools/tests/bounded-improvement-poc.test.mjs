import assert from "node:assert/strict";
import test from "node:test";
import { proveBoundedImprovement } from "../scripts/prove-bounded-improvement.mjs";

test("bounded improvement proof is deterministic and inert", async () => {
  const first = await proveBoundedImprovement();
  const second = await proveBoundedImprovement();
  assert.deepEqual(second, first);
  assert.deepEqual(first, {
    schemaVersion: "1.0.0",
    generatedAt: "2026-07-17T14:00:00.000Z",
    inputRuns: 4,
    activeObservations: 3,
    deduplicatedObservations: 1,
    quarantinedObservations: 1,
    recurrenceCount: 1,
    proposalCount: 1,
    inertProposalCount: 1,
    humanDecision: "rejected",
    autonomousActions: 0,
    observedPrecision: 1,
  });
});
