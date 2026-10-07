import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import test, { type TestContext } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { isJSONRPCResultResponse, type Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mcpWorkspaceRoot, resolveMcpWorkspace } from "../cli.js";
import { MCP_OUTPUT_SCHEMAS } from "../mcp-output-schemas.js";
import { MCP_MAX_SERIALIZED_RESULT_BYTES, MCP_SERVER_INSTRUCTIONS, type McpServiceResolver } from "../mcp.js";
import { ApexError, EXIT_CODES } from "../errors.js";
import { GovernanceBaselineError } from "@apexops/capabilities";
import { ApexService } from "../service.js";
import { requirements, tempRoot } from "./helpers.js";
import { MCP_PROTOCOL_VERSION, connectMcp, modernMcpClient } from "./mcp-client.js";

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
  const structured = response.structuredContent as {
    error?: { code?: string; message?: string; remediation?: string };
  };
  assert.equal(structured.error?.code, code);
  assert.equal(structured.error?.message, message);
  assert.equal(typeof structured.error?.remediation, "string");
  assert.notEqual(structured.error?.remediation, "");
  assert.deepEqual(response.content, [{ type: "text", text: JSON.stringify(response.structuredContent) }]);
  return structured.error;
}

function resultEnvelopeBytes(structuredContent: Record<string, unknown>): number {
  const text = JSON.stringify(structuredContent);
  return Buffer.byteLength(JSON.stringify({ content: [{ type: "text", text }], structuredContent }), "utf8");
}

