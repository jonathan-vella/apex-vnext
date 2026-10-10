import assert from "node:assert/strict";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { RunConfigV1 } from "@apexops/contracts";
import { EventJournal, ValidatorRegistry } from "@apexops/kernel";
import { ApexError } from "../errors.js";
import { ApexService } from "../service.js";
import { registerWorkflowValidators } from "../workflow-validators.js";
import {
  assertLabReadiness,
  completeOutputs,
  costEstimate,
  architecture,
  governanceFindings,
  importReferenceGovernance,
  nextTaskAfterInput,
  acceptAvailabilityEvidence,
  policyMap,
  prepareValidatedRun,
  requirements,
  review,
  tempRoot,
  workloadDecisionManifest,
} from "./helpers.js";
import { sha256Json } from "@apexops/kernel";

function field(gate: RunConfigV1["gates"][number], key: "readyAt" | "decidedAt" | "inheritedFromRunId") {
  return (gate as Partial<Record<typeof key, string>>)[key];
}

async function events(root: string, runId: string) {
  return new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal")).replay();
}

async function gates(service: ApexService): Promise<RunConfigV1["gates"]> {
  return (await service.status()).run.gates;
}

async function task(service: ApexService, expected: string): Promise<string> {
  const next = await nextTaskAfterInput(service);
  assert.equal(next.status, "task");
  if (next.status !== "task") throw new Error("Expected task");
  assert.equal(next.task.taskType, expected);
  return next.task.taskId;
}

/** Drives a lab run through accepted requirements and Gate 1, leaving the architecture task ready to issue. */
async function reachArchitecture(service: ApexService, runId: string): Promise<string> {
  const requirementHashes = await completeOutputs(service, await task(service, "requirements"), [
    { kind: "requirements", value: requirements() },
  ]);
  await completeOutputs(service, await task(service, "requirements-review"), [
    { kind: "review-findings", value: review(runId, "requirements", requirementHashes.outputHashes.requirements!) },
  ]);
  await service.decideGateNumber(1, "approved", "tester");
  await acceptAvailabilityEvidence(service, runId);
  return requirementHashes.outputHashes.requirements!;
}

async function completeArchitecture(service: ApexService, runId: string, requirementsHash: string) {
  const governanceHash = await importReferenceGovernance(service);
  const architectureValue = architecture(runId);
  const costValue = costEstimate(runId);
  const architectureTask = await task(service, "architecture");
  const findings = await governanceFindings(service, architectureTask, ["Microsoft.Web/sites"]);
  const hashes = await service.completeTaskOutputs(architectureTask, [
    { kind: "architecture", value: architectureValue },
    { kind: "cost-estimate", value: costValue },
    {
      kind: "workload-decision-manifest",
      value: workloadDecisionManifest({
        runId,
        requirementsHash,
        architectureHash: sha256Json(architectureValue),
        costEstimateHash: sha256Json(costValue),
      }),
    },
    { kind: "policy-property-map", value: policyMap(runId, governanceHash, findings) },
  ]);
  return { hashes: hashes.outputHashes, governanceHash };
}

