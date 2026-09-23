import assert from "node:assert/strict";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { EventJournal, ObjectStore, sha256Json } from "@apexops/kernel";
import type {
  EventV1,
  InputValueV1,
  RunConfigV1,
  PolicyPropertyMapV1,
  RequirementsAmendmentV1,
} from "@apexops/contracts";
import { ApexError } from "../errors.js";
import { ApexService } from "../service.js";
import {
  acceptAvailabilityEvidence,
  architecture,
  costEstimate,
  governance,
  nextTaskAfterInput,
  planBundle,
  policyMap,
  prepareValidatedRun,
  qualityReport,
  requirements,
  review,
  tempRoot,
  workloadDecisionManifest,
} from "./helpers.js";

async function recordRequirementsRound(service: ApexService, answers: Record<string, InputValueV1>): Promise<void> {
  const pending = await service.nextTask();
  assert.equal(pending.status, "needs_input");
  if (pending.status !== "needs_input") return;
  await service.recordInput({
    schemaVersion: "1.0.0",
    requestId: pending.request.requestId,
    expectedHead: pending.request.expectedHead,
    ownerEpoch: pending.request.ownerEpoch,
    answers: pending.request.questions.map(({ id }) => ({ questionId: id, value: answers[id]! })),
  });
}

async function snapshotFiles(directory: string): Promise<unknown[]> {
  const metadata = await stat(directory, { bigint: true });
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  return [
    metadata.mtimeNs,
    metadata.ctimeNs,
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return [entry.name, await snapshotFiles(path)];
        const metadata = await stat(path, { bigint: true });
        return [entry.name, metadata.mtimeNs, metadata.ctimeNs, await readFile(path)];
      }),
    ),
  ];
}

test("status is read-only across repeated active-run reads and restart", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo" });
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", initialized.runId, "journal"));
  const events = await journal.replay();
  const files = await snapshotFiles(root);
  const status = await service.status();
  assert.equal(status.task, "requirements");
  assert.equal(status.head, events.at(-1)?.hash);
  assert.equal(status.events, events.length);
  assert.deepEqual(await service.status(), status);
  assert.deepEqual(await new ApexService(root).status(), status);
  assert.deepEqual(await journal.replay(), events);
  assert.deepEqual(await snapshotFiles(root), files);
});

test("requirements change preview binds retained decisions and leaves workflow and files unchanged", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, runId, "bicep");
  const before = await service.status();
  const current = requirements();
  const candidate = {
    ...current,
    budgetAndOperations: "Monthly limit is EUR 500",
    requirements: [
      ...current.requirements,
      {
        id: "REQ-ADDED",
        statement: "Retain daily recovery points",
        priority: "must" as const,
        status: "confirmed" as const,
        source: "consumer",
      },
    ],
  };
  const files = await snapshotFiles(root);
  const proposal = await service.previewRequirementsChange(candidate, "Add recovery requirement");
  assert.deepEqual(proposal.addedRequirementIds, ["REQ-ADDED"]);
  assert.deepEqual(proposal.retainedRequirementIds, current.requirements.map(({ id }) => id).sort());
  assert.deepEqual(proposal.changedFields, ["budgetAndOperations"]);
  assert.equal(proposal.expectedHead, before.head);
  assert.equal(proposal.candidateHash, sha256Json(candidate));
  assert.deepEqual(proposal.invalidatedGates, [1, 2, 3, 4]);
  assert.equal(proposal.deploymentAuthorized, false);
  assert.deepEqual(
    await new ApexService(root).previewRequirementsChange(candidate, "Add recovery requirement"),
    proposal,
  );
  await assert.rejects(service.previewRequirementsChange(current, "No change"), /unchanged/);
  await assert.rejects(
    service.previewRequirementsChange({ ...candidate, projectId: "foreign" }, "Wrong project"),
    /valid consumer/,
  );
  assert.deepEqual(await service.status(), before);
  assert.deepEqual(await snapshotFiles(root), files);
});

test("requirements amendments preserve untouched decisions and require current confirmed revision", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, runId, "bicep");
  const base = requirements();
  const amendment: RequirementsAmendmentV1 = {
    schemaVersion: "1.0.0",
    baseRequirementsHash: sha256Json(base),
    updates: [{ id: base.requirements[0]!.id, changes: { statement: "Use the revised availability objective" } }],
    additions: [
      {
        id: "REQ-DEFERRED",
        statement: "Confirm recovery window",
        status: "deferred",
        priority: "should",
        source: "consumer",
      },
    ],
    removals: [],
    fields: { budgetAndOperations: "Monthly limit is EUR 500" },
  };
  const candidate = {
    ...base,
    ...amendment.fields,
    requirements: [
      ...base.requirements.map((item, index) => (index === 0 ? { ...item, ...amendment.updates[0]!.changes } : item)),
      ...amendment.additions,
    ],
  };
  const before = await service.status();
  const files = await snapshotFiles(root);
  const proposal = await service.previewRequirementsAmendment(amendment, "Revise objective");
  assert.deepEqual(proposal, await service.previewRequirementsChange(candidate, "Revise objective"));
  const options = { reason: "Revise objective", expectedHash: proposal.proposalHash, confirm: true };
  await assert.rejects(service.amendRequirements(amendment, { ...options, confirm: false }), /explicit confirmation/);
  await assert.rejects(
    service.previewRequirementsAmendment({ ...amendment, baseRequirementsHash: "f".repeat(64) }, "Stale"),
    /not current/,
  );
  for (const invalid of [
    { ...amendment, updates: [...amendment.updates, ...amendment.updates] },
    { ...amendment, removals: [base.requirements[0]!.id] },
    { ...amendment, updates: [{ id: "missing", changes: { statement: "Unknown ID" } }] },
    { ...amendment, additions: [base.requirements[0]!] },
    { ...amendment, fields: { environment: "prod" } },
    { ...amendment, fields: { businessContext: "x".repeat(262_144) } },
  ])
    await assert.rejects(service.previewRequirementsAmendment(invalid as RequirementsAmendmentV1, "Invalid"));
  await assert.rejects(
    service.amendRequirements({ ...amendment, fields: { workload: "Different" } }, options),
    /stale/,
  );
  assert.deepEqual(await service.status(), before);
  assert.deepEqual(await snapshotFiles(root), files);
  await service.amendRequirements(amendment, options);
  const restarted = new ApexService(root);
  await assert.rejects(restarted.previewRequirementsAmendment(amendment, "Replay"), /not current/);
  const next = await restarted.nextTask();
  assert.equal(next.status, "task");
  if (next.status !== "task") throw new Error("Expected amended requirements task");
  assert.deepEqual((await restarted.taskContext(next.task.taskId)).outputTemplates.requirements, candidate);
  await restarted.completeRequirements(next.task.taskId, candidate);
  assert.equal((await restarted.status()).task, "requirements-review");
  assert.ok((await restarted.status()).run.gates.every(({ state }) => state !== "approved"));
});

test("requirements amendments reject a revision change during asynchronous preview", async (context) => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", iacTool: "terraform" });
  await prepareValidatedRun(service, runId, "terraform");
  const amendment: RequirementsAmendmentV1 = {
    schemaVersion: "1.0.0",
    baseRequirementsHash: sha256Json(requirements()),
    updates: [],
    additions: [],
    removals: [],
    fields: { workload: "Amended workload" },
  };
  const original = service.previewRequirementsChange.bind(service);
  const competing = { ...requirements(), workload: "Concurrent workload" };
  const proposal = await original(competing, "Concurrent revision");
  context.mock.method(service, "previewRequirementsChange", async (...args: Parameters<typeof original>) => {
    context.mock.restoreAll();
    await service.reviseRequirements(competing, {
      reason: "Concurrent revision",
      expectedHash: proposal.proposalHash,
      confirm: true,
    });
    return original(...args);
  });
  await assert.rejects(service.previewRequirementsAmendment(amendment, "Amend workload"), /changed during preview/);
  const next = await service.nextTask();
  if (next.status !== "task") throw new Error("Expected concurrent revision task");
  assert.deepEqual((await service.taskContext(next.task.taskId)).outputTemplates.requirements, competing);
});

test("confirmed requirements revision invalidates proof without approvals or file replacement", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, runId, "bicep");
  const before = await service.status();
  const candidate = { ...requirements(), budgetAndOperations: "Monthly limit is EUR 500" };
  const proposal = await service.previewRequirementsChange(candidate, "Change budget");
  const options = { reason: "Change budget", expectedHash: proposal.proposalHash, confirm: true };
  await assert.rejects(service.reviseRequirements(candidate, { ...options, confirm: false }), /explicit confirmation/);
  await assert.rejects(
    service.reviseRequirements({ ...candidate, budgetAndOperations: "Different" }, options),
    /stale/,
  );
  assert.deepEqual(await service.status(), before);
  await writeFile(join(root, "manual-design.md"), "Retain this manual edit\n");
  const result = await service.reviseRequirements(candidate, options);
  assert.equal(result.deploymentAuthorized, false);
  const after = await service.status();
  assert.equal(after.task, "requirements");
  assert.equal(after.events, before.events + 1);
  assert.ok(after.run.gates.every(({ state }) => state !== "approved" && state !== "inherited"));
  assert.equal(await readFile(join(root, "manual-design.md"), "utf8"), "Retain this manual edit\n");
  const restarted = new ApexService(root);
  const task = await restarted.nextTask();
  assert.equal(task.status, "task");
  if (task.status !== "task") throw new Error("Expected revised requirements task");
  assert.deepEqual((await restarted.taskContext(task.task.taskId)).outputTemplates.requirements, candidate);
  await assert.rejects(restarted.completeRequirements(task.task.taskId, requirements()), /confirmed change candidate/);
  const documentPath = join(root, "agent-output", "demo", runId, "01-requirements.md");
  const originalDocument = await readFile(documentPath, "utf8");
  await writeFile(documentPath, "Manual requirements edit\n");
  const pending = await restarted.status();
  await assert.rejects(restarted.completeRequirements(task.task.taskId, candidate), /manual edits/);
  assert.deepEqual(await restarted.status(), pending);
  assert.equal(await readFile(documentPath, "utf8"), "Manual requirements edit\n");
  await writeFile(documentPath, originalDocument);
  const unchangedPath = join(root, "agent-output", "demo", runId, "service-recommendations.md");
  const unchangedBefore = await stat(unchangedPath, { bigint: true });
  await restarted.completeRequirements(task.task.taskId, candidate);
  assert.equal((await stat(unchangedPath, { bigint: true })).mtimeNs, unchangedBefore.mtimeNs);
  assert.equal((await restarted.status()).task, "requirements-review");
  assert.equal(await readFile(join(root, "manual-design.md"), "utf8"), "Retain this manual edit\n");
});

test("confirmed decision adoption reuses recovered requirements without importing approvals", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo" });
  await writeFile(join(root, "manual-workload.md"), "Existing independently copied design\n");
  const candidate = requirements();
  const before = await service.status();
  const proposal = await service.previewRequirementsChange(candidate, "Adopt recovered consumer decisions", "adopt");
  assert.equal(proposal.sourceRequirementsHash, null);
  assert.equal(proposal.mode, "adopt");
  assert.deepEqual(proposal.retainedRequirementIds, []);
  assert.deepEqual(await service.status(), before);
  await service.reviseRequirements(candidate, {
    reason: proposal.reason,
    expectedHash: proposal.proposalHash,
    confirm: true,
    mode: "adopt",
  });
  const restarted = new ApexService(root);
  const task = await restarted.nextTask();
  assert.equal(task.status, "task");
  if (task.status !== "task") throw new Error("Expected adopted requirements task without repeated intake");
  assert.deepEqual((await restarted.taskContext(task.task.taskId)).outputTemplates.requirements, candidate);
  await restarted.completeRequirements(task.task.taskId, candidate);
  assert.equal((await restarted.status()).task, "requirements-review");
  assert.ok((await restarted.status()).run.gates.every(({ state }) => state !== "approved" && state !== "inherited"));
  await assert.rejects(restarted.previewRequirementsChange(candidate, "Duplicate adoption", "adopt"), /use revision/);
  assert.equal(await readFile(join(root, "manual-workload.md"), "utf8"), "Existing independently copied design\n");
});

test("a later review invalidation does not resurrect an older confirmed requirements candidate", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo" });
  const candidate = { ...requirements(), budgetAndOperations: "Adopted budget" };
  const proposal = await service.previewRequirementsChange(candidate, "Adopt", "adopt");
  await service.reviseRequirements(candidate, {
    reason: "Adopt",
    expectedHash: proposal.proposalHash,
    confirm: true,
    mode: "adopt",
  });
  const task = await service.nextTask();
  if (task.status !== "task") throw new Error("Expected requirements task");
  await service.completeRequirements(task.task.taskId, candidate);
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
  const before = await service.status();
  await journal.append({
    eventId: "review-revision",
    projectId: "demo",
    runId,
    type: "workflow.invalidated",
    timestamp: new Date().toISOString(),
    ownerEpoch: before.run.ownerEpoch,
    expectedHead: before.head,
    payload: {
      reason: "Reviewer requires correction",
      nodeIds: ["requirements", "requirements-review"],
      artifactKinds: ["requirements", "review-findings"],
    },
  });
  const correction = await service.nextTask();
  assert.equal(correction.status, "task");
  if (correction.status !== "task") throw new Error("Expected correction without repeated intake");
  assert.deepEqual((await service.taskContext(correction.task.taskId)).outputTemplates.requirements, candidate);
  await service.completeRequirements(correction.task.taskId, {
    ...candidate,
    budgetAndOperations: "Reviewer-corrected budget",
  });
  assert.equal((await service.status()).task, "requirements-review");
});

test("requirements revision rejects stale heads and unresolved deployment execution", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo", iacTool: "terraform" });
  await prepareValidatedRun(service, runId, "terraform");
  const candidate = { ...requirements(), budgetAndOperations: "Monthly limit is EUR 500" };
  const first = await service.previewRequirementsChange(candidate, "Change budget");
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
  await journal.append({
    eventId: "in-flight",
    projectId: "demo",
    runId,
    type: "deployment.started",
    timestamp: new Date().toISOString(),
    ownerEpoch: first.ownerEpoch,
    expectedHead: first.expectedHead,
    payload: { previewHash: "a".repeat(64) },
  });
  const before = await service.status();
  await assert.rejects(
    service.reviseRequirements(candidate, { reason: "Change budget", expectedHash: first.proposalHash, confirm: true }),
    /stale/,
  );
  const current = await service.previewRequirementsChange(candidate, "Change budget");
  await assert.rejects(
    service.reviseRequirements(candidate, {
      reason: "Change budget",
      expectedHash: current.proposalHash,
      confirm: true,
    }),
    /in-flight or indeterminate/,
  );
  assert.deepEqual(await service.status(), before);
});

