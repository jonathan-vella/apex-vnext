import assert from "node:assert/strict";
import test from "node:test";
import type { TaskEnvelopeV1 } from "@apex/contracts";
import { CapabilityError, CapabilityRegistry } from "../capability.js";
import { createUnavailableOperationsCapabilities, operationsCapabilityCategories } from "../operations-placeholders.js";

const hash = "a".repeat(64);

function envelope(capability: string): TaskEnvelopeV1 {
  return {
    schemaVersion: "1.0.0",
    projectId: "project",
    runId: "run",
    taskId: "task",
    role: "operator",
    taskType: "test",
    expectedHead: hash,
    ownerEpoch: 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    expiresAt: "2026-08-20T02:00:00.000Z",
    inputRefs: [],
    allowedOutputKinds: [],
    capabilityGrants: [{ capability, sideEffect: "none", expiresAt: "2026-08-20T02:00:00.000Z" }],
    maxOutputBytes: 100,
  };
}

test("operations placeholders are unregistered by default and fail stably when test-registered", async () => {
  const registry = new CapabilityRegistry({ now: () => new Date("2026-08-20T01:00:00.000Z") });
  const capabilities = createUnavailableOperationsCapabilities("operator");

  assert.deepEqual(
    capabilities.map((capability) => capability.id),
    operationsCapabilityCategories.map((category) => `operations.${category}`),
  );
  await assert.rejects(
    registry.execute(capabilities[0]!.id, envelope(capabilities[0]!.id), undefined),
    (error: unknown) => error instanceof CapabilityError && error.code === "CAPABILITY_UNKNOWN",
  );
  for (const capability of capabilities) {
    registry.register(capability);
    await assert.rejects(
      registry.execute(capability.id, envelope(capability.id), undefined),
      (error: unknown) => error instanceof CapabilityError && error.code === "CAPABILITY_UNAVAILABLE",
    );
  }
});