async function connect(
  context: TestContext,
  overrides: Partial<ApexService> = {},
  options: { queueTimeoutMs?: number } = {},
) {
  const service = Object.assign(new ApexService(await tempRoot()), overrides);
  const { client, close } = await connectMcp(service, { ...options, name: "lifecycle-test" });
  const releases: Array<() => void> = [];
  const requests: Array<ReturnType<Client["callTool"]>> = [];
  context.after(async () => {
    for (const release of releases) release();
    await close();
    await Promise.allSettled(requests);
  });
  return {
    client,
    service,
    workspace: service.root,
    // 2026-07-28 removed ping; a tools/list round trip orders the connection the same way.
    async flush() {
      await client.listTools();
    },
    block() {
      const gate = deferred();
      releases.push(gate.resolve);
      return gate;
    },
    call(name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) {
      const request = client.callTool(
        { name, arguments: { workspace: service.root, ...args } },
        {
          timeout: 3_000,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      requests.push(request);
      void request.catch(() => undefined);
      return request;
    },
  };
}

test("2026-07-28 discovery includes compact APEX server instructions", async (context) => {
  const { client } = await connect(context);
  assert.equal(client.getNegotiatedProtocolVersion(), MCP_PROTOCOL_VERSION);
  assert.equal(client.getDiscoverResult()?.instructions, MCP_SERVER_INSTRUCTIONS);
  assert.equal(client.getInstructions(), MCP_SERVER_INSTRUCTIONS);
  assert.match(MCP_SERVER_INSTRUCTIONS, /Every tool call must include workspace/u);
  assert.match(MCP_SERVER_INSTRUCTIONS, /nextCursor/u);
});

test("tools/list matches the v1 SDK tool baseline exactly", async (context) => {
  // Captured from the @modelcontextprotocol/sdk 1.32.1 server at bfbc11a5; regenerate deliberately with
  // APEX_UPDATE_MCP_TOOLS_FIXTURE=1 when a tool contract changes on purpose.
  const fixture = new URL("../../src/test/fixtures/mcp-tools-list.json", import.meta.url);
  const { client } = await connect(context);
  const { tools } = await client.listTools();
  if (process.env.APEX_UPDATE_MCP_TOOLS_FIXTURE === "1")
    await writeFile(fixture, `[\n${tools.map((tool) => JSON.stringify(tool)).join(",\n")}\n]\n`);
  assert.deepEqual(tools, JSON.parse(await readFile(fixture, "utf8")));
});

test("unknown tool names return the APEX usage error envelope", async (context) => {
  const session = await connect(context);
  assert.match(
    assertError(
      await session.call("noSuchTool"),
      "APEX_USAGE",
      "Unknown tool noSuchTool; call tools/list for available tools",
    ).remediation!,
    /input schema/u,
  );
  assertError(
    await session.client.callTool({ name: "../not a tool", arguments: {} }),
    "APEX_USAGE",
    "Unknown tool; call tools/list for available tools",
  );
});

test("MCP errors include structured remediation for stable error classes", async (context) => {
  const failures = [
    new ApexError("APEX_STALE", "expired expected head", EXIT_CODES.stale),
    new ApexError("APEX_VALIDATION", "schema failed", EXIT_CODES.validation),
    new ApexError("APEX_WRITER_CONFLICT", "writer lease is owned elsewhere", EXIT_CODES.conflict),
    new ApexError("APEX_INTERNAL", "private stack frame", EXIT_CODES.internal, {
      remediation: "read /home/private/secret.txt",
    }),
  ];
  const session = await connect(context, {
    workspaceStatus: async () => {
      throw failures.shift()!;
    },
  });
  assert.match(
    assertError(await session.call("status"), "APEX_STALE", "Task is stale or expired; refresh status before retrying.")
      .remediation!,
    /Call status/u,
  );
  assert.match(
    assertError(await session.call("status"), "APEX_VALIDATION", "schema failed").remediation!,
    /Correct the validation issues/u,
  );
  assert.match(
    assertError(await session.call("status"), "APEX_WRITER_CONFLICT", "writer lease is owned elsewhere").remediation!,
    /owning worktree/u,
  );
  const internal = await session.call("status");
  assert.match(
    assertError(internal, "APEX_INTERNAL", "APEX could not complete the operation.").remediation!,
    /server log/u,
  );
  assert.doesNotMatch(JSON.stringify(internal), /private stack frame|\/home\/private|secret\.txt/u);
  const otherWorkspace = await tempRoot();
  const unsupported = await session.client.callTool({ name: "status", arguments: { workspace: otherWorkspace } });
  assert.equal(unsupported.isError, true);
  const unsupportedError = (
    unsupported.structuredContent as {
      error: { code: string; message: string; remediation: string };
    }
  ).error;
  assert.equal(unsupportedError.code, "APEX_WORKSPACE_UNSUPPORTED");
  assert.match(unsupportedError.message, /bound to/u);
  assert.match(unsupportedError.remediation, /supported APEX checkout/u);
});

test("pageable read tools traverse large results with opaque cursors", async (context) => {
  const projects = Array.from({ length: 160 }, (_, index) => ({
    projectId: `project-${index}`,
    displayName: `Project ${index} ${"x".repeat(900)}`,
  }));
  const session = await connect(context, {
    listProjects: async () => projects,
  });
  const collected = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = assertSuccess(
      "projectList",
      await session.call("projectList", cursor === undefined ? {} : { cursor }),
    ) as { projects: typeof projects; nextCursor?: string };
    assert.ok(resultEnvelopeBytes(page) <= MCP_MAX_SERIALIZED_RESULT_BYTES);
    collected.push(...page.projects);
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor !== undefined);
  assert.ok(pages > 1);
  assert.deepEqual(collected, projects);
});

test("large markdown read results are paged and reconstruct the full document", async (context) => {
  const markdown = `# Status\n\n${"detail ".repeat(20_000)}`;
  const session = await connect(context, {
    render: async () => markdown,
  });
  let rebuilt = "";
  let cursor: string | undefined;
  do {
    const page = assertSuccess(
      "render",
      await session.call("render", { kind: "status", ...(cursor === undefined ? {} : { cursor }) }),
    ) as { markdown: string; nextCursor?: string };
    assert.ok(resultEnvelopeBytes(page) <= MCP_MAX_SERIALIZED_RESULT_BYTES);
    rebuilt += page.markdown;
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  assert.equal(rebuilt, markdown);
});

test("paging cursors fail closed when tampered, stale, or bound elsewhere", async (context) => {
  let extraProject = false;
  const projects = () => [
    ...Array.from({ length: 120 }, (_, index) => ({
      projectId: `project-${index}`,
      displayName: `Project ${index} ${"x".repeat(900)}`,
    })),
    ...(extraProject ? [{ projectId: "project-extra", displayName: "extra" }] : []),
  ];
  const workspaceA = await tempRoot();
  const workspaceB = await tempRoot();
  const service = Object.assign(new ApexService(workspaceA), {
    listProjects: async () => projects(),
    improvementObservations: async () => [],
  });
  const { client, close } = await connectMcp(
    {
      defaultService: service,
      resolve: async (workspace) => ({ service, workspace }),
    },
    { name: "cursor-test" },
  );
  context.after(close);
  const first = assertSuccess(
    "projectList",
    await client.callTool({ name: "projectList", arguments: { workspace: workspaceA } }),
  ) as { projects: Array<{ projectId: string; displayName: string }>; nextCursor?: string };
  assert.ok(first.nextCursor);

  const tampered = `${first.nextCursor.startsWith("a") ? "b" : "a"}${first.nextCursor.slice(1)}`;
  assertError(
    await client.callTool({ name: "projectList", arguments: { workspace: workspaceA, cursor: tampered } }),
    "APEX_CURSOR_INVALID",
    "Cursor is invalid for this tool, workspace, or server session.",
  );
  assertError(
    await client.callTool({
      name: "projectList",
      arguments: { workspace: workspaceA, cursor: `${first.nextCursor}!` },
    }),
    "APEX_CURSOR_INVALID",
    "Cursor is invalid for this tool, workspace, or server session.",
  );
  assertError(
    await client.callTool({
      name: "improvementObservations",
      arguments: { workspace: workspaceA, cursor: first.nextCursor },
    }),
    "APEX_CURSOR_INVALID",
    "Cursor is invalid for this tool, workspace, or server session.",
  );
  assertError(
    await client.callTool({ name: "projectList", arguments: { workspace: workspaceB, cursor: first.nextCursor } }),
    "APEX_CURSOR_INVALID",
    "Cursor is invalid for this tool, workspace, or server session.",
  );
  extraProject = true;
  assertError(
    await client.callTool({ name: "projectList", arguments: { workspace: workspaceA, cursor: first.nextCursor } }),
    "APEX_STALE",
    "Task is stale or expired; refresh status before retrying.",
  );
});

test("oversize non-pageable results fail with a stable remediation error", async (context) => {
  const session = await connect(context, {
    workspaceStatus: async () => ({
      run: {
        schemaVersion: "1.0.0",
        projectId: "demo",
        runId: "run-1",
        environment: "dev",
        targetScope: "local",
        iacTool: "bicep",
        createdAt: "2026-09-18T00:00:00.000Z",
        runtimeLockHash: hash,
        ownerEpoch: 1,
        gates: [],
      },
      head: hash,
      events: 1,
      task: null,
      blockers: ["x".repeat(MCP_MAX_SERIALIZED_RESULT_BYTES + 1)],
    }),
  });
  const error = assertError(
    await session.call("status"),
    "APEX_RESULT_TOO_LARGE",
    "MCP result exceeded the bounded result size and cannot be paged safely.",
  );
  assert.match(error.remediation!, /paging-capable read tool/u);
});

test("paging cursors do not survive an MCP server restart", async (context) => {
  const projects = Array.from({ length: 120 }, (_, index) => ({
    projectId: `project-${index}`,
    displayName: `Project ${index} ${"x".repeat(900)}`,
  }));
  const workspace = await tempRoot();
  const service = Object.assign(new ApexService(workspace), { listProjects: async () => projects });
  const start = async () => {
    const { client, close } = await connectMcp(
      {
        defaultService: service,
        resolve: async (path) => ({ service, workspace: path }),
      },
      { name: "restart-test" },
    );
    context.after(close);
    return (args: Record<string, unknown> = {}) =>
      client.callTool({ name: "projectList", arguments: { workspace, ...args } });
  };
  const before = await start();
  const page = assertSuccess("projectList", await before()) as { nextCursor?: string };
  assert.ok(page.nextCursor);
  const after = await start();
  const error = assertError(
    await after({ cursor: page.nextCursor }),
    "APEX_CURSOR_INVALID",
    "Cursor is invalid for this tool, workspace, or server session.",
  );
  assert.match(error!.remediation!, /without it/u);
  assert.match(error!.remediation!, /restart/u);
  assert.ok((assertSuccess("projectList", await after()) as { nextCursor?: string }).nextCursor);
});

test("only bounded read tools accept cursors and mutations are never paged", async (context) => {
  const pageable = [
    "improvementObservations",
    "improvementProposals",
    "inventory",
    "preview",
    "projectList",
    "readTaskInput",
    "render",
    "taskContext",
  ];
  let created = 0;
  const session = await connect(context, {
    createProject: async () => {
      created += 1;
      throw new Error("must not run");
    },
  });
  const { tools } = await session.client.listTools();
  const hasProperty = (schema: unknown, key: string): boolean => {
    if (schema === null || typeof schema !== "object") return false;
    const record = schema as { properties?: Record<string, unknown>; anyOf?: unknown[] };
    return (
      Object.hasOwn(record.properties ?? {}, key) || (record.anyOf ?? []).some((branch) => hasProperty(branch, key))
    );
  };
  assert.deepEqual(
    tools
      .filter((tool) => hasProperty(tool.inputSchema, "cursor"))
      .map(({ name }) => name)
      .sort(),
    pageable,
  );
  for (const tool of tools)
    assert.equal(hasProperty(tool.outputSchema, "nextCursor"), pageable.includes(tool.name), tool.name);
  const rejected = await session.call("projectCreate", { projectId: "demo", displayName: "Demo", cursor: "abc.def" });
  assert.equal(rejected.isError, true);
  const rejectedError = (rejected.structuredContent as { error: { code: string; message: string } }).error;
  assert.equal(rejectedError.code, "APEX_VALIDATION");
  assert.match(rejectedError.message, /cursor/u);
  assert.equal(created, 0);
});

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
  await session.flush();
  assert.equal(mutations, 0);
  const rejected = assert.rejects(queued, /queued cancellation/);
  cancellation.abort(new Error("queued cancellation"));
  await rejected;
  await session.flush();
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
    await session.flush();
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
    await session.flush();
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
  "a real mutation started before disconnect completes and persists after the transport closes",
  { timeout: 10_000 },
  async (context) => {
    const root = await tempRoot();
    const service = new ApexService(root);
    await service.init({ projectId: "payments", riskOwner: "partner" });
    const entered = deferred();
    const release = deferred();
    const createProject = service.createProject.bind(service);
    let settled: Promise<unknown> | undefined;
    service.createProject = async (projectInput) => {
      entered.resolve();
      await release.promise;
      settled = createProject(projectInput);
      return (await settled) as Awaited<ReturnType<ApexService["createProject"]>>;
    };
    const { client, close } = await connectMcp(service, { name: "disconnect-persistence-test" });
    context.after(close);
    const active = client.callTool({
      name: "projectCreate",
      arguments: {
        workspace: root,
        projectId: "data-platform",
        displayName: "Data platform",
        environment: "dev",
        targetScope: "local",
        iacTool: "terraform",
        riskOwner: "partner",
      },
    });
    await entered.promise;
    const disconnected = assert.rejects(active, /Connection closed/i);
    await close();
    await disconnected;
    release.resolve();
    while (settled === undefined) await nextTurn();
    await settled;
    assert.ok(
      (await new ApexService(root).listProjects()).some(({ projectId }) => projectId === "data-platform"),
      "the started mutation must persist",
    );
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
  await session.flush();
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
  await session.flush();
  context.mock.timers.tick(101);
  assert.equal((await queued).isError, true);
  assert.equal(mutations, 0);
  const replacement = session.call("recordInput", input);
  await session.flush();
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
  await session.flush();
  controller.abort();
  await Promise.allSettled(queued);
  await session.flush();
  const replacement = session.call("projectList");
  await session.flush();
  release.resolve();
  assertSuccess("render", await active);
  assertSuccess("projectList", await replacement);
});

function spawnMcpServe(cwd: string): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [fileURLToPath(new URL("../cli.js", import.meta.url)), "mcp", "serve"], {
    cwd,
    stdio: "pipe",
  });
}

