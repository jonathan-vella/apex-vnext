import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { load as loadYaml } from "js-yaml";
import { build, hashTree } from "../../scripts/build-plugin.mjs";

const root = resolve(import.meta.dirname, "../../..");
const manifestPath = join(root, "plugin/package-manifest.json");
const runTimeoutMs = 120_000;

function bytewise(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function listFiles(rootDirectory) {
  const files = [];
  async function visit(directory, relativeDirectory = "") {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      bytewise(left.name, right.name),
    )) {
      const relativePath = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) await visit(join(directory, entry.name), relativePath);
      else if (entry.isFile()) files.push(relativePath);
      else throw new Error(`Unsupported package entry: ${relativePath}`);
    }
  }
  await visit(rootDirectory);
  return files;
}

async function buildInto(context, name) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), `apex-plugin-${name}-`));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const outputDirectory = join(temporaryRoot, "plugin");
  const result = await build({ manifestPath, outputDirectory });
  return { ...result, outputDirectory };
}

function parseAgentFrontmatter(path, source) {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(source.replaceAll("\r\n", "\n"));
  assert.notEqual(match, null, `${path} has YAML frontmatter`);
  return loadYaml(match[1]);
}

test("plugin build is byte reproducible", async (context) => {
  const first = await buildInto(context, "first");
  const second = await buildInto(context, "second");
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.files, second.files);
  assert.deepEqual(await hashTree(first.outputDirectory), await hashTree(first.outputDirectory));
});

test("plugin manifest, paths, agents, skills, hooks and MCP config are valid", async (context) => {
  const { outputDirectory } = await buildInto(context, "manifest");
  const manifest = await readJson(manifestPath);
  const plugin = await readJson(join(outputDirectory, "plugin.json"));
  const cliPackage = await readJson(join(root, "packages/cli/package.json"));
  assert.equal(plugin.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(plugin.name, "apex");
  assert.equal(plugin.version, cliPackage.version);
  assert.equal(plugin.repository, "https://github.com/jonathan-vella/apex-vnext");

  const mcp = await readJson(join(outputDirectory, "mcp.json"));
  const server = mcp.mcpServers?.[manifest.mcp.server];
  assert.equal(mcp.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
  assert.equal(server?.type, "stdio");
  assert.equal(server.command, manifest.mcp.command);
  assert.deepEqual(server.args, [manifest.mcp.entry]);
  assert.equal(server.env?.PLUGIN_ROOT, undefined);
  assert.equal(server.command, "node");
  assert.match(server.args[0], /^\$\{PLUGIN_ROOT\}\//u);
  assert.ok(!server.args.some((argument) => /\bnpx\b|\.sh$/u.test(argument)));
  await readFile(join(outputDirectory, "mcp/apex.mjs"));

  const agentRoot = join(outputDirectory, manifest.agents.targetRoot);
  const agentFiles = (await listFiles(agentRoot)).filter((path) => path.endsWith(".md"));
  assert.ok(agentFiles.includes("apex.agent.md"));
  assert.ok(agentFiles.includes("apex-codegen.agent.md"));
  assert.ok(agentFiles.includes("apex-reviewer.agent.md"));
  assert.ok(agentFiles.includes("apex-validator.agent.md"));
  for (const file of agentFiles) {
    const frontmatter = parseAgentFrontmatter(file, await readFile(join(agentRoot, file), "utf8"));
    assert.equal(typeof frontmatter.name, "string");
    assert.equal(frontmatter.model, undefined, `${file} does not pin model`);
    assert.equal(frontmatter["model-policy"], undefined, `${file} does not pin model policy`);
    assert.equal(frontmatter["reasoning-effort"], undefined, `${file} does not pin reasoning effort`);
  }

  const skillRoot = join(outputDirectory, manifest.skills.targetRoot);
  const skillFiles = await listFiles(skillRoot);
  assert.ok(skillFiles.includes("apex-next/SKILL.md"));
  assert.ok(skillFiles.includes("apex-workflow/SKILL.md"));
  assert.ok(skillFiles.every((path) => !path.includes("\\")));

  assert.equal(manifest.hooks.targetRoot, "com.github.copilot/hooks");
  assert.deepEqual(manifest.hooks.entries, []);
  assert.ok((await listFiles(join(outputDirectory, "assets"))).includes("manifest.json"));
  assert.ok(
    (await listFiles(join(outputDirectory, "runtime/node_modules/@apexops/cli/assets"))).includes("manifest.json"),
  );
});

function rpcMessage(message) {
  return `${JSON.stringify(message)}\n`;
}

async function run(command, args, cwd, options = {}) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...options.env },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} ${args.join(" ")} timed out\n${stderr}${stdout}`));
    }, options.timeoutMs ?? runTimeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}\n${stderr}${stdout}`));
    });
  });
}

async function mcpSession(entrypoint, pluginRoot, workspace) {
  const child = spawn(process.execPath, [entrypoint], {
    cwd: pluginRoot,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      PATH: dirnameOfNode(),
      SystemRoot: process.env.SystemRoot,
      ComSpec: process.env.ComSpec,
      PLUGIN_ROOT: pluginRoot,
      NPM_CONFIG_OFFLINE: "true",
      npm_config_offline: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  });
  const stderr = [];
  const responses = [];
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
    for (;;) {
      const newline = stdout.indexOf("\n");
      if (newline === -1) return;
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (line.length > 0) responses.push(JSON.parse(line));
    }
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr.push(chunk);
  });
  child.stdin.write(
    rpcMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "apex-plugin-test", version: "0.0.0" },
      },
    }),
  );
  child.stdin.write(rpcMessage({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }));
  child.stdin.write(rpcMessage({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
  child.stdin.write(
    rpcMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "status", arguments: { workspace } },
    }),
  );
  const expected = await waitForResponses(responses, [1, 2, 3], stderr);
  child.stdin.end();
  child.kill("SIGTERM");
  await new Promise((resolvePromise) => child.once("close", resolvePromise));
  return expected;
}

function dirnameOfNode() {
  return process.execPath.slice(0, Math.max(process.execPath.lastIndexOf("/"), process.execPath.lastIndexOf("\\")));
}

async function waitForResponses(responses, ids, stderr) {
  const deadline = Date.now() + runTimeoutMs;
  while (Date.now() < deadline) {
    const found = new Map(
      responses.filter((message) => ids.includes(message.id)).map((message) => [message.id, message]),
    );
    if (ids.every((id) => found.has(id))) return found;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Timed out waiting for MCP responses. stderr:\n${stderr.join("")}`);
}

test("plugin MCP server starts offline and serves status from packaged runtime", async (context) => {
  const { outputDirectory } = await buildInto(context, "offline");
  const workspace = await mkdtemp(join(tmpdir(), "apex-plugin-workspace-"));
  context.after(() => rm(workspace, { recursive: true, force: true }));
  await run("git", ["init"], workspace);
  const responses = await mcpSession(join(outputDirectory, "mcp/apex.mjs"), outputDirectory, workspace);
  assert.equal(responses.get(1).result.serverInfo.name, "apex");
  assert.ok(responses.get(2).result.tools.some((tool) => tool.name === "status"));
  const status = responses.get(3).result.structuredContent;
  assert.equal(status.error.code, "APEX_NOT_FOUND");
  assert.match(status.error.message, /Requested APEX state was not found/u);
  assert.equal(
    createHash("sha256")
      .update(await readFile(join(outputDirectory, "plugin.json")))
      .digest("hex").length,
    64,
  );
});
