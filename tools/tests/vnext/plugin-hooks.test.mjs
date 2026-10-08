import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  APEX_AGENT_ID,
  MARKER_TTL_MS,
  activeRubberDuckMarks,
  apexToolName,
  consumeRubberDuckDenial,
  denyApexMutationDuringRubberDuck,
  deny,
  handlers,
  isApexAgent,
  loadToolPolicy,
  normalizeAgentId,
  PRICING_READ_TOOLS,
  PRICING_SERVER,
  pricingTool,
  readPayload,
  reviewHome,
  reviewNonce,
  run,
  scanTaskTargets,
  scanToolNames,
  serialize,
} from "../../../plugin/hooks/apex-hook.mjs";
import { pricingReadTools, renderHookScript } from "../../scripts/build-plugin.mjs";
import {
  buildReviewPrompt,
  reviewCaptureKey,
  reviewPromptSha256,
  loadReviewCaptures,
  verifyIssuedReviewCapture,
  verifyReviewCapture,
} from "../../../packages/kernel/dist/index.js";
import { mcpToolPolicy } from "../../../packages/cli/dist/mcp.js";

const root = resolve(import.meta.dirname, "../../..");
const hookScript = join(root, "plugin/hooks/apex-hook.mjs");
// Every handler and spawned hook in this file uses a private review home, never the real ~/.apex/reviews.
const testReviewHome = mkdtempSync(join(tmpdir(), "apex-hook-review-home-"));
process.env.APEX_REVIEW_HOME = testReviewHome;
test.after(() => rm(testReviewHome, { recursive: true, force: true }));

// Copilot CLI 1.0.91 preToolUse payload for a plugin agent, recorded with a probe hook (toolArgs arrives as an object).
function taskPayload(agentType, overrides = {}) {
  return {
    sessionId: "44904b8e-e9ce-470b-911f-8bc7a45eadf3",
    timestamp: 1791378238675,
    cwd: "/workspace",
    toolName: "task",
    toolArgs: { description: "Delegate", prompt: "Run the task.", agent_type: agentType, name: "probe", mode: "sync" },
    ...overrides,
  };
}

// Copilot CLI 1.0.93 preToolUse payload for a plugin MCP tool, recorded with a probe hook: "<server>-<tool>".
function pricingPayload(toolName, overrides = {}) {
  return {
    sessionId: "7a1c9712-1cd9-4766-bcb1-e785d075e39f",
    timestamp: 1791406148125,
    cwd: "/workspace",
    toolName,
    toolArgs: {},
    ...overrides,
  };
}

let builtHook;
/** The hook as build-plugin.mjs packages it, with the registry read allowlist embedded. */
async function loadBuiltHook() {
  builtHook ??= (async () => {
    const folder = await mkdtemp(join(tmpdir(), "apex-hook-built-"));
    const script = join(folder, "apex-hook.mjs");
    await writeFile(script, renderHookScript(await readFile(hookScript), await pricingReadTools()));
    const module = await import(pathToFileURL(script).href);
    await rm(folder, { recursive: true, force: true });
    return module;
  })();
  return builtHook;
}

function capture() {
  const lines = [];
  return { stderr: { write: (text) => lines.push(text) }, lines };
}

function decide(event, payload, hook = { run }) {
  const { stderr, lines } = capture();
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  const output = hook.run(event, text, { stderr });
  return { output, decision: output === "" ? null : JSON.parse(output), warnings: lines };
}

function assertDenied(result, target) {
  assert.deepEqual(Object.keys(result.decision), ["permissionDecision", "permissionDecisionReason"]);
  assert.equal(result.decision.permissionDecision, "deny");
  assert.match(result.decision.permissionDecisionReason, /^APEX hook: /u);
  assert.ok(result.decision.permissionDecisionReason.includes(`"${target}" is the user-facing APEX agent`));
  assert.match(result.output, /^[\x20-\x7e]+$/u, "decision is one line of ASCII");
}

function assertPricingDenied(result, toolName) {
  assert.deepEqual(Object.keys(result.decision), ["permissionDecision", "permissionDecisionReason"]);
  assert.equal(result.decision.permissionDecision, "deny");
  assert.equal(
    result.decision.permissionDecisionReason,
    `APEX hook: "${toolName}" is not one of the read-only Azure pricing and cost tools. APEX uses only read-only ` +
      "tools from the apex-azure-pricing server; write, operation and unrecognized tools on it are blocked.",
  );
}

function assertAllowed(result) {
  assert.equal(result.output, "", "allow writes nothing, so the client's normal permission flow applies");
  assert.equal(result.decision, null);
}

test("agent IDs normalize plugin namespaces, folders, file suffixes and case", () => {
  assert.equal(APEX_AGENT_ID, "apex");
  for (const value of ["apex", "APEX", " Apex ", "apex:apex", "apex/apex", "apex:APEX.agent.md", "apex.agent.md"]) {
    assert.equal(normalizeAgentId(value), "apex", value);
    assert.equal(isApexAgent(value), true, value);
  }
  for (const value of ["apex:apex-codegen", "apex-validator", "APEX CodeGen", "explore", "apexx", "", "apex:"]) {
    assert.equal(isApexAgent(value), false, value);
  }
  assert.equal(normalizeAgentId("apex:APEX-CodeGen.agent.md"), "apex-codegen");
  for (const value of ["other-plugin:apex", "team/apex", "x\\apex", "apex-tools:apex"]) {
    assert.equal(normalizeAgentId(value), value.toLowerCase(), value);
    assert.equal(isApexAgent(value), false, `${value} belongs to another namespace`);
  }
  for (const value of [undefined, null, 1, {}, ["apex"]]) assert.equal(normalizeAgentId(value), "");
});

