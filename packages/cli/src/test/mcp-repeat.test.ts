import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import type { Client } from "@modelcontextprotocol/client";
import { EventJournal, REPEAT_EVENT_TYPE, RunRepository, readRepeatEvents, readRepeatRecords } from "@apexops/kernel";
import { resolveMcpWorkspace } from "../cli.js";
import { MCP_TOOL_EFFECTS, type McpServiceResolver } from "../mcp.js";
import { ApexService } from "../service.js";
import { fixtures, hash, request, selection, task, type ToolName } from "./mcp-fixtures.js";
import { inputAnswers, tempRoot } from "./helpers.js";
import { connectMcp } from "./mcp-client.js";

const execFileAsync = promisify(execFile);
type CallResult = Awaited<ReturnType<Client["callTool"]>>;
type ServiceMethod = {
  [Method in keyof ApexService]: ApexService[Method] extends (...args: never[]) => unknown ? Method : never;
}[keyof ApexService];
type GuardedTool = {
  [Name in ToolName]: (typeof MCP_TOOL_EFFECTS)[Name] extends "repeat-guarded" ? Name : never;
}[ToolName];

type ToolCase = { method: ServiceMethod; input: Record<string, unknown> };

const guardedTools = (Object.keys(MCP_TOOL_EFFECTS) as ToolName[]).filter(
  (name): name is GuardedTool => MCP_TOOL_EFFECTS[name] === "repeat-guarded",
);

// One duplicate-call case per state-changing tool. The coverage test fails when a guarded tool has no case here.
const duplicateCases: Record<GuardedTool, ToolCase> = {
  releaseWriter: { method: "releaseWriter", input: {} },
  nextTask: { method: "nextTask", input: {} },
  recordInput: {
    method: "recordInput",
    input: {
      schemaVersion: "1.0.0",
      requestId: request.requestId,
      expectedHead: hash,
      ownerEpoch: 1,
      answers: [{ questionId: "workload", value: "web" }],
    },
  },
  governanceImport: { method: "importGovernanceBaseline", input: { path: "baseline.json" } },
  governanceSelect: { method: "selectGovernanceBaseline", input: { path: "baseline.json" } },
  projectCreate: {
    method: "createProject",
    input: {
      projectId: "other",
      displayName: "Other",
      environment: "dev",
      targetScope: "local",
      iacTool: "bicep",
      riskOwner: "partner",
    },
  },
  projectUse: { method: "use", input: { projectId: "demo" } },
  projectDelete: { method: "deleteProject", input: { projectId: "other", confirm: true } },
  gateDecide: { method: "decideInteractiveGate", input: { gate: 1, decision: "approved", confirm: true } },
  reviewDecide: {
    method: "decideReview",
    input: { reviewHash: hash, decisions: [{ findingId: "f", action: "revise" }] },
  },
  stageArtifact: { method: "stageArtifact", input: { taskId: "task-1", kind: "requirements", value: { a: 1 } } },
  stageFile: { method: "stageFile", input: { taskId: "task-1", path: "main.bicep", content: "{}" } },
  generateIac: { method: "generateIac", input: { taskId: "task-1" } },
  validateTask: { method: "validateTask", input: { taskId: "task-1" } },
  completeTask: {
    method: "completeTaskOutputs",
    input: { taskId: "task-1", outputs: [{ kind: "requirements", value: {} }] },
  },
  requirementsComplete: { method: "completeRequirements", input: { taskId: "task-1", requirements: {} } },
  architectureComplete: {
    method: "completeArchitecture",
    input: { taskId: "task-1", architecture: {}, costEstimate: {}, decisionManifest: {}, policyMappings: [] },
  },
  reviewComplete: { method: "completeReview", input: { taskId: "task-1", findings: [] } },
  planComplete: {
    method: "completePlan",
    input: {
      taskId: "task-1",
      implementationIntent: {},
      iacBinding: { schemaVersion: "1.0.0", ...selection, track: "bicep", resourceBindings: {} },
      environmentInputs: {},
    },
  },
  reconcile: { method: "reconcile", input: {} },
  improvementObserve: {
    method: "improvementObserve",
    input: {
      source: "deterministic-test",
      category: "correctness",
      severity: "low",
      statement: "Repeat safety",
      evidenceRefs: [hash],
    },
  },
  promote: { method: "promote", input: { environment: "prod", target: "local" } },
  submitEvidence: { method: "acceptEvidence", input: { taskId: "task-1", kind: "test", value: {} } },
};

