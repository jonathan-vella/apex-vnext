import assert from "node:assert/strict";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { Client } from "@modelcontextprotocol/client";
import { MCP_OUTPUT_SCHEMAS } from "../mcp-output-schemas.js";
import { MCP_TOOL_EFFECTS } from "../mcp.js";
import { compareRuntimeVersions, workspaceRuntimeBinding, WORKSPACE_RUNTIME_LOCK } from "../runtime-binding.js";
import { ApexService } from "../service.js";
import { APEX_VERSION } from "../version.js";
import { hash, selection, type ToolName } from "./mcp-fixtures.js";
import { tempRoot } from "./helpers.js";
import { connectMcp } from "./mcp-client.js";

type CallResult = Awaited<ReturnType<Client["callTool"]>>;
type ErrorEnvelope = { error?: { code?: string; message?: string; remediation?: string } };

// Minimal arguments that pass each tool's input schema, so every call reaches the workspace runtime binding check.
// The record is keyed by the tool registry type and checked against tools/list, so a new tool cannot skip the check.
const toolArguments: Record<ToolName, Record<string, unknown>> = {
  status: {},
  projectList: {},
  doctorChecks: {},
  capabilityList: {},
  capabilityStatus: { pack: "test" },
  taskContext: { taskId: "task-1" },
  readTaskInput: { taskId: "task-1" },
  preview: {},
  inventory: {},
  diagnose: {},
  render: { kind: "status" },
  improvementObservations: {},
  improvementProposals: {},
  releaseWriter: {},
  nextTask: {},
  recordInput: {
    schemaVersion: "1.0.0",
    requestId: "request-1",
    expectedHead: hash,
    ownerEpoch: 1,
    answers: [{ questionId: "workload", value: "web" }],
  },
  governanceImport: { path: "baseline.json" },
  governanceSelect: { path: "baseline.json" },
  projectCreate: {
    projectId: "other",
    displayName: "Other",
    environment: "dev",
    targetScope: "local",
    iacTool: "bicep",
    riskOwner: "partner",
  },
  projectUse: { projectId: "demo" },
  projectDelete: { projectId: "other", confirm: true },
  gateDecide: { gate: 1, decision: "approved", confirm: true },
  reviewDecide: { reviewHash: hash, decisions: [{ findingId: "f", action: "revise" }] },
  stageArtifact: { taskId: "task-1", kind: "requirements", value: { a: 1 } },
  stageFile: { taskId: "task-1", path: "main.bicep", content: "{}" },
  generateIac: { taskId: "task-1" },
  validateTask: { taskId: "task-1" },
  completeTask: { taskId: "task-1", outputs: [{ kind: "requirements", value: {} }] },
  requirementsComplete: { taskId: "task-1", requirements: {} },
  architectureComplete: {
    taskId: "task-1",
    architecture: {},
    costEstimate: {},
    decisionManifest: {},
    policyMappings: [],
  },
  reviewComplete: { taskId: "task-1" },
  planComplete: {
    taskId: "task-1",
    implementationIntent: {},
    iacBinding: { schemaVersion: "1.0.0", ...selection, track: "bicep", resourceBindings: {} },
    environmentInputs: {},
  },
  reconcile: {},
  promote: { environment: "prod", target: "local" },
  submitEvidence: { taskId: "task-1", kind: "test", value: {} },
  improvementObserve: {
    source: "explicit-correction",
    category: "usability",
    severity: "low",
    statement: "Observation",
    evidenceRefs: [hash],
  },
  doctor: {},
};

const older = "0.0.1";
const newer = "99.0.0";

async function writeLock(root: string, lock: unknown): Promise<void> {
  await mkdir(join(root, ".apex"), { recursive: true });
  await writeFile(join(root, WORKSPACE_RUNTIME_LOCK), typeof lock === "string" ? lock : JSON.stringify(lock));
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[path] = await readFile(path, "utf8");
  }
  return files;
}

/**
 * A real service bound to `root` whose every method records its invocation and fails, so a test can prove whether a
 * tool call reached the service. `setWorkspacePath` only binds the caller's worktree and is not recorded.
 */
