import assert from "node:assert/strict";
import test from "node:test";
import type { GateRecordV1 } from "@apexops/contracts";
import {
  RunConfigInvalidError,
  WorkflowEngine,
  decideGate,
  inheritGate,
  invalidateGate,
  isReadinessGate,
  markGateReady,
  openGate,
  parseRunConfig,
} from "../index.js";
import { readFile } from "node:fs/promises";

const hash = "a".repeat(64);
const later = "b".repeat(64);
const readyAt = "2026-01-01T00:00:00.000Z";
const open = (gate: number): GateRecordV1 => ({ gate, state: "open", dependencyHash: hash });
const workflow = JSON.parse(await readFile(new URL("../../../../config/workflow.v1.json", import.meta.url), "utf8"));

test("readiness is limited to lab Gates 2 and 3", () => {
  assert.equal(isReadinessGate("lab", 2), true);
  assert.equal(isReadinessGate("lab", 3), true);
  for (const gate of [1, 4]) assert.equal(isReadinessGate("lab", gate), false);
  for (const gate of [1, 2, 3, 4]) assert.equal(isReadinessGate("production", gate), false);
});

test("markGateReady records a checkpoint with no decision fields and only from open", () => {
  assert.deepEqual(markGateReady(open(2), "lab", readyAt), { gate: 2, state: "ready", dependencyHash: hash, readyAt });
  assert.throws(() => markGateReady(open(1), "lab", readyAt), /cannot be recorded as ready/u);
  assert.throws(() => markGateReady(open(4), "lab", readyAt), /cannot be recorded as ready/u);
  assert.throws(() => markGateReady(open(2), "production", readyAt), /cannot be recorded as ready/u);
  for (const state of ["closed", "approved", "inherited", "rejected", "invalidated", "ready"] as const) {
    assert.throws(() => markGateReady({ gate: 3, state, dependencyHash: hash }, "lab", readyAt), /is not open/u, state);
  }
});

test("a ready gate is invalidated like an approved gate, cannot be decided or inherited, and reopens", () => {
  const ready = markGateReady(open(2), "lab", readyAt);
  const invalidated = invalidateGate(ready, later, "requirements changed");
  assert.deepEqual(invalidated, {
    gate: 2,
    state: "invalidated",
    dependencyHash: later,
    reason: "requirements changed",
  });
  assert.equal(invalidated.readyAt, undefined);
  assert.throws(() => decideGate(ready, "approved", readyAt), /is not open/u);
  assert.throws(() => inheritGate(ready, "run-1" as never, hash, readyAt), /recomputed in the new run/u);
  assert.equal(openGate(invalidated, later).state, "open");
  assert.throws(() => openGate(ready, later), /cannot open from ready/u);
});

test("run configuration rejects readiness outside lab Gates 2 and 3 or with decision fields", () => {
  const run = (purpose: string, gates: unknown[]) =>
    JSON.stringify({
      schemaVersion: "1.0.0",
      projectId: "demo",
      runId: "run-1",
      environment: "dev",
      purpose,
      targetScope: "local",
      iacTool: "bicep",
      createdAt: readyAt,
      runtimeLockHash: hash,
      ownerEpoch: 1,
      gates,
    });
  const closed = (gate: number) => ({ gate, state: "closed", dependencyHash: hash });
  const ready = (gate: number, extra: object = {}) => ({
    gate,
    state: "ready",
    dependencyHash: hash,
    readyAt,
    ...extra,
  });
  const gates = (overrides: Record<number, unknown>) => [1, 2, 3, 4].map((gate) => overrides[gate] ?? closed(gate));
  assert.equal(parseRunConfig(run("lab", gates({ 2: ready(2), 3: ready(3) }))).gates[1]?.state, "ready");
  for (const invalid of [
    run("lab", gates({ 1: ready(1) })),
    run("lab", gates({ 4: ready(4) })),
    run("production", gates({ 2: ready(2) })),
    run("lab", gates({ 2: ready(2, { decidedAt: readyAt }) })),
    run("lab", gates({ 2: ready(2, { inheritedFromRunId: "run-0" }) })),
    run("lab", gates({ 2: { gate: 2, state: "ready", dependencyHash: hash } })),
    run("lab", gates({ 2: { gate: 2, state: "open", dependencyHash: hash, readyAt } })),
  ]) {
    assert.throws(() => parseRunConfig(invalid), RunConfigInvalidError);
  }
});