test("lab Gates 2 and 3 are recorded as readiness checkpoints without approval evidence or a human decision", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  await prepareValidatedRun(service, runId, "bicep");

  const states = await gates(service);
  assert.deepEqual(
    states.map(({ state }) => state),
    ["approved", "ready", "ready", "closed"],
  );
  for (const gate of [states[1]!, states[2]!]) {
    assert.match(field(gate, "readyAt")!, /^\d{4}-\d{2}-\d{2}T/u);
    assert.equal(field(gate, "decidedAt"), undefined);
    assert.equal(field(gate, "inheritedFromRunId"), undefined);
  }

  const journal = await events(root, runId);
  const humanDecisions = journal.filter(({ type }) => type === "gate.decided");
  assert.deepEqual(
    humanDecisions.map(({ payload }) => (payload as { gate: number }).gate),
    [1],
  );
  const readiness = journal.filter(({ type }) => type === "gate.readiness-recorded");
  assert.deepEqual(
    readiness.map(({ payload }) => (payload as { gate: number }).gate),
    [2, 3],
  );
  for (const event of readiness) {
    const payload = event.payload as Record<string, unknown>;
    assert.equal(Object.hasOwn(payload, "approvalHash"), false);
    assert.equal(Object.hasOwn(payload, "actor"), false);
    assert.equal(Object.hasOwn(payload, "decision"), false);
    assert.deepEqual(
      Object.keys(payload)
        .filter((key) => key !== "transaction")
        .sort(),
      ["dependencyHash", "gate", "validatorIds"],
    );
    assert.equal(payload.dependencyHash, states[(payload.gate as number) - 1]!.dependencyHash);
  }
  assert.deepEqual((readiness[0]!.payload as { validatorIds: string[] }).validatorIds, [
    "gate:architecture-cost-governance-ready",
  ]);
  assert.deepEqual((readiness[1]!.payload as { validatorIds: string[] }).validatorIds, [
    "gate:implementation-plan-ready",
  ]);
  const opened = journal
    .filter(({ type }) => type === "gate.opened")
    .map(({ payload }) => (payload as { gate: number }).gate);
  assert.deepEqual(opened, [1, 2, 3]);
  assert.match(await service.render("status"), /\| 2 \| ready \| - \| - \| \d{4}/u);
  assert.equal((await service.validate()).valid, true);
});

test("lab readiness never unlocks Gate 4 or deployment; the final preview still needs a human approval", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  await prepareValidatedRun(service, runId, "bicep");

  const preview = await service.preview({ operation: "apply", provider: "fake" });
  assert.equal((await gates(service))[3]!.state, "open");
  await assert.rejects(service.deploy(preview.previewHash), /Gate 4 approval/u);
  const material = await readFile(
    join(root, "agent-output", "demo", runId, "operations", "deployment-preview.md"),
    "utf8",
  );
  assert.match(material, /## Approval Context/u);
  assert.match(material, /- Purpose: lab/u);
  assert.match(material, /- Target: local/u);
  assert.match(material, /Gate 1: human intent confirmation \(approved\)/u);
  assert.match(material, /Gates 2 and 3: kernel readiness checkpoints \(ready, ready\); not human approvals/u);
  assert.match(material, /## Architecture[\s\S]*### Components/u);
  assert.match(material, /## Cost Estimate[\s\S]*Estimated monthly total: 1 USD/u);
  assert.match(material, /## Accepted Risks\n\n- None\./u);

  // The approver relies on this material, so a hand edit blocks the decision until it is restored.
  const materialPath = join(root, "agent-output", "demo", runId, "operations", "deployment-preview.md");
  await writeFile(materialPath, material.replace("- Purpose: lab", "- Purpose: edited"));
  await assert.rejects(service.decideGateNumber(4, "approved", "tester"), /manual edits/u);
  await writeFile(materialPath, material);
  const approval = await service.decideGateNumber(4, "approved", "tester");
  assert.equal(approval.gate, 4);
  assert.equal(approval.mechanism, "tty");
  const deployed = await service.deploy(preview.previewHash);
  assert.equal(deployed.inventory.resources.length, 1);
  const humanDecisions = (await events(root, runId))
    .filter(({ type }) => type === "gate.decided")
    .map(({ payload }) => (payload as { gate: number }).gate);
  assert.deepEqual(humanDecisions, [1, 4]);
});

test("apply and destroy each need their own current preview and human approval in a lab run", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  await prepareValidatedRun(service, runId, "bicep");

  const applyPreview = await service.preview({ operation: "apply", provider: "fake" });
  await service.decideGateNumber(4, "approved", "tester");
  await service.deploy(applyPreview.previewHash);

  const destroyPreview = await service.preview({ operation: "destroy", provider: "fake" });
  assert.notEqual(destroyPreview.previewHash, applyPreview.previewHash);
  assert.equal((await gates(service))[3]!.state, "open");
  await assert.rejects(service.deploy(destroyPreview.previewHash), /Approval does not authorize the exact preview/u);
  await assert.rejects(service.deploy(applyPreview.previewHash), /preview|approval/iu);
  await service.decideGateNumber(4, "approved", "tester");
  const destroyed = await service.deploy(destroyPreview.previewHash);
  assert.equal(destroyed.inventory.resources.length, 0);
  assert.deepEqual(
    (await events(root, runId))
      .filter(({ type }) => type === "gate.decided")
      .map(({ payload }) => (payload as { gate: number }).gate),
    [1, 4, 4],
  );
});

test("human decisions on lab Gates 2 and 3 are refused and leave no record", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  await prepareValidatedRun(service, runId, "bicep");
  const before = await events(root, runId);

  const refusal = (error: unknown) =>
    error instanceof ApexError &&
    error.code === "APEX_VALIDATION" &&
    /readiness checkpoint/u.test(error.message) &&
    /no human decision/u.test(error.message) &&
    (error.details as { reason?: string }).reason === "GATE_READINESS_AUTOMATIC";
  await assert.rejects(service.decideGateNumber(2, "approved", "tester"), refusal);
  await assert.rejects(service.decideGateNumber(3, "rejected", "tester"), refusal);
  await assert.rejects(service.decideInteractiveGate(2, "approved"), refusal);
  await assert.rejects(service.decideInteractiveGate(3, "rejected"), refusal);
  assert.equal((await events(root, runId)).length, before.length);
  assert.deepEqual(
    (await gates(service)).map(({ state }) => state),
    ["approved", "ready", "ready", "closed"],
  );
});

test("Gate 1 remains the single human intent confirmation and readiness cannot precede it", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  const requirementHashes = await completeOutputs(service, await task(service, "requirements"), [
    { kind: "requirements", value: requirements() },
  ]);
  await completeOutputs(service, await task(service, "requirements-review"), [
    { kind: "review-findings", value: review(runId, "requirements", requirementHashes.outputHashes.requirements!) },
  ]);
  assert.deepEqual(
    (await gates(service)).map(({ state }) => state),
    ["open", "closed", "closed", "closed"],
  );
  await assert.rejects(service.nextTask(), /Gate 1 approval is required/u);
  const approval = await service.decideGateNumber(1, "approved", "tester");
  assert.equal(approval.mechanism, "tty");
  assert.equal(approval.actor, "tester");
  assert.deepEqual(
    (await gates(service)).map(({ state }) => state),
    ["approved", "closed", "closed", "closed"],
  );
});