function spyService(root: string) {
  const service = new ApexService(root);
  const calls: string[] = [];
  for (const name of Object.getOwnPropertyNames(ApexService.prototype)) {
    if (name === "constructor" || name === "setWorkspacePath") continue;
    if (typeof Reflect.get(service, name) !== "function") continue;
    Object.defineProperty(service, name, {
      configurable: true,
      writable: true,
      value: async () => {
        calls.push(name);
        throw new Error(`service.${name} reached`);
      },
    });
  }
  return { service, calls };
}

async function connect(context: TestContext, service: ApexService) {
  const session = await connectMcp(service, { name: "runtime-binding-test" });
  context.after(session.close);
  return session.client;
}

async function listedTools(client: Client): Promise<ToolName[]> {
  const names = (await client.listTools()).tools.map(({ name }) => name).sort();
  assert.deepEqual(names, Object.keys(toolArguments).sort());
  assert.deepEqual(names, Object.keys(MCP_TOOL_EFFECTS).sort());
  return names as ToolName[];
}

function errorOf(response: CallResult): NonNullable<ErrorEnvelope["error"]> | undefined {
  return response.isError === true ? (response.structuredContent as ErrorEnvelope).error : undefined;
}

const scenarios = [
  {
    label: "an older workspace",
    lock: { cliVersion: older },
    reason: "RUNTIME_WORKSPACE_OLDER",
    workspaceRuntimeVersion: older,
    message: `The workspace runtime lock names @apexops/cli@${older}, older than this APEX runtime @apexops/cli@${APEX_VERSION}`,
    remediation: new RegExp(
      `^Run \`apex update\` in the workspace with @apexops/cli@${APEX_VERSION.replaceAll(".", "\\.")}`,
      "u",
    ),
  },
  {
    label: "a newer workspace",
    lock: { cliVersion: newer },
    reason: "RUNTIME_WORKSPACE_NEWER",
    workspaceRuntimeVersion: newer,
    message: `The workspace runtime lock names @apexops/cli@${newer}, newer than this APEX runtime @apexops/cli@${APEX_VERSION}`,
    remediation: /^Install the APEX plugin or @apexops\/cli version named by the workspace runtime lock/u,
  },
  {
    label: "a lock without cliVersion",
    lock: { schemaVersion: "1.0.0" },
    reason: "RUNTIME_LOCK_INVALID",
    workspaceRuntimeVersion: null,
    message: `The workspace runtime lock ${WORKSPACE_RUNTIME_LOCK} has no valid cliVersion; this APEX runtime is @apexops/cli@${APEX_VERSION}`,
    remediation: /apex doctor --fix --yes/u,
  },
  {
    label: "a malformed lock",
    lock: "{ not json",
    reason: "RUNTIME_LOCK_INVALID",
    workspaceRuntimeVersion: null,
    message: `The workspace runtime lock ${WORKSPACE_RUNTIME_LOCK} has no valid cliVersion; this APEX runtime is @apexops/cli@${APEX_VERSION}`,
    remediation: /apex doctor --fix --yes/u,
  },
] as const;

for (const scenario of scenarios) {
  test(`every MCP tool fails closed on ${scenario.label} and status reports it read-only`, async (context) => {
    const root = await realpath(await tempRoot());
    await writeLock(root, scenario.lock);
    const before = await snapshot(root);
    const { service, calls } = spyService(root);
    const client = await connect(context, service);
    for (const name of await listedTools(client)) {
      const response = await client.callTool({ name, arguments: { workspace: root, ...toolArguments[name] } });
      if (name === "status") {
        assert.notEqual(response.isError, true, JSON.stringify(response.structuredContent));
        assert.equal(MCP_OUTPUT_SCHEMAS.status.safeParse(response.structuredContent).success, true);
        const status = response.structuredContent as Record<string, unknown>;
        assert.deepEqual(Object.keys(status).sort(), [
          "nextAction",
          "reason",
          "runtimeVersion",
          "status",
          "workspaceRuntimeVersion",
        ]);
        assert.equal(status.status, "runtime_mismatch");
        assert.equal(status.reason, scenario.reason);
        assert.equal(status.runtimeVersion, APEX_VERSION);
        assert.equal(status.workspaceRuntimeVersion, scenario.workspaceRuntimeVersion);
        assert.match(String(status.nextAction), scenario.remediation);
      } else {
        const error = errorOf(response);
        assert.equal(error?.code, "APEX_RUNTIME_MISMATCH", `${name}: ${JSON.stringify(response.structuredContent)}`);
        assert.equal(error?.message, scenario.message, name);
        assert.match(error?.remediation ?? "", scenario.remediation, name);
        assert.equal(MCP_OUTPUT_SCHEMAS[name].safeParse(response.structuredContent).success, true, name);
      }
      assert.deepEqual(calls, [], `${name} reached the service`);
    }
    assert.deepEqual(await snapshot(root), before);
  });
}