for (const track of ["bicep", "terraform"] as const) {
  test(`deployment guide binds current accepted ${track} plan and refuses invalidated sources`, async (context) => {
    const root = await tempRoot();
    const service = new ApexService(root);
    const { runId } = await service.init({ projectId: "demo", iacTool: track });
    await assert.rejects(service.render("deployment-guide"), /No current accepted plan/);
    await assert.rejects(service.render("implementation-plan"), /No current accepted implementation intent/);
    await prepareValidatedRun(service, runId, track);
    const before = await service.status();
    const guide = await service.render("deployment-guide");
    assert.match(guide, /Accepted design only/);
    assert.match(guide, new RegExp(`--provider ${track}`));
    const directory = join(root, "agent-output", "demo", runId, "plan");
    const implementation = await service.render("implementation-plan");
    assert.equal(await readFile(join(directory, "implementation-plan.md"), "utf8"), implementation);
    assert.equal(await new ApexService(root).render("implementation-plan"), implementation);
    assert.equal(await readFile(join(directory, "deployment-guide.md"), "utf8"), guide);
    assert.match(await readFile(join(directory, "README.md"), "utf8"), /deployment-guide.md/);
    assert.equal(await new ApexService(root).render("deployment-guide"), guide);
    assert.deepEqual(await service.status(), before);
    const originalRead = ObjectStore.prototype.getJson;
    context.mock.method(
      ObjectStore.prototype,
      "getJson",
      async function (this: ObjectStore, ...args: Parameters<typeof originalRead>) {
        const value = await originalRead.apply(this, args);
        return value !== null && typeof value === "object" && "resourceBindings" in value
          ? { ...value, intentHash: "f".repeat(64) }
          : value;
      },
    );
    await assert.rejects(service.render("deployment-guide"), /source bindings do not match/);
    context.mock.restoreAll();
    assert.deepEqual(await service.status(), before);
    const candidate = { ...requirements(), budgetAndOperations: "Revised budget" };
    const proposal = await service.previewRequirementsChange(candidate, "Change budget");
    await service.reviseRequirements(candidate, {
      reason: "Change budget",
      expectedHash: proposal.proposalHash,
      confirm: true,
    });
    await assert.rejects(service.render("deployment-guide"), /No current accepted plan/);
    await assert.rejects(service.render("implementation-plan"), /No current accepted implementation intent/);
    assert.equal(await readFile(join(directory, "deployment-guide.md"), "utf8"), guide);
  });
}

test("manual deployment guide blocks plan acceptance without replacing user content", async (context) => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo" });
  const directory = join(root, "agent-output", "demo", runId, "plan");
  const originalComplete = service.completeTaskOutputs.bind(service);
  let planHead: string | null | undefined;
  context.mock.method(service, "completeTaskOutputs", async (...args: Parameters<typeof originalComplete>) => {
    if (args[1].some(({ kind }) => kind === "implementation-intent")) {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "deployment-guide.md"), "Manual deployment instructions\n");
      planHead = (await service.status()).head;
    }
    return originalComplete(...args);
  });
  await assert.rejects(prepareValidatedRun(service, runId, "bicep"), /manual edits|generation baseline/);
  assert.ok(planHead);
  assert.equal((await service.status()).head, planHead);
  assert.equal(await readFile(join(directory, "deployment-guide.md"), "utf8"), "Manual deployment instructions\n");
  await assert.rejects(service.render("deployment-guide"), /No current accepted plan/);
});

test("deployment summary binds accepted operation evidence and never upgrades simulated execution", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo" });
  await assert.rejects(service.render("deployment-summary"), /No completed deployment/);
  await prepareValidatedRun(service, runId, "bicep");
  const preview = await service.preview({ operation: "apply", provider: "fake" });
  await service.decideGateNumber(4, "approved", "tester");
  const deployed = await service.deploy(preview.previewHash);
  const before = await service.status();
  const summary = await service.render("deployment-summary");
  assert.match(summary, /Simulated evidence only/);
  assert.match(summary, new RegExp(preview.previewHash));
  assert.deepEqual(await service.status(), before);
  assert.equal(await new ApexService(root).render("deployment-summary"), summary);
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
  const completed = (await journal.replay()).findLast(({ type }) => type === "deployment.completed")!;
  await journal.append({
    eventId: "bad-summary-binding",
    projectId: "demo",
    runId,
    ownerEpoch: before.run.ownerEpoch,
    timestamp: new Date().toISOString(),
    expectedHead: before.head,
    type: "deployment.completed",
    payload: { ...(completed.payload as Record<string, string>), previewHash: "f".repeat(64) },
  });
  await assert.rejects(service.render("deployment-summary"), /bindings do not match/);
  const objects = new ObjectStore(root);
  const payload = completed.payload as Record<string, string>;
  const approval = await objects.getJson<Record<string, unknown>>(payload.approvalHash!);
  for (const [field, value] of [
    ["operationHash", { ...(deployed.operation as Record<string, unknown>), approvalHash: "e".repeat(64) }],
    ["inventoryHash", { ...deployed.inventory, deploymentHash: "e".repeat(64) }],
    ["inventoryHash", { ...deployed.inventory, projectId: "foreign" }],
    ["approvalHash", { ...approval, decision: "rejected" }],
  ] as const) {
    const hash = await objects.putJson(value);
    await journal.append({
      eventId: hash,
      projectId: "demo",
      runId,
      ownerEpoch: before.run.ownerEpoch,
      timestamp: new Date().toISOString(),
      expectedHead: await journal.head(),
      type: "deployment.completed",
      payload: { ...payload, [field]: hash },
    });
    await assert.rejects(service.render("deployment-summary"), /bindings do not match/);
  }
});

test("operational handoff requires current inventory and pinned evidence before runbook materialization", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const { runId } = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, runId, "bicep");
  const preview = await service.preview({ operation: "apply", provider: "fake" });
  await service.decideGateNumber(4, "approved", "tester");
  const deployed = await service.deploy(preview.previewHash);
  const next = await service.nextTask();
  if (next.status !== "task" || next.task.taskType !== "diagnosis") throw new Error("Expected diagnosis task");
  const handoff = {
    owner: "Operations",
    escalation: "On-call",
    maintenanceWindow: "Sunday UTC",
    accessPrerequisites: ["Monitoring access"],
    configurationReferences: [],
    healthChecks: [
      {
        resourceId: deployed.inventory.resources[0]!.resourceId,
        check: "Inspect metrics",
        expectedOutcome: "Within SLO",
        evidenceRefs: [] as string[],
      },
    ],
    monitoring: "Recorded resource metrics",
    incidentResponse: { applicability: "not-applicable" as const, rationale: "Simulated fixture only" },
    rollback: { applicability: "not-applicable" as const, rationale: "No live operation" },
    recovery: { applicability: "not-applicable" as const, rationale: "No live data" },
    limitations: ["Simulation, not production readiness"],
  };
  const diagnosis = {
    schemaVersion: "1.0.0",
    projectId: "demo",
    runId,
    diagnosedAt: new Date().toISOString(),
    status: "unknown",
    observations: ["Simulated inventory"],
    causes: [],
    operationalHandoff: handoff,
  };
  const before = await service.status();
  await assert.rejects(
    service.completeTaskOutputs(next.task.taskId, [
      {
        kind: "diagnosis",
        value: {
          ...diagnosis,
          operationalHandoff: { ...handoff, healthChecks: [{ ...handoff.healthChecks[0], resourceId: "/foreign" }] },
        },
      },
    ]),
    /diagnosis:read-only/,
  );
  await assert.rejects(
    service.completeTaskOutputs(next.task.taskId, [
      {
        kind: "diagnosis",
        value: {
          ...diagnosis,
          operationalHandoff: {
            ...handoff,
            healthChecks: [{ ...handoff.healthChecks[0], evidenceRefs: ["f".repeat(64)] }],
          },
        },
      },
    ]),
    /diagnosis:read-only/,
  );
  assert.deepEqual(await service.status(), before);
  const accepted = await service.completeTaskOutputs(next.task.taskId, [{ kind: "diagnosis", value: diagnosis }]);
  const runbook = await service.render("operations-runbook");
  assert.match(runbook, new RegExp(accepted.outputHashes.diagnosis!));
  assert.match(runbook, /Simulation, not production readiness/);
  assert.equal(
    await readFile(join(root, "agent-output", "demo", runId, "operations", "operations-runbook.md"), "utf8"),
    runbook,
  );
  const directory = join(root, "agent-output", "demo", runId, "operations");
  const index = await readFile(join(directory, "handoff-index.md"), "utf8");
  for (const name of [
    "deployment-summary.md",
    "resource-inventory.md",
    "policy-matrix.md",
    "cost-reference.md",
    "operations-runbook.md",
  ]) {
    assert.ok(index.includes(`](${name})`));
    assert.ok((await readFile(join(directory, name))).length > 0);
  }
  assert.match(await readFile(join(directory, "deployment-summary.md"), "utf8"), /Simulated evidence only/);
  assert.match(await readFile(join(directory, "cost-reference.md"), "utf8"), /not measured as-built spend/);
});

test("status leaves pending run transaction recovery to an advancing operation", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo" });
  const directory = join(root, ".apex", "projects", "demo", "runs", initialized.runId);
  const journal = new EventJournal(join(directory, "journal"));
  const events = await journal.replay();
  await writeFile(join(directory, ".run-transaction.json"), JSON.stringify({ eventId: "uncommitted" }));
  const files = await snapshotFiles(root);
  for (const reader of [service, new ApexService(root)]) {
    await assert.rejects(
      reader.status(),
      (error: unknown) => error instanceof ApexError && error.code === "APEX_CONFLICT",
    );
  }
  assert.deepEqual(await journal.replay(), events);
  assert.deepEqual(await snapshotFiles(root), files);
  assert.equal((await service.nextTask()).status, "needs_input");
  await assert.rejects(readFile(join(directory, ".run-transaction.json")), { code: "ENOENT" });
});

for (const interrupted of [false, true]) {
  test(`status is read-only at terminal completion (${interrupted ? "interrupted" : "normal"})`, async (context) => {
    const root = await tempRoot();
    const service = new ApexService(root);
    const { runId } = await service.init({ projectId: "demo" });
    await prepareValidatedRun(service, runId, "bicep");
    const preview = await service.preview({ operation: "apply", provider: "fake" });
    await service.decideGateNumber(4, "approved", "tester");
    const deployed = await service.deploy(preview.previewHash);
    const diagnosis = await service.nextTask();
    assert.equal(diagnosis.status, "task");
    if (diagnosis.status !== "task") throw new Error("Expected diagnosis task");
    assert.equal(diagnosis.task.taskType, "diagnosis");
    await service.completeTaskOutputs(diagnosis.task.taskId, [
      {
        kind: "diagnosis",
        value: {
          schemaVersion: "1.0.0",
          projectId: "demo",
          runId,
          diagnosedAt: deployed.inventory.collectedAt,
          status: "healthy",
          observations: ["deployed"],
          causes: [],
        },
      },
    ]);
    const quality = await service.nextTask();
    assert.equal(quality.status, "task");
    if (quality.status !== "task") throw new Error("Expected quality task");
    assert.equal(quality.task.taskType, "quality");
    const report = await qualityReport(root, runId);
    const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", runId, "journal"));
    assert.equal(
      (await journal.replay()).some(({ type }) => type === "workflow.completed"),
      false,
    );
    const interruption = interrupted
      ? context.mock.method(
          service as unknown as { ensureTerminalCompletion(): Promise<EventV1[]> },
          "ensureTerminalCompletion",
          async () => {
            throw new Error("Interrupted terminal bookkeeping");
          },
        )
      : undefined;
    const completion = service.completeTaskOutputs(quality.task.taskId, [{ kind: "quality-report", value: report }]);
    if (interrupted) await assert.rejects(completion, /Interrupted terminal bookkeeping/u);
    else await completion;
    interruption?.mock.restore();

    const events = await journal.replay();
    assert.equal(events.filter(({ type }) => type === "workflow.completed").length, interrupted ? 0 : 1);
    const files = await snapshotFiles(root);
    const restarted = new ApexService(root);
    const status = await restarted.status();
    assert.equal(status.task, null);
    assert.deepEqual(status.blockers, []);
    assert.equal(status.head, events.at(-1)?.hash);
    assert.equal(status.events, events.length);
    assert.deepEqual(await restarted.status(), status);
    assert.deepEqual(await service.status(), status);
    assert.deepEqual(await journal.replay(), events);
    assert.deepEqual(await snapshotFiles(root), files);

    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(
        restarted.nextTask(),
        (error: unknown) => error instanceof ApexError && error.code === "APEX_NOT_FOUND",
      );
    }
    const finalEvents = await journal.replay();
    assert.equal(finalEvents.length, events.length + (interrupted ? 1 : 0));
    const completed = finalEvents.filter(({ type }) => type === "workflow.completed");
    assert.equal(completed.length, 1);
    assert.deepEqual((completed[0]!.payload as { validatorIds: string[] }).validatorIds, [
      "terminal:run-evidence-complete",
    ]);
  });
}