test("readiness is not recorded while a required review is missing or a blocking finding is unresolved", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  const requirementsHash = await reachArchitecture(service, runId);
  const { hashes } = await completeArchitecture(service, runId, requirementsHash);

  // The architecture review has not run: Gate 2 is neither open nor ready.
  assert.equal((await gates(service))[1]!.state, "closed");
  assert.equal(await task(service, "architecture-review").then(() => "issued"), "issued");

  const finding = {
    id: "F-ARCH-1",
    severity: "medium",
    disposition: "open",
    title: "Capacity assumption",
    detail: "Confirm the capacity assumption.",
    evidenceRefs: [],
  };
  const architectureReview = review(runId, "architecture", hashes.architecture!, [finding]);
  const criterion = architectureReview.criteria!.find(({ criterionId }) => criterionId === "reliability")!;
  criterion.outcome = "finding";
  (criterion.findingIds as string[]).push("F-ARCH-1");
  const reviewHashes = await completeOutputs(service, await task(service, "architecture-review"), [
    { kind: "review-findings", value: architectureReview },
  ]);
  const pending = await service.nextTask();
  assert.equal(pending.status, "needs_review");
  assert.equal((await gates(service))[1]!.state, "closed");
  assert.equal((await events(root, runId)).filter(({ type }) => type === "gate.readiness-recorded").length, 0);

  // Accepting the risk is a human decision; only then does the kernel record readiness.
  await service.decideReview(reviewHashes.outputHashes["review-findings"]!, [
    { findingId: "F-ARCH-1", action: "accept-risk", rationale: "Temporary acceptance." },
  ]);
  const gate2 = (await gates(service))[1]!;
  assert.equal(gate2.state, "ready");
  assert.equal(field(gate2, "decidedAt"), undefined);
  assert.deepEqual(
    (await events(root, runId))
      .filter(({ type }) => type === "gate.readiness-recorded")
      .map(({ payload }) => (payload as { gate: number }).gate),
    [2],
  );
  const run = await service["currentRun"]();
  const context = await service["approvalContextMarkdown"](run, await events(root, runId));
  assert.match(context, /## Accepted Risks\n\n- F-ARCH-1 \(expires [^)]*owner partner\): Temporary acceptance\./u);
  assert.equal((await service.nextTask()).status, "task");
});