const readCases: Partial<Record<ToolName, ToolCase>> = {
  status: { method: "workspaceStatus", input: {} },
  projectList: { method: "listProjects", input: {} },
  doctorChecks: { method: "doctor", input: {} },
  capabilityList: { method: "capabilityList", input: {} },
  capabilityStatus: { method: "capabilityStatus", input: { pack: "test" } },
  taskContext: { method: "taskContext", input: { taskId: "task-1" } },
  readTaskInput: { method: "readTaskInput", input: { taskId: "task-1" } },
  preview: { method: "currentPreview", input: {} },
  inventory: { method: "inventory", input: {} },
  diagnose: { method: "diagnose", input: {} },
  render: { method: "render", input: { kind: "status" } },
  improvementObservations: { method: "improvementObservations", input: {} },
  improvementProposals: { method: "improvementProposals", input: {} },
};

function serviceValue(name: ToolName): unknown {
  const value = structuredClone(fixtures[name]);
  switch (name) {
    case "nextTask":
      // A task envelope bounds replay by its expiry, so the fixture task must still be valid.
      return { status: "task", task: { ...task, expiresAt: new Date(Date.now() + 3_600_000).toISOString() } };
    case "status":
      return value;
    case "capabilityList":
      return value.packs;
    case "projectList":
      return value.projects;
    case "improvementObservations":
      return value.observations;
    case "improvementProposals":
      return value.proposals;
    case "preview":
    case "render":
      return value.markdown;
    default:
      return value;
  }
}

function assertSuccess(response: CallResult, label: string): void {
  assert.notEqual(response.isError, true, `${label}: ${JSON.stringify(response.structuredContent)}`);
}

function assertSameResult(second: CallResult, first: CallResult, label: string): void {
  assertSuccess(second, label);
  assert.deepEqual(second.content, first.content, label);
  assert.equal(JSON.stringify(second.structuredContent), JSON.stringify(first.structuredContent), label);
}

async function initializedWorkspace() {
  const service = new ApexService(await tempRoot(), {
    executableChecker: async () => true,
    azureAuthStatus: async () => ({ authenticated: false, detail: "Offline repeat test" }),
  });
  await service.init({ projectId: "demo", riskOwner: "partner" });
  const { run } = await service.status();
  const runDirectory = join(service.root, ".apex", "projects", run.projectId, "runs", run.runId);
  return { service, runDirectory, journal: new EventJournal(join(runDirectory, "journal")) };
}

async function connect(context: TestContext, service: ApexService | McpServiceResolver, name: string) {
  const session = await connectMcp(service, { name });
  context.after(session.close);
  return session;
}

test("every state-changing MCP tool is classified and has a duplicate-call case", async (context) => {
  const { client } = await connect(context, new ApexService(await tempRoot()), "repeat-coverage");
  const { tools } = await client.listTools();
  const names = tools.map(({ name }) => name).sort();
  assert.deepEqual(Object.keys(MCP_TOOL_EFFECTS).sort(), names);
  const listedGuarded = names.filter((name) => MCP_TOOL_EFFECTS[name as ToolName] === "repeat-guarded");
  assert.deepEqual(Object.keys(duplicateCases).sort(), listedGuarded);
  assert.deepEqual(
    names.filter((name) => MCP_TOOL_EFFECTS[name as ToolName] === "convergent"),
    ["doctor"],
  );
  assert.deepEqual(
    Object.keys(readCases).sort(),
    names.filter((name) => ["read", "read-only"].includes(MCP_TOOL_EFFECTS[name as ToolName])),
  );
  for (const tool of tools) {
    const effect = MCP_TOOL_EFFECTS[tool.name as ToolName];
    // Repeat suppression is bounded by the run state and window, so no state-changing tool claims idempotence.
    assert.equal(tool.annotations?.idempotentHint, effect === "read-only", tool.name);
    assert.equal(tool.annotations?.readOnlyHint, effect === "read-only", tool.name);
  }
});

