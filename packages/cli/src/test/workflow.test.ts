import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { EventJournal, sha256Json } from "@apex/kernel";
import type { InputValueV1 } from "@apex/contracts";
import { ApexError } from "../errors.js";
import { ApexService } from "../service.js";
import {
  acceptAvailabilityEvidence,
  architecture,
  costEstimate,
  governance,
  nextTaskAfterInput,
  policyMap,
  prepareValidatedRun,
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

test("full requirements to fake deploy workflow survives restart", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, initialized.runId, "bicep");
  const preview = await service.preview({ operation: "apply", provider: "fake" });
  await service.decideGateNumber(4, "approved", "tester");
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

test("requirements intake issues four rounds before the requirements task", async () => {
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
  const rounds = ["business-discovery", "workload-pattern", "service-preferences", "security-compliance"];

  for (const [index, round] of rounds.entries()) {
    const pending = await service.nextTask();
    assert.equal(pending.status, "needs_input");
    if (pending.status !== "needs_input") return;
    assert.deepEqual(pending.request.intake, { round, ordinal: index + 1, total: 4 });
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
  });
  const pending = await service.nextTask();
  assert.equal(pending.status, "needs_input");
  if (pending.status !== "needs_input") return;
  assert.deepEqual(
    pending.request.questions.slice(-3).map(({ id }) => id),
    ["current-platform", "migration-pain-points", "preserve-components"],
  );
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
    assert.deepEqual((await service.taskContext(issued.task.taskId)).decisions, {
      "network-exposure": "private-only",
    });
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
  assert.match(await service.render("requirements"), /offline service/u);
  assert.notEqual(document?.outputHash, accepted.outputHashes.requirements);
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
      { questionId: "industry", value: "software" },
      { questionId: "delivery-scenario", value: "greenfield" },
      { questionId: "target-environments", value: ["dev"] },
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
  const service = new ApexService(await tempRoot());
  await service.init({ projectId: "demo" });
  await recordRequirementsRound(service, {
    workload: "ecommerce",
    industry: "retail",
    "delivery-scenario": "greenfield",
    "target-environments": ["dev"],
  });
  await recordRequirementsRound(service, {
    "workload-pattern": "web-api",
    scale: "100 concurrent users",
    budget: { kind: "budget", amount: 500, currency: "USD", cadence: "monthly" },
    "data-sensitivity": { kind: "data-classification", classification: "confidential" },
    "iac-preference": "bicep",
  });
  await recordRequirementsRound(service, {
    "retained-services": "No services must be retained",
    "prohibited-services": "No services are prohibited",
    "service-preferences": "managed services",
    "sku-preferences": "no preference",
    "environment-overrides": "No environment-specific overrides",
  });
  await recordRequirementsRound(service, {
    compliance: { kind: "compliance", scopes: ["pci-dss"] },
    "security-controls": "managed identities",
    authentication: "Microsoft Entra ID",
    region: "swedencentral",
    "availability-recovery": "99.9% availability; RTO 60 minutes; RPO 15 minutes",
    recovery: { kind: "recovery", rtoMinutes: 60, rpoMinutes: 15 },
    operations: "central monitoring",
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
    "workload-pattern": "web-api",
    scale: "100 concurrent users",
    budget: { kind: "budget", amount: 500, currency: "USD", cadence: "monthly" },
    "data-sensitivity": { kind: "data-classification", classification: "confidential" },
    "iac-preference": "bicep",
    "retained-services": "No services must be retained",
    "prohibited-services": "No services are prohibited",
    "service-preferences": "managed services",
    "sku-preferences": "no preference",
    "environment-overrides": "No environment-specific overrides",
    compliance: { kind: "compliance", scopes: ["pci-dss"] },
    "security-controls": "managed identities",
    authentication: "Microsoft Entra ID",
    region: "swedencentral",
    "availability-recovery": "99.9% availability; RTO 60 minutes; RPO 15 minutes",
    recovery: { kind: "recovery", rtoMinutes: 60, rpoMinutes: 15 },
    operations: "central monitoring",
  });
  assert.equal(context.inputs.length, 0);
  const template = context.outputTemplates.requirements as {
    requirements: Array<{ id: string; statement: string; priority: string; status: string; source: string }>;
    assumptions: string[];
    unknowns: string[];
  };
  assert.deepEqual(template.requirements.slice(0, 2), [
    {
      id: "REQ-001",
      statement: "Availability and recovery: 99.9% availability; RTO 60 minutes; RPO 15 minutes",
      priority: "must",
      status: "confirmed",
      source: "intake:availability-recovery",
    },
    {
      id: "REQ-002",
      statement: "Security controls: managed identities",
      priority: "must",
      status: "confirmed",
      source: "intake:security-controls",
    },
  ]);
  assert.deepEqual(template.assumptions, ["industry: retail", "target-environments: dev"]);
  assert.deepEqual(template.unknowns, []);
  await service.stageArtifact(issued.task.taskId, {
    kind: "requirements",
    value: context.outputTemplates.requirements,
  });
});

