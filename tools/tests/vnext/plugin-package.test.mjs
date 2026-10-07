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
import { renderClientAgentProjection } from "../../../packages/cli/scripts/prepare-assets.mjs";
import {
  build,
  hashTree,
  validateMcpJson,
  validatePackageManifest,
  validatePackagedAgents,
  validatePackagedHooks,
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

test("plugin build replaces only an empty folder or a previous build", async (context) => {
  const parent = await temporaryDirectory(context, "guard");
  const unrelated = join(parent, "unrelated");
  await mkdir(unrelated);
  await writeFile(join(unrelated, "keep.txt"), "keep\n");
  await assert.rejects(build({ manifestPath, outputDirectory: unrelated }), /not a previous plugin build/u);
  assert.equal(await readFile(join(unrelated, "keep.txt"), "utf8"), "keep\n");
  const outputDirectory = join(parent, "plugin");
  const first = await build({ manifestPath, outputDirectory });
  const second = await build({ manifestPath, outputDirectory });
  assert.equal(second.sha256, first.sha256);
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
  assert.deepEqual(Object.keys(mcp.mcpServers), ["apex", "apex-azure-pricing"]);
  assert.deepEqual(mcp.mcpServers.apex, { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}/mcp/apex.mjs"] });
  assert.deepEqual(mcp.mcpServers["apex-azure-pricing"], {
    type: "streamable-http",
    url: "https://mcp.management.azure.com",
    headers: { "x-mcp-toolset": "CostManagement,Pricing" },
  });
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
    assert.equal(frontmatter.target, "github-copilot", `${file} target`);
    assert.ok(
      frontmatter.tools.every((tool) => !tool.startsWith("azure-resource-manager-mcp/")),
      `${file} uses the plugin server name`,
    );
  }

  const customizationManifest = await readJson(join(root, "customizations/manifest.json"));
  for (const path of customizationManifest.plugin.files) {
    const packaged = path.startsWith(".github/agents/")
      ? `com.github.copilot/agents/${path.slice(".github/agents/".length)}`
      : `skills/${path.slice(".github/skills/".length)}`;
    assert.ok(files.includes(packaged), `plugin replaces the retired workspace copy ${path}`);
  }
  const projectionAssets = files.filter((path) => path.startsWith("assets/client-projections/github-copilot-cli/"));
  assert.ok(projectionAssets.includes("assets/client-projections/github-copilot-cli/.github/copilot/settings.json"));
  assert.deepEqual(
    projectionAssets.filter((path) => /\/\.github\/(?:agents|skills)\/|\/\.mcp\.json$/u.test(path)),
    [],
    "the bundled CLI projection carries no plugin-owned copies",
  );

  const skills = (await readdir(join(outputDirectory, "skills"))).sort();
  assert.deepEqual(skills, (await readdir(join(root, "customizations/.github/skills"))).sort());
  for (const skill of skills) {
    const { frontmatter } = frontmatterOf(await readFile(join(outputDirectory, "skills", skill, "SKILL.md"), "utf8"));
    assert.equal(frontmatter.name, skill);
  }

  assert.deepEqual(manifest.hooks.entries, ["apex-hook.mjs", "hooks.json"]);
  assert.deepEqual(
    files.filter((path) => path.startsWith("com.github.copilot/hooks/")),
    ["com.github.copilot/hooks/apex-hook.mjs", "com.github.copilot/hooks/hooks.json"],
  );
  assert.equal(
    await readFile(join(outputDirectory, "com.github.copilot/hooks/apex-hook.mjs"), "utf8"),
    (await readFile(join(root, "plugin/hooks/apex-hook.mjs"), "utf8")).replaceAll("\r\n", "\n"),
    "the dependency-free hook script ships unbundled",
  );
  const hooks = await readJson(join(outputDirectory, "com.github.copilot/hooks/hooks.json"));
  assert.deepEqual(Object.keys(hooks), ["version", "hooks"]);
  assert.equal(hooks.version, 1);
  assert.deepEqual(Object.keys(hooks.hooks), ["preToolUse"]);
  assert.equal(hooks.hooks.preToolUse.length, 1);
  const [hook] = hooks.hooks.preToolUse;
  assert.equal(hook.type, "command");
  assert.equal(hook.matcher, "task");
  assert.match(hook.bash, /exec node "\$f" preToolUse;/u);
  assert.ok(hook.bash.includes('f="${PLUGIN_ROOT}/com.github.copilot/hooks/apex-hook.mjs"'));
  assert.match(hook.powershell, /& node \$f preToolUse/u);
  assert.ok(hook.powershell.includes("$env:PLUGIN_ROOT, 'com.github.copilot', 'hooks', 'apex-hook.mjs'"));
  assert.ok(hook.timeoutSec > 0 && hook.timeoutSec <= 30);
  await validatePackagedHooks(outputDirectory, manifest);
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

test("plugin agents and skills carry the guidance the retired workspace copies carried", async (context) => {
  const { outputDirectory } = await buildInto(context, "replacement");
  const toolInventory = await readJson(join(root, "tools/registry/copilot-cli-agent-tools.json"));
  const agentsRoot = join(outputDirectory, "com.github.copilot/agents");
  const apexAgent = await readFile(join(agentsRoot, "apex.agent.md"), "utf8");
  assert.equal(
    apexAgent,
    renderClientAgentProjection(
      await readFile(join(root, "customizations/.github/agents/apex.agent.md"), "utf8"),
      "github-copilot-cli",
      toolInventory,
      { delegates: true },
    ),
  );
  const { frontmatter } = frontmatterOf(apexAgent);
  assert.deepEqual(frontmatter.tools, [
    "ask_user",
    "task",
    "view",
    "glob",
    "rg",
    "web_fetch",
    "apex/status",
    "apex/releaseWriter",
    "apex/nextTask",
    "apex/projectCreate",
    "apex/projectList",
    "apex/projectUse",
    "apex/projectDelete",
    "apex/recordInput",
    "apex/taskContext",
    "apex/readTaskInput",
    "apex/requirementsComplete",
    "apex/architectureComplete",
    "apex/planComplete",
    "apex/completeTask",
    "apex/reviewDecide",
    "apex/gateDecide",
    "apex/governanceImport",
    "apex/governanceSelect",
    "apex/preview",
    "apex/reconcile",
    "apex/inventory",
    "apex/diagnose",
    "apex-azure-pricing/get_retail_prices",
    "apex-azure-pricing/query_costs",
    "apex-azure-pricing/query_aks_costs",
    "apex-azure-pricing/forecast_costs",
    "apex-azure-pricing/list_dimensions",
    "apex-azure-pricing/list_budgets",
    "apex-azure-pricing/get_budget",
    "apex-azure-pricing/list_alerts",
    "apex-azure-pricing/list_benefit_utilization",
    "apex-azure-pricing/get_benefit_recommendations",
    "apex-azure-pricing/list_reservation_transactions",
  ]);
  assert.doesNotMatch(apexAgent, /vscode\/askQuestions|handoffs:|agents:/u);
  assert.match(apexAgent, /## Client Mechanics/u);
  assert.match(apexAgent, /Route through the `apex-next` skill in this same APEX agent/u);
  assert.match(apexAgent, /Use `ask_user` for project lifecycle choices/u);
  assert.match(apexAgent, /Reuse values the user already stated/u);
  assert.match(apexAgent, /Carry the user's requested outcome, stop point and prohibited operations/u);
  assert.match(apexAgent, /If a gate is pending, report it and stop/u);
  assert.match(apexAgent, /worker to call `apex\/taskContext`/u);
  for (const worker of ["apex-codegen.agent.md", "apex-reviewer.agent.md", "apex-validator.agent.md"]) {
    const profile = await readFile(join(agentsRoot, worker), "utf8");
    assert.match(profile, /user-invocable: false/u);
    assert.doesNotMatch(profile, /- ask_user/u);
  }
  const skill = (...path) => readFile(join(outputDirectory, "skills", ...path), "utf8");
  const apexNext = await skill("apex-next", "SKILL.md");
  assert.match(apexNext, /^name: apex-next$/mu);
  assert.match(apexNext, /No `\/agent` switching/u);
  assert.match(await skill("apex-planning", "SKILL.md"), /kernel derives the canonical intent hash/u);
  assert.match(await skill("apex-architecture", "SKILL.md"), /`apex-azure-pricing\/get_retail_prices`/u);
  assert.match(await skill("apex-azure-defaults", "references", "security-baseline.md"), /Core Controls/u);
  assert.match(
    await skill("apex-artifacts", "templates", "requirements.md"),
    /Derived from accepted APEX requirements/u,
  );
});

test("plugin validators reject drift from the Agent Plugins 1.0 and APEX contracts", async (context) => {
  const manifest = await readManifest();
  const plugin = await readJson(join(root, "plugin/plugin.json"));
  const mcp = await readJson(join(root, "plugin/mcp.json"));
  assert.throws(() => validatePluginJson({ ...plugin, agents: "agents/" }), /unsupported fields: agents/u);
  assert.throws(() => validatePluginJson({ ...plugin, name: "APEX" }), /name constraints/u);
  assert.throws(() => validatePluginJson({ ...plugin, $schema: undefined }), /\$schema/u);
  assert.throws(() => validatePluginJson({ ...plugin, extensions: null }), /extensions/u);
  assert.throws(() => validatePluginJson({ ...plugin, extensions: [{}] }), /extensions/u);
  validatePluginJson({ ...plugin, extensions: { "com.github.copilot": {} } });
  const server = (overrides) => ({ ...mcp, mcpServers: { apex: { ...mcp.mcpServers.apex, ...overrides } } });
  assert.throws(() => validateMcpJson(server({ command: "npx" }), manifest), /must run node/u);
  assert.throws(() => validateMcpJson(server({ args: ["./mcp/apex.mjs"] }), manifest), /must run node/u);
  assert.throws(() => validateMcpJson(server({ env: { PLUGIN_ROOT: "x" } }), manifest), /PLUGIN_ROOT/u);
  assert.throws(() => validateMcpJson(server({ tools: ["status"] }), manifest), /unsupported fields: tools/u);
  assert.throws(() => validateMcpJson({ ...mcp, servers: {} }, manifest), /unsupported fields: servers/u);
  assert.throws(() => validateMcpJson(server({ cwd: ["./data"] }), manifest), /cwd/u);
  const remote = (entry) => ({ ...mcp, mcpServers: { ...mcp.mcpServers, remote: entry } });
  assert.throws(() => validateMcpJson(remote({ type: "http", url: "https://example.test" }), manifest), /type http/u);
  assert.throws(() => validateMcpJson(remote({ type: "sse", url: 123 }), manifest), /url/u);
  assert.throws(
    () =>
      validateMcpJson(remote({ type: "streamable-http", url: "https://example.test", headers: { a: 1 } }), manifest),
    /headers/u,
  );
  validateMcpJson(remote({ type: "streamable-http", url: "https://example.test", headers: { a: "b" } }), manifest);
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

test("hook validation rejects drift from the Copilot hooks format and the shipped script", async (context) => {
  const manifest = await readManifest();
  const pluginRoot = await temporaryDirectory(context, "hooks");
  const hooksRoot = join(pluginRoot, "com.github.copilot/hooks");
  await mkdir(hooksRoot, { recursive: true });
  const script = await readFile(join(root, "plugin/hooks/apex-hook.mjs"), "utf8");
  const hooks = await readJson(join(root, "plugin/hooks/hooks.json"));
  const [entry] = hooks.hooks.preToolUse;
  const check = async (hooksJson, source = script) => {
    await writeFile(join(hooksRoot, "apex-hook.mjs"), source);
    await writeFile(join(hooksRoot, "hooks.json"), JSON.stringify(hooksJson));
    return validatePackagedHooks(pluginRoot, manifest);
  };
  const prepend = (lines) => script.replace(/^(#!.*\n)/u, (shebang) => `${shebang}${lines}`);
  const withEntry = (overrides, event = "preToolUse") => ({
    version: 1,
    hooks: { [event]: [{ ...entry, ...overrides }] },
  });

  await check(hooks);
  await assert.rejects(check({ ...hooks, version: 2 }), /version must be 1/u);
  await assert.rejects(check({ version: 1, hooks: {} }), /map events/u);
  await assert.rejects(check(withEntry({}, "PreToolUse")), /unsupported event PreToolUse/u);
  await assert.rejects(check({ version: 1, hooks: { preToolUse: [] } }), /non-empty array/u);
  await assert.rejects(check(withEntry({ powershell: undefined })), /missing fields: powershell/u);
  await assert.rejects(check(withEntry({ bash: "   " })), /bash must start with/u);
  await assert.rejects(check(withEntry({ command: "node x" })), /unsupported fields: command/u);
  await assert.rejects(check(withEntry({ type: "http" })), /type must be command/u);
  await assert.rejects(check(withEntry({ matcher: "(" })), SyntaxError);
  await assert.rejects(check(withEntry({ timeoutSec: 0 })), /timeoutSec/u);
  await assert.rejects(check(withEntry({}, "postToolUse")), /bash must be the standard command .* postToolUse/u);
  await assert.rejects(
    check(withEntry({ bash: entry.bash.replace('"$f" preToolUse;', '"$f" wrong; echo preToolUse;') })),
    /bash must be the standard command/u,
  );
  await assert.rejects(
    check(withEntry({ bash: entry.bash.replaceAll("apex-hook.mjs", "other.mjs") })),
    /does not ship: com\.github\.copilot\/hooks\/other\.mjs/u,
  );
  await assert.rejects(
    check(withEntry({ bash: entry.bash.replace('"${PLUGIN_ROOT}/', '"./') })),
    /bash must start with f="\$\{PLUGIN_ROOT\}\/<script>";/u,
  );
  await assert.rejects(
    check(withEntry({ powershell: entry.powershell.replace("'hooks', ", "") })),
    /powershell must be the standard command/u,
  );
  await assert.rejects(
    check(withEntry({ powershell: entry.powershell.replace("& node $f preToolUse", "$input | node $f preToolUse") })),
    /powershell must be the standard command/u,
  );
  for (const [prefix, pattern] of [
    ['import "js-yaml";\n', /only Node builtins/u],
    ['import { x } from "./helper.mjs";\n', /only Node builtins/u],
    ['export * from "./helper.mjs";\n', /only Node builtins/u],
    ['await import("js-yaml");\n', /only Node builtins/u],
    ["const name = process.argv[3];\nawait import(name);\n", /only Node builtins: dynamic import/u],
  ]) {
    await assert.rejects(check(hooks, prepend(prefix)), pattern, prefix);
  }
  await writeFile(join(hooksRoot, "helper.mjs"), "export const x = 1;\n");
  await assert.rejects(check(hooks, prepend('export * from "./helper.mjs";\n')), /only Node builtins: .*helper\.mjs/u);
  await check(hooks, prepend('import { createHash } from "node:crypto";\nimport path from "path";\n'));
});

const hookPayload = (agentType) =>
  JSON.stringify({
    sessionId: "44904b8e-e9ce-470b-911f-8bc7a45eadf3",
    timestamp: 1791378238675,
    cwd: "/workspace",
    toolName: "task",
    toolArgs: { description: "Delegate", prompt: "Résumé ✓", agent_type: agentType, name: "probe", mode: "sync" },
  });

function hookShells() {
  const shells = [];
  if (process.platform !== "win32") shells.push({ name: "bash", field: "bash", args: (command) => ["-c", command] });
  const powershellArgs = (command) => ["-NoProfile", "-NonInteractive", "-Command", command];
  for (const name of process.platform === "win32" ? ["powershell.exe", "pwsh"] : ["pwsh"]) {
    const probe = spawnSync(name, powershellArgs("exit 0"), { encoding: "utf8", windowsHide: true });
    if (probe.status === 0) shells.push({ name, field: "powershell", args: powershellArgs });
  }
  return shells;
}

test("packaged hook commands run end to end through bash and PowerShell", async (context) => {
  const { outputDirectory } = await buildInto(context, "hooks-build");
  const pluginRoot = join(await temporaryDirectory(context, "hooks-run"), "installed plugins", "apex");
  await cp(outputDirectory, pluginRoot, { recursive: true });
  const [entry] = (await readJson(join(pluginRoot, "com.github.copilot/hooks/hooks.json"))).hooks.preToolUse;
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const env = (overrides) => ({
    ...process.env,
    [pathKey]: [dirname(process.execPath), process.env[pathKey]].filter(Boolean).join(delimiter),
    ...overrides,
  });
  const shells = hookShells();
  const expected = process.platform === "win32" ? ["powershell.exe", "pwsh"] : ["bash", "pwsh"];
  assert.ok(shells.length > 0, "bash or PowerShell is available");
  if (process.platform === "win32" || process.env.CI === "true") {
    assert.deepEqual(
      shells.map(({ name }) => name),
      expected,
      "CI runners provide every hook shell",
    );
  }
  for (const shell of shells) {
    const invoke = (input, overrides = { PLUGIN_ROOT: pluginRoot }) =>
      spawnSync(shell.name, shell.args(entry[shell.field]), {
        cwd: pluginRoot,
        env: env(overrides),
        input,
        encoding: "utf8",
        windowsHide: true,
      });
    for (const target of ["apex:apex", "APEX"]) {
      const denied = invoke(hookPayload(target));
      assert.equal(denied.status, 0, `${shell.name}: ${denied.stderr}`);
      assert.deepEqual(
        JSON.parse(denied.stdout),
        {
          permissionDecision: "deny",
          permissionDecisionReason:
            `APEX hook: "${target}" is the user-facing APEX agent and cannot run as a task subagent. ` +
            "Continue in the APEX agent selected in the agent picker; delegate kernel tasks only to hidden APEX workers.",
        },
        shell.name,
      );
    }
    for (const input of [hookPayload("apex:apex-codegen"), hookPayload("explore"), "{broken"]) {
      const allowed = invoke(input);
      assert.equal(allowed.status, 0, `${shell.name}: ${allowed.stderr}`);
      assert.equal(allowed.stdout.trim(), "", `${shell.name} allows ${input}`);
    }
    const missing = invoke(hookPayload("apex:apex"), { PLUGIN_ROOT: join(pluginRoot, "missing") });
    assert.equal(missing.status, 0, `${shell.name}: ${missing.stderr}`);
    assert.equal(missing.stdout.trim(), "", `${shell.name} fails open without the script`);
    assert.match(missing.stderr, /APEX hook: .* is missing; reinstall the APEX plugin\. Call allowed\./u);
  }
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