test("a duplicate call to every state-changing MCP tool has no extra effect", async (context) => {
  const { service, runDirectory, journal } = await initializedWorkspace();
  const repository = new RunRepository(runDirectory);
  const invocations = new Map<string, number>();
  const externalChange = async (type: string) =>
    journal.append({
      eventId: crypto.randomUUID(),
      projectId: "demo",
      runId: (await service.status()).run.runId,
      type,
      timestamp: new Date().toISOString(),
      ownerEpoch: (await service.status()).run.ownerEpoch,
      expectedHead: await journal.head(),
      payload: { type },
    });
  context.mock.method(service, "taskContext", async () => serviceValue("taskContext"));
  for (const name of guardedTools) {
    const { method } = duplicateCases[name];
    context.mock.method(service, method, async () => {
      invocations.set(name, (invocations.get(name) ?? 0) + 1);
      await repository.acquireWriterLease({ workspacePath: await realpath(service.root) });
      await externalChange(`mock.${name}`);
      return serviceValue(name);
    });
  }
  const { client } = await connect(context, service, "repeat-every-tool");
  const call = (name: GuardedTool) =>
    client.callTool({ name, arguments: { workspace: service.root, ...duplicateCases[name].input } });
  for (const name of guardedTools) {
    const events = (await journal.replay()).length;
    const repeats = (await readRepeatEvents(runDirectory)).length;
    const first = await call(name);
    assertSuccess(first, name);
    assert.equal(invocations.get(name), 1, name);
    assert.equal((await journal.replay()).length, events + 1, name);

    const second = await call(name);
    assertSameResult(second, first, name);
    assert.equal(invocations.get(name), 1, `${name} executed again`);
    assert.equal((await journal.replay()).length, events + 1, `${name} changed the run on repeat`);
    const audit = await readRepeatEvents(runDirectory);
    assert.equal(audit.length, repeats + 1, name);
    assert.equal(audit.at(-1)!.type, REPEAT_EVENT_TYPE, name);
    assert.equal((audit.at(-1)!.payload as { operation: string }).operation, name);

    await externalChange(`intervening.${name}`);
    const third = await call(name);
    assertSuccess(third, name);
    assert.equal(invocations.get(name), 2, `${name} was answered after an intervening state change`);
  }
});

test("a result that fails the MCP contract is not stored and its repeat executes again", async (context) => {
  const { service, runDirectory } = await initializedWorkspace();
  let invocations = 0;
  context.mock.method(service, "use", async () => {
    invocations += 1;
    return invocations === 1 ? { unexpected: true } : serviceValue("projectUse");
  });
  const { client } = await connect(context, service, "repeat-invalid-result");
  const call = () => client.callTool({ name: "projectUse", arguments: { workspace: service.root, projectId: "demo" } });
  const failed = await call();
  assert.equal(failed.isError, true);
  assert.deepEqual(await readRepeatRecords(runDirectory), []);
  assertSuccess(await call(), "projectUse");
  assert.equal(invocations, 2);
});

test("a governance file replaced while the call runs never binds the result to other bytes", async (context) => {
  const { service, runDirectory } = await initializedWorkspace();
  const baseline = join(service.root, "baseline.json");
  await writeFile(baseline, '{"version":"a"}\n');
  let invocations = 0;
  context.mock.method(service, "selectGovernanceBaseline", async () => {
    invocations += 1;
    if (invocations === 1) await writeFile(baseline, '{"version":"b"}\n');
    return serviceValue("governanceSelect");
  });
  const { client } = await connect(context, service, "repeat-file-binding");
  const call = () =>
    client.callTool({ name: "governanceSelect", arguments: { workspace: service.root, path: "baseline.json" } });
  assertSuccess(await call(), "governanceSelect");
  assert.deepEqual(await readRepeatRecords(runDirectory), []);
  await writeFile(baseline, '{"version":"a"}\n');
  assertSuccess(await call(), "governanceSelect");
  assert.equal(invocations, 2);
  const stored = await call();
  assertSuccess(stored, "governanceSelect");
  assert.equal(invocations, 2);
  await writeFile(baseline, '{"version":"c"}\n');
  assertSuccess(await call(), "governanceSelect");
  assert.equal(invocations, 3);
});