test("preToolUse denies the APEX agent as a task target in every ID form", () => {
  for (const target of ["apex:apex", "APEX", "apex", "apex/apex", "apex:APEX.agent.md"]) {
    assertDenied(decide("preToolUse", taskPayload(target)), target);
  }
  const camel = taskPayload(undefined);
  camel.toolArgs = { prompt: "x", agentType: "apex:apex" };
  assertDenied(decide("preToolUse", camel), "apex:apex");
});

test("preToolUse accepts toolArgs as a JSON string and the VS Code snake_case payload", () => {
  const stringArgs = taskPayload("apex:apex");
  stringArgs.toolArgs = JSON.stringify(stringArgs.toolArgs);
  assertDenied(decide("preToolUse", stringArgs), "apex:apex");
  const vscode = {
    hook_event_name: "PreToolUse",
    session_id: "s",
    timestamp: "2026-10-07T00:00:00.000Z",
    cwd: "/workspace",
    tool_name: "task",
    tool_input: { prompt: "x", agent_type: "APEX" },
  };
  assertDenied(decide("preToolUse", vscode), "APEX");
  for (const toolName of ["Agent", "Task"])
    assertDenied(decide("preToolUse", { ...vscode, tool_name: toolName }), "APEX");
  assertDenied(decide("preToolUse", `\uFEFF${JSON.stringify(taskPayload("apex:apex"))}`), "apex:apex");
});

test("preToolUse allows hidden workers, built-in agents and unknown targets", () => {
  for (const target of [
    "apex:apex-codegen",
    "apex:apex-validator",
    "apex:apex-reviewer",
    "apex-codegen",
    "APEX CodeGen",
    "explore",
    "task",
    "general-purpose",
    "rubber-duck",
    "code-review",
    "security-review",
    "apex-helper",
    "other-plugin:apex",
    "",
    42,
  ]) {
    const result = decide("preToolUse", taskPayload(target));
    assertAllowed(result);
    assert.deepEqual(result.warnings, []);
  }
  const noTarget = taskPayload("apex");
  delete noTarget.toolArgs.agent_type;
  assertAllowed(decide("preToolUse", noTarget));
  assertAllowed(decide("preToolUse", taskPayload("apex", { toolArgs: null })));
});

test("preToolUse allows unrelated tools even when their arguments name APEX", () => {
  for (const toolName of ["bash", "powershell", "view", "edit", "apex/completeTask", "tasks", "TASK"]) {
    assertAllowed(decide("preToolUse", taskPayload("apex:apex", { toolName })));
  }
});

test("events without handlers write nothing, and capture or mark handlers never decide", () => {
  assert.deepEqual(Object.keys(handlers), [
    "preToolUse",
    "postToolUse",
    "postToolUseFailure",
    "subagentStart",
    "subagentStop",
  ]);
  for (const event of ["postToolUse", "subagentStart", "subagentStop", "PreToolUse", "", "toString", "__proto__"]) {
    const result = decide(event, taskPayload("apex:apex"));
    assertAllowed(result);
    assert.deepEqual(result.warnings, []);
  }
});

test("unreadable input fails open, except a task call still readable as targeting APEX", () => {
  for (const text of ["", "   ", "not json", "[]", "null", '"task"', "{", JSON.stringify({ toolName: 5 })]) {
    const result = decide("preToolUse", text);
    assertAllowed(result);
  }
  const unreadable = decide("preToolUse", "not json");
  assert.match(unreadable.warnings.join(""), /unreadable preToolUse payload .*allowed/u);

  const truncated = JSON.stringify(taskPayload("apex:apex")).slice(0, -12);
  const denied = decide("preToolUse", truncated);
  assertDenied(denied, "apex:apex");
  assert.match(denied.warnings.join(""), /unreadable preToolUse payload .*denied/u);

  const badArgs = taskPayload("x");
  badArgs.toolArgs = '{"agent_type":"APEX","prompt":';
  assertDenied(decide("preToolUse", badArgs), "APEX");
  assertAllowed(decide("preToolUse", JSON.stringify(taskPayload("apex:apex-codegen")).slice(0, -12)));
  assertAllowed(decide("preToolUse", JSON.stringify(taskPayload("apex:apex", { toolName: "bash" })).slice(0, -12)));
});

test("the raw scan finds targets in plain and JSON-escaped arguments only for task calls", () => {
  const plain = '{"toolName": "task", "toolArgs": {"agent_type": "apex:apex"';
  assert.deepEqual(scanTaskTargets(plain), ["apex:apex"]);
  const escaped = JSON.stringify({ toolName: "task", toolArgs: '{"agentType":"APEX"' });
  assert.deepEqual(scanTaskTargets(escaped), ["APEX"]);
  assert.deepEqual(scanTaskTargets('{"tool_name":"task","tool_input":{"agent_type":"explore"'), ["explore"]);
  assert.deepEqual(scanTaskTargets('{"toolName":"bash","toolArgs":{"agent_type":"apex"'), []);
});

test("readPayload normalizes tool name and arguments", () => {
  assert.deepEqual(readPayload(JSON.stringify(taskPayload("apex"))).args.agent_type, "apex");
  assert.deepEqual(readPayload('{"toolName":"view","toolArgs":[1]}').args, {});
  assert.equal(readPayload('{"tool_name":"task"}').toolName, "task");
  assert.throws(() => readPayload("[]"), /not a JSON object/u);
  assert.throws(() => readPayload('{"toolArgs":"{"}'), SyntaxError);
});