test("task context projects hashes from legacy task completions", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo" });
  const issued = await nextTaskAfterInput(service);
  assert.equal(issued.status, "task");
  if (issued.status !== "task") return;
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", initialized.runId, "journal"));
  const requirementsHash = "a".repeat(64);
  await journal.append({
    eventId: "legacy-requirements",
    projectId: "demo",
    runId: initialized.runId,
    type: "task.completed",
    timestamp: "2026-01-01T00:00:00.000Z",
    ownerEpoch: 1,
    expectedHead: await journal.head(),
    payload: { nodeId: "requirements", requirementsHash, legacy: true },
  });

  const context = await service.taskContext(issued.task.taskId);
  assert.equal(context.artifactHashes.requirements, requirementsHash);
});

test("plan task context projects source hashes and valid output templates", async () => {
  const service = new ApexService(await tempRoot());
  const initialized = await service.init({ projectId: "demo" });
  const complete = async (taskType: string, outputs: Parameters<typeof service.completeTaskOutputs>[1]) => {
    const issued = await nextTaskAfterInput(service);
    assert.equal(issued.status, "task");
    if (issued.status !== "task") throw new Error("Expected a task");
    assert.equal(issued.task.taskType, taskType);
    return service.completeTaskOutputs(issued.task.taskId, outputs);
  };

  const requirementHashes = await complete("requirements", [{ kind: "requirements", value: requirements() }]);
  await complete("requirements-review", [
    {
      kind: "review-findings",
      value: review(initialized.runId, "requirements", requirementHashes.outputHashes.requirements!),
    },
  ]);
  await service.decideGateNumber(1, "approved", "tester");
  await acceptAvailabilityEvidence(service, initialized.runId);
  const architectureValue = architecture(initialized.runId);
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
  await complete("architecture-review", [
    {
      kind: "review-findings",
      value: review(initialized.runId, "architecture", architectureHashes.outputHashes.architecture!),
    },
  ]);
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
    });
    await recordRequirementsRound(service, {
      "workload-pattern": "web-api",
      scale: "100 concurrent users",
      budget: { kind: "budget", amount: 500, currency: "USD", cadence: "monthly" },
      "data-sensitivity": { kind: "data-classification", classification: "internal" },
      "iac-preference": "bicep",
    });
    await recordRequirementsRound(service, {
      "retained-services": "No services must be retained",
      "prohibited-services": "No services are prohibited",
      "service-preferences": "managed services",
      "sku-preferences": "no preference",
      "environment-overrides": "No environment-specific overrides",
    });
    await recordRequirementsRound(service, {
      compliance: { kind: "compliance", scopes: ["gdpr"] },
      "security-controls": "managed identities",
      authentication: "Microsoft Entra ID",
      region: "swedencentral",
      "availability-recovery": availabilityRecovery,
      recovery: { kind: "recovery", rtoMinutes: 60, rpoMinutes: 15 },
      operations: "central monitoring",
    });
    const issued = await service.nextTask();
    assert.equal(issued.status, "task");
    if (issued.status !== "task") continue;
    const context = await service.taskContext(issued.task.taskId);
    const template = context.outputTemplates.requirements as {
      requirements: Array<{ statement: string; status: string }>;
    };
    assert.equal((context.recordedInput as Record<string, string>)["availability-recovery"], availabilityRecovery);
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

test("compatibility input rejects legacy answers without recording unrelated values", async () => {
  const root = await tempRoot();
  const service = new ApexService(root);
  await service.init({ projectId: "demo" });
  await assert.rejects(
    service.recordRequirementsInput({ workload: "demo", secretToken: "do-not-journal" }),
    (error: unknown) => error instanceof ApexError && error.code === "APEX_VALIDATION",
  );
  await assert.rejects(
    service.recordRequirementsInput({ workload: "demo", requirements: "bounded", secretToken: "do-not-journal" }),
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
  const completed = await service.completeTask(issued.task.taskId, { kind: "requirements", value });
  assert.match(completed.outputHash, /^[0-9a-f]{64}$/);
});

test("expired preview and wrong preview hash are rejected", async () => {
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const service = new ApexService(await tempRoot(), { clock: () => new Date(now) });
  const initialized = await service.init({ projectId: "demo" });
  await prepareValidatedRun(service, initialized.runId, "bicep");
  const preview = await service.preview({ operation: "apply", provider: "fake", expiresInMs: 1 });
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
  await service.completeTask(issued.task.taskId, { kind: "requirements", value: requirements() });

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
