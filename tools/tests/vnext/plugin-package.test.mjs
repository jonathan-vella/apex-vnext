import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { load as loadYaml } from "js-yaml";
import {
  build,
  hashTree,
  validateMcpJson,
  validatePackageManifest,
  validatePackagedAgents,
  validatePluginJson,
} from "../../scripts/build-plugin.mjs";

const root = resolve(import.meta.dirname, "../../..");
const manifestPath = join(root, "plugin/package-manifest.json");
const protocolVersion = "2026-07-28";
const fixedTime = Date.parse("2000-01-01T00:00:00.000Z");
const responseTimeoutMs = 60_000;
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function temporaryDirectory(context, name) {
  const directory = await mkdtemp(join(tmpdir(), `apex-plugin-${name}-`));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function buildInto(context, name) {
  const outputDirectory = join(await temporaryDirectory(context, name), "plugin");
  return { ...(await build({ manifestPath, outputDirectory })), outputDirectory };
}

function frontmatterOf(source) {
  const match = /^---\n([\s\S]*?)\n---\n?/u.exec(source.replaceAll("\r\n", "\n"));
  assert.notEqual(match, null);
  return { frontmatter: loadYaml(match[1]), body: source.replaceAll("\r\n", "\n").slice(match[0].length) };
}

async function readManifest() {
  return readJson(manifestPath);
}

test("plugin build is byte reproducible with fixed mtimes", async (context) => {
  const first = await buildInto(context, "first");
  const second = await buildInto(context, "second");
  assert.match(first.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.files, second.files);
  assert.deepEqual(first.bundle, second.bundle);
  assert.deepEqual(await hashTree(first.outputDirectory), await hashTree(second.outputDirectory));
  for (const path of ["plugin.json", "mcp", "mcp/apex.mjs", "assets/manifest.json"]) {
    assert.equal((await stat(join(first.outputDirectory, path))).mtimeMs, fixedTime, path);
  }
  assert.equal(
    await readFile(`${first.outputDirectory}.sha256`, "utf8"),
    `${first.sha256}  plugin\n`,
    "sidecar hash names only the output folder",
  );
});

test("plugin layout, manifests, agents, skills and bundle are valid", async (context) => {
  const { outputDirectory, files, bundle } = await buildInto(context, "layout");
  const manifest = await readManifest();
  const topLevel = [...new Set(files.map((path) => path.split("/", 1)[0]))].sort();
  assert.deepEqual(topLevel, ["assets", "com.github.copilot", "mcp", "mcp.json", "plugin.json", "skills"]);
  assert.ok(files.every((path) => !path.split("/").includes("node_modules")));

  const plugin = await readJson(join(outputDirectory, "plugin.json"));
  validatePluginJson(plugin);
  assert.equal(plugin.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(plugin.name, "apex");
  assert.equal(plugin.version, (await readJson(join(root, "packages/cli/package.json"))).version);
  assert.equal(plugin.repository, "https://github.com/jonathan-vella/apex-vnext");

  const mcp = await readJson(join(outputDirectory, "mcp.json"));
  validateMcpJson(mcp, manifest);
  assert.deepEqual(mcp.mcpServers.apex, { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}/mcp/apex.mjs"] });
  const entry = mcp.mcpServers.apex.args[0].replace("${PLUGIN_ROOT}/", "");
  assert.ok((await stat(join(outputDirectory, entry))).isFile(), "MCP entry exists in the package");

  const agentsRoot = join(outputDirectory, "com.github.copilot/agents");
  const agents = (await readdir(agentsRoot)).sort();
  assert.deepEqual(agents, [
    "apex-codegen.agent.md",
    "apex-reviewer.agent.md",
    "apex-validator.agent.md",
    "apex.agent.md",
  ]);
  for (const file of agents) {
    const { frontmatter, body } = frontmatterOf(await readFile(join(agentsRoot, file), "utf8"));
    for (const field of ["model", "model-policy", "reasoning-effort"]) assert.equal(frontmatter[field], undefined);
    assert.ok(body.length <= 30_000, `${file} body is ${body.length} characters`);
    assert.equal(frontmatter["user-invocable"], file === "apex.agent.md", `${file} visibility`);
  }

  const skills = (await readdir(join(outputDirectory, "skills"))).sort();
  assert.deepEqual(skills, (await readdir(join(root, "customizations/.github/skills"))).sort());
  for (const skill of skills) {
    const { frontmatter } = frontmatterOf(await readFile(join(outputDirectory, "skills", skill, "SKILL.md"), "utf8"));
    assert.equal(frontmatter.name, skill);
  }

  assert.deepEqual(manifest.hooks.entries, []);
  await assert.rejects(stat(join(outputDirectory, "com.github.copilot/hooks")), { code: "ENOENT" });
  const assetFiles = files.filter((path) => path.startsWith("assets/")).map((path) => path.slice("assets/".length));
  assert.ok(assetFiles.includes("manifest.json"));
  assert.deepEqual(assetFiles, (await hashTree(join(root, "packages/cli/assets"))).files);

  const source = await readFile(join(outputDirectory, bundle.path), "utf8");
  assert.equal(bundle.bytes, Buffer.byteLength(source));
  assert.ok(!source.includes("@modelcontextprotocol/sdk"), "bundle carries no v1 SDK");
  assert.ok(!source.includes(root), "bundle embeds no checkout path");
  const staticImports = [...source.matchAll(/^import\s[^"']*["']([^"']+)["'];?$/gmu)].map((match) => match[1]);
  assert.ok(staticImports.length > 0);
  assert.deepEqual(
    staticImports.filter((specifier) => !builtins.has(specifier)),
    [],
  );
});

test("plugin validators reject drift from the Agent Plugins 1.0 and APEX contracts", async (context) => {
  const manifest = await readManifest();
  const plugin = await readJson(join(root, "plugin/plugin.json"));
  const mcp = await readJson(join(root, "plugin/mcp.json"));
  assert.throws(() => validatePluginJson({ ...plugin, agents: "agents/" }), /unsupported fields: agents/u);
  assert.throws(() => validatePluginJson({ ...plugin, name: "APEX" }), /name constraints/u);
  assert.throws(() => validatePluginJson({ ...plugin, $schema: undefined }), /\$schema/u);
  const server = (overrides) => ({ ...mcp, mcpServers: { apex: { ...mcp.mcpServers.apex, ...overrides } } });
  assert.throws(() => validateMcpJson(server({ command: "npx" }), manifest), /must run node/u);
  assert.throws(() => validateMcpJson(server({ args: ["./mcp/apex.mjs"] }), manifest), /must run node/u);
  assert.throws(() => validateMcpJson(server({ env: { PLUGIN_ROOT: "x" } }), manifest), /PLUGIN_ROOT/u);
  assert.throws(() => validateMcpJson(server({ tools: ["status"] }), manifest), /unsupported fields: tools/u);
  assert.throws(() => validateMcpJson({ ...mcp, servers: {} }, manifest), /unsupported fields: servers/u);
  assert.throws(
    () => validatePackageManifest({ ...manifest, assets: { ...manifest.assets, targetRoot: "apex-assets" } }),
    /must ship at assets/u,
  );
  assert.throws(
    () => validatePackageManifest({ ...manifest, agents: { ...manifest.agents, targetRoot: "agents" } }),
    /com\.github\.copilot\/agents/u,
  );
  assert.throws(
    () => validatePackageManifest({ ...manifest, hooks: { ...manifest.hooks, entries: ["../hook.mjs"] } }),
    /hooks entries/u,
  );

  const agentsRoot = await temporaryDirectory(context, "agents");
  const agent = (frontmatter, body = "Body\n") => `---\nname: Test\ndescription: Test\n${frontmatter}---\n${body}`;
  await writeFile(join(agentsRoot, "pinned.agent.md"), agent("model: gpt-5\n"));
  await assert.rejects(validatePackagedAgents(agentsRoot, "."), /must not pin model/u);
  await writeFile(join(agentsRoot, "pinned.agent.md"), agent("", "x".repeat(30_001)));
  await assert.rejects(validatePackagedAgents(agentsRoot, "."), /exceeds 30000 characters/u);
  await writeFile(join(agentsRoot, "pinned.agent.md"), agent("", "x".repeat(30_000)));
  await validatePackagedAgents(agentsRoot, ".");
});

const guardHook = `import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (resolved.url.includes("/node_modules/")) throw new Error("Plugin runtime resolved " + resolved.url);
    return resolved;
  },
});
`;

function cli(cwd, args) {
  const result = spawnSync(process.execPath, [join(root, "packages/cli/dist/cli.js"), ...args, "--json"], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function offlinePlugin(context) {
  const { outputDirectory } = await buildInto(context, "offline-build");
  const sandbox = await temporaryDirectory(context, "offline");
  const pluginRoot = join(sandbox, "installed", "apex");
  const pluginData = join(sandbox, "data", "apex");
  const workspace = join(sandbox, "workspace");
  await cp(outputDirectory, pluginRoot, { recursive: true });
  await mkdir(pluginData, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const git = spawnSync("git", ["init", "--quiet", workspace], { encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  const init = cli(workspace, ["init", "--project", "plugin-test", "--risk-owner", "partner", "--target", "local"]);
  assert.equal(init.ok, true);
  const guard = join(sandbox, "guard.mjs");
  await writeFile(guard, guardHook);
  return { pluginRoot, pluginData, workspace, guard };
}

function startServer({ pluginRoot, pluginData, guard }) {
  const env = {
    PATH: dirname(process.execPath),
    PLUGIN_ROOT: pluginRoot,
    PLUGIN_DATA: pluginData,
    NPM_CONFIG_OFFLINE: "true",
    npm_config_offline: "true",
    ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}),
  };
  assert.equal(env.PATH.split(delimiter).length, 1);
  const child = spawn(process.execPath, ["--import", pathToFileURL(guard).href, join(pluginRoot, "mcp/apex.mjs")], {
    cwd: pluginRoot,
    env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolveExit) => child.once("exit", (code, signal) => resolveExit({ code, signal })));
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const next = async () => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for MCP output\n${stderr}`)), responseTimeoutMs);
    });
    try {
      const line = await Promise.race([lines.next(), timeout]);
      assert.equal(line.done, false, `MCP server closed stdout\n${stderr}`);
      return JSON.parse(line.value);
    } finally {
      clearTimeout(timer);
    }
  };
  const close = async () => {
    child.stdin.end();
    return { ...(await exited), stderr };
  };
  return { child, send, next, close, stderr: () => stderr };
}

const modernMeta = {
  "io.modelcontextprotocol/protocolVersion": protocolVersion,
  "io.modelcontextprotocol/clientInfo": { name: "apex-plugin-test", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

test("packaged MCP server starts offline and serves 2026-07-28 discovery, tools and status", async (context) => {
  const plugin = await offlinePlugin(context);
  const server = startServer(plugin);
  context.after(() => server.child.kill());
  server.send({ id: 1, method: "server/discover", params: { _meta: modernMeta } });
  const discovered = await server.next();
  assert.equal(discovered.id, 1, JSON.stringify(discovered));
  assert.ok(discovered.result.supportedVersions.includes(protocolVersion), JSON.stringify(discovered));
  assert.equal(typeof discovered.result.instructions, "string");
  assert.ok(discovered.result.instructions.length > 0);

  server.send({ id: 2, method: "tools/list", params: { _meta: modernMeta } });
  const listed = await server.next();
  assert.equal(listed.id, 2, JSON.stringify(listed));
  assert.ok(listed.result.tools.some((tool) => tool.name === "status"));

  server.send({
    id: 3,
    method: "tools/call",
    params: { name: "status", arguments: { workspace: plugin.workspace }, _meta: modernMeta },
  });
  const called = await server.next();
  assert.equal(called.id, 3, JSON.stringify(called));
  assert.equal(called.error, undefined, JSON.stringify(called));
  assert.notEqual(called.result.isError, true, JSON.stringify(called.result));
  assert.deepEqual(called.result.structuredContent, cli(plugin.workspace, ["status"]).result);

  const exit = await server.close();
  assert.deepEqual({ code: exit.code, signal: exit.signal }, { code: 0, signal: null }, exit.stderr);
  assert.equal(exit.stderr, "");
});

test("packaged MCP server answers a Copilot discover then 2025-11-25 initialize fallback", async (context) => {
  const plugin = await offlinePlugin(context);
  const server = startServer(plugin);
  context.after(() => server.child.kill());
  server.send({ id: 1, method: "server/discover", params: { _meta: modernMeta } });
  const discovered = await server.next();
  assert.equal(discovered.id, 1);
  assert.ok(discovered.result.supportedVersions.includes(protocolVersion), JSON.stringify(discovered));
  server.send({
    id: 2,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "apex-plugin-fallback-test", version: "1.0.0" },
    },
  });
  const initialized = await server.next();
  assert.equal(initialized.id, 2);
  assert.equal(initialized.error, undefined, JSON.stringify(initialized));
  assert.equal(initialized.result.protocolVersion, "2025-11-25");
  assert.equal(initialized.result.serverInfo.name, "apex");
  server.send({ method: "notifications/initialized" });
  server.send({ id: 3, method: "tools/list" });
  const listed = await server.next();
  assert.equal(listed.id, 3);
  assert.ok(listed.result.tools.some((tool) => tool.name === "status"));
  const exit = await server.close();
  assert.deepEqual({ code: exit.code, signal: exit.signal }, { code: 0, signal: null }, exit.stderr);
});