test("full requirements to fake deploy workflow survives restart", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, initialized.runId, "bicep");
  const planReviewDirectory = join(root, "agent-output", "demo", initialized.runId, "plan");
  assert.match(await readFile(join(planReviewDirectory, "implementation-plan.md"), "utf8"), /Logical Resources/u);
  assert.match(await readFile(join(planReviewDirectory, "iac-binding.md"), "utf8"), /IaC Binding/u);
  assert.match(await readFile(join(planReviewDirectory, "environment-inputs.md"), "utf8"), /Environment Inputs/u);
  const preview = await service.preview({ operation: "apply", provider: "fake" });
  const operationsDirectory = join(root, "agent-output", "demo", initialized.runId, "operations");
  assert.match(await readFile(join(operationsDirectory, "deployment-preview.md"), "utf8"), /Deployment Preview/u);
  await service.decideGateNumber(4, "approved", "tester");
  assert.match(await readFile(join(operationsDirectory, "approval.md"), "utf8"), /Gate 4 Approval/u);
  const events = await new EventJournal(
    join(root, ".apex", "projects", "demo", "runs", initialized.runId, "journal"),
  ).replay();
  const gateValidators = new Map(
    events.flatMap((event) =>
      event.type === "gate.decided"
        ? [
            [
              (event.payload as { gate: number }).gate,
              (event.payload as { validatorIds?: unknown }).validatorIds,
            ] as const,
          ]
        : [],
    ),
  );
  assert.deepEqual(gateValidators.get(1), ["gate:requirements-ready"]);
  assert.deepEqual(gateValidators.get(2), ["gate:architecture-cost-governance-ready"]);
  assert.deepEqual(gateValidators.get(3), ["gate:implementation-plan-ready"]);
  assert.deepEqual(gateValidators.get(4), [
    "gate:preview-current",
    "gate:approval-binding-complete",
    "gate:no-hard-blockers",
  ]);
  const deployed = await service.deploy(preview.previewHash);
  assert.equal(deployed.inventory.resources.length, 1);
  const deploymentEvents = await new EventJournal(
    join(root, ".apex", "projects", "demo", "runs", initialized.runId, "journal"),
  ).replay();
  const completed = [...deploymentEvents].reverse().find((event) => event.type === "deployment.completed");
  assert.deepEqual((completed?.payload as { validatorIds?: unknown }).validatorIds, [
    "deploy:exact-approved-operation",
    "deploy:stale-writer-rejection",
  ]);
  assert.deepEqual((completed?.payload as { preValidatorIds?: unknown }).preValidatorIds, [
    "deploy:exact-approved-operation",
    "deploy:stale-writer-rejection",
  ]);
  assert.deepEqual((completed?.payload as { postValidatorIds?: unknown }).postValidatorIds, []);
  assert.deepEqual((completed?.payload as { omittedValidatorIds?: unknown }).omittedValidatorIds, [
    "deploy:bicep-stack-ownership",
  ]);
  assert.equal((completed?.payload as { evidenceMode?: unknown }).evidenceMode, "simulated");

  const restarted = new ApexService(root);
  assert.equal((await restarted.inventory()).deploymentHash, deployed.inventory.deploymentHash);
  assert.equal((await restarted.status()).run.gates[3]?.state, "approved");
});

test("requirements task remains blocked until pending input is recorded", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
  const requested = await service.nextTask();
  assert.equal(requested.status, "needs_input");
  const stillWaiting = await service.nextTask();
  assert.equal(stillWaiting.status, "needs_input");
  await assert.rejects(
    service.taskContext("requirements"),
    (error: unknown) =>
      error instanceof ApexError &&
      error.code === "APEX_NOT_FOUND" &&
      (error.cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT",
  );
  await assert.rejects(
    service.taskContext("../requirements"),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_VALIDATION",
  );
});

for (const profile of ["alz-backed", "standalone-lab"]) {
  test(`requirements intake records explicit workload profile ${profile} across restart`, async () => {
    const root = await tempRoot();
    const service = new ApexService(root);
    const initialized = await service.init({ projectId: "demo" });
    const pending = await service.nextTask();
    assert.equal(pending.status, "needs_input");
    if (pending.status !== "needs_input") return;
    const question = pending.request.questions.find(({ id }) => id === "workload-profile");
    assert.deepEqual(question?.options, ["alz-backed", "standalone-lab"]);
    assert.equal(question?.recommendation, undefined);
    const answers = pending.request.questions.map(({ id, options, multiSelect }) => ({
      questionId: id,
      value: id === "workload-profile" ? profile : multiSelect ? [options![0]!] : (options?.[0] ?? "demo workload"),
    }));
    const response = {
      schemaVersion: "1.0.0" as const,
      requestId: pending.request.requestId,
      expectedHead: pending.request.expectedHead,
      ownerEpoch: pending.request.ownerEpoch,
      answers,
    };
    await assert.rejects(
      service.recordInput({
        ...response,
        answers: answers.filter(({ questionId }) => questionId !== "workload-profile"),
      }),
      (error: unknown) => error instanceof ApexError && error.code === "APEX_VALIDATION",
    );
    await assert.rejects(
      service.recordInput({
        ...response,
        answers: answers.map((answer) =>
          answer.questionId === "workload-profile" ? { ...answer, value: "dev" } : answer,
        ),
      }),
      (error: unknown) => error instanceof ApexError && error.code === "APEX_VALIDATION",
    );
    await service.recordInput(response);
    const restarted = new ApexService(root);
    const next = await restarted.nextTask();
    assert.equal(next.status, "needs_input");
    if (next.status === "needs_input") assert.equal(next.request.intake?.round, "workload-pattern");
    const events = await new EventJournal(
      join(root, ".apex", "projects", "demo", "runs", initialized.runId, "journal"),
    ).replay();
    const recorded = events.find(({ type }) => type === "requirements.input-recorded");
    const recordedAnswers = (recorded?.payload as { answers: Array<{ questionId: string; value: InputValueV1 }> })
      .answers;
    assert.equal(recordedAnswers.find(({ questionId }) => questionId === "workload-profile")?.value, profile);
  });
}

test("requirements intake issues three panels before the requirements task", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
  const rounds = ["business-discovery", "workload-pattern", "security-compliance"];

  for (const [index, round] of rounds.entries()) {
    const pending = await service.nextTask();
    assert.equal(pending.status, "needs_input");
    if (pending.status !== "needs_input") return;
    assert.deepEqual(pending.request.intake, { round, ordinal: index + 1, total: 3 });
    await service.recordInput({
      schemaVersion: "1.0.0",
      requestId: pending.request.requestId,
      expectedHead: pending.request.expectedHead,
      ownerEpoch: pending.request.ownerEpoch,
      answers: pending.request.questions.map(({ id, multiSelect, options, valueType }) => ({
        questionId: id,
        value:
          valueType === "budget"
            ? { kind: "budget" as const, amount: 250, currency: "USD", cadence: "monthly" as const }
            : valueType === "recovery"
              ? { kind: "recovery" as const, rtoMinutes: 60, rpoMinutes: 15 }
              : valueType === "data-classification"
                ? { kind: "data-classification" as const, classification: "internal" as const }
                : valueType === "compliance"
                  ? { kind: "compliance" as const, scopes: ["gdpr"] }
                  : options === undefined
                    ? `test-${id}`
                    : multiSelect === true
                      ? [options[0]!]
                      : options[0]!,
      })),
    });
    if (index < rounds.length - 1) assert.equal((await service.nextTask()).status, "needs_input");
  }

  const issued = await service.nextTask();
  assert.equal(issued.status, "task");
  if (issued.status === "task") assert.equal(issued.task.taskType, "requirements");
});

test("requirements intake adds migration questions only for migration scenarios", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
  await recordRequirementsRound(service, {
    workload: "ecommerce",
    industry: "retail",
    "delivery-scenario": "migration",
    "target-environments": ["dev"],
    "workload-profile": "alz-backed",
  });
  const pending = await service.nextTask();
  assert.equal(pending.status, "needs_input");
  if (pending.status !== "needs_input") return;
  assert.deepEqual(
    pending.request.questions.slice(-3).map(({ id }) => id),
    ["current-platform", "migration-pain-points", "preserve-components"],
  );
  await service.recordInput({
    schemaVersion: "1.0.0",
    requestId: pending.request.requestId,
    expectedHead: pending.request.expectedHead,
    ownerEpoch: pending.request.ownerEpoch,
    answers: pending.request.questions.map(({ id, multiSelect, options, valueType }) => ({
      questionId: id,
      value:
        valueType === "budget"
          ? { kind: "budget" as const, amount: 250, currency: "USD", cadence: "monthly" as const }
          : valueType === "data-classification"
            ? { kind: "data-classification" as const, classification: "internal" as const }
            : options === undefined
              ? `test-${id}`
              : multiSelect === true
                ? [options[0]!]
                : options[0]!,
    })),
  });
  const services = await service.nextTask();
  assert.equal(services.status, "needs_input");
  if (services.status !== "needs_input") return;
  assert.equal(services.request.questions[0]?.id, "compliance");
});

test("requirements intake recommends a workload pattern and asks pattern-specific scale questions", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
  await recordRequirementsRound(service, {
    workload: "IoT sensors publish telemetry for offline field devices",
    industry: "manufacturing",
    "delivery-scenario": "greenfield",
    "target-environments": ["dev"],
    "workload-profile": "alz-backed",
  });
  const pending = await service.nextTask();
  assert.equal(pending.status, "needs_input");
  if (pending.status !== "needs_input") return;
  assert.deepEqual(pending.request.questions.find(({ id }) => id === "workload-pattern")?.recommendation, {
    value: "iot",
    source: "derived",
    rationale: "Derived from the confirmed workload description; confirm or choose another pattern.",
  });
  assert.equal(
    pending.request.questions.find(({ id }) => id === "scale")?.prompt,
    "Describe device count, message rate, payload size, and offline behavior.",
  );
});

test("greenfield service intake skips retained services and uses selectable recovery capabilities", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
  await recordRequirementsRound(service, {
    workload: "ecommerce",
    industry: "retail",
    "delivery-scenario": "greenfield",
    "target-environments": ["dev"],
    "workload-profile": "alz-backed",
  });
  const services = await service.nextTask();
  assert.equal(services.status, "needs_input");
  if (services.status !== "needs_input") return;
  assert.equal(
    services.request.questions.some(({ id }) => id === "retained-services"),
    false,
  );
  assert.equal(
    services.request.questions.find(({ id }) => id === "prohibited-services")?.prompt,
    "List prohibited services, use 'none', or explicitly defer the constraint.",
  );
  await service.recordInput({
    schemaVersion: "1.0.0",
    requestId: services.request.requestId,
    expectedHead: services.request.expectedHead,
    ownerEpoch: services.request.ownerEpoch,
    answers: services.request.questions.map(({ id, multiSelect, options, valueType }) => ({
      questionId: id,
      value:
        valueType === "budget"
          ? { kind: "budget" as const, amount: 250, currency: "USD", cadence: "monthly" as const }
          : valueType === "data-classification"
            ? { kind: "data-classification" as const, classification: "internal" as const }
            : id === "scale"
              ? "100 concurrent users"
              : id === "prohibited-services" || id === "environment-overrides"
                ? "No constraints"
                : id === "sku-preferences"
                  ? "no preference"
                  : options === undefined
                    ? `test-${id}`
                    : multiSelect === true
                      ? [options[0]!]
                      : options[0]!,
    })),
  });
  const security = await service.nextTask();
  assert.equal(security.status, "needs_input");
  if (security.status !== "needs_input") return;
  assert.deepEqual(
    security.request.questions.find(({ id }) => id === "availability-recovery"),
    {
      id: "availability-recovery",
      prompt: "Select required availability, backup, and disaster-recovery capabilities.",
      options: [
        "single-region-availability",
        "availability-zones",
        "automated-backups",
        "point-in-time-restore",
        "immutable-backups",
        "cross-region-disaster-recovery",
      ],
      multiSelect: true,
    },
  );
  assert.deepEqual(
    security.request.questions.find(({ id }) => id === "recovery"),
    {
      id: "recovery",
      prompt: "Set exact recovery targets: provide RTO and RPO in whole minutes, or explicitly defer them.",
      valueType: "recovery",
    },
  );
});

test("requirements intake provides selectable Azure service and security recommendations", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
  await recordRequirementsRound(service, {
    workload: "ecommerce",
    industry: "retail",
    "delivery-scenario": "greenfield",
    "target-environments": ["dev"],
    "workload-profile": "alz-backed",
  });
  const services = await service.nextTask();
  assert.equal(services.status, "needs_input");
  if (services.status !== "needs_input") return;
  assert.deepEqual(
    services.request.questions.find(({ id }) => id === "service-preferences"),
    {
      id: "service-preferences",
      prompt:
        "Confirm the recommended Azure service candidates or select alternatives; Architecture makes the final choice.",
      options: [
        "app-service",
        "container-apps",
        "azure-functions",
        "aks",
        "azure-sql",
        "azure-cosmos-db",
        "storage",
        "service-bus",
        "event-hubs",
        "api-management",
        "azure-monitor",
        "application-insights",
      ],
      multiSelect: true,
      recommendation: {
        value: ["app-service", "azure-sql", "storage", "service-bus", "azure-monitor", "application-insights"],
        source: "prior-answer",
        rationale: "Derived from the confirmed workload description as non-binding Architecture candidates.",
      },
    },
  );
  await service.recordInput({
    schemaVersion: "1.0.0",
    requestId: services.request.requestId,
    expectedHead: services.request.expectedHead,
    ownerEpoch: services.request.ownerEpoch,
    answers: services.request.questions.map(({ id, options, multiSelect, valueType }) => ({
      questionId: id,
      value:
        valueType === "budget"
          ? { kind: "budget" as const, amount: 250, currency: "USD", cadence: "monthly" as const }
          : valueType === "data-classification"
            ? { kind: "data-classification" as const, classification: "internal" as const }
            : id === "service-preferences"
              ? ["container-apps", "azure-cosmos-db", "application-insights"]
              : id === "scale"
                ? "100 concurrent users"
                : id === "prohibited-services" || id === "environment-overrides"
                  ? "No constraints"
                  : id === "sku-preferences"
                    ? "no preference"
                    : options === undefined
                      ? `test-${id}`
                      : multiSelect === true
                        ? [options[0]!]
                        : options[0]!,
    })),
  });

  const security = await service.nextTask();
  assert.equal(security.status, "needs_input");
  if (security.status !== "needs_input") return;
  assert.deepEqual(
    security.request.questions.find(({ id }) => id === "security-controls"),
    {
      id: "security-controls",
      prompt:
        "Select required security controls. The Azure baseline recommends managed identity, private access, Key Vault, and diagnostic logging.",
      options: [
        "managed-identity",
        "private-endpoints",
        "private-dns",
        "disable-public-network-access",
        "key-vault",
        "platform-managed-encryption",
        "customer-managed-keys",
        "diagnostic-logging",
      ],
      multiSelect: true,
      recommendation: {
        value: ["managed-identity", "key-vault", "platform-managed-encryption", "diagnostic-logging"],
        source: "default",
        rationale: "APEX security baseline; confirm additions or exceptions for this workload.",
      },
    },
  );
  assert.deepEqual(security.request.questions.find(({ id }) => id === "compliance")?.options, [
    "gdpr",
    "hipaa",
    "pci-dss",
    "iso-27001",
    "soc-2",
    "other",
  ]);
  assert.equal(security.request.questions.find(({ id }) => id === "authentication")?.multiSelect, true);
  assert.equal(security.request.questions.find(({ id }) => id === "operations")?.multiSelect, true);
});