test("an external edit to staged work makes an identical call a new request", async (context) => {
  const { service, runDirectory, journal } = await initializedWorkspace();
  const { run } = await service.status();
  const staged = join(service.root, ".apex", "work", run.runId, "task-1", "code", "main.bicep");
  let invocations = 0;
  context.mock.method(service, "stageFile", async () => {
    invocations += 1;
    if (invocations === 1) {
      await mkdir(join(staged, ".."), { recursive: true });
      await writeFile(staged, "{}");
      await journal.append({
        eventId: crypto.randomUUID(),
        projectId: run.projectId,
        runId: run.runId,
        type: "file.staged",
        timestamp: new Date().toISOString(),
        ownerEpoch: run.ownerEpoch,
        expectedHead: await journal.head(),
        payload: { path: "main.bicep" },
      });
    }
    return serviceValue("stageFile");
  });
  const { client } = await connect(context, service, "repeat-staged-edit");
  const call = () =>
    client.callTool({ name: "stageFile", arguments: { workspace: service.root, ...duplicateCases.stageFile.input } });
  const first = await call();
  assertSuccess(first, "stageFile");
  assertSameResult(await call(), first, "stageFile");
  assert.equal(invocations, 1);
  await writeFile(staged, "{ /* edited */ }");
  assertSuccess(await call(), "stageFile");
  assert.equal(invocations, 2);
  assert.equal((await readRepeatEvents(runDirectory)).length, 1);
});

test("read tools are never answered from a stored result", async (context) => {
  const { service, runDirectory } = await initializedWorkspace();
  const invocations = new Map<string, number>();
  for (const [name, { method }] of Object.entries(readCases)) {
    context.mock.method(service, method, async () => {
      invocations.set(name, (invocations.get(name) ?? 0) + 1);
      return serviceValue(name as ToolName);
    });
  }
  const { client } = await connect(context, service, "repeat-reads");
  for (const [name, { input }] of Object.entries(readCases)) {
    for (let index = 0; index < 2; index += 1)
      assertSuccess(await client.callTool({ name, arguments: { workspace: service.root, ...input } }), name);
    assert.equal(invocations.get(name), 2, name);
  }
  assert.deepEqual(await readRepeatEvents(runDirectory), []);
});

test("repeated doctor repair converges without an extra effect", async (context) => {
  const { service, runDirectory, journal } = await initializedWorkspace();
  const { client } = await connect(context, service, "repeat-doctor");
  const snapshot = async () => {
    const files = new Map<string, string>();
    const walk = async (directory: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.name.startsWith(".run-mutation")) continue;
        if (entry.isDirectory()) await walk(path);
        else
          files.set(
            relative(service.root, path),
            createHash("sha256")
              .update(await readFile(path))
              .digest("hex"),
          );
      }
    };
    await walk(service.root);
    return files;
  };
  await writeFile(join(service.root, ".apex", "runtime", "defaults.v1.json"), "{}\n");
  const repair = () =>
    client.callTool({ name: "doctor", arguments: { workspace: service.root, fix: true, yes: true } });
  const first = await repair();
  assertSuccess(first, "doctor");
  assert.notEqual(await readFile(join(service.root, ".apex", "runtime", "defaults.v1.json"), "utf8"), "{}\n");
  const afterFirst = await snapshot();
  const events = (await journal.replay()).length;
  const second = await repair();
  assert.deepEqual(second.content, first.content);
  assert.deepEqual(await snapshot(), afterFirst);
  assert.equal((await journal.replay()).length, events);
  assert.deepEqual(await readRepeatEvents(runDirectory), []);
});