test("only lab Gates 2 and 3 readiness satisfies downstream workflow nodes", () => {
  // Skipping the gate node itself isolates how the engine treats the gate state as a dependency of the next node.
  const routeAfter = (gateNumber: number, purpose: string, gateState: string, completedNodes: string[], extra = {}) => {
    const skipped = structuredClone(workflow);
    skipped.nodes.find((node: { id: string }) => node.id === `gate-${gateNumber}`).condition = {
      equals: [{ path: "run.purpose" }, "never"],
    };
    return new WorkflowEngine(skipped).route({
      run: { iacTool: "bicep", purpose, targetScope: "scope" },
      artifacts: {
        "requirements-v1": {},
        "architecture-v1": {},
        "governance-constraints-v1": {},
        "policy-property-map-v1": {},
        "implementation-intent-v1": {},
        "iac-binding-v1": {},
        "environment-inputs-v1": {},
        "deployment-preview-v1": {},
        "execution-plan-attestation-v1": {},
        "validation-evidence-v1": {},
        "iac-tree-hash": {},
        "approval-evidence-v1": {},
        "bicep-tree": {},
        "repository-head": {},
        "owner-epoch": {},
        "accepted-risk-scopes": {},
        defaults: {},
        toolchain: {},
        "runtime-bundle": {},
        "governance-capability-lock": {},
        ...extra,
      },
      completedNodes,
      gateStates: { [`gate-${gateNumber}`]: gateState },
    });
  };
  const beforePlan = ["requirements", "gate-1", "governance-discovery", "architecture"];
  assert.equal(routeAfter(2, "lab", "ready", beforePlan).nextTask, "plan");
  assert.equal(routeAfter(2, "lab", "approved", beforePlan).nextTask, "plan");
  for (const [purpose, state] of [
    ["lab", "open"],
    ["lab", "invalidated"],
    ["production", "ready"],
  ] as const) {
    assert.notEqual(routeAfter(2, purpose, state, beforePlan).nextTask, "plan", `${purpose}/${state}`);
  }

  const beforeCodegen = [...beforePlan, "gate-2", "plan"];
  assert.equal(routeAfter(3, "lab", "ready", beforeCodegen).nextTask, "codegen-bicep");
  assert.notEqual(routeAfter(3, "production", "ready", beforeCodegen).nextTask, "codegen-bicep");

  // Gate 1 is human only and Gate 4 can never be satisfied by readiness.
  assert.equal(routeAfter(1, "lab", "approved", ["requirements"]).nextTask, "governance-discovery");
  assert.notEqual(routeAfter(1, "lab", "ready", ["requirements"]).nextTask, "governance-discovery");
  const beforeDeploy = [...beforeCodegen, "gate-3", "codegen-bicep", "validation-bicep", "preview-bicep"];
  assert.equal(routeAfter(4, "lab", "approved", beforeDeploy).nextTask, "deploy-bicep");
  assert.notEqual(routeAfter(4, "lab", "ready", beforeDeploy).nextTask, "deploy-bicep");
});

test("Gate 1 binds purpose and target and readiness depends on Gate 1", () => {
  const engine = new WorkflowEngine(workflow);
  const node = (id: string) => engine.manifest.nodes.find((candidate) => candidate.id === id)!;
  for (const dependency of ["run-config.purpose", "run-config.targetScope"]) {
    assert.ok(node("gate-1").sourceDependencies.includes(dependency));
  }
  assert.ok(node("gate-2").sourceDependencies.includes("gate-1"));
  assert.ok(node("gate-3").sourceDependencies.includes("gate-1"));
  const invalidated = engine.invalidationPlan("requirements", "changed").map(({ nodeId }) => nodeId);
  for (const id of ["gate-1", "gate-2", "gate-3", "gate-4"]) assert.ok(invalidated.includes(id), id);
});