test("architecture task waits for a kernel-owned decision and resumes the issued task", async () => {
  const service = new ApexService(await tempRoot());
  const initialized = await service.init({ projectId: "demo" });
  const requirementsTask = await nextTaskAfterInput(service);
  assert.equal(requirementsTask.status, "task");
  if (requirementsTask.status !== "task") return;
  const requirementHashes = await service.completeTaskOutputs(requirementsTask.task.taskId, [
    { kind: "requirements", value: requirements() },
  ]);
  const reviewTask = await service.nextTask();
  assert.equal(reviewTask.status, "task");
  if (reviewTask.status !== "task") return;
  await service.completeTaskOutputs(reviewTask.task.taskId, [
    {
      kind: "review-findings",
      value: review(initialized.runId, "requirements", requirementHashes.outputHashes.requirements!),
    },
  ]);
  await service.decideGateNumber(1, "approved", "tester");
  await acceptAvailabilityEvidence(service, initialized.runId);

  const pending = await service.nextTask();
  assert.equal(pending.status, "needs_input");
  if (pending.status !== "needs_input") return;
  assert.equal(pending.request.decision?.id, "network-exposure");
  const taskId = pending.request.decision?.taskId;
  assert.ok(taskId);
  await service.recordInput({
    schemaVersion: "1.0.0",
    requestId: pending.request.requestId,
    expectedHead: pending.request.expectedHead,
    ownerEpoch: pending.request.ownerEpoch,
    answers: [{ questionId: "network-exposure", value: "private-only" }],
  });

  const issued = await service.nextTask();
  assert.equal(issued.status, "task");
  if (issued.status === "task") {
    assert.equal(issued.task.taskType, "architecture");
    assert.equal(issued.task.taskId, taskId);
    const context = await service.taskContext(issued.task.taskId);
    assert.deepEqual(context.decisions, {
      "network-exposure": "private-only",
    });
    assert.deepEqual(Object.keys(context.outputTemplates).sort(), [
      "architecture",
      "cost-estimate",
      "workload-decision-manifest",
    ]);
    assert.deepEqual(
      (context.outputTemplates["cost-estimate"] as { unpricedItems: Array<{ id: string; quantity: number }> })
        .unpricedItems,
      [
        {
          id: "UNPRICED_COMPONENT_ID",
          service: "AZURE_SERVICE",
          sku: "SELECTED_SKU",
          quantity: 1,
          attemptedAt: (context.outputTemplates["cost-estimate"] as { unpricedItems: Array<{ attemptedAt: string }> })
            .unpricedItems[0]!.attemptedAt,
          reason: "A well-scoped ARM MCP query returned no matching retail row.",
        },
      ],
    );
    const chunks: string[] = [];
    let offset: number | undefined = 0;
    while (offset !== undefined) {
      const chunk = await service.readTaskInput(issued.task.taskId, offset, 500);
      chunks.push(chunk.content);
      offset = chunk.nextOffset;
    }
    const bounded = JSON.parse(chunks.join("")) as { decisions: Record<string, string>; outputTemplates: object };
    assert.deepEqual(bounded.decisions, { "network-exposure": "private-only" });
    assert.deepEqual(Object.keys(bounded.outputTemplates).sort(), Object.keys(context.outputTemplates).sort());

    const architectureValue = architecture(initialized.runId);
    architectureValue.components.push({
      id: "identity",
      service: "global/identity",
      purpose: "Authenticate external users",
      requirementIds: ["REQ-1"],
      dependsOn: [],
    });
    const costValue = costEstimate(initialized.runId);
    costValue.lineItems[0]!.sku = "caller-meter-name";
    const partialCost = costValue as Parameters<typeof service.completeArchitecture>[2];
    partialCost.pricingStatus = "partial";
    partialCost.unpricedItems = [
      {
        id: "identity",
        service: "caller service",
        sku: "caller sku",
        quantity: 1,
        attemptedAt: "2026-01-01T00:00:00.000Z",
        reason: "Well-scoped ARM MCP query returned no matching retail row.",
      },
    ];
    const manifest = workloadDecisionManifest({
      runId: initialized.runId,
      requirementsHash: "0".repeat(64),
      architectureHash: "0".repeat(64),
      costEstimateHash: "0".repeat(64),
    });
    manifest.requirementTraceability.push({
      requirementId: "REQ-SHOULD-NOT-BE-TRACED",
      skuDecisionIds: ["api-sku"],
      sloDecisionIds: ["api-slo"],
    });
    manifest.skuDecisions.push({
      id: "identity-sku",
      logicalId: "identity",
      service: "global/identity",
      sku: "usage",
      quantity: 1,
      rationale: "Global identity service",
      requirementIds: ["REQ-1"],
      environmentOverrides: [],
    });
    const unpriced = structuredClone(partialCost);
    unpriced.lineItems[0]!.sku = "test - UNPRICED";
    unpriced.lineItems[0]!.source.uri = "urn:apex:arm-mcp:pricing-unavailable";
    const untraced = structuredClone(manifest) as { skuDecisions: Array<{ requirementIds?: string[] }> };
    delete untraced.skuDecisions[0]!.requirementIds;
    await assert.rejects(
      service.completeArchitecture(
        issued.task.taskId,
        architectureValue,
        partialCost,
        untraced as Parameters<typeof service.completeArchitecture>[3],
      ),
      (error: unknown) =>
        error instanceof ApexError &&
        error.code === "APEX_VALIDATION" &&
        JSON.stringify(error.details).includes("requirementIds"),
    );
    await assert.rejects(
      service.completeArchitecture(
        issued.task.taskId,
        architectureValue,
        unpriced as Parameters<typeof service.completeArchitecture>[2],
        manifest,
      ),
      /Current ARM MCP pricing evidence is required/u,
    );
    const completed = await service.completeArchitecture(issued.task.taskId, architectureValue, partialCost, manifest);
    assert.match(completed.outputHashes.architecture ?? "", /^[0-9a-f]{64}$/u);
    assert.match(completed.outputHashes["workload-decision-manifest"] ?? "", /^[0-9a-f]{64}$/u);
    const store = new ObjectStore(service.root);
    const storedCost = await store.getJson<{
      pricingStatus: string;
      lineItems: Array<{ sku: string }>;
      unpricedItems: Array<{ service: string; sku: string }>;
    }>(completed.outputHashes["cost-estimate"]!);
    const storedManifest = await store.getJson<{ requirementTraceability: Array<{ requirementId: string }> }>(
      completed.outputHashes["workload-decision-manifest"]!,
    );
    assert.equal(storedCost.lineItems[0]?.sku, "test");
    assert.equal(storedCost.pricingStatus, "partial");
    assert.deepEqual(
      storedCost.unpricedItems.map(({ service, sku }) => ({ service, sku })),
      [{ service: "global/identity", sku: "usage" }],
    );
    assert.deepEqual(
      storedManifest.requirementTraceability.map(({ requirementId }) => requirementId),
      ["REQ-1"],
    );
  }
});

test("architecture decision is reissued after its journal head becomes stale", async () => {
  const service = new ApexService(await tempRoot());
  const initialized = await service.init({ projectId: "demo" });
  const requirementsTask = await nextTaskAfterInput(service);
  assert.equal(requirementsTask.status, "task");
  if (requirementsTask.status !== "task") return;
  const requirementHashes = await service.completeTaskOutputs(requirementsTask.task.taskId, [
    { kind: "requirements", value: requirements() },
  ]);
  const reviewTask = await service.nextTask();
  assert.equal(reviewTask.status, "task");
  if (reviewTask.status !== "task") return;
  await service.completeTaskOutputs(reviewTask.task.taskId, [
    {
      kind: "review-findings",
      value: review(initialized.runId, "requirements", requirementHashes.outputHashes.requirements!),
    },
  ]);
  await service.decideGateNumber(1, "approved", "tester");
  const firstEvidence = await acceptAvailabilityEvidence(service, initialized.runId);
  const first = await service.nextTask();
  assert.equal(first.status, "needs_input");
  if (first.status !== "needs_input") return;
  await acceptAvailabilityEvidence(service, initialized.runId);
  const reissued = await service.nextTask();
  assert.equal(reissued.status, "needs_input");
  if (reissued.status !== "needs_input") return;
  assert.notEqual(reissued.request.requestId, first.request.requestId);
  assert.notEqual(reissued.request.expectedHead, first.request.expectedHead);
  assert.notEqual(reissued.request.expectedHead, firstEvidence);
});

test("render requirements reads the accepted requirements artifact", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
  const issued = await nextTaskAfterInput(service);
  assert.equal(issued.status, "task");
  if (issued.status !== "task") return;
  await service.completeTaskOutputs(issued.task.taskId, [{ kind: "requirements", value: requirements() }]);

  assert.match(await service.render("requirements"), /offline service/u);
});

test("requirements acceptance records a bound rendered document", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo" });
  const issued = await nextTaskAfterInput(service);
  assert.equal(issued.status, "task");
  if (issued.status !== "task") return;
  const accepted = await service.completeTaskOutputs(issued.task.taskId, [
    { kind: "requirements", value: requirements() },
  ]);
  const events = await new EventJournal(
    join(root, ".apex", "projects", "demo", "runs", initialized.runId, "journal"),
  ).replay();
  const completed = events.find((event) => event.type === "task.completed");
  const document = (
    completed?.payload as {
      renderedDocuments?: Array<{ documentId: string; templateHash: string; outputHash: string }>;
    }
  ).renderedDocuments?.[0];
  assert.deepEqual(document?.documentId, "requirements");
  assert.match(document?.templateHash ?? "", /^[a-f0-9]{64}$/);
  assert.match(document?.outputHash ?? "", /^[a-f0-9]{64}$/);
  const persisted = await new ObjectStore(root).getJson<{ contentType: string; content: string }>(document!.outputHash);
  assert.equal(persisted.contentType, "text/markdown");
  assert.equal(await service.render("requirements"), persisted.content);
  assert.match(persisted.content, /Unavailable: RequirementsV1 does not represent business context\./u);
  assert.notEqual(document?.outputHash, accepted.outputHashes.requirements);
  const reviewDirectory = join(root, "agent-output", "demo", initialized.runId);
  assert.equal(await readFile(join(reviewDirectory, "01-requirements.md"), "utf8"), persisted.content);
  assert.match(await readFile(join(reviewDirectory, "README.md"), "utf8"), /APEX kernel state remains authoritative/u);
  assert.match(await readFile(join(reviewDirectory, "service-recommendations.md"), "utf8"), /Candidate Services/u);
  assert.match(await readFile(join(reviewDirectory, "sku-preferences.md"), "utf8"), /SKU Preferences/u);
  assert.match(await readFile(join(reviewDirectory, "challenger-findings.md"), "utf8"), /review is pending/u);
});

test("requirements review package escapes user-provided Markdown", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo" });
  const issued = await nextTaskAfterInput(service);
  assert.equal(issued.status, "task");
  if (issued.status !== "task") return;
  const value = requirements();
  value.architectureHandoff = "Candidate | rationale\nsecond line";
  await service.completeTaskOutputs(issued.task.taskId, [{ kind: "requirements", value }]);
  const serviceRecommendations = await readFile(
    join(root, "agent-output", "demo", initialized.runId, "service-recommendations.md"),
    "utf8",
  );
  assert.match(serviceRecommendations, /Candidate \\| rationale<br>second line/u);
});

test("requirements document rendering escapes table cells without rejecting content braces", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo" });
  const issued = await nextTaskAfterInput(service);
  assert.equal(issued.status, "task");
  if (issued.status !== "task") return;
  const value = requirements();
  value.requirements[0] = {
    ...value.requirements[0]!,
    statement: "Allow {workload} and {custom-rule} | retain newline\nfor review",
  };
  value.assumptions = ["Keep {environment}\nfor review"];
  value.unknowns = ["Clarify {artifact-hash}\nwith owner"];
  await service.completeTaskOutputs(issued.task.taskId, [{ kind: "requirements", value }]);
  const events = await new EventJournal(
    join(root, ".apex", "projects", "demo", "runs", (await service.status()).run.runId, "journal"),
  ).replay();
  const documentHash = (
    events.find((event) => event.type === "task.completed")?.payload as {
      renderedDocuments?: Array<{ outputHash: string }>;
    }
  ).renderedDocuments?.[0]?.outputHash;
  assert.match(documentHash ?? "", /^[a-f0-9]{64}$/);
});

test("an initialized workspace can create and select independent projects", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "payments", displayName: "Payments" });
  const dataPlatform = await service.createProject({
    projectId: "data-platform",
    displayName: "Data platform",
    environment: "test",
    targetScope: "resource-group:data-platform-test",
    iacTool: "terraform",
  });

  assert.deepEqual(await service.listProjects(), [
    { projectId: "data-platform", displayName: "Data platform" },
    { projectId: "payments", displayName: "Payments" },
  ]);
  assert.equal((await service.status()).run.projectId, "data-platform");
  assert.equal((await service.status()).run.runId, dataPlatform.runId);
  assert.equal((await service.status()).run.iacTool, "terraform");

  await service.use("payments");
  assert.equal((await service.status()).run.projectId, "payments");
});

test("a project promotes independently through multiple environments", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo", environment: "dev", targetScope: "local" });
  await prepareValidatedRun(service, initialized.runId, "bicep");

  const testRun = await service.promote("test", "resource-group:payments-test");
  assert.equal(testRun.projectId, "demo");
  assert.equal(testRun.environment, "test");
  assert.equal(testRun.parentRunId, initialized.runId);
  assert.equal(testRun.gates[0]?.state, "inherited");
  assert.equal(testRun.gates[1]?.state, "closed");

  await service.use("demo", initialized.runId);
  assert.equal((await service.status()).run.environment, "dev");
  await service.use("demo", testRun.runId);
  assert.equal((await service.status()).run.environment, "test");
});

