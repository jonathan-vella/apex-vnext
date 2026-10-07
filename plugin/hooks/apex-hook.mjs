#!/usr/bin/env node
/**
 * APEX plugin hook. One dependency-free script for every hook event: hooks.json runs it from a bash and a PowerShell
 * command entry with the event name as the only argument, and the client writes the camelCase hook payload to stdin.
 *
 * preToolUse:
 * - Deny the user-facing APEX agent as a `task` target. A person selects APEX in the agent picker; it never runs as a
 *   subagent. Hidden workers and built-in agents are left to the normal permission flow.
 * - Deny every tool on the plugin's `apex-azure-pricing` server (Azure Resource Manager MCP) except the read-only
 *   pricing and cost tools. The plugin cannot give a remote server a tool allowlist, so without this rule its write
 *   tools, such as budget creation, would reach every agent. Unknown or unparseable tool names on that server are
 *   denied. Every other tool is left to the normal permission flow.
 *
 * Failure rule: the script always exits 0, because the client denies a preToolUse call when a command hook exits
 * non-zero. Input it cannot parse therefore allows the call (fail open), except that a raw-text scan still denies a
 * `task` call whose target it can read as APEX and any call it can read as aimed at the pricing server, unless the
 * tool is an allowed read tool (fail closed for the deny rules). Allowing means writing nothing: empty output keeps
 * the client's default behaviour, while `permissionDecision: "allow"` could bypass its prompt.
 *
 * New handlers (CP-16: postToolUse rubber-duck capture, preToolUse deny of APEX state-changing tools during
 * rubber-duck calls) are added to `handlers` without changing the runner.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const APEX_AGENT_ID = "apex";
// `task` in camelCase payloads; `Agent` (or `Task`) in PascalCase payloads, which use Claude tool names.
const TASK_TOOLS = new Set(["task", "Task", "Agent"]);

export const APEX_PLUGIN_NAME = "apex";

export const PRICING_SERVER = "apex-azure-pricing";
// build-plugin.mjs replaces this line with managedPolicy.candidateReadAllowlist from
// tools/registry/arm-mcp-cost-pricing.v1.json. Unbuilt, the hook allows no pricing tool.
export const PRICING_READ_TOOLS = Object.freeze([]); // @apex-build: pricing-read-tools
// The server name, with "-" or "_" between its words, anywhere in a tool name.
const PRICING_SERVER_MARK = /apex[-_]azure[-_]pricing/iu;
// Copilot CLI sends "apex-azure-pricing-<tool>" (probed with 1.0.93). Also accepted: "/", ":" or "." separators and
// the "mcp__<server>__<tool>" and "mcp_<server>_<tool>" forms other hosts use.
const PRICING_TOOL_NAME = /^(?:mcp_{1,2})?apex[-_]azure[-_]pricing(?:-|_{1,2}|\/|:|\.)([A-Za-z0-9_.-]+)$/iu;

/**
 * Lower-case agent ID without the APEX plugin namespace or file suffix: "apex:APEX.agent.md" becomes "apex". Copilot
 * names plugin agents "<plugin>:<file stem>"; other namespaces stay, so "other-plugin:apex" is not the APEX agent.
 */
export function normalizeAgentId(value) {
  if (typeof value !== "string") return "";
  const id = value
    .trim()
    .toLowerCase()
    .replace(/\.agent\.md$/u, "");
  const namespace = /^([^:/\\]+)[:/\\](.*)$/u.exec(id);
  return namespace !== null && namespace[1] === APEX_PLUGIN_NAME ? namespace[2].trim() : id;
}

export function isApexAgent(value) {
  return normalizeAgentId(value) === APEX_AGENT_ID;
}

export function deny(reason) {
  return { permissionDecision: "deny", permissionDecisionReason: `APEX hook: ${reason}` };
}

function apexTaskDenial(target) {
  return deny(
    `"${target}" is the user-facing APEX agent and cannot run as a task subagent. ` +
      "Continue in the APEX agent selected in the agent picker; delegate kernel tasks only to hidden APEX workers.",
  );
}

/**
 * Returns the tool on the pricing server that a tool name addresses: a tool name, "" when the name addresses the server
 * but no tool can be read from it, or undefined when the name is not for the pricing server.
 */
export function pricingTool(toolName) {
  if (typeof toolName !== "string") return undefined;
  const name = toolName.trim();
  if (!PRICING_SERVER_MARK.test(name)) return undefined;
  return PRICING_TOOL_NAME.exec(name)?.[1] ?? "";
}

function pricingDenial(toolName) {
  return deny(
    `"${toolName}" is not one of the read-only Azure pricing and cost tools. APEX uses only read-only tools from the ` +
      `${PRICING_SERVER} server; write, operation and unrecognized tools on it are blocked.`,
  );
}