test("a failing gate validator leaves the lab gate unrecorded and reports why", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  const requirementsHash = await reachArchitecture(service, runId);
  const validators = service["validators"] as unknown as {
    validators: Map<string, { handler: (value: unknown) => unknown; kind: string }>;
  };
  const original = validators.validators.get("gate:architecture-cost-governance-ready")!;
  validators.validators.set("gate:architecture-cost-governance-ready", {
    kind: original.kind,
    handler: () => [{ path: "/injected", message: "Injected readiness failure" }],
  });
  const { hashes } = await completeArchitecture(service, runId, requirementsHash);
  await completeOutputs(service, await task(service, "architecture-review"), [
    { kind: "review-findings", value: review(runId, "architecture", hashes.architecture!) },
  ]);

  assert.equal((await gates(service))[1]!.state, "open");
  assert.equal((await events(root, runId)).filter(({ type }) => type === "gate.readiness-recorded").length, 0);
  await assert.rejects(service.nextTask(), /Gate 2 readiness checkpoint is not recorded: Injected readiness failure/u);
  await assert.rejects(service.decideGateNumber(2, "approved", "tester"), /readiness checkpoint/u);
  await assert.rejects(service.preview({ operation: "apply", provider: "fake" }));

  // A run file edited to say ready is not readiness: the journal holds no matching kernel record.
  const runPath = join(root, ".apex", "projects", "demo", "runs", runId, "run.json");
  const run = JSON.parse(await readFile(runPath, "utf8")) as RunConfigV1;
  run.gates[1] = { ...run.gates[1]!, state: "ready", readyAt: "2026-01-01T00:00:00.000Z" };
  await writeFile(runPath, `${JSON.stringify(run)}\n`);
  await assert.rejects(new ApexService(root).nextTask(), /Gate 2 readiness checkpoint is not recorded/u);
});

test("an open lab gate whose checks failed is recorded when they pass on a later nextTask", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  const requirementsHash = await reachArchitecture(service, runId);
  const validators = service["validators"] as unknown as {
    validators: Map<string, { handler: (value: unknown) => unknown; kind: string }>;
  };
  const original = validators.validators.get("gate:architecture-cost-governance-ready")!;
  validators.validators.set("gate:architecture-cost-governance-ready", {
    kind: original.kind,
    handler: () => [{ path: "/injected", message: "Injected readiness failure" }],
  });
  const { hashes } = await completeArchitecture(service, runId, requirementsHash);
  await completeOutputs(service, await task(service, "architecture-review"), [
    { kind: "review-findings", value: review(runId, "architecture", hashes.architecture!) },
  ]);
  await assert.rejects(service.nextTask(), /Gate 2 readiness checkpoint is not recorded/u);
  validators.validators.set("gate:architecture-cost-governance-ready", original);
  assert.equal((await service.nextTask()).status, "task");
  assert.equal((await gates(service))[1]!.state, "ready");
});