test("typed input recording rejects premature, stale, malformed, duplicate, and replayed answers", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo" });
  await assert.rejects(
    service.recordInput({
      schemaVersion: "1.0.0",
      requestId: "missing",
      expectedHead: "a".repeat(64),
      ownerEpoch: 1,
      answers: [{ questionId: "workload", value: "demo" }],
    }),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_CONFLICT",
  );
  const pending = await service.nextTask();
  assert.equal(pending.status, "needs_input");
  if (pending.status !== "needs_input") return;
  const valid = {
    schemaVersion: "1.0.0" as const,
    requestId: pending.request.requestId,
    expectedHead: pending.request.expectedHead,
    ownerEpoch: pending.request.ownerEpoch,
    answers: [
      { questionId: "workload", value: "demo" },
      { questionId: "industry", value: "technology" },
      { questionId: "delivery-scenario", value: "greenfield" },
      { questionId: "target-environments", value: ["dev"] },
      { questionId: "workload-profile", value: "alz-backed" },
    ],
  };
  await assert.rejects(
    service.recordInput({ ...valid, expectedHead: "b".repeat(64) }),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_STALE",
  );
  await assert.rejects(
    service.recordInput({ ...valid, ownerEpoch: valid.ownerEpoch + 1 }),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_STALE",
  );
  await assert.rejects(
    service.recordInput({ ...valid, answers: [valid.answers[0]!] }),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_VALIDATION",
  );
  await assert.rejects(
    service.recordInput({ ...valid, answers: [valid.answers[0]!, valid.answers[0]!] }),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_VALIDATION",
  );
  await assert.rejects(
    service.recordInput({
      ...valid,
      answers: valid.answers.map((answer) =>
        answer.questionId === "delivery-scenario" ? { ...answer, value: "invalid-scenario" } : answer,
      ),
    }),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_VALIDATION",
  );
  for (const environments of [["dev", "dev"], [], ["dev", "qa"]]) {
    await assert.rejects(
      service.recordInput({
        ...valid,
        answers: valid.answers.map((answer) =>
          answer.questionId === "target-environments" ? { ...answer, value: environments } : answer,
        ),
      }),
      (error: unknown) => error instanceof ApexError && error.code === "APEX_VALIDATION",
      `target environments ${JSON.stringify(environments)}`,
    );
  }
  const recorded = await service.recordInput(valid);
  assert.deepEqual(recorded, { recorded: true, requestId: pending.request.requestId });
  await assert.rejects(
    service.recordInput(valid),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_CONFLICT",
  );
  const events = await new EventJournal(
    join(root, ".apex", "projects", "demo", "runs", (await service.status()).run.runId, "journal"),
  ).replay();
  const inputEvents = events.filter((event) => event.type === "requirements.input-recorded");
  assert.equal(inputEvents.length, 1);
  assert.deepEqual((inputEvents[0]?.payload as { answers?: unknown }).answers, valid.answers);
});

test("requirements task context includes recorded input and stageable output templates", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo" });
  await recordRequirementsRound(service, {
    workload: "ecommerce",
    industry: "retail",
    "delivery-scenario": "greenfield",
    "target-environments": ["dev"],
    "workload-profile": "standalone-lab",
  });
  await recordRequirementsRound(service, {
    "workload-pattern": "web-api",
    scale: "100 concurrent users",
    budget: { kind: "budget", amount: 500, currency: "USD", cadence: "monthly" },
    "data-sensitivity": { kind: "data-classification", classification: "confidential" },
    "prohibited-services": "No services are prohibited",
    "service-preferences": ["container-apps", "azure-cosmos-db", "application-insights"],
    "sku-preferences": "no preference",
    "environment-overrides": "No environment-specific overrides",
  });
  await recordRequirementsRound(service, {
    compliance: { kind: "compliance", scopes: ["pci-dss"] },
    "security-controls": ["managed-identity", "private-endpoints", "key-vault", "diagnostic-logging"],
    authentication: ["microsoft-entra-id", "managed-identity"],
    region: "swedencentral",
    "availability-recovery": ["availability-zones", "automated-backups", "point-in-time-restore"],
    recovery: { kind: "recovery", rtoMinutes: 60, rpoMinutes: 15 },
    operations: ["azure-monitor", "application-insights", "managed-alerts"],
  });
  const issued = await service.nextTask();
  assert.equal(issued.status, "task");
  if (issued.status !== "task") return;
  const context = await service.taskContext(issued.task.taskId);
  assert.deepEqual(context.recordedInput, {
    workload: "ecommerce",
    industry: "retail",
    "delivery-scenario": "greenfield",
    "target-environments": ["dev"],
    "workload-profile": "standalone-lab",
    "workload-pattern": "web-api",
    scale: "100 concurrent users",
    budget: { kind: "budget", amount: 500, currency: "USD", cadence: "monthly" },
    "data-sensitivity": { kind: "data-classification", classification: "confidential" },
    "prohibited-services": "No services are prohibited",
    "service-preferences": ["container-apps", "azure-cosmos-db", "application-insights"],
    "sku-preferences": "no preference",
    "environment-overrides": "No environment-specific overrides",
    compliance: { kind: "compliance", scopes: ["pci-dss"] },
    "security-controls": ["managed-identity", "private-endpoints", "key-vault", "diagnostic-logging"],
    authentication: ["microsoft-entra-id", "managed-identity"],
    region: "swedencentral",
    "availability-recovery": ["availability-zones", "automated-backups", "point-in-time-restore"],
    recovery: { kind: "recovery", rtoMinutes: 60, rpoMinutes: 15 },
    operations: ["azure-monitor", "application-insights", "managed-alerts"],
  });
  assert.equal(context.inputs.length, 0);
  const template = context.outputTemplates.requirements as {
    requirements: Array<{ id: string; statement: string; priority: string; status: string; source: string }>;
    assumptions: string[];
    unknowns: string[];
    businessContext?: string;
    successCriteria?: string;
    nonFunctionalRequirements?: string;
    securityAndCompliance?: string;
    budgetAndOperations?: string;
    regionalConstraints?: string;
    architectureHandoff?: string;
  };
  assert.deepEqual(template.requirements.slice(0, 2), [
    {
      id: "REQ-001",
      statement: "Availability and recovery: availability-zones, automated-backups, point-in-time-restore",
      priority: "must",
      status: "confirmed",
      source: "intake:availability-recovery",
    },
    {
      id: "REQ-002",
      statement: "Security controls: managed-identity, private-endpoints, key-vault, diagnostic-logging",
      priority: "must",
      status: "confirmed",
      source: "intake:security-controls",
    },
  ]);
  assert.deepEqual(template.assumptions, ["industry: retail", "target-environments: dev"]);
  assert.deepEqual(
    template.requirements.find(({ source }) => source === "intake:workload-profile"),
    {
      id: "REQ-018",
      statement: "Workload profile: standalone-lab",
      priority: "must",
      status: "confirmed",
      source: "intake:workload-profile",
    },
  );
  assert.deepEqual(template.unknowns, []);
  assert.equal(template.businessContext, "retail; greenfield; web-api");
  assert.match(template.successCriteria!, /^100 concurrent users\n\nRecommendation \(proposed, not confirmed\):/);
  assert.match(template.successCriteria!, /p95 and p99/);
  assert.equal(template.nonFunctionalRequirements, "availability-zones, automated-backups, point-in-time-restore");
  assert.equal(
    template.securityAndCompliance,
    "managed-identity, private-endpoints, key-vault, diagnostic-logging; pci-dss; microsoft-entra-id, managed-identity; confidential",
  );
  assert.equal(template.budgetAndOperations, "USD 500 monthly; azure-monitor, application-insights, managed-alerts");
  assert.equal(template.regionalConstraints, "swedencentral");
  assert.match(
    template.architectureHandoff!,
    /^container-apps, azure-cosmos-db, application-insights\n\nRecommendation/,
  );
  assert.match(template.architectureHandoff!, /no assignment is implied/);
  await service.stageArtifact(issued.task.taskId, {
    kind: "requirements",
    value: context.outputTemplates.requirements,
  });
  await service.completeRequirements(
    issued.task.taskId,
    context.outputTemplates.requirements as Parameters<typeof service.completeRequirements>[1],
  );
  const document = await readFile(join(root, "agent-output", "demo", initialized.runId, "01-requirements.md"), "utf8");
  assert.match(document, /p95 and p99/);
  assert.match(document, /ingress and DNS/);
  assert.match(document, /proposed, not confirmed/);
});

test("requirements recommendations document GDPR planning without confirmed obligations", async () => {
  const service = new ApexService(await tempRoot());
  const project = service as unknown as {
    requirementsTemplateFromIntake(input: Record<string, InputValueV1>): {
      requirements: Array<{ source: string; statement: string }>;
      securityAndCompliance: string;
    };
  };
  const template = project.requirementsTemplateFromIntake({ compliance: { kind: "compliance", scopes: ["gdpr"] } });
  assert.match(template.securityAndCompliance, /Recommendation \(proposed, not confirmed\)/);
  assert.match(template.securityAndCompliance, /retention\/deletion and data-subject handling/);
  assert.match(template.securityAndCompliance, /no assignment, retention period or GDPR compliance is asserted/);
  assert.deepEqual(template.requirements, [
    {
      id: "REQ-003",
      statement: "Compliance: gdpr",
      priority: "should",
      status: "confirmed",
      source: "intake:compliance",
    },
  ]);
});

test("task context rejects a task whose journal head changed", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo" });
  const issued = await nextTaskAfterInput(service);
  assert.equal(issued.status, "task");
  if (issued.status !== "task") return;
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", initialized.runId, "journal"));
  const requirementsHash = "a".repeat(64);
  await journal.append({
    eventId: "completed-requirements",
    projectId: "demo",
    runId: initialized.runId,
    type: "task.completed",
    timestamp: "2026-01-01T00:00:00.000Z",
    ownerEpoch: 1,
    expectedHead: await journal.head(),
    payload: { nodeId: "requirements", artifactHashes: { requirements: requirementsHash } },
  });

  await assert.rejects(service.taskContext(issued.task.taskId), /stale/);
});

test("large multibyte review context stays bounded with authorized selective reads", async () => {
  const service = new ApexService(await tempRoot(), { clock: () => new Date("2026-01-01T00:00:00.000Z") });
  await service.init({ projectId: "demo" });
  const issued = await nextTaskAfterInput(service);
  assert.equal(issued.status, "task");
  if (issued.status !== "task") return;
  const large = requirements();
  large.architectureHandoff = "\u00e9".repeat(140_000);
  const accepted = await service.completeRequirements(issued.task.taskId, large);
  const reviewTask = await service.nextTask();
  assert.equal(reviewTask.status, "task");
  if (reviewTask.status !== "task") return;
  const context = await service.taskContext(reviewTask.task.taskId);
  assert.ok(Buffer.byteLength(JSON.stringify(context)) <= 262_144);
  assert.deepEqual(context.reviewMetadata, {
    subjectKind: "requirements",
    subjectHash: accepted.outputHashes.requirements,
    criteria: ["review:requirements-comprehensive"],
    dispositions: [],
    evidenceRefs: reviewTask.task.inputRefs,
    evidenceRefsRequired: true,
  });
  const metadata = await service.readTaskInput(reviewTask.task.taskId, 0, 6_000, "review-metadata");
  assert.deepEqual(JSON.parse(metadata.content), context.reviewMetadata);
  assert.deepEqual(metadata.outputTemplate, context.outputTemplates["review-findings"]);
  assert.deepEqual(context.inputs, []);
  assert.equal(context.inputReferences[0]!.inlined, false);
  const hash = accepted.outputHashes.requirements!;
  assert.equal(context.inputReferences[0]!.hash, hash);
  const chunks: string[] = [];
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const chunk = await service.readTaskInput(reviewTask.task.taskId, offset, 6_000, hash);
    assert.ok(Buffer.byteLength(chunk.content) <= 6_000);
    chunks.push(chunk.content);
    offset = chunk.nextOffset;
  }
  assert.deepEqual(JSON.parse(chunks.join("")), large);
  await assert.rejects(
    service.readTaskInput(reviewTask.task.taskId, 0, 500, "f".repeat(64)),
    /current task dependency/,
  );
});

test("review context filters current dispositions and selectively reads oversized metadata", async () => {
  const root = await tempRoot();
  const service = new ApexService(root, { clock: () => new Date("2026-01-01T00:00:00.000Z") });
  const initialized = await service.init({ projectId: "demo" });
  const requirementsTask = await nextTaskAfterInput(service);
  assert.equal(requirementsTask.status, "task");
  if (requirementsTask.status !== "task") return;
  await assert.rejects(
    service.readTaskInput(requirementsTask.task.taskId, 0, 500, "review-metadata"),
    /current task dependency/,
  );
  const accepted = await service.completeRequirements(requirementsTask.task.taskId, requirements());
  const issued = await service.nextTask();
  assert.equal(issued.status, "task");
  if (issued.status !== "task") return;
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", initialized.runId, "journal"));
  const taskPath = join(
    root,
    ".apex",
    "projects",
    "demo",
    "runs",
    initialized.runId,
    "tasks",
    `${issued.task.taskId}.json`,
  );
  let sequence = 0;
  const append = async (type: EventV1["type"], payload: Parameters<EventJournal["append"]>[0]["payload"]) => {
    await journal.append({
      eventId: `review-context-${sequence++}`,
      projectId: "demo",
      runId: initialized.runId,
      type,
      timestamp: "2026-01-01T00:00:00.000Z",
      ownerEpoch: 1,
      expectedHead: await journal.head(),
      payload,
    });
    await writeFile(taskPath, JSON.stringify({ ...issued.task, expectedHead: await journal.head() }));
  };
  const subjectHash = accepted.outputHashes.requirements!;
  const current = {
    findingId: "FIND-001",
    reviewHash: "a".repeat(64),
    subjectHash,
    dependencyHash: "b".repeat(64),
    disposition: "dismissed",
    actor: "tester",
    rationale: "Evidence addresses the finding",
    evidenceRefs: [subjectHash],
  };
  const oldReviewHash = "c".repeat(64);
  await append("task.completed", {
    nodeId: "requirements-review",
    subjectHash,
    reviewHash: oldReviewHash,
    dependencyHash: current.dependencyHash,
  });
  await append("review.resolved", { resolution: { ...current, reviewHash: oldReviewHash, findingId: "old-review" } });
  await append("task.completed", {
    nodeId: "requirements-review",
    subjectHash,
    reviewHash: current.reviewHash,
    dependencyHash: current.dependencyHash,
  });
  for (const resolution of [
    { ...current, reviewHash: oldReviewHash, findingId: "late-old-review" },
    { ...current, subjectHash: "d".repeat(64), findingId: "other-subject" },
    { ...current, dependencyHash: "e".repeat(64), findingId: "old-dependency" },
    { ...current, rationale: "Superseded rationale" },
    { ...current, unrelatedJournalData: "must not be projected" },
  ])
    await append("review.resolved", { resolution });
  await append("task.completed", {
    nodeId: "architecture-review",
    subjectHash: "d".repeat(64),
    reviewHash: "f".repeat(64),
  });
  const context = await service.taskContext(issued.task.taskId);
  assert.deepEqual(context.reviewMetadata?.dispositions, [current]);
  assert.equal(context.reviewMetadataReference?.inlined, true);

  const oversized = { ...current, rationale: "\u{1f642}\u00e9".repeat(50_000) };
  await append("review.resolved", { resolution: oversized });
  const bounded = await service.taskContext(issued.task.taskId);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 262_144);
  assert.equal(bounded.reviewMetadata, undefined);
  assert.equal(bounded.reviewMetadataReference?.selector, "review-metadata");
  assert.equal(bounded.reviewMetadataReference?.inlined, false);
  assert.ok(bounded.outputTemplates["review-findings"]);
  assert.deepEqual(
    bounded.inputReferences.map(({ hash }) => hash),
    issued.task.inputRefs,
  );
  service.taskContext = async () => {
    throw new Error("Selective metadata reads must not construct the full context");
  };
  const chunks: string[] = [];
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const chunk = await service.readTaskInput(issued.task.taskId, offset, 6_000, "review-metadata");
    assert.ok(Buffer.byteLength(chunk.content) <= 6_000);
    chunks.push(chunk.content);
    offset = chunk.nextOffset;
  }
  const serialized = chunks.join("");
  assert.equal(Buffer.byteLength(serialized), bounded.reviewMetadataReference?.bytes);
  assert.deepEqual(JSON.parse(serialized), { ...context.reviewMetadata, dispositions: [oversized] });
  await assert.rejects(service.readTaskInput(issued.task.taskId, 0, 500, "f".repeat(64)), /current task dependency/);
  await writeFile(
    taskPath,
    JSON.stringify({ ...issued.task, expectedHead: await journal.head(), inputRefs: [subjectHash, "f".repeat(64)] }),
  );
  await assert.rejects(
    service.readTaskInput(issued.task.taskId, 0, 500, "review-metadata"),
    /unauthorized input reference/,
  );
});

