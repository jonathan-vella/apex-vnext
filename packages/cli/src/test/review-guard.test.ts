import assert from "node:assert/strict";
import test from "node:test";
import { mcpServiceResolver } from "../cli.js";
import { ApexError } from "../errors.js";
import { REVIEW_GUARDED_OPERATIONS, type ReviewGuardedOperation } from "../review-guard.js";
import { ApexService } from "../service.js";
import { captureReview, nextTaskAfterInput, requirements, tempRoot } from "./helpers.js";
import { connectMcp } from "./mcp-client.js";

// One invocation per classified operation. Arguments are harmless: once the guard lifts, each call fails on its own
// checks or changes nothing the test relies on.
const invocations: Record<ReviewGuardedOperation, (service: ApexService) => Promise<unknown>> = {
  decideGateNumber: (service) => service.decideGateNumber(3, "approved", "tester"),
  decideReview: (service) => service.decideReview("0".repeat(64), [{ findingId: "F-1", decision: "dismiss" } as never]),
  resolveReview: (service) => service.resolveReview({ reviewHash: "0".repeat(64) } as never),
  improvementDecide: (service) =>
    service.improvementDecide({ proposalId: "missing", actor: "tester", decision: "rejected" } as never),
  acceptWriterTransfer: (service) => service.acceptWriterTransfer("0".repeat(64), "ci", "0".repeat(64)),
  deleteProject: (service) => service.deleteProject("missing-project" as never, true),
  improvementDeleteObservation: (service) => service.improvementDeleteObservation("missing"),
  improvementPrune: (service) => service.improvementPrune(),
  deleteTelemetry: (service) => service.deleteTelemetry(),
  promote: (service) => service.promote("prod", "local"),
  acceptEvidence: (service) =>
    service.acceptEvidence({ kind: "", contentType: "application/json", value: {}, required: false } as never),
  deploy: (service) => service.deploy("0".repeat(64)),
  publishRepository: (service) => service.publishRepository({} as never, "0".repeat(64), false),
  provisionGovernance: (service) => service.provisionGovernance({} as never, "0".repeat(64), false),
  createWriterTransfer: (service) => service.createWriterTransfer({} as never),
};

async function pendingReview(clock?: () => Date) {
  const root = await tempRoot();
  const service = new ApexService(root, clock === undefined ? {} : { clock });
  await service.init({ projectId: "demo", riskOwner: "partner" });
  const issued = await nextTaskAfterInput(service);
  if (issued.status !== "task") throw new Error("Expected requirements task");
  await service.completeRequirements(issued.task.taskId, requirements());
  const next = await service.nextTask();
  if (next.status !== "task" || next.task.taskType !== "requirements-review")
    throw new Error(`Expected requirements-review, received ${JSON.stringify(next).slice(0, 200)}`);
  return { root, service, taskId: next.task.taskId };
}

async function outcome(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "ok";
  } catch (error) {
    return error instanceof ApexError ? error.code : "error";
  }
}

async function assertBlocked(service: ApexService, taskId: string): Promise<void> {
  for (const [operation, invoke] of Object.entries(invocations) as Array<
    [ReviewGuardedOperation, typeof invocations.deploy]
  >)
    await assert.rejects(
      invoke(service),
      (error: unknown) => {
        assert.ok(error instanceof ApexError, operation);
        assert.equal(error.code, "APEX_REVIEW_PENDING", operation);
        assert.deepEqual(error.details, {
          reason: "REVIEW_PENDING",
          operation,
          projectId: "demo",
          runId: (error.details as { runId: string }).runId,
          taskId,
        });
        assert.match(error.message, new RegExp(`apex task cancel --task ${taskId}`, "u"));
        return true;
      },
      operation,
    );
}

async function assertNotBlocked(service: ApexService): Promise<void> {
  for (const [operation, invoke] of Object.entries(invocations) as Array<
    [ReviewGuardedOperation, typeof invocations.deploy]
  >)
    assert.notEqual(await outcome(invoke(service)), "APEX_REVIEW_PENDING", operation);
}

test("the guard covers exactly the classified service operations", () => {
  assert.deepEqual(Object.keys(invocations).sort(), Object.keys(REVIEW_GUARDED_OPERATIONS).sort());
  for (const operation of Object.keys(REVIEW_GUARDED_OPERATIONS))
    assert.equal(
      typeof (ApexService.prototype as unknown as Record<string, unknown>)[operation],
      "function",
      operation,
    );
  for (const effect of Object.values(REVIEW_GUARDED_OPERATIONS))
    assert.ok(["approve", "delete", "publish"].includes(effect));
  for (const operation of ["decideGateNumber", "decideReview", "deleteProject", "promote", "acceptEvidence"])
    assert.ok(operation in REVIEW_GUARDED_OPERATIONS, operation);
});

