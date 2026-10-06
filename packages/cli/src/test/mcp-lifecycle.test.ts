import assert from "node:assert/strict";
import { execFile, type ChildProcess } from "node:child_process";
import { mkdir, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { JSONRPCMessageSchema, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { mcpWorkspaceRoot, resolveMcpWorkspace } from "../cli.js";
import { MCP_OUTPUT_SCHEMAS } from "../mcp-output-schemas.js";
import { createMcpServer, type McpServiceResolver } from "../mcp.js";
import { ApexError, EXIT_CODES } from "../errors.js";
import { GovernanceBaselineError } from "@apexops/capabilities";
import { ApexService } from "../service.js";
import { requirements, tempRoot } from "./helpers.js";

const hash = "a".repeat(64);
const execFileAsync = promisify(execFile);
const input = {
  schemaVersion: "1.0.0",
  requestId: "request-1",
  expectedHead: hash,
  ownerEpoch: 1,
  answers: [{ questionId: "workload", value: "offline test" }],
} satisfies Parameters<ApexService["recordInput"]>[0];

function deferred() {
  return Promise.withResolvers<void>();
}

function staged(taskId: string, output: Parameters<ApexService["stageArtifact"]>[1]) {
  return { taskId, kind: output.kind, path: `${taskId}/${output.kind}.json`, bytes: 2, hash };
}

function assertSuccess(name: keyof typeof MCP_OUTPUT_SCHEMAS, response: Awaited<ReturnType<Client["callTool"]>>) {
  assert.notEqual(response.isError, true, JSON.stringify(response));
  assert.equal(MCP_OUTPUT_SCHEMAS[name].safeParse(response.structuredContent).success, true);
  return response.structuredContent;
}

function assertError(response: Awaited<ReturnType<Client["callTool"]>>, code: string, message: string) {
  assert.equal(response.isError, true);
  const error = { error: { code, message } };
  assert.deepEqual(response.structuredContent, error);
  assert.deepEqual(response.content, [{ type: "text", text: JSON.stringify(error) }]);
}

async function connect(
  context: TestContext,
  overrides: Partial<ApexService> = {},
  options: { queueTimeoutMs?: number } = {},
) {
  const service = Object.assign(new ApexService(await tempRoot()), overrides);
  const server = createMcpServer(service, options);
  const client = new Client({ name: "lifecycle-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const releases: Array<() => void> = [];
  const requests: Array<ReturnType<Client["callTool"]>> = [];
  context.after(async () => {
    for (const release of releases) release();
    await client.close();
    await server.close();
    await Promise.allSettled(requests);
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    server,
    service,
    workspace: service.root,
    block() {
      const gate = deferred();
      releases.push(gate.resolve);
      return gate;
    },
    call(name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) {
      const request = client.callTool({ name, arguments: { workspace: service.root, ...args } }, undefined, {
        timeout: 3_000,
        ...(signal === undefined ? {} : { signal }),
      });
      requests.push(request);
      void request.catch(() => undefined);
      return request;
    },
  };
}

test("unknown no-argument and raw-shape arguments never invoke the service", { timeout: 10_000 }, async (context) => {
  let calls = 0;
  const { client, workspace } = await connect(context, {
    status: async () => {
      calls += 1;
      throw new Error("status must not run");
    },
    render: async () => {
      calls += 1;
      return "# Status";
    },
  });
  for (const request of [
    { name: "status", arguments: { workspace, unexpected: true } },
    { name: "render", arguments: { workspace, kind: "status", unexpected: true } },
  ]) {
    assert.equal((await client.callTool(request)).isError, true);
  }
  assert.equal(calls, 0);
});

test("a cancelled queued mutation never starts and the queue remains usable", { timeout: 10_000 }, async (context) => {
  const entered = deferred();
  let mutations = 0;
  const session = await connect(context, {
    render: async () => {
      entered.resolve();
      await release.promise;
      return "# Status";
    },
    recordInput: async (submission) => {
      mutations += 1;
      return { recorded: true, requestId: submission.requestId };
    },
    listProjects: async () => [],
  });
  const release = session.block();
  const active = session.call("render", { kind: "status" });
  await entered.promise;
  const cancellation = new AbortController();
  const queued = session.call("recordInput", input, cancellation.signal);
  await session.client.ping();
  assert.equal(mutations, 0);
  const rejected = assert.rejects(queued, /queued cancellation/);
  cancellation.abort(new Error("queued cancellation"));
  await rejected;
  await session.client.ping();
  release.resolve();
  assertSuccess("render", await active);
  assert.deepEqual(assertSuccess("projectList", await session.call("projectList")), { projects: [] });
  assert.equal(mutations, 0);
});

test(
  "cancelling an active mutation allows one commit without automatic retry",
  { timeout: 10_000 },
  async (context) => {
    const entered = deferred();
    let starts = 0;
    let commits = 0;
    const session = await connect(context, {
      recordInput: async (submission) => {
        assert.deepEqual(submission, input);
        starts += 1;
        entered.resolve();
        await release.promise;
        commits += 1;
        return { recorded: true, requestId: submission.requestId };
      },
      listProjects: async () => [],
    });
    const release = session.block();
    const cancellation = new AbortController();
    const active = session.call("recordInput", input, cancellation.signal);
    await entered.promise;
    const rejected = assert.rejects(active, /active cancellation/);
    cancellation.abort(new Error("active cancellation"));
    await rejected;
    await session.client.ping();
    assert.equal(commits, 0);
    const following = session.call("projectList");
    release.resolve();
    assertSuccess("projectList", await following);
    assert.equal(starts, 1);
    assert.equal(commits, 1);
  },
);

test(
  "disconnect rejects callers, cancels queued mutations, and lets active work settle",
  { timeout: 10_000 },
  async (context) => {
    const entered = deferred();
    const committed = deferred();
    const starts: string[] = [];
    const commits: string[] = [];
    const session = await connect(context, {
      recordInput: async (submission) => {
        starts.push(submission.requestId);
        if (submission.requestId === input.requestId) {
          entered.resolve();
          await release.promise;
        }
        commits.push(submission.requestId);
        committed.resolve();
        return { recorded: true, requestId: submission.requestId };
      },
    });
    const release = session.block();
    const active = session.call("recordInput", input);
    await entered.promise;
    const queued = session.call("recordInput", { ...input, requestId: "queued-request" });
    await session.client.ping();
    const disconnected = Promise.all([
      assert.rejects(active, /Connection closed/i),
      assert.rejects(queued, /Connection closed/i),
    ]);
    await session.client.close();
    await disconnected;
    assert.deepEqual(commits, []);
    release.resolve();
    await committed.promise;
    await nextTurn();
    assert.deepEqual(starts, [input.requestId]);
    assert.deepEqual(commits, [input.requestId]);
  },
);

test(
  "the 32-call bound returns a sanitized error and recovers after draining",
  { timeout: 10_000 },
  async (context) => {
    const entered = deferred();
    let reads = 0;
    const session = await connect(context, {
      render: async () => {
        entered.resolve();
        await release.promise;
        return "# Status";
      },
      listProjects: async () => {
        reads += 1;
        return [];
      },
    });
    const release = session.block();
    const active = session.call("render", { kind: "status" });
    await entered.promise;
    const flooded = Array.from({ length: 32 }, () => session.call("projectList"));
    assertError(
      await flooded[31]!,
      "APEX_CONFLICT",
      "The operation conflicts with current state; refresh status before retrying.",
    );
    assert.equal(reads, 0);
    release.resolve();
    assertSuccess("render", await active);
    for (const response of await Promise.all(flooded.slice(0, 31))) {
      assert.deepEqual(assertSuccess("projectList", response), { projects: [] });
    }
    assert.equal(reads, 31);
    assertSuccess("projectList", await session.call("projectList"));
    assert.equal(reads, 32);
  },
);

test("concurrent staging bundles run sequentially without interleaving", { timeout: 10_000 }, async (context) => {
  const entered = deferred();
  const order: string[] = [];
  const session = await connect(context, {
    stageArtifact: async (taskId, output) => {
      order.push(`${taskId}:${output.kind}:start`);
      if (taskId === "first" && output.kind === "requirements") {
        entered.resolve();
        await release.promise;
      }
      order.push(`${taskId}:${output.kind}:commit`);
      return staged(taskId, output);
    },
  });
  const release = session.block();
  const outputs = [
    { kind: "requirements", value: {} },
    { kind: "architecture", value: {} },
  ];
  const first = session.call("stageArtifact", { taskId: "first", outputs });
  await entered.promise;
  const second = session.call("stageArtifact", { taskId: "second", outputs });
  await session.client.ping();
  assert.deepEqual(order, ["first:requirements:start"]);
  release.resolve();
  for (const response of await Promise.all([first, second])) assertSuccess("stageArtifact", response);
  assert.deepEqual(order, [
    "first:requirements:start",
    "first:requirements:commit",
    "first:architecture:start",
    "first:architecture:commit",
    "second:requirements:start",
    "second:requirements:commit",
    "second:architecture:start",
    "second:architecture:commit",
  ]);
});

test(
  "bundle staging is not transactional: a later failure preserves earlier artifacts without retry",
  { timeout: 10_000 },
  async (context) => {
    const persisted: string[] = [];
    const attempts: string[] = [];
    const session = await connect(context, {
      stageArtifact: async (taskId, output) => {
        attempts.push(output.kind);
        if (output.kind === "architecture") throw new Error("private path /workspace/secret-artifact.json");
        persisted.push(output.kind);
        return staged(taskId, output);
      },
      listProjects: async () => [],
    });
    const response = await session.call("stageArtifact", {
      taskId: "task-1",
      outputs: [
        { kind: "requirements", value: {} },
        { kind: "architecture", value: {} },
        { kind: "implementation-intent", value: {} },
      ],
    });
    assertError(response, "APEX_INTERNAL", "APEX could not complete the operation.");
    assertSuccess("projectList", await session.call("projectList"));
    assert.deepEqual(attempts, ["requirements", "architecture"]);
    assert.deepEqual(persisted, ["requirements"]);
  },
);

test(
  "requests over 4 MiB are rejected by byte size before service invocation",
  { timeout: 10_000 },
  async (context) => {
    let calls = 0;
    const session = await connect(context, {
      stageArtifact: async (taskId, output) => {
        calls += 1;
        return staged(taskId, output);
      },
      listProjects: async () => [],
    });
    const value = "\u00e9".repeat(2 * 1024 * 1024);
    const response = await session.call("stageArtifact", { taskId: "task-1", kind: "requirements", value });
    assertError(
      response,
      "APEX_VALIDATION",
      "APEX validation failed; check the supplied input against the current task contract.",
    );
    assert.equal(calls, 0);
    assertSuccess("projectList", await session.call("projectList"));
  },
);

test("service validation reasons reach the agent while other errors stay generic", async (context) => {
  const session = await connect(context, {
    status: async () => {
      throw new ApexError("APEX_VALIDATION", "REQ-002 needs a SKU decision", EXIT_CODES.validation);
    },
    capabilityList: async () => {
      throw new ApexError("APEX_VALIDATION", "architecture validation failed", EXIT_CODES.validation, [
        { path: "/components/0/requirementIds", message: "Expected required property" },
        { path: "/components/0/requirementIds", message: "Expected array" },
      ]);
    },
    listProjects: async () => {
      throw new ApexError("APEX_CONFLICT", "private detail", EXIT_CODES.conflict);
    },
  });
  assertError(await session.call("status"), "APEX_VALIDATION", "REQ-002 needs a SKU decision");
  assertError(
    await session.call("capabilityList"),
    "APEX_VALIDATION",
    "architecture validation failed: /components/0/requirementIds Expected required property",
  );
  assertError(
    await session.call("projectList"),
    "APEX_CONFLICT",
    "The operation conflicts with current state; refresh status before retrying.",
  );
});

test("input schema failures name the failing paths without invoking the service", async (context) => {
  let calls = 0;
  const session = await connect(context, {
    completeReview: async () => {
      calls += 1;
      throw new Error("completeReview must not run");
    },
  });
  const response = await session.call("reviewComplete", {
    taskId: "task-1",
    findings: [{ id: "FINDING-001", severity: "urgent", title: "t", detail: "d" }],
  });
  assert.equal(calls, 0);
  assert.equal(response.isError, true);
  const { error } = response.structuredContent as { error: { code: string; message: string } };
  assert.equal(error.code, "APEX_VALIDATION");
  assert.match(error.message, /^Invalid tool arguments: \/findings\/0\/severity /u);
});

test("single-service MCP servers fail closed when the workspace resolves elsewhere", async (context) => {
  let calls = 0;
  const session = await connect(context, {
    status: async () => {
      calls += 1;
      throw new Error("status must not run for mismatched workspace");
    },
  });
  const otherWorkspace = await tempRoot();
  const response = await session.client.callTool({ name: "status", arguments: { workspace: otherWorkspace } });
  assert.equal(response.isError, true);
  const { error } = response.structuredContent as { error: { code: string; message: string } };
  assert.equal(error.code, "APEX_WORKSPACE_UNSUPPORTED");
  assert.match(error.message, /bound to/u);
  assert.equal(calls, 0);
});

test("review criteria without findingIds reach the service as an empty list", async (context) => {
  let received: unknown;
  const session = await connect(context, {
    completeReview: async (_taskId, _findings, criteria) => {
      received = criteria;
      throw new ApexError("APEX_CONFLICT", "stop after capture", EXIT_CODES.conflict);
    },
  });
  await session.call("reviewComplete", {
    taskId: "task-1",
    findings: [],
    criteria: [{ criterionId: "security", outcome: "pass", rationale: "Private endpoints only." }],
  });
  assert.deepEqual(received, [
    { criterionId: "security", outcome: "pass", rationale: "Private endpoints only.", findingIds: [] },
  ]);
  const reviewComplete = (await session.client.listTools()).tools.find(({ name }) => name === "reviewComplete")!;
  const criterion = (reviewComplete.inputSchema.properties as { criteria: { items: { required?: string[] } } }).criteria
    .items;
  assert.equal(criterion.required?.includes("findingIds"), false);
});

test("repeated validation issues are grouped by field with a count", async (context) => {
  const session = await connect(context, {
    status: async () => {
      throw new ApexError("APEX_VALIDATION", "architectureComplete found 4 problems", EXIT_CODES.validation, [
        ...[0, 1, 2].map((index) => ({
          path: `/architecture/decisionRecords/0/alternatives/${index}/benefits`,
          message: "Expected string",
        })),
        { path: "/policyMappings/4/propertyPath", message: "Expected required property" },
      ]);
    },
  });
  assertError(
    await session.call("status"),
    "APEX_VALIDATION",
    "architectureComplete found 4 problems: /architecture/decisionRecords/*/alternatives/*/benefits Expected string (3 places); /policyMappings/4/propertyPath Expected required property",
  );
});

test("raw governance baseline rejections reach the agent with their hint", async (context) => {
  const session = await connect(context, {
    nextTask: async () => {
      throw new GovernanceBaselineError("incomplete");
    },
    status: async () => {
      throw new GovernanceBaselineError("stale");
    },
  });
  const incomplete = await session.call("nextTask");
  assert.equal(incomplete.isError, true);
  const { error } = incomplete.structuredContent as { error: { code: string; message: string } };
  assert.equal(error.code, "APEX_VALIDATION");
  assert.match(error.message, /^Governance baseline rejected: incomplete: .*-IncludeDescendants/u);
  assertError(
    await session.call("status"),
    "APEX_STALE",
    "Governance baseline rejected: stale: the baseline is too old; collect a fresh baseline",
  );
});

test("oversized malformed arguments hit the size guard before schema parsing", { timeout: 10_000 }, async (context) => {
  let calls = 0;
  const session = await connect(context, {
    status: async () => {
      calls += 1;
      throw new Error("status must not run");
    },
    listProjects: async () => [],
  });
  const response = await session.call("status", { unexpected: "x".repeat(4 * 1024 * 1024) });
  assert.equal(calls, 0);
  assertError(
    response,
    "APEX_VALIDATION",
    "APEX validation failed; check the supplied input against the current task contract.",
  );
  assertSuccess("projectList", await session.call("projectList"));
});

test("deeply nested unknown artifact values are rejected before staging", { timeout: 10_000 }, async (context) => {
  let calls = 0;
  const session = await connect(context, {
    stageArtifact: async (taskId, output) => {
      calls += 1;
      return staged(taskId, output);
    },
    listProjects: async () => [],
  });
  let value: unknown = {};
  for (let depth = 0; depth < 256; depth += 1) value = { nested: value };
  const response = await session.call("stageArtifact", { taskId: "task-1", kind: "requirements", value });
  assert.equal(calls, 0, "the depth guard must run before stageArtifact");
  assertError(
    response,
    "APEX_VALIDATION",
    "APEX validation failed; check the supplied input against the current task contract.",
  );
  assertSuccess("projectList", await session.call("projectList"));
});

test("queued wait expiration prevents late mutations without aborting active work", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
  const entered = deferred();
  let mutations = 0;
  const session = await connect(
    context,
    {
      render: async () => {
        entered.resolve();
        await release.promise;
        return "# Status";
      },
      recordInput: async (submission) => {
        mutations += 1;
        return { recorded: true, requestId: submission.requestId };
      },
    },
    { queueTimeoutMs: 100 },
  );
  const release = session.block();
  const active = session.call("render", { kind: "status" });
  await entered.promise;
  const queued = session.call("recordInput", input);
  await session.client.ping();
  context.mock.timers.tick(101);
  assert.equal((await queued).isError, true);
  assert.equal(mutations, 0);
  const replacement = session.call("recordInput", input);
  await session.client.ping();
  release.resolve();
  assertSuccess("render", await active);
  assertSuccess("recordInput", await replacement);
  assert.equal(mutations, 1);
});

test("per-connection rate limit rejects work and resets without replay", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1_000 });
  let calls = 0;
  const session = await connect(context, {
    listProjects: async () => {
      calls += 1;
      return [];
    },
  });
  for (let index = 0; index < 240; index += 1) assertSuccess("projectList", await session.call("projectList"));
  assert.equal((await session.call("projectList")).isError, true);
  assert.equal(calls, 240);
  context.mock.timers.tick(60_000);
  assertSuccess("projectList", await session.call("projectList"));
  assert.equal(calls, 241);
});

test("cancelled waiters release capacity before the active operation settles", async (context) => {
  const entered = deferred();
  const session = await connect(context, {
    render: async () => {
      entered.resolve();
      await release.promise;
      return "# Status";
    },
    listProjects: async () => [],
  });
  const release = session.block();
  const active = session.call("render", { kind: "status" });
  await entered.promise;
  const controller = new AbortController();
  const queued = Array.from({ length: 31 }, () => session.call("projectList", {}, controller.signal));
  await session.client.ping();
  controller.abort();
  await Promise.allSettled(queued);
  await session.client.ping();
  const replacement = session.call("projectList");
  await session.client.ping();
  release.resolve();
  assertSuccess("render", await active);
  assertSuccess("projectList", await replacement);
});

test(
  "real stdio CLI negotiates 2025-11-25, lists tools, reads status, and exits cleanly",
  { timeout: 20_000 },
  async (context) => {
    const root = await tempRoot();
    const service = new ApexService(root, {
      executableChecker: async () => false,
      azureAuthStatus: async () => ({ authenticated: false, detail: "Offline lifecycle test" }),
    });
    await service.init({ projectId: "lifecycle", riskOwner: "partner" });
    const expected = await service.status();
    const client = new Client({ name: "stdio-lifecycle-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../cli.js", import.meta.url)), "mcp", "serve"],
      cwd: root,
      stderr: "pipe",
    });
    const exited = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();
    let stdout = "";
    let stderr = "";
    let negotiated: unknown;
    const errors: Error[] = [];
    const start = transport.start.bind(transport);
    context.mock.method(transport, "start", async () => {
      await start();
      const child = Reflect.get(transport, "_process") as ChildProcess;
      assert.ok(child.pid);
      child.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.once("exit", (code, signal) => exited.resolve({ code, signal }));
    });
    transport.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    transport.onmessage = (message) => {
      if ("result" in message && "protocolVersion" in message.result) negotiated = message.result.protocolVersion;
    };
    client.onerror = (error) => {
      errors.push(error);
    };
    context.after(async () => {
      await client.close();
      await transport.close();
    });
    await client.connect(transport, { timeout: 5_000, signal: context.signal });
    assert.ok(SUPPORTED_PROTOCOL_VERSIONS.includes("2025-11-25"));
    assert.equal(negotiated, "2025-11-25");
    assert.equal(client.getServerVersion()?.name, "apex");
    const { tools } = await client.listTools();
    assert.equal(tools.length, Object.keys(MCP_OUTPUT_SCHEMAS).length);
    assert.ok(tools.every((tool) => tool.outputSchema?.type === "object"));
    const response = await client.callTool({ name: "status", arguments: { workspace: root } });
    assert.deepEqual(assertSuccess("status", response), expected);
    await client.close();
    assert.deepEqual(await exited.promise, { code: 0, signal: null }, stderr);
    assert.equal(transport.pid, null);
    assert.deepEqual(errors, [], stderr);
    const lines = stdout.trimEnd().split("\n");
    assert.equal(lines.length, 3, stdout);
    for (const line of lines) JSONRPCMessageSchema.parse(JSON.parse(line));
  },
);