test("codegen task inputs exclude invalidated revisions and unrelated accepted artifacts", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
  const internal = service as unknown as {
    currentRun(): Promise<RunConfigV1>;
    inputRefs(run: RunConfigV1, events: EventV1[], descriptor: { id: string }): Promise<string[]>;
  };
  const run = await internal.currentRun();
  const oldIntent = "a".repeat(64);
  const currentIntent = "b".repeat(64);
  const requirementsHash = "c".repeat(64);
  const reviewHash = "d".repeat(64);
  const events = [
    { type: "task.completed", payload: { artifactHashes: { requirements: requirementsHash } } },
    { type: "task.completed", payload: { artifactHashes: { "implementation-intent": oldIntent } } },
    { type: "workflow.invalidated", payload: { artifactKinds: ["implementation-intent"] } },
    { type: "task.completed", payload: { artifactHashes: { "implementation-intent": currentIntent } } },
    { type: "task.completed", payload: { artifactHashes: { "review-findings": reviewHash } } },
  ] as EventV1[];
  for (const track of ["bicep", "terraform"]) {
    const inputRefs = await internal.inputRefs(run, events, { id: `codegen-${track}` });
    assert.deepEqual(inputRefs, [currentIntent]);
  }
});

test("issued task output limit matches locked defaults and counts multibyte content", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
  const issued = await nextTaskAfterInput(service);
  assert.equal(issued.status, "task");
  if (issued.status !== "task") return;
  assert.equal(issued.task.maxOutputBytes, 1_048_576);
  const oversized = requirements();
  oversized.architectureHandoff = "\u00e9".repeat(600_000);
  await assert.rejects(
    service.stageArtifact(issued.task.taskId, { kind: "requirements", value: oversized }),
    /size limit/,
  );
});

test("imported initiative members require distinct mappings and run-owned evidence", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const subscriptionId = "11111111-1111-1111-1111-111111111111";
  await service.init({ projectId: "demo", targetScope: `/subscriptions/${subscriptionId}` });
  const internal = service as unknown as {
    currentRun(): Promise<RunConfigV1>;
    validateBundle(
      run: RunConfigV1,
      descriptor: { id: string },
      outputs: Array<{ kind: string; value: unknown }>,
      events: EventV1[],
    ): Promise<void>;
    inputRefs(run: RunConfigV1, events: EventV1[], descriptor: { id: string }): Promise<string[]>;
  };
  const run = await internal.currentRun();
  const objects = new ObjectStore(root);
  const snapshot = {
    schemaVersion: "governance-baseline-selection-v2",
    projectId: run.projectId,
    runId: run.runId,
    subscriptionId,
    targetScope: run.targetScope.toLowerCase(),
    findings: ["member-1", "member-2"].map((policyDefinitionReferenceId) => ({
      assignmentId: "assignment",
      policyId: "definition",
      policyDefinitionReferenceId,
      effect: "deployIfNotExists",
    })),
  };
  const digest = await objects.putJson(snapshot);
  const constraints = {
    ...governance(run.runId),
    targetScope: run.targetScope,
    constraintsRef: {
      mediaType: "application/json",
      uri: `apex-object:${digest}`,
      digest,
      bytes: (await objects.getBytes(digest)).byteLength,
    },
  };
  const governanceHash = await objects.putJson(constraints);
  const events = [
    { type: "task.completed", payload: { artifactHashes: { "governance-constraints": governanceHash } } },
  ] as EventV1[];
  const policy: PolicyPropertyMapV1 = {
    ...policyMap(run.runId, governanceHash),
    mappings: [
      {
        policyAssignmentId: "assignment",
        policyDefinitionId: "definition",
        policyDefinitionReferenceId: "member-1",
        effect: "deployIfNotExists",
        logicalResourceId: "api",
        propertyPath: "diagnostics",
        disposition: "planned",
      },
    ],
  };
  const validate = () =>
    internal.validateBundle(
      run,
      { id: "governance-reconciliation" },
      [{ kind: "policy-property-map", value: policy }],
      events,
    );
  await assert.rejects(validate(), /explicit mappings/);
  policy.mappings.push({ ...policy.mappings[0]!, policyDefinitionReferenceId: "member-2" });
  await validate();
  policy.mappings[1]!.disposition = "exempt";
  await assert.rejects(validate(), /exemptions are not verified/);
  const foreignDigest = await objects.putJson({ ...snapshot, runId: "another-run" });
  const foreignHash = await objects.putJson({
    ...constraints,
    constraintsRef: {
      ...constraints.constraintsRef,
      digest: foreignDigest,
      uri: `apex-object:${foreignDigest}`,
      bytes: (await objects.getBytes(foreignDigest)).byteLength,
    },
  });
  await assert.rejects(
    internal.inputRefs(
      run,
      [
        {
          type: "task.completed",
          payload: {
            artifactHashes: {
              "governance-constraints": foreignHash,
            },
          },
        },
      ] as EventV1[],
      { id: "governance-reconciliation" },
    ),
    /does not belong/,
  );
});

test("plan task context projects source hashes and valid output templates", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo" });
  const assertReviewContext = async (taskId: string, taskType: string, subjectHash: string) => {
    const context = await service.taskContext(taskId);
    const packs: Record<string, { subjectKind: string; criteria: string[]; kinds: string[] }> = {
      "requirements-review": {
        subjectKind: "requirements",
        criteria: ["review:requirements-comprehensive"],
        kinds: ["requirements"],
      },
      "architecture-review": {
        subjectKind: "architecture",
        criteria: ["review:architecture-comprehensive", "review:well-architected-criteria-complete"],
        kinds: ["requirements", "architecture", "cost-estimate", "workload-decision-manifest"],
      },
      "governance-review": {
        subjectKind: "policy-property-map",
        criteria: ["review:governance-reconciliation"],
        kinds: ["architecture", "governance-constraints", "policy-property-map"],
      },
      "plan-review": {
        subjectKind: "implementation-intent",
        criteria: ["review:plan-comprehensive"],
        kinds: [
          "requirements",
          "architecture",
          "governance-constraints",
          "policy-property-map",
          "implementation-intent",
          "iac-binding",
          "environment-inputs",
        ],
      },
    };
    const pack = packs[taskType]!;
    assert.deepEqual(context.reviewMetadata, {
      subjectKind: pack.subjectKind,
      subjectHash,
      criteria: pack.criteria,
      dispositions: [],
      evidenceRefs: context.task.inputRefs,
      evidenceRefsRequired: true,
    });
    assert.deepEqual(Object.keys(context.artifactHashes).sort(), pack.kinds.sort());
    assert.deepEqual(
      context.inputReferences.map(({ hash }) => hash),
      context.task.inputRefs,
    );
    assert.ok(Buffer.byteLength(JSON.stringify(context)) <= 262_144);
    const template = context.outputTemplates["review-findings"] as {
      subjectHash: string;
      subjectKind: string;
      criteria?: unknown[];
    };
    assert.equal(template.subjectHash, subjectHash);
    assert.equal(
      template.subjectKind,
      taskType === "governance-review" ? "policy-property-map" : taskType.replace("-review", ""),
    );
    if (taskType === "architecture-review") assert.equal(template.criteria?.length, 5);
    for (const reference of context.inputReferences) {
      const chunk = await service.readTaskInput(taskId, 0, 6_000, reference.hash);
      assert.equal(chunk.subjectHash, reference.hash);
    }
    await assert.rejects(service.readTaskInput(taskId, 0, 500, "f".repeat(64)), /current task dependency/);
  };
  const complete = async (taskType: string, outputs: Parameters<typeof service.completeTaskOutputs>[1]) => {
    const issued = await nextTaskAfterInput(service);
    assert.equal(issued.status, "task");
    if (issued.status !== "task") throw new Error("Expected a task");
    assert.equal(issued.task.taskType, taskType);
    if (taskType.endsWith("-review")) {
      const subjectHash = (outputs[0]!.value as { subjectHash: string }).subjectHash;
      await assertReviewContext(issued.task.taskId, taskType, subjectHash);
      const chunks: string[] = [];
      let offset: number | undefined = 0;
      while (offset !== undefined) {
        const chunk = await service.readTaskInput(issued.task.taskId, offset, 137);
        assert.equal(chunk.subjectHash, subjectHash);
        assert.equal(chunk.outputTemplate !== undefined, offset === 0);
        chunks.push(chunk.content);
        offset = chunk.nextOffset;
      }
      assert.equal(sha256Json(JSON.parse(chunks.join(""))), subjectHash);
      await assert.rejects(service.readTaskInput(issued.task.taskId, chunks.join("").length, 137), /offset/i);
      await assert.rejects(service.readTaskInput(issued.task.taskId, 0, 6_001), /range/i);
    }
    return service.completeTaskOutputs(issued.task.taskId, outputs);
  };

  const requirementHashes = await complete("requirements", [{ kind: "requirements", value: requirements() }]);
  await complete("requirements-review", [
    {
      kind: "review-findings",
      value: review(initialized.runId, "requirements", requirementHashes.outputHashes.requirements!),
    },
  ]);
  assert.match(
    await readFile(
      join(root, "agent-output", "demo", initialized.runId, "reviews", "requirements-findings.md"),
      "utf8",
    ),
    /No findings remain open\./u,
  );
  assert.match(
    await readFile(join(root, "agent-output", "demo", initialized.runId, "challenger-findings.md"), "utf8"),
    /No challenger findings remain open\./u,
  );
  await service.decideGateNumber(1, "approved", "tester");
  await acceptAvailabilityEvidence(service, initialized.runId);
  const architectureValue = {
    ...architecture(initialized.runId),
    decisionRecords: [
      {
        id: "ADR-0001",
        title: "Service choice",
        context: "Consumer workload requirements",
        decision: "Use the accepted service",
        requirementIds: [requirements().requirements[0]!.id],
        alternatives: [
          {
            option: "Alternative A",
            benefits: "Lower base cost",
            drawbacks: "Insufficient capacity",
            rejectionReason: "Fails workload demand",
          },
          {
            option: "Alternative B",
            benefits: "Flexible",
            drawbacks: "Operations burden",
            rejectionReason: "Team staffing limit",
          },
        ],
        positiveConsequences: ["Meets workload demand"],
        negativeConsequences: ["Higher base cost"],
        wafImpacts: {
          security: "Managed identity",
          reliability: "Recovery planning",
          "performance-efficiency": "Capacity alignment",
          "cost-optimization": "Base cost trade-off",
          "operational-excellence": "Team ownership",
        },
        complianceConsiderations: "Target policy remains mandatory",
        implementationNotes: "Use accepted binding and parameter contract",
      },
    ],
  };
  const costValue = costEstimate(initialized.runId);
  const architectureHashes = await complete("architecture", [
    { kind: "architecture", value: architectureValue },
    { kind: "cost-estimate", value: costValue },
    {
      kind: "workload-decision-manifest",
      value: workloadDecisionManifest({
        runId: initialized.runId,
        requirementsHash: requirementHashes.outputHashes.requirements!,
        architectureHash: sha256Json(architectureValue),
        costEstimateHash: sha256Json(costValue),
      }),
    },
  ]);
  const architectureReviewDirectory = join(root, "agent-output", "demo", initialized.runId, "architecture");
  const decisions = await service.render("architecture-decisions");
  assert.match(decisions, /ADR-0001/);
  assert.match(decisions, new RegExp(architectureHashes.outputHashes.architecture!));
  assert.equal(await readFile(join(architectureReviewDirectory, "architecture-decisions.md"), "utf8"), decisions);
  assert.match(await readFile(join(architectureReviewDirectory, "README.md"), "utf8"), /Architecture hash/u);
  assert.match(
    await readFile(join(architectureReviewDirectory, "architecture-assessment.md"), "utf8"),
    /Five WAF Pillars/u,
  );
  const expectedDiagrams = ["02-waf-assessment", "03-des-cost-breakdown", "03-des-cost-uncertainty", "03-des-diagram"];
  for (const name of expectedDiagrams) {
    for (const extension of ["py", "svg", "png"]) {
      assert.ok((await readFile(join(architectureReviewDirectory, `${name}.${extension}`))).byteLength > 0);
    }
  }
  const architectureAssessment = await readFile(
    join(architectureReviewDirectory, "architecture-assessment.md"),
    "utf8",
  );
  assert.match(architectureAssessment, /03-des-diagram\.svg/u);
  assert.match(architectureAssessment, /02-waf-assessment\.svg/u);
  const costAssessment = await readFile(join(architectureReviewDirectory, "cost-estimate.md"), "utf8");
  assert.match(costAssessment, /03-des-cost-breakdown\.svg/u);
  assert.match(costAssessment, /03-des-cost-uncertainty\.svg/u);
  assert.match(costAssessment, /Unpriced items are excluded from the priced subtotal and diagrams/u);
  assert.match(costAssessment, /Evidence Appendix/u);
  assert.match(await readFile(join(architectureReviewDirectory, "sku-comparison.md"), "utf8"), /SKU Comparison/u);
  assert.match(
    await readFile(join(architectureReviewDirectory, "challenger-findings.md"), "utf8"),
    /review is pending/u,
  );
  await complete("architecture-review", [
    {
      kind: "review-findings",
      value: review(initialized.runId, "architecture", architectureHashes.outputHashes.architecture!),
    },
  ]);
  assert.match(
    await readFile(join(architectureReviewDirectory, "challenger-findings.md"), "utf8"),
    /Well-Architected Criteria/u,
  );
  const reviewsDirectory = join(root, "agent-output", "demo", initialized.runId, "reviews");
  assert.match(
    await readFile(join(reviewsDirectory, "architecture-findings.md"), "utf8"),
    /Reviewed artifact kind: architecture/u,
  );
  const governanceHashes = await complete("governance-discovery", [
    { kind: "governance-constraints", value: governance(initialized.runId) },
  ]);
  const policyHashes = await complete("governance-reconciliation", [
    {
      kind: "policy-property-map",
      value: policyMap(initialized.runId, governanceHashes.outputHashes["governance-constraints"]!),
    },
  ]);
  await complete("governance-review", [
    {
      kind: "review-findings",
      value: review(initialized.runId, "policy-property-map", policyHashes.outputHashes["policy-property-map"]!),
    },
  ]);
  assert.match(
    await readFile(join(reviewsDirectory, "governance-reconciliation-findings.md"), "utf8"),
    /Reviewed artifact kind: policy-property-map/u,
  );
  await service.decideGateNumber(2, "approved", "tester");

  const issued = await service.nextTask();
  assert.equal(issued.status, "task");
  if (issued.status !== "task") return;
  assert.equal(issued.task.taskType, "plan");
  const context = await service.taskContext(issued.task.taskId);
  for (const kind of ["requirements", "architecture", "governance-constraints", "policy-property-map"]) {
    assert.match(context.artifactHashes[kind]!, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(Object.keys(context.outputTemplates).sort(), [
    "environment-inputs",
    "iac-binding",
    "implementation-intent",
  ]);
  assert.deepEqual(context.outputTemplates["environment-inputs"], {
    schemaVersion: "1.0.0",
    projectId: "demo",
    runId: initialized.runId,
    environment: "dev",
    inputs: {
      location: { kind: "value", value: "REGION" },
      credential: {
        kind: "secret-reference",
        provider: "azure-key-vault",
        reference: "KEY_VAULT_SECRET_REFERENCE",
      },
    },
  });

  const plan = planBundle(
    initialized.runId,
    "bicep",
    {},
    {
      requirements: requirementHashes.outputHashes.requirements!,
      architecture: architectureHashes.outputHashes.architecture!,
      "governance-constraints": governanceHashes.outputHashes["governance-constraints"]!,
      "policy-property-map": policyHashes.outputHashes["policy-property-map"]!,
    },
  );
  const planHashes = await service.completeTaskOutputs(issued.task.taskId, plan);
  const reviewTask = await service.nextTask();
  assert.equal(reviewTask.status, "task");
  if (reviewTask.status !== "task") return;
  assert.equal(reviewTask.task.taskType, "plan-review");
  await assertReviewContext(reviewTask.task.taskId, "plan-review", planHashes.outputHashes["implementation-intent"]!);
  const reviewInput = await service.readTaskInput(reviewTask.task.taskId);
  assert.equal(reviewInput.subjectHash, planHashes.outputHashes["implementation-intent"]);
  assert.deepEqual(JSON.parse(reviewInput.content), plan[0]!.value);
  const chunks: string[] = [];
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const chunk = await service.readTaskInput(reviewTask.task.taskId, offset, 137);
    chunks.push(chunk.content);
    offset = chunk.nextOffset;
  }
  assert.deepEqual(JSON.parse(chunks.join("")), plan[0]!.value);
});