test("approve, delete and publish operations are refused while a review waits for its capture", async () => {
  const { service, taskId } = await pendingReview();
  await assertBlocked(service, taskId);
  // The review flow itself, reads and task flow stay available, and the review completes from its capture.
  assert.ok((await service.taskContext(taskId)).reviewRequest?.nonce);
  const again = await service.nextTask();
  assert.equal(again.status === "task" && again.task.taskId, taskId);
  await service.status();
  await captureReview(service, taskId, { findings: [] });
  await service.completeReview(taskId);
  await assertNotBlocked(service);
});

test("a pending review in another project still blocks deleting it", async () => {
  const { service, taskId } = await pendingReview();
  await service.createProject({
    projectId: "other",
    riskOwner: "partner",
    displayName: "Other",
    environment: "dev",
    targetScope: "local",
    iacTool: "bicep",
  } as never);
  assert.equal((await service.status()).run.projectId, "other");
  await assert.rejects(service.deleteProject("demo" as never, true), (error: unknown) => {
    assert.ok(error instanceof ApexError);
    assert.equal(error.code, "APEX_REVIEW_PENDING");
    assert.equal((error.details as { taskId: string }).taskId, taskId);
    return true;
  });
});

test("rejected reviews stay pending; cancelling or expiry lifts the guard and a new request restores it", async () => {
  let now = new Date();
  const { service, taskId } = await pendingReview(() => now);
  await captureReview(service, taskId, "No review block here.");
  await assert.rejects(service.completeReview(taskId), /failed \(unparseable\)/u);
  await assertBlocked(service, taskId);
  await service.cancelTask(taskId);
  await assertNotBlocked(service);
  const next = await service.nextTask();
  assert.ok(next.status === "task" && next.task.taskType === "requirements-review");
  await assertBlocked(service, next.task.taskId);
  now = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 1);
  await assertNotBlocked(service);
});

test("MCP returns APEX_REVIEW_PENDING with a finish-or-cancel remediation", async (context) => {
  const { service } = await pendingReview();
  const { client, close } = await connectMcp(service, { name: "review-guard-test" });
  context.after(close);
  for (const [name, args] of [
    ["gateDecide", { gate: 1, decision: "approved", confirm: true }],
    ["projectDelete", { projectId: "demo", confirm: true }],
    ["promote", { environment: "prod", target: "local" }],
  ] as const) {
    const response = await client.callTool({ name, arguments: { workspace: service.root, ...args } });
    assert.equal(response.isError, true, name);
    const { error } = response.structuredContent as { error: { code: string; message: string; remediation: string } };
    assert.equal(error.code, "APEX_REVIEW_PENDING", name);
    assert.match(error.message, /approve, delete or publish are blocked/u);
    assert.match(error.remediation, /reviewComplete.*apex task cancel/u);
  }
  const status = await client.callTool({ name: "status", arguments: { workspace: service.root } });
  assert.notEqual(status.isError, true);
});

test("a guarded call aimed at another served workspace is refused while one has a pending review", async (context) => {
  const { service: reviewed, taskId } = await pendingReview();
  const other = new ApexService(await tempRoot());
  await other.init({ projectId: "other", riskOwner: "partner" });
  const resolver = mcpServiceResolver(reviewed, async (workspaceRoot) => new ApexService(workspaceRoot));
  const { client, close } = await connectMcp(resolver, { name: "review-guard-peers" });
  context.after(close);
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: { workspace: other.root, ...args } });
  assert.notEqual((await call("status", {})).isError, true, "the other workspace is served and readable");
  for (const [name, args] of [
    ["projectDelete", { projectId: "other", confirm: true }],
    ["gateDecide", { gate: 1, decision: "approved", confirm: true }],
  ] as const) {
    const response = await call(name, args);
    assert.equal(response.isError, true, name);
    assert.equal((response.structuredContent as { error: { code: string } }).error.code, "APEX_REVIEW_PENDING", name);
  }
  // Without the shared peers, the other workspace's own scan finds nothing; with them, the error names the workspace.
  assert.notEqual(await outcome(other.deleteProject("missing" as never, true)), "APEX_REVIEW_PENDING");
  other.setReviewGuardPeers(() => [reviewed, other]);
  await assert.rejects(other.deleteProject("missing" as never, true), (error: unknown) => {
    assert.ok(error instanceof ApexError);
    assert.equal(error.code, "APEX_REVIEW_PENDING");
    assert.deepEqual(
      {
        workspace: (error.details as { workspace?: string }).workspace,
        taskId: (error.details as { taskId: string }).taskId,
      },
      { workspace: reviewed.root, taskId },
    );
    return true;
  });
});