test("changed requirements invalidate readiness and it is re-recorded only after re-confirmation", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  await prepareValidatedRun(service, runId, "bicep");
  const firstReadiness = (await gates(service)).slice(1, 3).map(({ dependencyHash }) => dependencyHash);

  const candidate = { ...requirements(), budgetAndOperations: "Monthly limit is EUR 500" };
  const proposal = await service.previewRequirementsChange(candidate, "Change budget");
  await service.reviseRequirements(candidate, {
    reason: "Change budget",
    expectedHash: proposal.proposalHash,
    confirm: true,
  });
  assert.deepEqual(
    (await gates(service)).map(({ state }) => state),
    ["invalidated", "invalidated", "invalidated", "invalidated"],
  );
  await assert.rejects(service.preview({ operation: "apply", provider: "fake" }), /Gate 3|readiness|Workflow/u);

  await prepareValidatedRun(service, runId, "bicep", {
    requirements: candidate,
    acceptAvailability: false,
    stopBeforeCodegen: true,
  });
  const states = await gates(service);
  assert.deepEqual(
    states.map(({ state }) => state),
    ["approved", "ready", "ready", "invalidated"],
  );
  assert.notDeepEqual(
    states.slice(1, 3).map(({ dependencyHash }) => dependencyHash),
    firstReadiness,
  );
  const journal = await events(root, runId);
  assert.equal(journal.filter(({ type }) => type === "gate.readiness-recorded").length, 4);
  assert.equal(journal.filter(({ type }) => type === "gate.decided").length, 2);
});

test("promotion never inherits readiness; the new run records its own", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  await prepareValidatedRun(service, runId, "bicep");

  const sameScope = await service.promote("stage", "local");
  assert.deepEqual(
    sameScope.gates.map(({ state }) => state),
    ["inherited", "ready", "ready", "closed"],
  );
  for (const gate of sameScope.gates.slice(1, 3)) {
    assert.equal(field(gate, "inheritedFromRunId"), undefined);
    assert.equal(field(gate, "decidedAt"), undefined);
    assert.ok(field(gate, "readyAt"));
  }
  const promotedEvents = await events(root, sameScope.runId);
  assert.deepEqual(
    promotedEvents
      .filter(({ type }) => type === "gate.readiness-recorded")
      .map(({ payload }) => (payload as { gate: number }).gate),
    [2, 3],
  );
  assert.equal(promotedEvents.filter(({ type }) => type === "gate.decided").length, 0);

  await service.use(sameScope.projectId, runId as never);
  const changedScope = await service.promote("prod", "local/prod");
  assert.deepEqual(
    changedScope.gates.map(({ state }) => state),
    ["closed", "closed", "closed", "closed"],
  );
  // Gate 1 binds the target, so the new run redoes the requirements review and computes its own Gate 1 hash.
  assert.equal((await sourceRunGate1(root, runId)).state, "approved");
  const requirementsHash = service["acceptedArtifactHashes"](
    await service["journal"](changedScope).replay(),
  ).requirements!;
  await completeOutputs(service, await task(service, "requirements-review"), [
    { kind: "review-findings", value: review(changedScope.runId, "requirements", requirementsHash) },
  ]);
  const childGate1 = (await gates(service))[0]!;
  assert.equal(childGate1.state, "open");
  assert.notEqual(childGate1.dependencyHash, (await sourceRunGate1(root, runId)).dependencyHash);
  await assert.rejects(service.nextTask(), /Gate 1 approval is required/u);
  await service.decideGateNumber(1, "approved", "tester");
  assert.equal((await service.nextTask()).status, "task");
});

async function sourceRunGate1(root: string, runId: string) {
  const run = JSON.parse(
    await readFile(join(root, ".apex", "projects", "demo", "runs", runId, "run.json"), "utf8"),
  ) as RunConfigV1;
  return run.gates[0]!;
}