test("direct worker calls preserve authority across missing, foreign, wrong, replayed and expired tasks", async () => {
  let now = Date.parse("2026-09-21T00:00:00.000Z");
  const root = await tempRoot();
  const service = new ApexService(root, { clock: () => new Date(now) });
  const { runId } = await service.init({ projectId: "demo" });
  const runPath = join(root, ".apex", "projects", "demo", "runs", runId);
  const journal = new EventJournal(join(runPath, "journal"));
  const canary = join(root, "user-notes.md");
  await writeFile(canary, "Preserve user content\n");
  const unchangedAfterRejection = async (operation: () => Promise<unknown>, expected: RegExp) => {
    const beforeEvents = await journal.replay();
    const beforeRun = await readFile(join(runPath, "run.json"));
    await assert.rejects(operation, expected);
    assert.deepEqual(await journal.replay(), beforeEvents);
    assert.deepEqual(await readFile(join(runPath, "run.json")), beforeRun);
    assert.equal(await readFile(canary, "utf8"), "Preserve user content\n");
  };
  const missing = "00000000-0000-4000-8000-000000000000";
  for (const operation of [
    () => service.completeReview(missing, []),
    () => service.generateIac(missing),
    () => service.validateTask(missing),
    () => service.stageFile(missing, "main.bicep", ""),
  ])
    await unchangedAfterRejection(operation, /task|ENOENT/i);
  const issued = await nextTaskAfterInput(service);
  if (issued.status !== "task") throw new Error("Expected requirements task");
  for (const operation of [
    () => service.completeReview(issued.task.taskId, []),
    () => service.generateIac(issued.task.taskId),
    () => service.stageFile(issued.task.taskId, "../user-notes.md", "overwrite"),
    () => service.decideGateNumber(1, "approved", "direct-worker-probe"),
  ])
    await unchangedAfterRejection(operation, /task|gate|review|approval/i);
  const other = new ApexService(await tempRoot());
  await other.init({ projectId: "other" });
  const foreign = await nextTaskAfterInput(other);
  if (foreign.status !== "task") throw new Error("Expected foreign task");
  await unchangedAfterRejection(() => service.completeReview(foreign.task.taskId, []), /task|ENOENT/i);
  const accepted = await service.completeRequirements(issued.task.taskId, requirements());
  assert.ok(accepted.outputHashes.requirements);
  await unchangedAfterRejection(
    () => service.completeRequirements(issued.task.taskId, requirements()),
    /stale|head|completed/i,
  );
  const reviewTask = await service.nextTask();
  if (reviewTask.status !== "task") throw new Error("Expected review task");
  assert.equal(reviewTask.task.taskType, "requirements-review");
  const reviewOutput = review(runId, "requirements", accepted.outputHashes.requirements!);
  const wrongSubject = { ...reviewOutput, subjectHash: "f".repeat(64) };
  await unchangedAfterRejection(
    () => service.completeTaskOutputs(reviewTask.task.taskId, [{ kind: "review-findings", value: wrongSubject }]),
    /bind|subject|hash/i,
  );
  now += 25 * 60 * 60 * 1_000;
  await unchangedAfterRejection(() => service.completeReview(reviewTask.task.taskId, []), /expired/i);
});

test("same client can submit valid requirements and review without authenticating distinct agent identities", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo" });
  const issued = await nextTaskAfterInput(service);
  if (issued.status !== "task") throw new Error("Expected requirements task");
  const accepted = await service.completeRequirements(issued.task.taskId, requirements());
  const reviewTask = await service.nextTask();
  if (reviewTask.status !== "task") throw new Error("Expected review task");
  const completed = await service.completeReview(reviewTask.task.taskId, []);
  const stored = await new ObjectStore(root).getJson(completed.outputHashes["review-findings"]!);
  assert.equal((stored as { subjectHash: string }).subjectHash, accepted.outputHashes.requirements);
  assert.notEqual((await service.status()).run.gates[0]!.state, "approved");
});

test("review input reads reject expired tasks", async () => {
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const service = new ApexService(await tempRoot(), { clock: () => new Date(now) });
  await service.init({ projectId: "demo" });
  const requirementsTask = await nextTaskAfterInput(service);
  assert.equal(requirementsTask.status, "task");
  if (requirementsTask.status !== "task") return;
  await service.completeRequirements(requirementsTask.task.taskId, requirements());
  const reviewTask = await service.nextTask();
  assert.equal(reviewTask.status, "task");
  if (reviewTask.status !== "task") return;
  await service.readTaskInput(reviewTask.task.taskId);
  now += 25 * 60 * 60 * 1_000;
  await assert.rejects(service.readTaskInput(reviewTask.task.taskId), /expired/i);
});

test("reviewer summary preserves non-empty findings and evidence references", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo" });
  const requirementsTask = await nextTaskAfterInput(service);
  assert.equal(requirementsTask.status, "task");
  if (requirementsTask.status !== "task") return;
  const accepted = await service.completeTaskOutputs(requirementsTask.task.taskId, [
    { kind: "requirements", value: requirements() },
  ]);
  const reviewerTask = await service.nextTask();
  assert.equal(reviewerTask.status, "task");
  if (reviewerTask.status !== "task") return;
  await service.completeTaskOutputs(reviewerTask.task.taskId, [
    {
      kind: "review-findings",
      value: review(initialized.runId, "requirements", accepted.outputHashes.requirements!, [
        {
          id: "FIND-001",
          severity: "high",
          disposition: "open",
          title: "Missing owner",
          detail: "Recovery ownership is not assigned.",
          evidenceRefs: ["a".repeat(64)],
        },
      ]),
    },
  ]);
  const summary = await readFile(
    join(root, "agent-output", "demo", initialized.runId, "reviews", "requirements-findings.md"),
    "utf8",
  );
  assert.match(summary, /FIND-001: Missing owner/u);
  assert.match(summary, /Evidence: a{64}/u);
});

test("requirements intake preserves explicit unresolved answers", async () => {
  for (const availabilityRecovery of ["deferred: product owner", "unknown"] as const) {
    const service = new ApexService(await tempRoot());
    await service.init({ projectId: "demo" });
    await recordRequirementsRound(service, {
      workload: "ecommerce",
      industry: "retail",
      "delivery-scenario": "greenfield",
      "target-environments": ["dev"],
      "workload-profile": "alz-backed",
    });
    await recordRequirementsRound(service, {
      "workload-pattern": "web-api",
      scale: "100 concurrent users",
      budget: { kind: "budget", amount: 500, currency: "USD", cadence: "monthly" },
      "data-sensitivity": { kind: "data-classification", classification: "internal" },
      "iac-preference": "bicep",
      "prohibited-services": "No services are prohibited",
      "service-preferences": ["container-apps", "azure-cosmos-db", "application-insights"],
      "sku-preferences": "no preference",
      "environment-overrides": "No environment-specific overrides",
    });
    await recordRequirementsRound(service, {
      compliance: { kind: "compliance", scopes: ["gdpr"] },
      "security-controls": ["managed-identity", "private-endpoints", "key-vault", "diagnostic-logging"],
      authentication: ["microsoft-entra-id", "managed-identity"],
      region: "swedencentral",
      "availability-recovery":
        availabilityRecovery === "unknown" ? { kind: "unknown" } : { kind: "deferred", owner: "product owner" },
      recovery: { kind: "recovery", rtoMinutes: 60, rpoMinutes: 15 },
      operations: ["azure-monitor", "application-insights", "managed-alerts"],
    });
    const issued = await service.nextTask();
    assert.equal(issued.status, "task");
    if (issued.status !== "task") continue;
    const context = await service.taskContext(issued.task.taskId);
    const template = context.outputTemplates.requirements as {
      requirements: Array<{ statement: string; status: string }>;
    };
    assert.deepEqual(
      (context.recordedInput as Record<string, unknown>)["availability-recovery"],
      availabilityRecovery === "unknown" ? { kind: "unknown" } : { kind: "deferred", owner: "product owner" },
    );
    assert.deepEqual(template.requirements[0], {
      id: "REQ-001",
      statement: `Availability and recovery: ${availabilityRecovery}`,
      priority: "must",
      status: availabilityRecovery === "unknown" ? "unknown" : "deferred",
      source: "intake:availability-recovery",
    });
  }
});

test("pending input is reissued after writer transfer", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
  const before = await service.nextTask();
  assert.equal(before.status, "needs_input");
  if (before.status !== "needs_input") return;
  const transfer = (await service.createWriterTransfer({
    repository: "owner/repository",
    branch: "main",
    commit: "abc",
    workflowId: "qualification.yml",
    sender: "local",
    recipient: "ci",
    currentHead: "abc",
    ttlMs: 60_000,
  })) as { hash: string };
  await service.acceptWriterTransfer(transfer.hash, "ci", "abc");
  const after = await service.nextTask();
  assert.equal(after.status, "needs_input");
  if (after.status !== "needs_input") return;
  assert.notEqual(after.request.requestId, before.request.requestId);
  assert.notEqual(after.request.expectedHead, before.request.expectedHead);
  assert.equal(after.request.ownerEpoch, before.request.ownerEpoch + 1);
  await service.recordInput({
    schemaVersion: "1.0.0",
    requestId: after.request.requestId,
    expectedHead: after.request.expectedHead,
    ownerEpoch: after.request.ownerEpoch,
    answers: after.request.questions.map(({ id, multiSelect, options }) => ({
      questionId: id,
      value: options === undefined ? id : multiSelect === true ? [options[0]!] : options[0]!,
    })),
  });
  assert.equal((await service.nextTask()).status, "needs_input");
});

test("typed input rejects obsolete answers without recording unrelated values", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo" });
  await assert.rejects(
    service.recordInput({ workload: "demo", secretToken: "do-not-journal" } as never),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_VALIDATION",
  );
  await assert.rejects(
    service.recordInput({ workload: "demo", requirements: "bounded", secretToken: "do-not-journal" } as never),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_VALIDATION",
  );
  const events = await new EventJournal(
    join(root, ".apex", "projects", "demo", "runs", (await service.status()).run.runId, "journal"),
  ).replay();
  assert.equal(
    events.some((event) => event.type === "requirements.input-recorded"),
    false,
  );
});

