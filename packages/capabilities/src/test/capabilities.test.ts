import assert from "node:assert/strict";
import test from "node:test";
import type { TaskEnvelopeV1 } from "@apexops/contracts";
import { CapabilityError, CapabilityRegistry, type Capability } from "../capability.js";
import { designCapabilityIds, registerUnavailableDesignCapabilities } from "../design-capabilities.js";

const hash = "a".repeat(64);

function envelope(overrides: Partial<TaskEnvelopeV1> = {}): TaskEnvelopeV1 {
  return {
    schemaVersion: "1.0.0",
    projectId: "project",
    runId: "run",
    taskId: "task",
    role: "deployer",
    taskType: "test",
    expectedHead: hash,
    ownerEpoch: 1,
    createdAt: "2026-07-13T00:00:00.000Z",
    expiresAt: "2026-07-13T02:00:00.000Z",
    inputRefs: [],
    allowedOutputKinds: [],
    capabilityGrants: [{ capability: "test.run", sideEffect: "remote", expiresAt: "2026-07-13T02:00:00.000Z" }],
    maxOutputBytes: 100,
    ...overrides,
  };
}

const capability: Capability<string, { value: string }> = {
  id: "test.run",
  sideEffect: "remote",
  requiredRole: "deployer",
  timeoutMs: 20,
  retries: 0,
  idempotency: "required",
  async execute(_context, input) {
    return { value: input };
  },
};

test("registry denies missing grants, wrong roles, expiry, and unknown capabilities", async () => {
  const registry = new CapabilityRegistry({ now: () => new Date("2026-07-13T01:00:00.000Z") });
  registry.register(capability);

  await assert.rejects(registry.execute("missing", envelope(), "x"), errorCode("CAPABILITY_UNKNOWN"));
  await assert.rejects(
    registry.execute("test.run", envelope({ capabilityGrants: [] }), "x"),
    errorCode("CAPABILITY_GRANT_DENIED"),
  );
  await assert.rejects(
    registry.execute("test.run", envelope({ role: "reader" }), "x"),
    errorCode("CAPABILITY_ROLE_DENIED"),
  );
  await assert.rejects(
    registry.execute("test.run", envelope({ expiresAt: "2026-07-13T00:30:00.000Z" }), "x"),
    errorCode("CAPABILITY_EXPIRED"),
  );
});

test("registry rejects duplicate capabilities, timeouts, and oversized output", async () => {
  const registry = new CapabilityRegistry({ now: () => new Date("2026-07-13T01:00:00.000Z") });
  registry.register(capability);
  assert.throws(() => registry.register(capability), errorCode("CAPABILITY_DUPLICATE"));

  const slow: Capability = {
    ...capability,
    id: "test.slow",
    sideEffect: "none",
    timeoutMs: 1,
    async execute() {
      return await new Promise(() => undefined);
    },
  };
  registry.register(slow);
  await assert.rejects(
    registry.execute(
      "test.slow",
      envelope({
        capabilityGrants: [{ capability: "test.slow", sideEffect: "none", expiresAt: "2026-07-13T02:00:00.000Z" }],
      }),
      undefined,
    ),
    errorCode("CAPABILITY_TIMEOUT"),
  );
  await assert.rejects(
    registry.execute("test.run", envelope({ maxOutputBytes: 5 }), "too-large"),
    errorCode("CAPABILITY_OUTPUT_LIMIT"),
  );
});

test("registry rejects implemented capabilities until they are qualified", async () => {
  const registry = new CapabilityRegistry({ now: () => new Date("2026-07-13T01:00:00.000Z") });
  registry.register({ ...capability, lifecycle: "implemented-unqualified" });

  await assert.rejects(registry.execute("test.run", envelope(), "x"), errorCode("CAPABILITY_UNQUALIFIED"));
});

test("registry permits trusted external capabilities through their envelope controls", async () => {
  const registry = new CapabilityRegistry({ now: () => new Date("2026-07-13T01:00:00.000Z") });
  registry.register({ ...capability, lifecycle: "external-trusted" });

  assert.deepEqual(await registry.execute("test.run", envelope(), "x"), { value: "x" });
});

test("unqualified design capabilities return only the stable unavailable error", async () => {
  const registry = new CapabilityRegistry({ now: () => new Date("2026-07-13T01:00:00.000Z") });
  registerUnavailableDesignCapabilities(registry);

  for (const id of Object.values(designCapabilityIds)) {
    await assert.rejects(
      registry.execute(
        id,
        envelope({
          role: "architect",
          capabilityGrants: [{ capability: id, sideEffect: "none", expiresAt: "2026-07-13T02:00:00.000Z" }],
        }),
        { request: "test" },
      ),
      errorCode("CAPABILITY_UNAVAILABLE"),
    );
  }
});

function errorCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof CapabilityError && error.code === code;
}