function stdoutMessages(child: ChildProcessWithoutNullStreams) {
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  return async () => {
    const next = await lines.next();
    assert.equal(next.done, false, "MCP server closed stdout before answering");
    return JSON.parse(next.value as string) as Record<string, unknown>;
  };
}

const modernEnvelope = (name: string) => ({
  _meta: {
    "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientInfo": { name, version: "1.0.0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  },
});

test(
  "real stdio CLI serves 2026-07-28 discovery, lists tools, reads status, and exits cleanly",
  { timeout: 30_000 },
  async (context) => {
    const root = await tempRoot();
    const service = new ApexService(root, {
      executableChecker: async () => false,
      azureAuthStatus: async () => ({ authenticated: false, detail: "Offline lifecycle test" }),
    });
    await service.init({ projectId: "lifecycle", riskOwner: "partner" });
    const expected = await service.status();
    const client = modernMcpClient("stdio-lifecycle-test");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../cli.js", import.meta.url)), "mcp", "serve"],
      cwd: root,
      stderr: "pipe",
    });
    const exited = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();
    let stdout = "";
    let stderr = "";
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
    client.onerror = (error) => {
      errors.push(error);
    };
    context.after(async () => {
      await client.close();
      await transport.close();
    });
    // The base stdio transport probes server/discover on a disposable sibling process, then starts this session.
    await client.connect(transport, { timeout: 10_000, signal: context.signal });
    assert.equal(client.getNegotiatedProtocolVersion(), MCP_PROTOCOL_VERSION);
    const discovered = client.getDiscoverResult();
    assert.ok(discovered?.supportedVersions.includes(MCP_PROTOCOL_VERSION), JSON.stringify(discovered));
    assert.equal(discovered?.instructions, MCP_SERVER_INSTRUCTIONS);
    assert.equal(client.getInstructions(), MCP_SERVER_INSTRUCTIONS);
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
    assert.equal(lines.length, 2, stdout);
    for (const line of lines) assert.ok(isJSONRPCResultResponse(JSON.parse(line)), line);
  },
);