test("concurrent input submissions return only stable Apex errors", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
  const pending = await service.nextTask();
  assert.equal(pending.status, "needs_input");
  if (pending.status !== "needs_input") return;
  const submission = {
    schemaVersion: "1.0.0" as const,
    requestId: pending.request.requestId,
    expectedHead: pending.request.expectedHead,
    ownerEpoch: pending.request.ownerEpoch,
    answers: pending.request.questions.map(({ id, multiSelect, options }) => ({
      questionId: id,
      value: options === undefined ? id : multiSelect === true ? [options[0]!] : options[0]!,
    })),
  };
  const results = await Promise.allSettled([service.recordInput(submission), service.recordInput(submission)]);
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = results.find(({ status }) => status === "rejected");
  assert.equal(rejected?.status, "rejected");
  if (rejected?.status === "rejected") {
    assert.equal(rejected.reason instanceof ApexError, true);
    assert.equal(["APEX_STALE", "APEX_CONFLICT"].includes((rejected.reason as ApexError).code), true);
  }
});

for (const total of [3, 4]) {
  test(`obsolete ${total}-round intake requests fail closed without mutation`, async () => {
    const root = await tempRoot();
    const service = new ApexService(root);
    const initialized = await service.init({ projectId: "demo" });
    const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", initialized.runId, "journal"));
    await journal.append({
      eventId: "legacy-request",
      projectId: "demo",
      runId: initialized.runId,
      type: "requirements.input-requested",
      timestamp: "2026-01-01T00:00:00.000Z",
      ownerEpoch: 1,
      expectedHead: await journal.head(),
      payload: {
        requestId: "legacy-request",
        intake: { round: "business-discovery", ordinal: 1, total },
        questions: [
          { id: "workload", prompt: "Briefly describe the workload and its users." },
          { id: "industry", prompt: "Choose the industry.", options: ["retail", "other"] },
          { id: "delivery-scenario", prompt: "Choose the scenario.", options: ["greenfield", "migration"] },
          {
            id: "target-environments",
            prompt: "Choose environments.",
            options: ["dev", "prod"],
            multiSelect: true,
            valueType: "environment-set",
          },
        ],
      },
    });
    const head = await journal.head();
    await assert.rejects(service.nextTask(), /Requirements intake is incompatible/u);
    await assert.rejects(new ApexService(root).status(), /Requirements intake is incompatible/u);
    assert.equal(await journal.head(), head);
  });
}

test("malformed persisted input requests fail closed", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo" });
  const journalDirectory = join(root, ".apex", "projects", "demo", "runs", initialized.runId, "journal");
  const journal = new EventJournal(journalDirectory);
  await journal.append({
    eventId: "malformed-request",
    projectId: "demo",
    runId: initialized.runId,
    type: "requirements.input-requested",
    timestamp: "2026-01-01T00:00:00.000Z",
    ownerEpoch: 1,
    expectedHead: await journal.head(),
    payload: {
      requestId: "malformed-request",
      intake: { round: "business-discovery", ordinal: 5, total: 4 },
      questions: [{ id: "workload", prompt: "Describe the workload." }],
    },
  });
  await assert.rejects(service.nextTask(), /Requirements intake is incompatible/u);
});

test("a task remains current across stage then complete", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
  const issued = await nextTaskAfterInput(service);
  assert.equal(issued.status, "task");
  if (issued.status !== "task") return;

  const value = requirements();
  const staged = await service.stageArtifact(issued.task.taskId, { kind: "requirements", value });
  assert.equal(staged.kind, "requirements");
  const completed = await service.completeTaskOutputs(issued.task.taskId, [{ kind: "requirements", value }]);
  assert.match(completed.outputHashes.requirements!, /^[0-9a-f]{64}$/);
  const next = await service.nextTask();
  assert.equal(next.status, "task");
  if (next.status === "task") assert.equal(next.task.taskType, "requirements-review");
  assert.equal((await service.status()).run.gates[0]?.state, "closed");
});

test("expired preview and wrong preview hash are rejected", async () => {
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const root = await tempRoot();
  const service = new ApexService(root, { clock: () => new Date(now) });
  const initialized = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, initialized.runId, "bicep");
  const preview = await service.preview({ operation: "apply", provider: "fake", expiresInMs: 1 });
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", initialized.runId, "journal"));
  const beforeApproval = await service.status();
  const events = await journal.replay();
  await assert.rejects(service.deploy(preview.previewHash), /approval|gate/i);
  assert.deepEqual(await journal.replay(), events);
  assert.deepEqual((await service.status()).run, beforeApproval.run);
  await service.decideGateNumber(4, "approved", "tester");
  await assert.rejects(
    service.deploy("f".repeat(64)),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_STALE",
  );
  now += 2;
  await assert.rejects(
    service.deploy(preview.previewHash),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_STALE",
  );
});

test("gate approval rejects stale dependencies while explicit rejection remains available", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo" });
  const issued = await nextTaskAfterInput(service);
  assert.equal(issued.status, "task");
  if (issued.status !== "task") return;
  await service.completeTaskOutputs(issued.task.taskId, [{ kind: "requirements", value: requirements() }]);
  const reviewer = await service.nextTask();
  assert.equal(reviewer.status, "task");
  if (reviewer.status !== "task") return;
  await service.completeReview(reviewer.task.taskId, []);

  const runPath = join(root, ".apex", "projects", "demo", "runs", initialized.runId, "run.json");
  const run = JSON.parse(await readFile(runPath, "utf8")) as { gates: Array<{ gate: number; dependencyHash: string }> };
  await writeFile(
    runPath,
    JSON.stringify({
      ...run,
      gates: run.gates.map((gate) => (gate.gate === 1 ? { ...gate, dependencyHash: "f".repeat(64) } : gate)),
    }),
  );
  await assert.rejects(service.decideGateNumber(1, "approved", "tester"), /gate:requirements-ready/);
  const rejection = await service.decideGateNumber(1, "rejected", "tester");
  assert.equal(rejection.decision, "rejected");

  const events = await new EventJournal(
    join(root, ".apex", "projects", "demo", "runs", initialized.runId, "journal"),
  ).replay();
  const decided = events.find((event) => event.type === "gate.decided");
  assert.equal((decided?.payload as { validatorIds?: unknown }).validatorIds, undefined);
});

test("Gate 4 approval rejects an expired preview before changing gate state", async () => {
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const service = new ApexService(await tempRoot(), { clock: () => new Date(now) });
  const initialized = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, initialized.runId, "bicep");
  await service.preview({ operation: "apply", provider: "fake", expiresInMs: 1 });
  now += 2;
  await assert.rejects(service.decideGateNumber(4, "approved", "tester"), /preview has expired/);
  assert.equal((await service.status()).run.gates[3]?.state, "open");
});

test("deploy rejects a preview and approval from an older owner epoch", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, initialized.runId, "bicep");
  const preview = await service.preview({ operation: "apply", provider: "fake" });
  await service.decideGateNumber(4, "approved", "tester");
  const runPath = join(root, ".apex", "projects", "demo", "runs", initialized.runId, "run.json");
  const run = JSON.parse(await readFile(runPath, "utf8")) as { ownerEpoch: number };
  await writeFile(runPath, JSON.stringify({ ...run, ownerEpoch: 2 }));
  await assert.rejects(
    service.deploy(preview.previewHash),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_STALE",
  );
});

test("Gate 4 approval binds the current transferred writer identity", async () => {
  const service = new ApexService(await tempRoot());
  const initialized = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, initialized.runId, "bicep");
  const transfer = (await service.createWriterTransfer({
    repository: "owner/repo",
    branch: "feat/run",
    commit: "abc",
    workflowId: "deploy",
    sender: "local",
    recipient: "ci",
    currentHead: "abc",
    ttlMs: 60_000,
  })) as { hash: string };
  await service.acceptWriterTransfer(transfer.hash, "ci", "abc");
  await service.preview({ operation: "apply", provider: "fake" });
  const approval = await service.decideGateNumber(4, "approved", "tester");
  assert.equal(approval.recipientIdentity, "ci");
});

test("Gate 4 approves and deploys an exact preview after one post-preview writer transfer", async () => {
  const service = new ApexService(await tempRoot());
  const initialized = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, initialized.runId, "bicep");
  const preview = await service.preview({ operation: "apply", provider: "fake" });
  const transfer = (await service.createWriterTransfer({
    repository: "owner/repo",
    branch: "main",
    commit: "abc",
    workflowId: "deploy",
    sender: "local",
    recipient: "ci",
    currentHead: "abc",
    ttlMs: 60_000,
  })) as { hash: string };
  await service.acceptWriterTransfer(transfer.hash, "ci", "abc");
  const approval = await service.decideGateNumber(4, "approved", "tester");
  assert.equal(approval.writerEpoch, 2);
  assert.equal(approval.writerTransferClaimHash, transfer.hash);
  assert.equal((await service.deploy(preview.previewHash)).operation !== undefined, true);
});

test("Gate 4 rejects authority relinquished by a pending transfer", async () => {
  const service = new ApexService(await tempRoot());
  const initialized = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, initialized.runId, "bicep");
  await service.preview({ operation: "apply", provider: "fake" });
  await service.createWriterTransfer({
    repository: "owner/repo",
    branch: "main",
    commit: "abc",
    workflowId: "deploy",
    sender: "local",
    recipient: "ci",
    currentHead: "abc",
    ttlMs: 60_000,
  });
  await assert.rejects(service.decideGateNumber(4, "approved", "tester"), /writer authority is missing or expired/);
  assert.equal((await service.status()).run.gates[3]?.state, "open");
});

test("Gate 4 rejects an accepted writer after its lease expires", async () => {
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const service = new ApexService(await tempRoot(), { clock: () => new Date(now) });
  const initialized = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, initialized.runId, "bicep");
  const transfer = (await service.createWriterTransfer({
    repository: "owner/repo",
    branch: "main",
    commit: "abc",
    workflowId: "deploy",
    sender: "local",
    recipient: "ci",
    currentHead: "abc",
    ttlMs: 1_000,
  })) as { hash: string };
  await service.acceptWriterTransfer(transfer.hash, "ci", "abc");
  await service.preview({ operation: "apply", provider: "fake", expiresInMs: 2_000 });
  now += 1_001;
  await assert.rejects(service.decideGateNumber(4, "approved", "tester"), /writer authority is missing or expired/);
  assert.equal((await service.status()).run.gates[3]?.state, "open");
});

test("Gate 4 approval cannot outlive the current writer lease", async () => {
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const service = new ApexService(await tempRoot(), { clock: () => new Date(now) });
  const initialized = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, initialized.runId, "bicep");
  const transfer = (await service.createWriterTransfer({
    repository: "owner/repo",
    branch: "main",
    commit: "abc",
    workflowId: "deploy",
    sender: "local",
    recipient: "ci",
    currentHead: "abc",
    ttlMs: 1_000,
  })) as { hash: string };
  await service.acceptWriterTransfer(transfer.hash, "ci", "abc");
  const preview = await service.preview({ operation: "apply", provider: "fake", expiresInMs: 2_000 });
  const approval = await service.decideGateNumber(4, "approved", "tester");
  assert.equal(approval.expiresAt, "2026-01-01T00:00:01.000Z");
  assert.ok(Date.parse(approval.expiresAt!) < Date.parse(preview.expiresAt));
});

test("Gate 4 rejects a second post-preview writer hop and remains open", async () => {
  const service = new ApexService(await tempRoot());
  const initialized = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, initialized.runId, "bicep");
  await service.preview({ operation: "apply", provider: "fake" });
  const first = (await service.createWriterTransfer({
    repository: "owner/repo",
    branch: "main",
    commit: "abc",
    workflowId: "deploy",
    sender: "local",
    recipient: "ci",
    currentHead: "abc",
    ttlMs: 60_000,
  })) as { hash: string };
  await service.acceptWriterTransfer(first.hash, "ci", "abc");
  const second = (await service.createWriterTransfer({
    repository: "owner/repo",
    branch: "main",
    commit: "abc",
    workflowId: "deploy",
    sender: "ci",
    recipient: "prod",
    currentHead: "abc",
    ttlMs: 60_000,
  })) as { hash: string };
  await service.acceptWriterTransfer(second.hash, "prod", "abc");
  await assert.rejects(service.decideGateNumber(4, "approved", "tester"), /lineage is invalid/);
  assert.equal((await service.status()).run.gates[3]?.state, "open");
});

test("Gate 4 reopens for an exact superseding destroy preview and requires new approval", async () => {
  const service = new ApexService(await tempRoot());
  const initialized = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, initialized.runId, "bicep");
  const applyPreview = await service.preview({ operation: "apply", provider: "fake" });
  await service.decideGateNumber(4, "approved", "tester");
  await service.deploy(applyPreview.previewHash);

  const destroyPreview = await service.preview({ operation: "destroy", provider: "fake" });
  assert.equal((await service.status()).run.gates[3]?.state, "open");
  await assert.rejects(service.deploy(destroyPreview.previewHash), /does not authorize the exact preview|approval/i);
  await assert.rejects(service.deploy(applyPreview.previewHash), /not current/);

  await service.decideGateNumber(4, "approved", "tester");
  const destroyed = await service.deploy(destroyPreview.previewHash);
  assert.equal((destroyed.operation as { operation?: unknown }).operation, "destroy");
  assert.equal(destroyed.inventory.resources.length, 0);

  const events = await service.history(100);
  assert.ok(events.some((event) => event.type === "gate.reopened"));
});

test("Gate 4 refreshes an expired open preview without promotion", async () => {
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const service = new ApexService(await tempRoot(), { clock: () => new Date(now) });
  const initialized = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, initialized.runId, "bicep");
  const expired = await service.preview({ operation: "apply", provider: "fake", expiresInMs: 1 });
  now += 2;
  const refreshed = await service.preview({ operation: "apply", provider: "fake", expiresInMs: 60_000 });
  assert.notEqual(refreshed.previewHash, expired.previewHash);
  await assert.rejects(service.deploy(expired.previewHash), /not current|approval/i);
  await service.decideGateNumber(4, "approved", "tester");
  assert.equal((await service.deploy(refreshed.previewHash)).operation !== undefined, true);
});