function denyPricingWrite({ toolName }) {
  const tool = pricingTool(toolName);
  if (tool === undefined) return null;
  return PRICING_READ_TOOLS.includes(tool) ? null : pricingDenial(toolName);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalizes the documented camelCase payload ({ toolName, toolArgs }) and the VS Code compatible snake_case payload
 * ({ tool_name, tool_input }). toolArgs may arrive as an object or as a JSON string. Throws on unreadable JSON.
 */
export function readPayload(text) {
  const payload = JSON.parse(text.replace(/^\uFEFF/u, ""));
  if (!isObject(payload)) throw new Error("hook payload is not a JSON object");
  let args = payload.toolArgs ?? payload.tool_input ?? {};
  if (typeof args === "string") args = JSON.parse(args);
  return { payload, toolName: String(payload.toolName ?? payload.tool_name ?? ""), args: isObject(args) ? args : {} };
}

/** Finds tool names in text that is not valid JSON, including JSON-escaped payloads. */
export function scanToolNames(text) {
  return [...text.matchAll(/\\*"(?:toolName|tool_name)\\*"\s*:\s*\\*"([^"\\]*)\\*"/gu)].map((match) => match[1]);
}

/** Finds agent_type values in text that is not valid JSON, including JSON-escaped toolArgs strings. */
export function scanTaskTargets(text) {
  if (!/\\*"(?:toolName|tool_name)\\*"\s*:\s*\\*"(?:task|Task|Agent)\\*"/u.test(text)) return [];
  return [...text.matchAll(/\\*"(?:agent_type|agentType)\\*"\s*:\s*\\*"([^"\\]*)\\*"/gu)].map((match) => match[1]);
}

function denyApexTaskTarget({ toolName, args }) {
  if (!TASK_TOOLS.has(toolName)) return null;
  const target = args.agent_type ?? args.agentType;
  return isApexAgent(target) ? apexTaskDenial(target) : null;
}

/** Handlers per event. The first handler that returns a decision wins. */
export const handlers = Object.freeze({
  preToolUse: Object.freeze([denyApexTaskTarget, denyPricingWrite]),
});

/**
 * Fallback for unreadable input: the deny rules apply to what the raw text shows. A task target readable as APEX is
 * denied. A pricing-server tool name is denied unless it is an allowed read tool, and so is text that names the
 * pricing server without any readable tool name.
 */
function failSafe(event, text) {
  if (event !== "preToolUse") return null;
  const target = scanTaskTargets(text).find(isApexAgent);
  if (target !== undefined) return apexTaskDenial(target);
  const names = scanToolNames(text);
  for (const name of names) {
    const decision = denyPricingWrite({ toolName: name });
    if (decision) return decision;
  }
  return names.length === 0 && PRICING_SERVER_MARK.test(text) ? pricingDenial(PRICING_SERVER) : null;
}

/** One-line JSON with every non-ASCII character escaped, so a shell that re-encodes stdout cannot corrupt it. */
export function serialize(decision) {
  const escape = (unit) => `\\u${unit.toString(16).padStart(4, "0")}`;
  return JSON.stringify(decision).replace(/[^\t\n\r\u0020-\u007e]/gu, (character) =>
    character.length === 1
      ? escape(character.charCodeAt(0))
      : escape(character.charCodeAt(0)) + escape(character.charCodeAt(1)),
  );
}

/** Returns the stdout text for one hook call: a decision object, or "" for the client's default behaviour. */
export function run(event, text, { stderr = process.stderr } = {}) {
  if (!Object.hasOwn(handlers, event)) return "";
  const eventHandlers = handlers[event];
  let context;
  try {
    context = readPayload(text);
  } catch (error) {
    const decision = failSafe(event, text);
    stderr.write(`APEX hook: unreadable ${event} payload (${error.message}); ${decision ? "denied" : "allowed"}.\n`);
    return decision ? serialize(decision) : "";
  }
  for (const handler of eventHandlers) {
    try {
      const decision = handler(context);
      if (decision) return serialize(decision);
    } catch (error) {
      const decision = failSafe(event, text);
      stderr.write(`APEX hook: ${event} check failed (${error.message}); ${decision ? "denied" : "allowed"}.\n`);
      if (decision) return serialize(decision);
    }
  }
  return "";
}

async function readStdin() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function invokedDirectly() {
  try {
    return (
      process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  let text = "";
  try {
    text = await readStdin();
  } catch (error) {
    process.stderr.write(`APEX hook: cannot read stdin (${error.message}).\n`);
  }
  const output = run(process.argv[2] ?? "", text);
  if (output) process.stdout.write(`${output}\n`);
  process.exitCode = 0;
}
