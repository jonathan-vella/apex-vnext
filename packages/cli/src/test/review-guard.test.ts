import assert from "node:assert/strict";
import test from "node:test";
import type { Client } from "@modelcontextprotocol/client";
import { mcpServiceResolver } from "../cli.js";
import { ApexError } from "../errors.js";
import { MCP_TOOL_EFFECTS, MCP_TOOL_REVIEW_GUARDS } from "../mcp.js";
import type { McpStateChangingTool, ReviewGuardedTool } from "../mcp-tool-effects.js";
import { ApexService } from "../service.js";
import { captureReview, nextTaskAfterInput, requirements, tempRoot } from "./helpers.js";
import { connectMcp } from "./mcp-client.js";

const hash = "0".repeat(64);
const guardedTools = (Object.keys(MCP_TOOL_REVIEW_GUARDS) as McpStateChangingTool[]).filter(
  (name): name is ReviewGuardedTool => MCP_TOOL_REVIEW_GUARDS[name] !== null,
);

// Per guarded tool: MCP arguments (given the pending review task) and every service path of the same operation, which
// the CLI uses. Arguments are harmless: once the guard lifts, each call fails on its own checks.
const invocations: Record<
  ReviewGuardedTool,
  { mcp: (taskId: string) => Record<string, unknown>; service: Array<(service: ApexService) => Promise<unknown>> }
> = {
  recordInput: {
    mcp: () => ({
      schemaVersion: "1.0.0",
      requestId: "missing",
      expectedHead: hash,
      ownerEpoch: 1,
      answers: [{ questionId: "q", value: "v" }],
    }),
    service: [
      (service) =>
        service.recordInput({
          schemaVersion: "1.0.0",
          requestId: "missing",
          expectedHead: hash,
          ownerEpoch: 1,
          answers: [{ questionId: "q", value: "v" }],
        } as never),
    ],
  },
  projectDelete: {
    mcp: () => ({ projectId: "missing-project", confirm: true }),
    service: [(service) => service.deleteProject("missing-project" as never, true)],
  },
  gateDecide: {
    mcp: () => ({ gate: 3, decision: "approved", confirm: true }),
    service: [
      (service) => service.decideGateNumber(3, "approved", "tester"),
      (service) => service.decideInteractiveGate(3, "approved"),
    ],
  },
  reviewDecide: {
    mcp: () => ({ reviewHash: hash, decisions: [{ findingId: "F-1", action: "dismiss", rationale: "test" }] }),
    service: [
      (service) => service.decideReview(hash, [{ findingId: "F-1", action: "dismiss", rationale: "test" }]),
      (service) => service.resolveReview({ reviewHash: hash } as never),
    ],
  },
  promote: {
    mcp: () => ({ environment: "prod", target: "local" }),
    service: [(service) => service.promote("prod", "local")],
  },
  submitEvidence: {
    // The adapter reads the task context first, so the call names the pending review task to reach the service.
    mcp: (taskId) => ({ taskId, kind: "test", value: {} }),
    service: [
      (service) =>
        service.acceptEvidence({ kind: "test", contentType: "application/json", value: {}, required: false }),
    ],
  },
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

function mcpCode(response: Awaited<ReturnType<Client["callTool"]>>): string {
  return response.isError === true ? (response.structuredContent as { error: { code: string } }).error.code : "ok";
}

async function assertBlocked(service: ApexService, taskId: string): Promise<void> {
  for (const tool of guardedTools)
    for (const invoke of invocations[tool].service)
      await assert.rejects(
        invoke(service),
        (error: unknown) => {
          assert.ok(error instanceof ApexError, tool);
          assert.equal(error.code, "APEX_REVIEW_PENDING", tool);
          assert.deepEqual(error.details, {
            reason: "REVIEW_PENDING",
            operation: tool,
            projectId: "demo",
            runId: (error.details as { runId: string }).runId,
            taskId,
          });
          assert.match(error.message, new RegExp(`apex task cancel --task ${taskId}`, "u"));
          return true;
        },
        tool,
      );
}

async function assertNotBlocked(service: ApexService): Promise<void> {
  for (const tool of guardedTools)
    for (const invoke of invocations[tool].service)
      assert.notEqual(await outcome(invoke(service)), "APEX_REVIEW_PENDING", tool);
}

test("the pending-review guard extends the MCP effect classification", () => {
  const stateChanging = Object.entries(MCP_TOOL_EFFECTS)
    .filter(([, effect]) => effect === "repeat-guarded" || effect === "convergent")
    .map(([name]) => name)
    .sort();
  assert.deepEqual(Object.keys(MCP_TOOL_REVIEW_GUARDS).sort(), stateChanging, "every state-changing tool decides");
  assert.deepEqual(Object.keys(invocations).sort(), [...guardedTools].sort(), "every guarded tool has a case");
  for (const tool of ["projectDelete", "gateDecide", "reviewDecide", "promote", "submitEvidence"])
    assert.ok(guardedTools.includes(tool as ReviewGuardedTool), tool);
  for (const tool of ["nextTask", "reviewComplete", "stageArtifact"])
    assert.equal(MCP_TOOL_REVIEW_GUARDS[tool as McpStateChangingTool], null, tool);
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

test("every guarded MCP tool returns APEX_REVIEW_PENDING with a finish-or-cancel remediation", async (context) => {
  const { service, taskId } = await pendingReview();
  const { client, close } = await connectMcp(service, { name: "review-guard-test" });
  context.after(close);
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: { workspace: service.root, ...args } });
  for (const tool of guardedTools) {
    const response = await call(tool, invocations[tool].mcp(taskId));
    assert.equal(mcpCode(response), "APEX_REVIEW_PENDING", tool);
    const { error } = response.structuredContent as { error: { message: string; remediation: string } };
    assert.match(error.message, /approve, delete or publish are blocked/u);
    assert.match(error.remediation, /reviewComplete.*apex task cancel/u);
  }
  // Reads, task flow and the review's own completion still work over MCP.
  assert.equal(mcpCode(await call("status", {})), "ok");
  assert.equal(mcpCode(await call("taskContext", { taskId })), "ok");
  assert.equal(mcpCode(await call("nextTask", {})), "ok");
  await captureReview(service, taskId, { findings: [] });
  assert.equal(mcpCode(await call("reviewComplete", { taskId })), "ok");
  for (const tool of guardedTools)
    assert.notEqual(mcpCode(await call(tool, invocations[tool].mcp(taskId))), "APEX_REVIEW_PENDING", tool);
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
  // Every guarded tool, including recordInput, is refused there; submitEvidence names a task of that workspace.
  const otherTask = await nextTaskAfterInput(other);
  if (otherTask.status !== "task") throw new Error("Expected a task in the other workspace");
  for (const tool of guardedTools)
    assert.equal(mcpCode(await call(tool, invocations[tool].mcp(otherTask.task.taskId))), "APEX_REVIEW_PENDING", tool);
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