test("invalid staging forms are rejected before staging", { timeout: 10_000 }, async (context) => {
  let calls = 0;
  const { client, workspace } = await connect(context, {
    stageArtifact: async () => {
      calls += 1;
      throw new Error("stageArtifact must not run");
    },
  });
  const output = { kind: "requirements", value: {} };
  const invalid: Record<string, unknown>[] = [
    {},
    { outputs: [] },
    { ...output, outputs: [output] },
    { summary: "mixed", outputs: [output] },
    { outputs: [output, output] },
    { kind: "requirements" },
    { value: {} },
    { summary: "missing kind/value" },
    { outputs: [{ kind: "requirements" }] },
    { outputs: [{ value: {} }] },
    { ...output, unexpected: true },
  ];
  for (const args of invalid) {
    const response = await client.callTool({
      name: "stageArtifact",
      arguments: { workspace, taskId: "task-1", ...args },
    });
    assert.equal(response.isError, true, JSON.stringify(args));
  }
  assert.equal(calls, 0);
});

test("MCP serve finds the APEX workspace from a subdirectory without leaving the repository", async () => {
  const root = await tempRoot();
  await mkdir(join(root, ".git"));
  await mkdir(join(root, ".apex"));
  await mkdir(join(root, "infra", "bicep"), { recursive: true });
  assert.equal(await mcpWorkspaceRoot(join(root, "infra", "bicep")), root);
  assert.equal(await mcpWorkspaceRoot(root), root);
  const nested = join(root, "nested");
  await mkdir(join(nested, ".git"), { recursive: true });
  await mkdir(join(nested, "sub"));
  assert.equal(await mcpWorkspaceRoot(join(nested, "sub")), join(nested, "sub"));
  const linked = await tempRoot();
  await mkdir(join(linked, ".git"));
  await mkdir(join(linked, "sub"));
  await symlink(join(root, ".apex"), join(linked, ".apex"));
  assert.equal(await mcpWorkspaceRoot(join(linked, "sub")), join(linked, "sub"));
  const outside = await tempRoot();
  assert.equal(await mcpWorkspaceRoot(outside), outside);
});