test("every MCP tool reaches the service when the workspace lock matches this runtime", async (context) => {
  const root = await realpath(await tempRoot());
  await writeLock(root, { cliVersion: APEX_VERSION });
  const { service, calls } = spyService(root);
  const client = await connect(context, service);
  for (const name of await listedTools(client)) {
    calls.length = 0;
    const response = await client.callTool({ name, arguments: { workspace: root, ...toolArguments[name] } });
    assert.notEqual(errorOf(response)?.code, "APEX_RUNTIME_MISMATCH", name);
    assert.notEqual(
      calls.length,
      0,
      `${name} did not reach the service: ${JSON.stringify(response.structuredContent)}`,
    );
  }
});

test("uninitialized workspaces keep their existing behavior", async (context) => {
  const root = await realpath(await tempRoot());
  const spied = spyService(root);
  const spyClient = await connect(context, spied.service);
  for (const name of await listedTools(spyClient)) {
    spied.calls.length = 0;
    const response = await spyClient.callTool({ name, arguments: { workspace: root, ...toolArguments[name] } });
    assert.notEqual(errorOf(response)?.code, "APEX_RUNTIME_MISMATCH", name);
    assert.notEqual(spied.calls.length, 0, `${name} did not reach the service`);
  }

  const client = await connect(context, new ApexService(root));
  const status = await client.callTool({ name: "status", arguments: { workspace: root } });
  assert.equal(errorOf(status)?.code, "APEX_NOT_FOUND", JSON.stringify(status.structuredContent));
});

test("the runtime lock is read on every call, so a fixed workspace recovers without a restart", async (context) => {
  const root = await realpath(await tempRoot());
  await writeLock(root, { cliVersion: older });
  const service = Object.assign(new ApexService(root), {
    listProjects: async () => [{ projectId: "demo", displayName: "Demo" }],
  });
  const client = await connect(context, service);
  const call = () => client.callTool({ name: "projectList", arguments: { workspace: root } });
  assert.equal(errorOf(await call())?.code, "APEX_RUNTIME_MISMATCH");
  await writeLock(root, { cliVersion: APEX_VERSION });
  const recovered = await call();
  assert.notEqual(recovered.isError, true, JSON.stringify(recovered.structuredContent));
  assert.deepEqual(recovered.structuredContent, { projects: [{ projectId: "demo", displayName: "Demo" }] });
  await writeLock(root, { cliVersion: newer });
  assert.equal(errorOf(await call())?.code, "APEX_RUNTIME_MISMATCH");
});

test("an initialized workspace binds to the runtime that initialized it", async () => {
  const root = await tempRoot();
  const service = new ApexService(root, {
    executableChecker: async () => true,
    azureAuthStatus: async () => ({ authenticated: false, detail: "Offline runtime binding test" }),
  });
  await service.initializeWorkspace({});
  const lock = JSON.parse(await readFile(join(root, WORKSPACE_RUNTIME_LOCK), "utf8")) as { cliVersion: string };
  assert.equal(lock.cliVersion, APEX_VERSION);
  assert.deepEqual(await workspaceRuntimeBinding(root), { state: "match", runtimeVersion: APEX_VERSION });

  // `apex update`, the documented fix for an older workspace, is a CLI command outside the MCP check and rebinds it.
  await writeLock(root, { ...lock, cliVersion: older });
  assert.equal((await workspaceRuntimeBinding(root)).state, "mismatch");
  await service.update();
  assert.deepEqual(await workspaceRuntimeBinding(root), { state: "match", runtimeVersion: APEX_VERSION });

  // Doctor repair rewrites a lock that has no readable version.
  await writeLock(root, "{ not json");
  await service.doctor(true, true);
  assert.deepEqual(await workspaceRuntimeBinding(root), { state: "match", runtimeVersion: APEX_VERSION });
});

