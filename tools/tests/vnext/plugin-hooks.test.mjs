import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  APEX_AGENT_ID,
  deny,
  handlers,
  isApexAgent,
  normalizeAgentId,
  readPayload,
  run,
  scanTaskTargets,
  serialize,
} from "../../../plugin/hooks/apex-hook.mjs";

const root = resolve(import.meta.dirname, "../../..");
const hookScript = join(root, "plugin/hooks/apex-hook.mjs");

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

function capture() {
  const lines = [];
  return { stderr: { write: (text) => lines.push(text) }, lines };
}

function decide(event, payload) {
  const { stderr, lines } = capture();
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  const output = run(event, text, { stderr });
  return { output, decision: output === "" ? null : JSON.parse(output), warnings: lines };
}

function assertDenied(result, target) {
  assert.deepEqual(Object.keys(result.decision), ["permissionDecision", "permissionDecisionReason"]);
  assert.equal(result.decision.permissionDecision, "deny");
  assert.match(result.decision.permissionDecisionReason, /^APEX hook: /u);
  assert.ok(result.decision.permissionDecisionReason.includes(`"${target}" is the user-facing APEX agent`));
  assert.match(result.output, /^[\x20-\x7e]+$/u, "decision is one line of ASCII");
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

test("events without handlers write nothing", () => {
  assert.deepEqual(Object.keys(handlers), ["preToolUse"]);
  for (const event of ["postToolUse", "subagentStart", "PreToolUse", "", "toString", "__proto__"]) {
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