test("MCP workspace resolution shares APEX state across git worktrees and enforces one writer", async (context) => {
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

  const now = { value: new Date("2026-01-01T00:00:00.000Z") };
  const canonicalMain = await realpath(main);
  const canonicalWorktree = await realpath(worktree);
  const cache = new Map<string, ApexService>();
  const serviceFor = (workspaceRoot: string) => {
    let service = cache.get(workspaceRoot);
    if (service === undefined) {
      service = new ApexService(workspaceRoot, {
        clock: () => now.value,
        writerLeaseTtlMs: 1_000,
        executableChecker: async () => false,
        azureAuthStatus: async () => ({ authenticated: false, detail: "Offline lifecycle test" }),
      });
      cache.set(workspaceRoot, service);
    }
    return service;
  };
  const resolvedMain = await resolveMcpWorkspace(main);
  const resolvedWorktree = await resolveMcpWorkspace(worktree);
  assert.equal(resolvedMain.root, canonicalMain);
  assert.equal(resolvedMain.workspace, canonicalMain);
  assert.equal(resolvedWorktree.root, canonicalMain);
  assert.equal(resolvedWorktree.workspace, canonicalWorktree);
  const resolver: McpServiceResolver = {
    defaultService: serviceFor(main),
    resolve: async (workspace) => {
      const resolved = await resolveMcpWorkspace(workspace);
      return { service: serviceFor(resolved.root), workspace: resolved.workspace };
    },
  };
  await serviceFor(main).init({ projectId: "demo", riskOwner: "partner" });
  const server = createMcpServer(resolver);
  const client = new Client({ name: "worktree-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  context.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const worktreeStatus = assertSuccess(
    "status",
    await client.callTool({ name: "status", arguments: { workspace: worktree } }),
  ) as { run: { projectId: string } };
  assert.equal(worktreeStatus.run.projectId, "demo");
  assertError(
    await client.callTool({ name: "nextTask", arguments: { workspace: worktree } }),
    "APEX_WRITER_CONFLICT",
    "Run writer lease is held by " +
      `${canonicalMain} until 2026-01-01T00:00:01.000Z; retry from that worktree, release the writer lease there, or wait for it to expire`,
  );
  assert.equal((await client.callTool({ name: "projectList", arguments: { workspace: worktree } })).isError, undefined);
  now.value = new Date("2026-01-01T00:00:01.001Z");
  let issued = assertSuccess(
    "nextTask",
    await client.callTool({ name: "nextTask", arguments: { workspace: worktree } }),
  ) as {
    status: string;
    request?: {
      requestId: string;
      expectedHead: string;
      ownerEpoch: number;
      questions: Array<{
        id: string;
        multiSelect?: boolean;
        options?: string[];
        valueType?: string;
      }>;
    };
    task?: { taskId: string };
  };
  for (let index = 0; issued.status === "needs_input" && index < 10; index += 1) {
    assert.ok(issued.request);
    assertSuccess(
      "recordInput",
      await client.callTool({
        name: "recordInput",
        arguments: {
          workspace: worktree,
          schemaVersion: "1.0.0",
          requestId: issued.request.requestId,
          expectedHead: issued.request.expectedHead,
          ownerEpoch: issued.request.ownerEpoch,
          answers: issued.request.questions.map(({ id, multiSelect, options, valueType }) => ({
            questionId: id,
            value:
              valueType === "budget"
                ? { kind: "budget", amount: 250, currency: "USD", cadence: "monthly" }
                : valueType === "recovery"
                  ? { kind: "recovery", rtoMinutes: 60, rpoMinutes: 15 }
                  : valueType === "data-classification"
                    ? { kind: "data-classification", classification: "internal" }
                    : valueType === "compliance"
                      ? { kind: "compliance", scopes: ["gdpr"] }
                      : options === undefined
                        ? `test-${id}`
                        : multiSelect === true
                          ? [options[0]!]
                          : options[0]!,
          })),
        },
      }),
    );
    issued = assertSuccess(
      "nextTask",
      await client.callTool({ name: "nextTask", arguments: { workspace: worktree } }),
    ) as typeof issued;
  }
  assert.equal(issued.status, "task");
  assert.ok(issued.task?.taskId);
  assertError(
    await client.callTool({
      name: "stageArtifact",
      arguments: {
        workspace: main,
        taskId: issued.task.taskId,
        kind: "requirements",
        value: requirements("demo"),
      },
    }),
    "APEX_WRITER_CONFLICT",
    "Run writer lease is held by " +
      `${canonicalWorktree} until 2026-01-01T00:00:02.001Z; retry from that worktree, release the writer lease there, or wait for it to expire`,
  );
  await assert.rejects(readdir(join(main, ".apex", "work")), { code: "ENOENT" });

  const missing = await client.callTool({ name: "status", arguments: {} });
  assert.equal(missing.isError, true);
  assert.match(JSON.stringify(missing.structuredContent), /\/workspace/u);
  const relative = await client.callTool({ name: "status", arguments: { workspace: "relative" } });
  assert.equal(relative.isError, true);
  assert.match(JSON.stringify(relative.structuredContent), /\/workspace/u);
});