test("workspace runtime binding classifies locks and fails closed on anything unreadable", async () => {
  const root = await tempRoot();
  assert.deepEqual(await workspaceRuntimeBinding(root), { state: "uninitialized" });
  await mkdir(join(root, ".apex"));
  assert.deepEqual(await workspaceRuntimeBinding(root), { state: "uninitialized" });

  const mismatch = (reason: string, workspaceRuntimeVersion: string | null, runtimeVersion = "1.2.3") => ({
    state: "mismatch",
    reason,
    runtimeVersion,
    workspaceRuntimeVersion,
  });
  const cases: Array<[unknown, unknown]> = [
    [{ cliVersion: "1.2.3" }, { state: "match", runtimeVersion: "1.2.3" }],
    [{ cliVersion: "1.2.2" }, mismatch("RUNTIME_WORKSPACE_OLDER", "1.2.2")],
    [{ cliVersion: "1.2.3-next.9" }, mismatch("RUNTIME_WORKSPACE_OLDER", "1.2.3-next.9")],
    [{ cliVersion: "1.10.0" }, mismatch("RUNTIME_WORKSPACE_NEWER", "1.10.0")],
    [{ cliVersion: "9007199254740993.0.0" }, mismatch("RUNTIME_WORKSPACE_NEWER", "9007199254740993.0.0")],
    [{ cliVersion: "1.2.3+build.1" }, mismatch("RUNTIME_WORKSPACE_NEWER", "1.2.3+build.1")],
    [{}, mismatch("RUNTIME_LOCK_INVALID", null)],
    [{ cliVersion: 123 }, mismatch("RUNTIME_LOCK_INVALID", null)],
    [{ cliVersion: "" }, mismatch("RUNTIME_LOCK_INVALID", null)],
    [{ cliVersion: "latest" }, mismatch("RUNTIME_LOCK_INVALID", null)],
    [{ cliVersion: "01.2.3" }, mismatch("RUNTIME_LOCK_INVALID", null)],
    [{ cliVersion: `1.2.3-${"a".repeat(200)}` }, mismatch("RUNTIME_LOCK_INVALID", null)],
    [[{ cliVersion: "1.2.3" }], mismatch("RUNTIME_LOCK_INVALID", null)],
    ["null", mismatch("RUNTIME_LOCK_INVALID", null)],
    ["{", mismatch("RUNTIME_LOCK_INVALID", null)],
    [JSON.stringify({ cliVersion: "1.2.3", padding: "x".repeat(70_000) }), mismatch("RUNTIME_LOCK_INVALID", null)],
  ];
  for (const [lock, expected] of cases) {
    await writeLock(root, lock);
    assert.deepEqual(await workspaceRuntimeBinding(root, "1.2.3"), expected, JSON.stringify(lock).slice(0, 80));
  }

  const directory = await tempRoot();
  await mkdir(join(directory, WORKSPACE_RUNTIME_LOCK), { recursive: true });
  assert.deepEqual(await workspaceRuntimeBinding(directory, "1.2.3"), mismatch("RUNTIME_LOCK_INVALID", null));
});

test("runtime versions compare by SemVer precedence", () => {
  const ordered = [
    "0.9.9",
    "0.10.0-next.2",
    "0.10.0-next.5",
    "0.10.0-next.10",
    "0.10.0-next.10.1",
    "0.10.0-rc.1",
    "0.10.0",
    "0.10.1",
    "1.0.0",
    "9007199254740992.0.0",
    "9007199254740993.0.0",
    "9007199254740993.0.1-9007199254740992",
    "9007199254740993.0.1-9007199254740993",
    "9007199254740993.0.1",
  ];
  for (const [index, lower] of ordered.slice(0, -1).entries()) {
    const higher = ordered[index + 1]!;
    assert.equal(compareRuntimeVersions(lower, higher), -1, `${lower} < ${higher}`);
    assert.equal(compareRuntimeVersions(higher, lower), 1, `${higher} > ${lower}`);
  }
  assert.equal(compareRuntimeVersions("1.0.0+a", "1.0.0+b"), 0);
  assert.equal(compareRuntimeVersions("1.0.0-1", "1.0.0-alpha"), -1);
  assert.throws(() => compareRuntimeVersions("1.0", "1.0.0"), /SemVer/u);
});