test("a run file that records readiness outside lab Gates 2 and 3 is rejected", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  const runPath = join(root, ".apex", "projects", "demo", "runs", runId, "run.json");
  const original = await readFile(runPath, "utf8");
  const run = JSON.parse(original) as RunConfigV1;
  const forged = (mutate: (value: RunConfigV1) => void) => {
    const copy = structuredClone(run);
    mutate(copy);
    return `${JSON.stringify(copy)}\n`;
  };
  const readyGate = (gate: number) => ({
    gate,
    state: "ready" as const,
    dependencyHash: "a".repeat(64),
    readyAt: "2026-01-01T00:00:00.000Z",
  });
  for (const gate of [1, 4]) {
    await writeFile(
      runPath,
      forged((value) => {
        value.gates[gate - 1] = readyGate(gate);
      }),
    );
    await assert.rejects(new ApexService(root).status(), /does not match the current contract/u);
  }
  await writeFile(
    runPath,
    forged((value) => {
      value.purpose = "production";
      value.gates[1] = readyGate(2);
    }),
  );
  await assert.rejects(new ApexService(root).status(), /ready is only valid for lab Gates 2 and 3/u);
  await writeFile(
    runPath,
    forged((value) => {
      value.gates[1] = { ...readyGate(2), decidedAt: "2026-01-01T00:00:00.000Z" } as never;
    }),
  );
  await assert.rejects(new ApexService(root).status(), /does not match the current contract/u);
  await writeFile(
    runPath,
    forged((value) => {
      value.gates[1] = {
        gate: 2,
        state: "approved",
        dependencyHash: "a".repeat(64),
        readyAt: "2026-01-01T00:00:00.000Z",
      } as never;
    }),
  );
  await assert.rejects(new ApexService(root).status(), /does not match the current contract/u);
  await writeFile(runPath, original);
  await assertLabReadinessAbsent(new ApexService(root));
});

async function assertLabReadinessAbsent(service: ApexService): Promise<void> {
  await assert.rejects(assertLabReadiness(service, 2), /readiness was not recorded/u);
}

test("gate validators never accept a missing approval where a human decision is required", () => {
  const registry = new ValidatorRegistry();
  registerWorkflowValidators(registry);
  const hash = "b".repeat(64);
  const run = { projectId: "demo", runId: "run-1", purpose: "lab", ownerEpoch: 1, targetScope: "local" };
  const base = {
    now: "2026-01-01T00:00:00.000Z",
    run,
    artifactHashes: { requirements: hash },
    completedNodes: ["requirements-review"],
    reviewBlockers: [],
    expectedDependencyHash: hash,
    currentDependencyRevision: hash,
  };
  const gate1 = { gate: 1, state: "open", dependencyHash: hash };
  assert.equal(registry.validate("gate:requirements-ready", { ...base, gateNumber: 1, gate: gate1 }).valid, false);
  const gate4 = { gate: 4, state: "open", dependencyHash: hash };
  assert.equal(
    registry.validate("gate:approval-binding-complete", { ...base, gateNumber: 4, gate: gate4 }).valid,
    false,
  );
  const gate2 = { gate: 2, state: "open", dependencyHash: hash };
  const architectureArtifacts = {
    architecture: hash,
    "cost-estimate": hash,
    "workload-decision-manifest": hash,
    "governance-constraints": hash,
    "policy-property-map": hash,
  };
  const readiness = {
    ...base,
    gateNumber: 2,
    gate: gate2,
    artifactHashes: architectureArtifacts,
    completedNodes: ["architecture-review"],
  };
  assert.equal(registry.validate("gate:architecture-cost-governance-ready", readiness).valid, true);
  assert.equal(
    registry.validate("gate:architecture-cost-governance-ready", {
      ...readiness,
      run: { ...run, purpose: "production" },
    }).valid,
    false,
  );
});

async function readyFixture() {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  await prepareValidatedRun(service, runId, "bicep", { stopBeforeCodegen: true });
  const run = await service["currentRun"]();
  const satisfied = async (candidate: RunConfigV1, gate = 2) =>
    service["gateSatisfied"](candidate, gate, await events(root, runId));
  return { root, service, runId, run, satisfied };
}

test("a genuine readiness record satisfies its gate and nothing else does", async () => {
  const { run, satisfied } = await readyFixture();
  assert.equal(await satisfied(run, 2), true);
  assert.equal(await satisfied(run, 3), true);
  const swapped = structuredClone(run);
  swapped.gates[1] = { ...run.gates[2]!, gate: 2 } as RunConfigV1["gates"][number];
  assert.equal(await satisfied(swapped, 2), false);
  const retimed = structuredClone(run);
  (retimed.gates[1] as { readyAt: string }).readyAt = "2030-01-01T00:00:00.000Z";
  assert.equal(await satisfied(retimed, 2), false);
});