test(
  "real stdio CLI answers a Copilot-style discover then 2025-11-25 initialize fallback on one connection",
  { timeout: 30_000 },
  async () => {
    const root = await tempRoot();
    const child = spawnMcpServe(root);
    const exited = once(child, "exit");
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const next = stdoutMessages(child);
    const send = (message: Record<string, unknown>) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    send({ id: 1, method: "server/discover", params: modernEnvelope("copilot-fallback-test") });
    const discovered = await next();
    assert.equal(discovered.id, 1);
    const discoverResult = discovered.result as { supportedVersions: string[]; instructions?: string };
    assert.ok(discoverResult.supportedVersions.includes(MCP_PROTOCOL_VERSION), JSON.stringify(discovered));
    assert.equal(discoverResult.instructions, MCP_SERVER_INSTRUCTIONS);
    send({
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "copilot-fallback-test", version: "1.0.0" },
      },
    });
    const initialized = await next();
    assert.equal(initialized.id, 2);
    assert.equal(initialized.error, undefined, JSON.stringify(initialized));
    const initializeResult = initialized.result as {
      protocolVersion: string;
      serverInfo: { name: string };
      instructions?: string;
    };
    assert.equal(initializeResult.protocolVersion, "2025-11-25");
    assert.equal(initializeResult.serverInfo.name, "apex");
    assert.equal(initializeResult.instructions, MCP_SERVER_INSTRUCTIONS);
    send({ method: "notifications/initialized" });
    send({ id: 3, method: "tools/list" });
    const listed = await next();
    assert.equal(listed.id, 3);
    assert.equal((listed.result as { tools: unknown[] }).tools.length, Object.keys(MCP_OUTPUT_SCHEMAS).length);
    child.stdin.end();
    assert.deepEqual(await exited, [0, null], stderr);
  },
);

test(
  "real stdio CLI closes cleanly on SIGTERM",
  { timeout: 30_000, skip: process.platform === "win32" ? "POSIX signals only" : false },
  async () => {
    const root = await tempRoot();
    const child = spawnMcpServe(root);
    const exited = once(child, "exit");
    const next = stdoutMessages(child);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: modernEnvelope("signal-test") })}\n`,
    );
    assert.equal((await next()).id, 1);
    child.kill("SIGTERM");
    assert.deepEqual(await exited, [0, null]);
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
  const { client, close } = await connectMcp(resolver, { name: "worktree-test" });
  context.after(close);

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