test("decisions serialize as one line of ASCII JSON", () => {
  const decision = deny('target "é ✓ 😀"');
  const text = serialize(decision);
  assert.match(text, /^[\x20-\x7e]+$/u);
  assert.deepEqual(JSON.parse(text), decision);
});

test("the hook script runs as a process from a path with spaces and always exits 0", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "apex hook "));
  context.after(() => rm(folder, { recursive: true, force: true }));
  const script = join(folder, "with space", "apex-hook.mjs");
  await mkdir(join(folder, "with space"));
  await copyFile(hookScript, script);
  const invoke = (input, event = "preToolUse") =>
    spawnSync(process.execPath, [script, event], { input, encoding: "utf8", windowsHide: true });

  const denied = invoke(JSON.stringify(taskPayload("apex:apex")));
  assert.equal(denied.status, 0, denied.stderr);
  assert.equal(JSON.parse(denied.stdout).permissionDecision, "deny");
  assert.equal(denied.stderr, "");

  for (const [input, event] of [
    [JSON.stringify(taskPayload("apex:apex-codegen")), "preToolUse"],
    [JSON.stringify(taskPayload("apex:apex")), "postToolUse"],
    ["", "preToolUse"],
    ["{broken", "preToolUse"],
  ]) {
    const allowed = invoke(input, event);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.equal(allowed.stdout, "");
  }
  const imported = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(script).href)})`],
    {
      input: JSON.stringify(taskPayload("apex:apex")),
      encoding: "utf8",
    },
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "", "importing the module does not run the hook");
});

const PRICING_NAME_FORMS = [
  (tool) => `apex-azure-pricing-${tool}`,
  (tool) => `apex-azure-pricing/${tool}`,
  (tool) => `apex-azure-pricing:${tool}`,
  (tool) => `mcp__apex-azure-pricing__${tool}`,
  (tool) => `mcp_apex_azure_pricing_${tool}`,
  (tool) => ` APEX-Azure-Pricing-${tool} `,
];

test("the generated pricing allowlist is the registry read allowlist", async () => {
  const registry = JSON.parse(await readFile(join(root, "tools/registry/arm-mcp-cost-pricing.v1.json"), "utf8"));
  const built = await loadBuiltHook();
  assert.equal(PRICING_SERVER, "apex-azure-pricing");
  assert.deepEqual([...built.PRICING_READ_TOOLS], registry.managedPolicy.candidateReadAllowlist);
  assert.deepEqual(await pricingReadTools(), registry.managedPolicy.candidateReadAllowlist);
  for (const tool of [...registry.managedPolicy.denyBeforeTransport, ...registry.managedPolicy.deferredTools])
    assert.ok(!built.PRICING_READ_TOOLS.includes(tool), tool);
  assert.ok(Object.isFrozen(built.PRICING_READ_TOOLS));
  assert.deepEqual([...PRICING_READ_TOOLS], [], "the unbuilt hook allows no pricing tool");
  assert.throws(() => renderHookScript("export const x = 1;\n", ["get_retail_prices"]), /marker exactly once/u);
});

test("pricingTool reads the server tool from every tool name form", () => {
  for (const form of PRICING_NAME_FORMS) assert.equal(pricingTool(form("get_retail_prices")), "get_retail_prices");
  for (const name of [
    "apex-azure-pricing",
    "apex-azure-pricing-",
    "apex-azure-pricing-get prices",
    "x-apex-azure-pricing-get",
  ])
    assert.equal(pricingTool(name), "", name);
  for (const name of ["bash", "task", "view", "apex/status", "apex-status", "azure-pricing-get_retail_prices", "", 5])
    assert.equal(pricingTool(name), undefined, String(name));
});

test("preToolUse allows each read-only pricing tool in every name form", async () => {
  const built = await loadBuiltHook();
  for (const tool of built.PRICING_READ_TOOLS)
    for (const form of PRICING_NAME_FORMS) {
      const result = decide("preToolUse", pricingPayload(form(tool)), built);
      assertAllowed(result);
      assert.deepEqual(result.warnings, []);
    }
});

test("preToolUse denies pricing write, operation and unknown tools in every name form", async () => {
  const built = await loadBuiltHook();
  for (const tool of [
    "create_budget",
    "start_pricesheet_download",
    "get_pricesheet_status",
    "create_template_deployment",
    "cancel_arm_template_deployment",
    "delete_budget",
    "GET_RETAIL_PRICES",
    "get_retail_prices_v2",
  ])
    for (const form of PRICING_NAME_FORMS)
      assertPricingDenied(decide("preToolUse", pricingPayload(form(tool)), built), form(tool));
  for (const toolName of ["apex-azure-pricing", "apex-azure-pricing-", "apex-azure-pricing-get prices"])
    assertPricingDenied(decide("preToolUse", pricingPayload(toolName), built), toolName);
  const vscode = { hook_event_name: "PreToolUse", tool_name: "apex-azure-pricing-create_budget", tool_input: {} };
  assertPricingDenied(decide("preToolUse", vscode, built), "apex-azure-pricing-create_budget");
  for (const tool of built.PRICING_READ_TOOLS)
    assertPricingDenied(
      decide("preToolUse", pricingPayload(`apex-azure-pricing-${tool}`)),
      `apex-azure-pricing-${tool}`,
    );
});

test("preToolUse leaves unrelated tools alone and keeps the APEX task deny", async () => {
  const built = await loadBuiltHook();
  for (const toolName of ["bash", "view", "edit", "web_fetch", "apex-status", "github-mcp-server-get_commit", "task"])
    assertAllowed(
      decide("preToolUse", pricingPayload(toolName, { toolArgs: { note: "apex-azure-pricing-create_budget" } }), built),
    );
  assertDenied(decide("preToolUse", taskPayload("apex:apex"), built), "apex:apex");
  assertAllowed(decide("preToolUse", taskPayload("apex:apex-codegen"), built));
});

test("unreadable pricing payloads fail closed unless they name an allowed read tool", async () => {
  const built = await loadBuiltHook();
  const truncated = (toolName) => JSON.stringify(pricingPayload(toolName)).slice(0, -5);
  const denied = decide("preToolUse", truncated("apex-azure-pricing-create_budget"), built);
  assertPricingDenied(denied, "apex-azure-pricing-create_budget");
  assert.match(denied.warnings.join(""), /unreadable preToolUse payload .*denied/u);
  assertAllowed(decide("preToolUse", truncated("apex-azure-pricing-get_retail_prices"), built));
  assertPricingDenied(decide("preToolUse", '{"apex-azure-pricing', built), "apex-azure-pricing");
  assertAllowed(decide("preToolUse", truncated("bash"), built));
  assert.deepEqual(scanToolNames(JSON.stringify({ toolName: "a", nested: JSON.stringify({ tool_name: "b" }) })), [
    "a",
    "b",
  ]);
});

test("the built hook script denies a pricing write as a process", async (context) => {
  const folder = await mkdtemp(join(tmpdir(), "apex hook built "));
  context.after(() => rm(folder, { recursive: true, force: true }));
  const script = join(folder, "apex-hook.mjs");
  await writeFile(script, renderHookScript(await readFile(hookScript), await pricingReadTools()));
  const invoke = (input) => spawnSync(process.execPath, [script, "preToolUse"], { input, encoding: "utf8" });
  const denied = invoke(JSON.stringify(pricingPayload("apex-azure-pricing-create_budget")));
  assert.equal(denied.status, 0, denied.stderr);
  assert.equal(JSON.parse(denied.stdout).permissionDecision, "deny");
  const allowed = invoke(JSON.stringify(pricingPayload("apex-azure-pricing-get_retail_prices")));
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(allowed.stdout, "");
});

// Copilot CLI 1.0.92 payloads recorded with a probe plugin hook during a sync rubber-duck task call (2026-10-07).
const parentSession = "36a083fd-de54-420f-892a-46033e0b8a49";
const rubberDuckSession = "b98af3d1-4763-4c97-a520-e4c5ac7f5fd5";
const workspace = "/home/user/project";
const reviewRequestNonce = "0123456789abcdef0123456789abcdef";
const reviewPrompt = buildReviewPrompt({
  nonce: reviewRequestNonce,
  gate: 1,
  subjectKind: "requirements",
  wellArchitected: false,
  files: [{ label: "subject", kind: "requirements", path: "/home/user/project/subject.json", sha256: "b".repeat(64) }],
});
const rubberDuckAnswer =
  'Notes.\n```apex-review\n{"findings":[{"severity":"high","title":"No RPO","detail":"Add one."}]}\n```';

function rubberDuckTask(overrides = {}, args = {}) {
  return {
    sessionId: parentSession,
    timestamp: 1791388448975,
    cwd: workspace,
    toolName: "task",
    toolArgs: {
      description: "APEX review",
      agent_type: "rubber-duck",
      mode: "sync",
      name: "apex-review",
      prompt: reviewPrompt,
      ...args,
    },
    toolResult: { resultType: "success", textResultForLlm: rubberDuckAnswer },
    ...overrides,
  };
}

// A damaged mark ages by its file mtime. NTFS stamps it with a finer clock than Date.now(), so the mtime can run a few
// milliseconds ahead; checking one minute past the TTL keeps expiry tests independent of that skew.
const PAST_TTL_MS = MARKER_TTL_MS + 60_000;

const subagentStart = (agentName = "rubber-duck", overrides = {}) => ({
  sessionId: parentSession,
  timestamp: 1791388443826,
  cwd: workspace,
  transcriptPath: `/home/user/.copilot/session-state/${parentSession}/events.jsonl`,
  agentName,
  ...overrides,
});

const subagentStop = (agentName = "rubber-duck", overrides = {}) => ({
  ...subagentStart(agentName),
  timestamp: 1791388448937,
  agentId: rubberDuckSession,
  agentType: agentName,
  response: rubberDuckAnswer,
  stopReason: "end_turn",
  ...overrides,
});

const apexCall = (tool, overrides = {}) => ({
  sessionId: rubberDuckSession,
  timestamp: 1791388446898,
  cwd: workspace,
  toolName: `apex-${tool}`,
  toolArgs: { workspace },
  ...overrides,
});

async function resetReviewHome() {
  await rm(testReviewHome, { recursive: true, force: true });
  await mkdir(testReviewHome, { recursive: true, mode: 0o700 });
}

function assertMutationDenied(result, tool) {
  assert.equal(result.decision?.permissionDecision, "deny", `${tool} must be denied`);
  assert.match(result.decision.permissionDecisionReason, new RegExp(`APEX tool "${tool}" changes state`, "u"));
}

test("postToolUse saves a kernel-requested rubber-duck review that the kernel verifies", async () => {
  await resetReviewHome();
  assert.equal(reviewHome(), testReviewHome);
  assert.equal(reviewNonce(reviewPrompt), reviewRequestNonce);
  assertAllowed(decide("postToolUse", rubberDuckTask()));
  const files = await loadReviewCaptures(reviewRequestNonce, testReviewHome);
  assert.equal(files.length, 1);
  for (const folder of [testReviewHome, join(testReviewHome, "captures")])
    assert.deepEqual(
      (await readdir(folder)).filter((name) => name.endsWith(".tmp")),
      [],
      "files are published whole, with no temporary files left",
    );
  const key = await reviewCaptureKey(testReviewHome);
  const record = verifyReviewCapture(files[0].value, key);
  assert.equal(record.prompt, reviewPrompt);
  assert.equal(record.response, rubberDuckAnswer, "the capture is rubber-duck's exact output");
  assert.equal(record.sessionId, parentSession);
  const issued = { nonce: reviewRequestNonce, promptSha256: reviewPromptSha256(reviewPrompt) };
  assert.equal(verifyIssuedReviewCapture(issued, files, key).nonce, reviewRequestNonce);

  assertAllowed(decide("postToolUse", rubberDuckTask()));
  assert.equal(
    (await loadReviewCaptures(reviewRequestNonce, testReviewHome)).length,
    1,
    "identical repeat is one file",
  );
  const second = rubberDuckTask({ toolResult: { resultType: "success", textResultForLlm: "different answer" } });
  assertAllowed(decide("postToolUse", second));
  const both = await loadReviewCaptures(reviewRequestNonce, testReviewHome);
  assert.equal(both.length, 2, "a second answer gets its own file, so the kernel sees the rerun");
  assert.throws(() => verifyIssuedReviewCapture(issued, both, key), /2 rubber-duck captures/u);
});

test("postToolUse accepts the VS Code payload and ignores ordinary rubber-duck and other task calls", async () => {
  await resetReviewHome();
  const vscode = {
    hook_event_name: "PostToolUse",
    session_id: parentSession,
    timestamp: "2026-10-07T00:00:00.000Z",
    cwd: workspace,
    tool_name: "Agent",
    tool_input: { agent_type: "rubber-duck", prompt: reviewPrompt, mode: "sync" },
    tool_result: { result_type: "success", text_result_for_llm: rubberDuckAnswer },
  };
  assertAllowed(decide("postToolUse", vscode));
  const [file] = await loadReviewCaptures(reviewRequestNonce, testReviewHome);
  assert.equal(verifyReviewCapture(file.value, await reviewCaptureKey(testReviewHome)).toolName, "Agent");
  await resetReviewHome();
  for (const payload of [
    rubberDuckTask({}, { prompt: "Review my notes please." }),
    rubberDuckTask({}, { prompt: `Please review.\n${reviewPrompt}` }),
    rubberDuckTask({}, { agent_type: "explore" }),
    rubberDuckTask({}, { agent_type: "apex:apex-codegen" }),
    rubberDuckTask({ toolName: "bash" }),
    rubberDuckTask({ toolResult: { resultType: "failure", textResultForLlm: "boom" } }),
    rubberDuckTask({ toolResult: undefined }),
  ])
    assertAllowed(decide("postToolUse", payload));
  const background = decide("postToolUse", rubberDuckTask({}, { mode: "background" }));
  assertAllowed(background);
  assert.match(background.warnings.join(""), /background rubber-duck review is not captured/u);
  assert.deepEqual(await readdir(testReviewHome).catch(() => []), []);
});

test("postToolUse refuses a capture key other users can read", { skip: process.platform === "win32" }, async () => {
  await resetReviewHome();
  await writeFile(join(testReviewHome, "capture.key"), `${"1".repeat(64)}\n`, { mode: 0o644 });
  await chmod(join(testReviewHome, "capture.key"), 0o644);
  const result = decide("postToolUse", rubberDuckTask());
  assertAllowed(result);
  assert.match(result.warnings.join(""), /capture key permissions must be 0600/u);
  assert.deepEqual(await loadReviewCaptures(reviewRequestNonce, testReviewHome), []);
  await resetReviewHome();
});

test("postToolUse never blocks when the capture cannot be written", async () => {
  await resetReviewHome();
  await rm(testReviewHome, { recursive: true, force: true });
  await writeFile(testReviewHome, "not a folder");
  const result = decide("postToolUse", rubberDuckTask());
  assertAllowed(result);
  assert.match(result.warnings.join(""), /APEX hook: postToolUse handler failed/u);
  await rm(testReviewHome, { force: true });
  await mkdir(testReviewHome, { mode: 0o700 });
});

test("a reviewer mutation is denied while rubber-duck runs, and allowed again after it stops", async () => {
  await resetReviewHome();
  const policy = new Set(mcpToolPolicy().readOnly);
  const stateChanging = mcpToolPolicy().tools.filter((tool) => !policy.has(tool));
  assert.deepEqual([...policy].sort(), ["projectList", "status"]);
  assert.ok(stateChanging.includes("reviewComplete") && stateChanging.includes("gateDecide"));
  assertAllowed(decide("subagentStart", subagentStart()));
  assert.equal(activeRubberDuckMarks().length, 1);

  // Negative test: rubber-duck inherits the caller's APEX tools; every state-changing one is denied.
  const options = { readOnlyTools: () => policy };
  for (const tool of stateChanging)
    assertMutationDenied(
      { decision: denyApexMutationDuringRubberDuck(readPayload(JSON.stringify(apexCall(tool))), options) },
      tool,
    );
  for (const toolName of ["apex/reviewDecide", "mcp__apex__gateDecide", "apex-futureTool"])
    assert.equal(
      denyApexMutationDuringRubberDuck(readPayload(JSON.stringify(apexCall("x", { toolName }))), options)
        ?.permissionDecision,
      "deny",
      toolName,
    );
  for (const tool of policy)
    assert.equal(denyApexMutationDuringRubberDuck(readPayload(JSON.stringify(apexCall(tool))), options), null, tool);
  assert.equal(
    denyApexMutationDuringRubberDuck(readPayload(JSON.stringify(apexCall("status"))), {
      readOnlyTools: () => {
        throw new Error("missing policy");
      },
    })?.permissionDecision,
    "deny",
    "a missing policy treats every APEX tool as state-changing",
  );
  // The run's parent, other folders and non-APEX tools are not affected.
  for (const payload of [
    apexCall("reviewComplete", { sessionId: parentSession }),
    apexCall("reviewComplete", { cwd: "/home/user/other" }),
    apexCall("x", { toolName: "view", toolArgs: { path: "/home/user/project/subject.json" } }),
    apexCall("x", { toolName: "other-server-reviewComplete" }),
  ])
    assert.equal(denyApexMutationDuringRubberDuck(readPayload(JSON.stringify(payload)), options), null);

  // The shipped runner reads the generated policy beside the script; without it every APEX tool is denied.
  assertMutationDenied(decide("preToolUse", apexCall("status")), "status");
  assertMutationDenied(decide("preToolUse", apexCall("gateDecide")), "gateDecide");

  assertAllowed(decide("subagentStop", subagentStop("explore")));
  assert.equal(activeRubberDuckMarks().length, 1, "other agents do not clear the mark");
  assertAllowed(decide("subagentStop", subagentStop()));
  assert.equal(activeRubberDuckMarks().length, 0);
  assertAllowed(decide("preToolUse", apexCall("gateDecide")));
});

test("concurrent rubber-duck runs in one folder never block either parent, only sessions without a mark", async () => {
  await resetReviewHome();
  const otherParent = "7d2e6b5a-0000-4000-8000-000000000000";
  assertAllowed(decide("subagentStart", subagentStart()));
  assertAllowed(decide("subagentStart", subagentStart("rubber-duck", { sessionId: otherParent })));
  for (const sessionId of [parentSession, otherParent])
    assertAllowed(decide("preToolUse", apexCall("reviewComplete", { sessionId })));
  assertMutationDenied(decide("preToolUse", apexCall("reviewComplete")), "reviewComplete");
  // One run per folder: a rubber-duck subagent cannot start its own run to become an exempt parent, and a parent
  // cannot hold two marks that one duplicate stop or failure event could both clear.
  for (const sessionId of [rubberDuckSession, parentSession]) {
    const nested = decide("preToolUse", rubberDuckTask({ sessionId }));
    assert.equal(nested.decision?.permissionDecision, "deny", sessionId);
    assert.match(nested.decision.permissionDecisionReason, /already running in this folder/u);
  }
  assertAllowed(decide("preToolUse", rubberDuckTask({ cwd: "/home/user/other", sessionId: rubberDuckSession })));
  // Once its own run stops, a parent owns no mark and waits for the other run like any other session (fail closed).
  assertAllowed(decide("subagentStop", subagentStop()));
  assertMutationDenied(
    decide("preToolUse", apexCall("reviewComplete", { sessionId: parentSession })),
    "reviewComplete",
  );
  assertAllowed(decide("preToolUse", apexCall("reviewComplete", { sessionId: otherParent })));
  assertAllowed(decide("subagentStop", subagentStop("rubber-duck", { sessionId: otherParent })));
  assertAllowed(decide("preToolUse", apexCall("gateDecide")));
  assertAllowed(decide("preToolUse", rubberDuckTask({ sessionId: rubberDuckSession })));
  await resetReviewHome();
});

test("rubber-duck marks clear on task failure, expire, and fail closed when unreadable", async () => {
  await resetReviewHome();
  assertAllowed(decide("subagentStart", subagentStart("explore")));
  assert.equal(activeRubberDuckMarks().length, 0, "only rubber-duck runs are marked");
  assertAllowed(decide("subagentStart", subagentStart()));
  assertAllowed(decide("subagentStart", subagentStart()));
  assert.equal(activeRubberDuckMarks().length, 2);
  const failure = { ...rubberDuckTask(), error: "subagent failed" };
  delete failure.toolResult;
  assertAllowed(decide("postToolUseFailure", failure));
  assert.equal(activeRubberDuckMarks().length, 1, "one failure clears one mark");
  assertAllowed(decide("postToolUseFailure", { ...failure, toolArgs: { ...failure.toolArgs, agent_type: "explore" } }));
  assert.equal(activeRubberDuckMarks().length, 1);
  assert.equal(activeRubberDuckMarks({ now: Date.now() + PAST_TTL_MS }).length, 0, "expired marks are removed");
  assert.deepEqual(await readdir(join(testReviewHome, "active")), []);

  // A damaged mark fails closed for every folder until it is older than the TTL; temporary files are ignored.
  await writeFile(join(testReviewHome, "active", ".1-abc.tmp"), "{");
  assert.equal(activeRubberDuckMarks().length, 0, "unpublished temporary marks are not read");
  await writeFile(join(testReviewHome, "active", "broken.json"), "{");
  assert.deepEqual(
    activeRubberDuckMarks().map(({ cwd, parentSessionId }) => ({ cwd, parentSessionId })),
    [{ cwd: null, parentSessionId: null }],
  );
  assertMutationDenied(
    { decision: denyApexMutationDuringRubberDuck(readPayload(JSON.stringify(apexCall("gateDecide")))) },
    "gateDecide",
  );
  assertMutationDenied(
    { decision: denyApexMutationDuringRubberDuck(readPayload(JSON.stringify(apexCall("gateDecide", { cwd: "/x" })))) },
    "gateDecide",
  );
  assert.equal(activeRubberDuckMarks({ now: Date.now() + PAST_TTL_MS }).length, 0, "old damaged marks expire");
  assert.deepEqual(
    (await readdir(join(testReviewHome, "active"))).filter((name) => name.endsWith(".json")),
    [],
  );
  await rm(join(testReviewHome, "active", ".1-abc.tmp"));
  await rm(join(testReviewHome, "active"), { recursive: true });
  await writeFile(join(testReviewHome, "active"), "not a folder");
  const unreadable = denyApexMutationDuringRubberDuck(readPayload(JSON.stringify(apexCall("gateDecide"))));
  assert.equal(unreadable?.permissionDecision, "deny");
  assert.match(unreadable.permissionDecisionReason, /cannot read rubber-duck run marks .* "gateDecide" is blocked/u);
  await rm(join(testReviewHome, "active"));
});

test("a denied duplicate rubber-duck call cannot clear the mark of the run that is still going", async () => {
  await resetReviewHome();
  const failed = (overrides = {}) => {
    const failure = { ...rubberDuckTask(overrides), error: "Denied by preToolUse hook" };
    delete failure.toolResult;
    return failure;
  };
  assertAllowed(decide("subagentStart", subagentStart()));
  const duplicate = decide("preToolUse", rubberDuckTask());
  assert.equal(duplicate.decision?.permissionDecision, "deny");
  assertAllowed(decide("postToolUseFailure", failed()));
  assert.equal(activeRubberDuckMarks().length, 1, "the denied duplicate's failure consumes its denial, not the mark");
  assertMutationDenied(decide("preToolUse", apexCall("gateDecide")), "gateDecide");
  assert.deepEqual(await readdir(join(testReviewHome, "denied")), []);
  // The running call's own failure still clears its mark.
  assertAllowed(decide("postToolUseFailure", failed()));
  assert.equal(activeRubberDuckMarks().length, 0);
  assertAllowed(decide("preToolUse", apexCall("gateDecide")));

  // A denial only covers failures from the same session and folder, and expires with the mark TTL.
  assertAllowed(decide("subagentStart", subagentStart()));
  assert.equal(decide("preToolUse", rubberDuckTask()).decision?.permissionDecision, "deny");
  assertAllowed(decide("postToolUseFailure", failed({ cwd: "/home/user/other" })));
  assertAllowed(decide("postToolUseFailure", failed({ sessionId: rubberDuckSession })));
  assert.equal(activeRubberDuckMarks().length, 1);
  assert.equal(consumeRubberDuckDenial(rubberDuckTask(), { now: Date.now() + PAST_TTL_MS }), false);
  assert.deepEqual(await readdir(join(testReviewHome, "denied")), [], "expired denials are removed");
  assertAllowed(decide("postToolUseFailure", failed()));
  assert.equal(activeRubberDuckMarks().length, 0);

  // When the denial record cannot be written, the marks that failure could clear are duplicated, so it stays denied.
  assertAllowed(decide("subagentStart", subagentStart()));
  await rm(join(testReviewHome, "denied"), { recursive: true, force: true });
  await writeFile(join(testReviewHome, "denied"), "not a folder");
  assert.equal(decide("preToolUse", rubberDuckTask()).decision?.permissionDecision, "deny");
  assert.equal(activeRubberDuckMarks().length, 2, "the parent's mark is duplicated");
  assertAllowed(decide("postToolUseFailure", failed()));
  assert.ok(activeRubberDuckMarks().length >= 1);
  assertMutationDenied(decide("preToolUse", apexCall("gateDecide")), "gateDecide");
  const before = activeRubberDuckMarks().length;
  assert.equal(
    decide("preToolUse", rubberDuckTask({ sessionId: rubberDuckSession })).decision?.permissionDecision,
    "deny",
  );
  assert.equal(activeRubberDuckMarks().length, before);
  assert.ok(
    activeRubberDuckMarks().every(({ parentSessionId }) => parentSessionId === parentSession),
    "a session that owns no mark gains none, so it never becomes an exempt parent",
  );
  assert.equal(activeRubberDuckMarks({ now: Date.now() + PAST_TTL_MS }).length, 0);
  await rm(join(testReviewHome, "denied"));

  // A fail-safe denial of an unreadable rubber-duck call covers the next rubber-duck failure from any session.
  assertAllowed(decide("subagentStart", subagentStart()));
  const unreadable = decide("preToolUse", JSON.stringify(rubberDuckTask()).slice(0, -10));
  assert.equal(unreadable.decision?.permissionDecision, "deny");
  assertAllowed(decide("postToolUseFailure", failed({ sessionId: rubberDuckSession })));
  assert.equal(activeRubberDuckMarks().length, 1);
  assertAllowed(decide("subagentStop", subagentStop()));
  assert.equal(activeRubberDuckMarks().length, 0);
  await resetReviewHome();
});

test(
  "an unwritable denial folder still leaves the running run marked after the denied call fails",
  { skip: process.platform === "win32" || process.getuid?.() === 0 },
  async () => {
    await resetReviewHome();
    const failure = { ...rubberDuckTask(), error: "Denied by preToolUse hook" };
    delete failure.toolResult;
    assertAllowed(decide("subagentStart", subagentStart()));
    await mkdir(join(testReviewHome, "denied"));
    await chmod(join(testReviewHome, "denied"), 0o500);
    try {
      assert.equal(decide("preToolUse", rubberDuckTask()).decision?.permissionDecision, "deny");
      assertAllowed(decide("postToolUseFailure", failure));
      assert.equal(activeRubberDuckMarks().length, 1, "the unmatched failure clears only the duplicate");
      assertMutationDenied(decide("preToolUse", apexCall("gateDecide")), "gateDecide");
    } finally {
      await chmod(join(testReviewHome, "denied"), 0o700);
    }
    assertAllowed(decide("subagentStop", subagentStop()));
    assert.equal(activeRubberDuckMarks().length, 0);
    await resetReviewHome();
  },
);

test(
  "a review home other users can write is not trusted: no capture, and APEX mutations are denied",
  { skip: process.platform === "win32" },
  async () => {
    await resetReviewHome();
    assertAllowed(decide("subagentStart", subagentStart()));
    await chmod(testReviewHome, 0o777);
    try {
      const captured = decide("postToolUse", rubberDuckTask());
      assertAllowed(captured);
      assert.match(captured.warnings.join(""), /writable by other users/u);
      const denied = decide("preToolUse", apexCall("gateDecide"));
      assert.equal(denied.decision?.permissionDecision, "deny");
      assert.match(
        denied.decision.permissionDecisionReason,
        /cannot read rubber-duck run marks .*writable by other users/u,
      );
    } finally {
      await chmod(testReviewHome, 0o700);
    }
    assert.deepEqual(await loadReviewCaptures(reviewRequestNonce, testReviewHome), []);
    await resetReviewHome();
  },
);

test(
  "a review home under a non-sticky folder other users can write is not trusted",
  { skip: process.platform === "win32" },
  async (context) => {
    const parent = await mkdtemp(join(tmpdir(), "apex-hook-parent-"));
    context.after(async () => {
      await chmod(parent, 0o700);
      await rm(parent, { recursive: true, force: true });
    });
    const env = { ...process.env, APEX_REVIEW_HOME: join(parent, "reviews") };
    await mkdir(join(parent, "reviews"), { mode: 0o700 });
    await chmod(parent, 0o777);
    assert.throws(() => activeRubberDuckMarks({ env }), /folder above the review home lets another user replace it/u);
    await chmod(parent, 0o1777);
    assert.deepEqual(activeRubberDuckMarks({ env }), []);
  },
);

test("unreadable APEX tool payloads are denied only while a rubber-duck run is marked", async () => {
  await resetReviewHome();
  const truncated = JSON.stringify(apexCall("gateDecide")).slice(0, -10);
  assertAllowed(decide("preToolUse", truncated));
  assertAllowed(decide("subagentStart", subagentStart()));
  const denied = decide("preToolUse", truncated);
  assert.equal(denied.decision?.permissionDecision, "deny");
  assert.match(denied.decision.permissionDecisionReason, /apex-gateDecide/u);
  assertAllowed(decide("preToolUse", JSON.stringify(rubberDuckTask({ toolName: "view" })).slice(0, -10)));
  // An unreadable nested rubber-duck start is denied too, so a reviewer cannot become an exempt parent.
  const nested = decide("preToolUse", JSON.stringify(rubberDuckTask({ sessionId: rubberDuckSession })).slice(0, -10));
  assert.equal(nested.decision?.permissionDecision, "deny");
  assert.match(nested.decision.permissionDecisionReason, /unreadable rubber-duck task call is blocked/u);
  await resetReviewHome();
  assertAllowed(decide("preToolUse", JSON.stringify(rubberDuckTask()).slice(0, -10)));
});

test("APEX tool names parse in every client form, and the shipped policy loader checks its shape", async (context) => {
  assert.equal(apexToolName("apex-status"), "status");
  assert.equal(apexToolName("apex/reviewComplete"), "reviewComplete");
  assert.equal(apexToolName("mcp__apex__gateDecide"), "gateDecide");
  for (const name of ["apex", "apexx-status", "other-status", "apex-", "task", "apex-a/b"])
    assert.equal(apexToolName(name), undefined, name);
  const folder = await mkdtemp(join(tmpdir(), "apex-hook-policy-"));
  context.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, "apex-mcp-tools.json");
  await writeFile(path, JSON.stringify(mcpToolPolicy()));
  assert.deepEqual([...loadToolPolicy(path)].sort(), ["projectList", "status"]);
  for (const bad of [{}, { server: "other", readOnly: [] }, { server: "apex", readOnly: [1] }]) {
    await writeFile(path, JSON.stringify(bad));
    assert.throws(() => loadToolPolicy(path), /malformed/u);
  }
  assert.throws(() => loadToolPolicy(join(folder, "missing.json")), /ENOENT/u);
});

test("the CP-15 APEX task deny is unchanged while rubber-duck runs", async () => {
  await resetReviewHome();
  assertAllowed(decide("subagentStart", subagentStart()));
  assertDenied(decide("preToolUse", taskPayload("apex:apex", { sessionId: rubberDuckSession })), "apex:apex");
  assertAllowed(decide("preToolUse", taskPayload("rubber-duck")));
  assertAllowed(decide("preToolUse", taskPayload("apex:apex-codegen")));
  await resetReviewHome();
});

test("review home follows APEX_REVIEW_HOME and must be absolute", () => {
  assert.equal(reviewHome({ APEX_REVIEW_HOME: "/x/y" }), resolve("/x/y"));
  assert.throws(() => reviewHome({ APEX_REVIEW_HOME: "relative" }), /absolute/u);
  assert.match(reviewHome({}), /\.apex[\\/]reviews$/u);
});

test("an expired mark file on disk is pruned by age", async () => {
  await resetReviewHome();
  assertAllowed(decide("subagentStart", subagentStart()));
  const [name] = await readdir(join(testReviewHome, "active"));
  const path = join(testReviewHome, "active", name);
  const mark = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...mark, startedAt: new Date(Date.now() - MARKER_TTL_MS - 1).toISOString() }));
  await utimes(path, new Date(), new Date());
  assertAllowed(decide("preToolUse", apexCall("gateDecide")));
  assert.deepEqual(await readdir(join(testReviewHome, "active")), []);
});
