import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const readJson = async (name) => JSON.parse(await readFile(resolve(root, name), "utf8"));

const plugin = await readJson("plugin.json");
const mcp = await readJson("mcp.json");
const packageJson = await readJson("package.json");

assert.equal(plugin.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
assert.equal(mcp.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
assert.deepEqual(Object.keys(mcp.mcpServers), ["host-probe"]);
assert.equal(mcp.mcpServers["host-probe"].type, "stdio");
assert.equal(packageJson.dependencies["@modelcontextprotocol/server"], "2.4.0");
assert.equal(packageJson.engines.node, ">=26.13.1");

const coordinator = await readFile(
  resolve(root, "com.github.copilot/agents/host-feasibility-coordinator.agent.md"),
  "utf8",
);
const leaf = await readFile(
  resolve(root, "com.github.copilot/agents/host-feasibility-leaf.agent.md"),
  "utf8",
);
const rule = await readFile(
  resolve(root, "com.github.copilot/rules/probe.instructions.md"),
  "utf8",
);

assert.match(coordinator, /tools: \[read, search, task, ask_user, "host-probe\/\*"\]/u);
assert.match(leaf, /user-invocable: false/u);
assert.match(leaf, /tools: \[read, search\]/u);
assert.match(leaf, /name: Host Feasibility Leaf/u);
assert.match(rule, /applyTo: "\*\*\/\*\.bicep"/u);

process.stdout.write("Spike manifest and least-privilege checks passed.\n");