test("an old readiness record cannot be restored after the gate was invalidated", async () => {
  const { root, service, runId, run, satisfied } = await readyFixture();
  const oldGate2 = structuredClone(run.gates[1]!);

  const candidate = { ...requirements(), budgetAndOperations: "Monthly limit is EUR 500" };
  const proposal = await service.previewRequirementsChange(candidate, "Change budget");
  await service.reviseRequirements(candidate, {
    reason: "Change budget",
    expectedHash: proposal.proposalHash,
    confirm: true,
  });
  const invalidated = await service["currentRun"]();
  assert.equal(invalidated.gates[1]!.state, "invalidated");
  const restored = { ...invalidated, gates: invalidated.gates.map((gate) => (gate.gate === 2 ? oldGate2 : gate)) };
  // The latest event touching Gate 2 is the invalidation, so the old record proves nothing.
  assert.equal(await satisfied(restored as RunConfigV1, 2), false);

  // Redo the workflow: Gate 2 is ready again with a new hash, but the old record is still not valid.
  await prepareValidatedRun(service, runId, "bicep", {
    requirements: candidate,
    acceptAvailability: false,
    stopBeforeCodegen: true,
  });
  const current = await service["currentRun"]();
  assert.equal(await satisfied(current, 2), true);
  assert.notEqual(current.gates[1]!.dependencyHash, oldGate2.dependencyHash);
  const replayed = { ...current, gates: current.gates.map((gate) => (gate.gate === 2 ? oldGate2 : gate)) };
  assert.equal(await satisfied(replayed as RunConfigV1, 2), false);
  const runPath = join(root, ".apex", "projects", "demo", "runs", runId, "run.json");
  await writeFile(runPath, `${JSON.stringify(replayed)}\n`);
  await assert.rejects(new ApexService(root).preview({ operation: "apply", provider: "fake" }));
});

test("readiness is revoked by any later event that touches the gate", async () => {
  for (const event of [
    { type: "workflow.invalidated", payload: { nodeIds: ["gate-2"], artifactKinds: [], reason: "later" } },
    { type: "gate.opened", payload: { gate: 2, dependencyHash: "a".repeat(64) } },
    { type: "gate.reopened", payload: { gate: 2, dependencyHash: "a".repeat(64) } },
    { type: "gate.decided", payload: { gate: 2, approvalHash: "a".repeat(64) } },
  ]) {
    const { service, run, satisfied } = await readyFixture();
    assert.equal(await satisfied(run, 2), true);
    await service["append"](run, event.type, event.payload as never);
    assert.equal(await satisfied(run, 2), false, event.type);
    assert.equal(await satisfied(run, 3), true, `${event.type} leaves Gate 3`);
  }
});

test("readiness requires the gate to match the current review dependency", async () => {
  const { service, run, satisfied } = await readyFixture();
  // A newer architecture review without an invalidation leaves the recorded hash stale.
  await service["append"](run, "task.completed", {
    nodeId: "architecture-review",
    dependencyHash: "c".repeat(64),
    artifactHashes: {},
  });
  assert.equal(await satisfied(run, 2), false);
  assert.equal(await satisfied(run, 3), true);
});

test("a journal written for another run is rejected for every gate type", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", riskOwner: "partner" });
  await prepareValidatedRun(service, runId, "bicep", { stopBeforeCodegen: true });
  const child = await service.promote("stage", "local");
  const parentJournal = join(root, ".apex", "projects", "demo", "runs", runId, "journal");
  const childJournal = join(root, ".apex", "projects", "demo", "runs", child.runId, "journal");
  await rm(childJournal, { recursive: true, force: true });
  await cp(parentJournal, childJournal, { recursive: true });
  await assert.rejects(
    new ApexService(root).status(),
    (error: unknown) =>
      error instanceof ApexError && error.code === "APEX_CONFLICT" && /different project or run/u.test(error.message),
  );
});