test("real workflow repeats return the original result and only a state change makes a new request", async (context) => {
  const { service, runDirectory, journal } = await initializedWorkspace();
  const { client } = await connect(context, service, "repeat-workflow");
  const call = (name: string, input: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: { workspace: service.root, ...input } });

  const issued = await call("nextTask");
  assertSuccess(issued, "nextTask");
  const issuedEvents = (await journal.replay()).length;
  assertSameResult(await call("nextTask"), issued, "nextTask");
  assert.equal((await journal.replay()).length, issuedEvents);

  const pending = issued.structuredContent as {
    status: string;
    request: { requestId: string; expectedHead: string; ownerEpoch: number } & {
      questions: Parameters<typeof inputAnswers>[0];
    };
  };
  assert.equal(pending.status, "needs_input");
  const submission = {
    schemaVersion: "1.0.0",
    requestId: pending.request.requestId,
    expectedHead: pending.request.expectedHead,
    ownerEpoch: pending.request.ownerEpoch,
    answers: inputAnswers(pending.request.questions),
  };
  const recorded = await call("recordInput", submission);
  assertSuccess(recorded, "recordInput");
  const recordedEvents = (await journal.replay()).length;
  assert.equal(recordedEvents, issuedEvents + 1);
  // Without the guard this repeat fails as stale because its expected head is no longer current.
  assertSameResult(await call("recordInput", submission), recorded, "recordInput");
  assert.equal((await journal.replay()).length, recordedEvents);

  // The run changed after the first nextTask, so the identical call is a new request with a new answer.
  const next = await call("nextTask");
  assertSuccess(next, "nextTask");
  assert.notEqual(JSON.stringify(next.structuredContent), JSON.stringify(issued.structuredContent));
  assert.ok((await journal.replay()).length > recordedEvents);

  const used = await call("projectUse", { projectId: "demo" });
  assertSuccess(used, "projectUse");
  const usedEvents = (await journal.replay()).length;
  assertSameResult(await call("projectUse", { projectId: "demo" }), used, "projectUse");
  assert.equal((await journal.replay()).length, usedEvents);
  assert.deepEqual(
    (await readRepeatEvents(runDirectory)).map(({ payload }) => (payload as { operation: string }).operation),
    ["nextTask", "recordInput", "projectUse"],
  );
});

test("a repeat survives an MCP server restart within the run", async (context) => {
  const { service, journal } = await initializedWorkspace();
  const first = await connectMcp(service, { name: "repeat-before-restart" });
  const issued = await first.client.callTool({ name: "nextTask", arguments: { workspace: service.root } });
  assertSuccess(issued, "nextTask");
  await first.close();
  const events = (await journal.replay()).length;
  const restarted = new ApexService(service.root);
  const { client } = await connect(context, restarted, "repeat-after-restart");
  assertSameResult(
    await client.callTool({ name: "nextTask", arguments: { workspace: service.root } }),
    issued,
    "nextTask",
  );
  assert.equal((await journal.replay()).length, events);
});

test("a repeat from another worktree still meets the writer lease and the owner's repeat is answered", async (context) => {
  const root = await tempRoot();
  const main = join(root, "main");
  const worktree = join(root, "worktree");
  await mkdir(main);
  await execFileAsync("git", ["init", main]);
  await execFileAsync("git", ["-C", main, "config", "user.email", "apex@example.test"]);
  await execFileAsync("git", ["-C", main, "config", "user.name", "APEX Test"]);
  await writeFile(join(main, "README.md"), "# Demo\n", "utf8");
  await execFileAsync("git", ["-C", main, "add", "README.md"]);
  await execFileAsync("git", ["-C", main, "commit", "-m", "initial"]);
  await execFileAsync("git", ["-C", main, "worktree", "add", worktree]);
  const cache = new Map<string, ApexService>();
  const serviceFor = (workspaceRoot: string) => {
    let service = cache.get(workspaceRoot);
    if (service === undefined) {
      service = new ApexService(workspaceRoot);
      cache.set(workspaceRoot, service);
    }
    return service;
  };
  const resolver: McpServiceResolver = {
    defaultService: serviceFor(main),
    resolve: async (workspace) => {
      const resolved = await resolveMcpWorkspace(workspace);
      return { service: serviceFor(resolved.root), workspace: resolved.workspace };
    },
  };
  await serviceFor(main).init({ projectId: "demo", riskOwner: "partner" });
  const { client } = await connect(context, resolver, "repeat-worktrees");
  const use = (workspace: string) =>
    client.callTool({ name: "projectUse", arguments: { workspace, projectId: "demo" } });
  const used = await use(main);
  assertSuccess(used, "projectUse");
  for (let index = 0; index < 2; index += 1) {
    const conflict = await use(worktree);
    assert.equal(conflict.isError, true);
    assert.equal((conflict.structuredContent as { error: { code: string } }).error.code, "APEX_WRITER_CONFLICT");
  }
  assertSameResult(await use(main), used, "projectUse");
  const events = await readRepeatEvents(
    join(await realpath(main), ".apex", "projects", "demo", "runs", (await serviceFor(main).status()).run.runId),
  );
  assert.deepEqual(
    events.map(({ payload }) => (payload as { workspace: string }).workspace),
    [await realpath(main)],
  );
});
