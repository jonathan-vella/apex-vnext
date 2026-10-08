import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  buildReviewPrompt,
  loadReviewCaptures,
  reviewCaptureKey,
  reviewPromptSha256,
  verifyIssuedReviewCapture,
} from "../../../packages/kernel/dist/index.js";
import { mcpToolPolicy } from "../../../packages/cli/dist/mcp.js";
import {
  build,
  hashTree,
  renderHookScript,
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
  assert.deepEqual(first.native, second.native);
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
  assert.deepEqual(topLevel, ["assets", "com.github.copilot", "mcp", "mcp.json", "native", "plugin.json", "skills"]);
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
  assert.deepEqual(agents, ["apex-codegen.agent.md", "apex-validator.agent.md", "apex.agent.md"]);
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
  assert.equal(manifest.hooks.toolPolicy, "apex-mcp-tools.json");
  assert.deepEqual(
    files.filter((path) => path.startsWith("com.github.copilot/hooks/")),
    [
      "com.github.copilot/hooks/apex-hook.mjs",
      "com.github.copilot/hooks/apex-mcp-tools.json",
      "com.github.copilot/hooks/hooks.json",
    ],
  );
  const policy = await readJson(join(outputDirectory, "com.github.copilot/hooks/apex-mcp-tools.json"));
  assert.deepEqual(policy, mcpToolPolicy(), "the deny hook policy is derived from the MCP adapter");
  assert.deepEqual(policy.readOnly, ["doctorChecks", "projectList", "status"]);
  assert.equal(
    await readFile(join(outputDirectory, "com.github.copilot/hooks/apex-hook.mjs"), "utf8"),
    renderHookScript(
      (await readFile(join(root, "plugin/hooks/apex-hook.mjs"), "utf8")).replaceAll("\r\n", "\n"),
      (await readJson(join(root, "tools/registry/arm-mcp-cost-pricing.v1.json"))).managedPolicy.candidateReadAllowlist,
    ).toString("utf8"),
    "the dependency-free hook script ships unbundled apart from the generated read allowlist",
  );
  const hooks = await readJson(join(outputDirectory, "com.github.copilot/hooks/hooks.json"));
  assert.deepEqual(Object.keys(hooks), ["version", "hooks"]);
  assert.equal(hooks.version, 1);
  assert.deepEqual(Object.keys(hooks.hooks), [
    "preToolUse",
    "postToolUse",
    "postToolUseFailure",
    "subagentStart",
    "subagentStop",
  ]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(hooks.hooks).map(([event, entries]) => [event, entries.map((e) => e.matcher)])),
    {
      preToolUse: ["task|Task|Agent|.*apex[-_]azure[-_]pricing.*", "apex-.*|apex/.*|mcp__apex__.*"],
      postToolUse: ["task|Task|Agent"],
      postToolUseFailure: [undefined],
      subagentStart: ["rubber-duck"],
      subagentStop: [undefined],
    },
  );
  for (const [event, entries] of Object.entries(hooks.hooks))
    for (const entry of entries) {
      assert.match(entry.bash, new RegExp(`exec node "\\$f" ${event};`, "u"));
      assert.match(entry.powershell, new RegExp(`& node \\$f ${event}`, "u"));
    }
  const [hook] = hooks.hooks.preToolUse;
  assert.equal(hook.type, "command");
  assert.equal(hook.matcher, "task|Task|Agent|.*apex[-_]azure[-_]pricing.*");
  const matcher = new RegExp(`^(?:${hook.matcher})$`, "u");
  for (const name of [
    "task",
    "Task",
    "Agent",
    "apex-azure-pricing-create_budget",
    "mcp__apex_azure_pricing__get_budget",
  ])
    assert.ok(matcher.test(name), name);
  for (const name of ["bash", "view", "apex-status", "tasks", "agent"]) assert.ok(!matcher.test(name), name);
  // Every subagent tool name the hook script handles reaches it through the postToolUse capture entry too.
  const capture = new RegExp(`^(?:${hooks.hooks.postToolUse[0].matcher})$`, "u");
  for (const name of ["task", "Task", "Agent"]) assert.ok(capture.test(name), name);
  const registry = await readJson(join(root, "tools/registry/arm-mcp-cost-pricing.v1.json"));
  const packagedHook = await readFile(join(outputDirectory, "com.github.copilot/hooks/apex-hook.mjs"), "utf8");
  const generated =
    /^export const PRICING_READ_TOOLS = Object\.freeze\((\[.*\])\); \/\/ generated by build-plugin\.mjs$/mu.exec(
      packagedHook,
    );
  assert.notEqual(generated, null, "the packaged hook carries the generated read allowlist");
  assert.deepEqual(JSON.parse(generated[1]), registry.managedPolicy.candidateReadAllowlist);
  assert.ok(!packagedHook.includes("@apex-build: pricing-read-tools"));
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
    "apex/reviewComplete",
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
  for (const worker of ["apex-codegen.agent.md", "apex-validator.agent.md"]) {
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
  const check = async (hooksJson, source = script, policy = mcpToolPolicy()) => {
    await writeFile(join(hooksRoot, "apex-hook.mjs"), source);
    await writeFile(join(hooksRoot, "hooks.json"), JSON.stringify(hooksJson));
    await writeFile(join(hooksRoot, "apex-mcp-tools.json"), JSON.stringify(policy));
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
  await check(hooks, prepend('import { randomUUID } from "node:crypto";\nimport path from "path";\n'));
  const policy = mcpToolPolicy();
  for (const [bad, pattern] of [
    [{ ...policy, server: "other" }, /server must be the bundled MCP server/u],
    [{ ...policy, readOnly: ["notATool"] }, /unknown tool read-only: notATool/u],
    [{ ...policy, tools: [...policy.tools].reverse() }, /sorted, unique/u],
    [{ ...policy, tools: [] }, /sorted, unique/u],
    [{ ...policy, extra: true }, /unsupported fields: extra/u],
  ])
    await assert.rejects(check(hooks, script, bad), pattern);
  await rm(join(hooksRoot, "apex-mcp-tools.json"));
  await writeFile(join(hooksRoot, "hooks.json"), JSON.stringify(hooks));
  await assert.rejects(validatePackagedHooks(pluginRoot, manifest), /ENOENT/u);
  for (const toolPolicy of ["hooks.json", "../x.json", "policy.txt", undefined])
    assert.throws(
      () => validatePackageManifest({ ...manifest, hooks: { ...manifest.hooks, toolPolicy } }),
      /toolPolicy|missing fields/u,
    );
});

// Copilot CLI 1.0.93 preToolUse payload for a plugin MCP tool, recorded with a probe hook: "<server>-<tool>".
const pricingPayload = (toolName) =>
  JSON.stringify({
    sessionId: "7a1c9712-1cd9-4766-bcb1-e785d075e39f",
    timestamp: 1791406148125,
    cwd: "/workspace",
    toolName,
    toolArgs: { scope: "Résumé ✓" },
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
    const registry = await readJson(join(root, "tools/registry/arm-mcp-cost-pricing.v1.json"));
    for (const tool of registry.managedPolicy.candidateReadAllowlist) {
      const allowed = invoke(pricingPayload(`apex-azure-pricing-${tool}`));
      assert.equal(allowed.status, 0, `${shell.name}: ${allowed.stderr}`);
      assert.equal(allowed.stdout.trim(), "", `${shell.name} allows read tool ${tool}`);
    }
    for (const toolName of ["apex-azure-pricing-create_budget", "apex-azure-pricing-start_pricesheet_download"]) {
      const denied = invoke(pricingPayload(toolName));
      assert.equal(denied.status, 0, `${shell.name}: ${denied.stderr}`);
      assert.deepEqual(
        JSON.parse(denied.stdout),
        {
          permissionDecision: "deny",
          permissionDecisionReason:
            `APEX hook: "${toolName}" is not one of the read-only Azure pricing and cost tools. APEX uses only ` +
            "read-only tools from the apex-azure-pricing server; write, operation and unrecognized tools on it are " +
            "blocked.",
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

test("packaged rubber-duck hooks capture reviews and deny reviewer mutations through bash and PowerShell", async (context) => {
  const { outputDirectory } = await buildInto(context, "review-hooks-build");
  const sandbox = await temporaryDirectory(context, "review-hooks-run");
  const pluginRoot = join(sandbox, "installed plugins", "apex");
  await cp(outputDirectory, pluginRoot, { recursive: true });
  const hooks = (await readJson(join(pluginRoot, "com.github.copilot/hooks/hooks.json"))).hooks;
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const parent = "36a083fd-de54-420f-892a-46033e0b8a49";
  const child = "b98af3d1-4763-4c97-a520-e4c5ac7f5fd5";
  const cwd = join(sandbox, "workspace");
  const nonce = "0123456789abcdef0123456789abcdef";
  const promptFor = (requestNonce) =>
    buildReviewPrompt({
      nonce: requestNonce,
      gate: 1,
      subjectKind: "requirements",
      wellArchitected: false,
      files: [{ label: "subject", kind: "requirements", path: join(cwd, "subject.json"), sha256: "b".repeat(64) }],
    });
  const prompt = promptFor(nonce);
  const vscodeNonce = "fedcba9876543210fedcba9876543210";
  const vscodePrompt = promptFor(vscodeNonce);
  for (const shell of hookShells()) {
    const home = join(sandbox, `review-home-${shell.name}`);
    const invoke = (entry, event, payload) => {
      const result = spawnSync(shell.name, shell.args(entry[shell.field]), {
        cwd: pluginRoot,
        env: {
          ...process.env,
          [pathKey]: [dirname(process.execPath), process.env[pathKey]].filter(Boolean).join(delimiter),
          PLUGIN_ROOT: pluginRoot,
          APEX_REVIEW_HOME: home,
        },
        input: JSON.stringify(payload),
        encoding: "utf8",
        windowsHide: true,
      });
      assert.equal(result.status, 0, `${shell.name} ${event}: ${result.stderr}`);
      return result.stdout.trim() === "" ? null : JSON.parse(result.stdout);
    };
    // Dispatch like the client: every entry for the event whose matcher fully matches the tool (or agent) name runs,
    // and the first decision wins.
    const dispatch = (event, payload) => {
      const name = String(payload.toolName ?? payload.tool_name ?? payload.agentName ?? "");
      let decision = null;
      for (const entry of hooks[event])
        if (entry.matcher === undefined || new RegExp(`^(?:${entry.matcher})$`, "u").test(name)) {
          const result = invoke(entry, event, payload);
          decision ??= result;
        }
      return decision;
    };
    const apexCall = (tool, sessionId = child) => ({
      sessionId,
      timestamp: 1,
      cwd,
      toolName: `apex-${tool}`,
      toolArgs: {},
    });
    assert.equal(dispatch("preToolUse", apexCall("gateDecide")), null, `${shell.name}: no rubber-duck run`);
    assert.equal(dispatch("subagentStart", { sessionId: parent, timestamp: 1, cwd, agentName: "rubber-duck" }), null);
    for (const tool of ["reviewComplete", "gateDecide", "reviewDecide", "completeTask", "nextTask"])
      assert.equal(dispatch("preToolUse", apexCall(tool))?.permissionDecision, "deny", `${shell.name}: ${tool}`);
    assert.equal(dispatch("preToolUse", apexCall("status")), null, `${shell.name}: read-only tools stay allowed`);
    assert.equal(dispatch("preToolUse", apexCall("reviewComplete", parent)), null, `${shell.name}: parent`);
    const response = '```apex-review\n{"findings":[]}\n```';
    const task = { description: "review", agent_type: "rubber-duck", mode: "sync", name: "review", prompt };
    // A denied duplicate call fails, and its failure event leaves the running run's mark in place.
    const duplicate = { sessionId: parent, timestamp: 2, cwd, toolName: "task", toolArgs: task };
    assert.equal(dispatch("preToolUse", duplicate)?.permissionDecision, "deny", `${shell.name}: duplicate`);
    assert.equal(dispatch("postToolUseFailure", { ...duplicate, error: "Denied by preToolUse hook" }), null);
    assert.equal(
      dispatch("preToolUse", apexCall("gateDecide"))?.permissionDecision,
      "deny",
      `${shell.name}: still marked after the denied duplicate fails`,
    );
    assert.equal(
      dispatch("subagentStop", {
        sessionId: parent,
        timestamp: 2,
        cwd,
        agentId: child,
        agentType: "rubber-duck",
        agentName: "rubber-duck",
        response,
        stopReason: "end_turn",
      }),
      null,
    );
    assert.equal(dispatch("preToolUse", apexCall("gateDecide")), null, `${shell.name}: mark cleared`);
    assert.equal(
      dispatch("postToolUse", {
        sessionId: parent,
        timestamp: 3,
        cwd,
        toolName: "task",
        toolArgs: task,
        toolResult: { resultType: "success", textResultForLlm: response },
      }),
      null,
    );
    const files = await loadReviewCaptures(nonce, home);
    const record = verifyIssuedReviewCapture(
      { nonce, promptSha256: reviewPromptSha256(prompt) },
      files,
      await reviewCaptureKey(home),
    );
    assert.equal(record.response, response, `${shell.name}: exact output captured`);
    // The VS Code payload names the subagent tool `Agent`; the packaged matcher still reaches the capture handler.
    assert.equal(
      dispatch("postToolUse", {
        hook_event_name: "PostToolUse",
        session_id: parent,
        cwd,
        tool_name: "Agent",
        tool_input: { agent_type: "rubber-duck", prompt: vscodePrompt, mode: "sync" },
        tool_result: { result_type: "success", text_result_for_llm: response },
      }),
      null,
    );
    const vscode = verifyIssuedReviewCapture(
      { nonce: vscodeNonce, promptSha256: reviewPromptSha256(vscodePrompt) },
      await loadReviewCaptures(vscodeNonce, home),
      await reviewCaptureKey(home),
    );
    assert.equal(vscode.toolName, "Agent", `${shell.name}: VS Code capture`);
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

async function offlinePlugin(context, outputDirectory, projectId = "plugin-test") {
  outputDirectory ??= (await buildInto(context, "offline-build")).outputDirectory;
  const sandbox = await temporaryDirectory(context, "offline");
  const pluginRoot = join(sandbox, "installed", "apex");
  const pluginData = join(sandbox, "data", "apex");
  const workspace = join(sandbox, "workspace");
  await cp(outputDirectory, pluginRoot, { recursive: true });
  await mkdir(pluginData, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const git = spawnSync("git", ["init", "--quiet", workspace], { encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  const init = cli(workspace, ["init", "--project", projectId, "--risk-owner", "partner", "--target", "local"]);
  assert.equal(init.ok, true);
  const guard = join(sandbox, "guard.mjs");
  await writeFile(guard, guardHook);
  return { pluginRoot, pluginData, workspace, guard, sandbox, projectId, runId: init.result.runId };
}

function startServer({ pluginRoot, pluginData, guard, preload = [] }) {
  const env = {
    PATH: dirname(process.execPath),
    PLUGIN_ROOT: pluginRoot,
    PLUGIN_DATA: pluginData,
    NPM_CONFIG_OFFLINE: "true",
    npm_config_offline: "true",
    ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}),
  };
  assert.equal(env.PATH.split(delimiter).length, 1);
  const imports = [guard, ...preload].flatMap((path) => ["--import", pathToFileURL(path).href]);
  const child = spawn(process.execPath, [...imports, join(pluginRoot, "mcp/apex.mjs")], {
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

  // The bundled runtime refuses a workspace locked to another @apexops/cli version; status reports it read-only.
  const { version } = await readJson(join(root, "packages/cli/package.json"));
  const lockPath = join(plugin.workspace, ".apex", "apex.lock.json");
  await writeFile(lockPath, JSON.stringify({ ...(await readJson(lockPath)), cliVersion: "99.0.0" }));
  server.send({
    id: 4,
    method: "tools/call",
    params: { name: "status", arguments: { workspace: plugin.workspace }, _meta: modernMeta },
  });
  const mismatch = await server.next();
  assert.equal(mismatch.id, 4, JSON.stringify(mismatch));
  assert.notEqual(mismatch.result.isError, true, JSON.stringify(mismatch.result));
  assert.equal(mismatch.result.structuredContent.status, "runtime_mismatch");
  assert.equal(mismatch.result.structuredContent.runtimeVersion, version);
  assert.equal(mismatch.result.structuredContent.workspaceRuntimeVersion, "99.0.0");
  server.send({
    id: 5,
    method: "tools/call",
    params: { name: "projectList", arguments: { workspace: plugin.workspace }, _meta: modernMeta },
  });
  const refused = await server.next();
  assert.equal(refused.id, 5, JSON.stringify(refused));
  assert.equal(refused.result.isError, true, JSON.stringify(refused.result));
  assert.equal(refused.result.structuredContent.error.code, "APEX_RUNTIME_MISMATCH");

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
  // The bundle serves the exact @apexops/cli version the plugin is published as.
  assert.equal(
    initialized.result.serverInfo.version,
    (await readJson(join(root, "packages/cli/package.json"))).version,
  );
  server.send({ method: "notifications/initialized" });
  server.send({ id: 3, method: "tools/list" });
  const listed = await server.next();
  assert.equal(listed.id, 3);
  assert.ok(listed.result.tools.some((tool) => tool.name === "status"));
  const exit = await server.close();
  assert.deepEqual({ code: exit.code, signal: exit.signal }, { code: 0, signal: null }, exit.stderr);
});

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const diagramNames = ["02-waf-assessment", "03-des-cost-breakdown", "03-des-cost-uncertainty", "03-des-diagram"];

/**
 * Drives a workspace to the Architecture task with the npm CLI service and its test fixtures, so the packaged server
 * renders the Gate 2 diagrams when it completes that task. The fixtures use the project id "demo".
 */
async function architectureTask(plugin) {
  const { ApexService } = await import(pathToFileURL(join(root, "packages/cli/dist/service.js")).href);
  const fixtures = await import(pathToFileURL(join(root, "packages/cli/dist/test/helpers.js")).href);
  const { projectId } = plugin;
  const service = new ApexService(plugin.workspace);
  const complete = async (taskType, outputs) => {
    const next = await fixtures.nextTaskAfterInput(service);
    assert.equal(next.status, "task", JSON.stringify(next));
    assert.equal(next.task.taskType, taskType);
    // Review findings come only from captured rubber-duck answers; completeOutputs writes one for review tasks.
    return fixtures.completeOutputs(service, next.task.taskId, outputs);
  };
  const requirements = await complete("requirements", [
    { kind: "requirements", value: fixtures.requirements(projectId) },
  ]);
  await complete("requirements-review", [
    {
      kind: "review-findings",
      value: fixtures.review(plugin.runId, "requirements", requirements.outputHashes.requirements),
    },
  ]);
  await service.decideGateNumber(1, "approved", "tester");
  await fixtures.acceptAvailabilityEvidence(service, plugin.runId, projectId);
  const governanceHash = await fixtures.importReferenceGovernance(service);
  const next = await fixtures.nextTaskAfterInput(service);
  assert.equal(next.task?.taskType, "architecture", JSON.stringify(next));
  const findings = await fixtures.governanceFindings(service, next.task.taskId, ["Microsoft.Web/sites"]);
  const architecture = fixtures.architecture(plugin.runId);
  const cost = fixtures.costEstimate(plugin.runId);
  const { sha256Json } = await import(pathToFileURL(join(root, "packages/kernel/dist/index.js")).href);
  return {
    taskId: next.task.taskId,
    outputs: [
      { kind: "architecture", value: architecture },
      { kind: "cost-estimate", value: cost },
      {
        kind: "workload-decision-manifest",
        value: fixtures.workloadDecisionManifest({
          runId: plugin.runId,
          requirementsHash: requirements.outputHashes.requirements,
          architectureHash: sha256Json(architecture),
          costEstimateHash: sha256Json(cost),
        }),
      },
      { kind: "policy-property-map", value: fixtures.policyMap(plugin.runId, governanceHash, findings) },
    ],
    directory: join(plugin.workspace, "agent-output", projectId, plugin.runId, "architecture"),
  };
}

/** Completes the Architecture task through the packaged server and returns the review README diagram status. */
async function renderThroughPackagedServer(plugin, preload = []) {
  const task = await architectureTask(plugin);
  const server = startServer({ ...plugin, preload });
  try {
    server.send({
      id: 1,
      method: "tools/call",
      params: {
        name: "completeTask",
        arguments: { workspace: plugin.workspace, taskId: task.taskId, outputs: task.outputs },
        _meta: modernMeta,
      },
    });
    const completed = await server.next();
    assert.equal(completed.error, undefined, JSON.stringify(completed));
    assert.notEqual(completed.result.isError, true, JSON.stringify(completed.result));
  } finally {
    const exit = await server.close();
    assert.deepEqual({ code: exit.code, signal: exit.signal }, { code: 0, signal: null }, exit.stderr);
  }
  for (const name of diagramNames) {
    for (const extension of ["py", "svg"]) {
      assert.ok((await readFile(join(task.directory, `${name}.${extension}`))).byteLength > 0, `${name}.${extension}`);
    }
  }
  return { directory: task.directory, readme: await readFile(join(task.directory, "README.md"), "utf8") };
}

const hostPlatform = `${process.platform}-${process.arch}`;
const nativePlatforms = ["linux-x64", "win32-x64"];
// The shipped Linux binary needs glibc; a musl host falls back to SVG before any hash check.
const hostLoadsShippedBinary =
  nativePlatforms.includes(hostPlatform) &&
  (process.platform !== "linux" || process.report.getReport().header.glibcVersionRuntime !== undefined);

test("plugin ships the pinned resvg binaries, license and provenance under native/", async (context) => {
  const { outputDirectory, files, native } = await buildInto(context, "native");
  const manifest = await readManifest();
  const lock = await readJson(join(root, "package-lock.json"));
  const provenance = await readJson(join(outputDirectory, "native/resvg-js/manifest.json"));
  assert.deepEqual(
    files.filter((path) => path.startsWith("native/")),
    [
      "native/resvg-js/LICENSE",
      "native/resvg-js/linux-x64/resvgjs.linux-x64-gnu.node",
      "native/resvg-js/manifest.json",
      "native/resvg-js/win32-x64/resvgjs.win32-x64-msvc.node",
    ],
  );
  assert.match(
    await readFile(join(outputDirectory, "native/resvg-js/LICENSE"), "utf8"),
    /^Mozilla Public License Version 2\.0/u,
  );
  assert.equal(provenance.license, "MPL-2.0");
  assert.equal(provenance.version, lock.packages["node_modules/@resvg/resvg-js"].version);
  assert.equal(provenance.source, `https://github.com/yisibl/resvg-js/tree/v${provenance.version}`);
  assert.deepEqual(Object.keys(provenance.binaries), nativePlatforms);
  assert.deepEqual(Object.keys(native.binaries), nativePlatforms);
  assert.equal(native.root, "../native/resvg-js/");
  for (const platform of nativePlatforms) {
    const binary = provenance.binaries[platform];
    const locked = lock.packages[`node_modules/${manifest.native.binaries[platform].package}`];
    assert.equal(binary.package, manifest.native.binaries[platform].package);
    assert.deepEqual([binary.tarball, binary.integrity], [locked.resolved, locked.integrity]);
    const bytes = await readFile(join(outputDirectory, "native/resvg-js", binary.file));
    assert.equal(bytes.length, binary.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), binary.sha256, `${platform} binary hash`);
    assert.deepEqual(native.binaries[platform], {
      file: binary.file,
      sha256: binary.sha256,
      ...(platform.startsWith("linux-") ? { libc: "glibc" } : {}),
    });
  }
  const signature = (bytes) => [...bytes.subarray(0, 4)];
  const linux = await readFile(join(outputDirectory, "native/resvg-js", provenance.binaries["linux-x64"].file));
  const windows = await readFile(join(outputDirectory, "native/resvg-js", provenance.binaries["win32-x64"].file));
  assert.deepEqual(signature(linux), [0x7f, 0x45, 0x4c, 0x46], "linux-x64 binary is ELF");
  assert.deepEqual(signature(windows).slice(0, 2), [0x4d, 0x5a], "win32-x64 binary is PE");
  const bundle = await readFile(join(outputDirectory, "mcp/apex.mjs"), "utf8");
  for (const platform of nativePlatforms) assert.ok(bundle.includes(provenance.binaries[platform].sha256));
});

test("plugin native manifest rejects drift from the shipped platform packages", async () => {
  const manifest = await readManifest();
  const variant = (change) => {
    const copy = structuredClone(manifest);
    change(copy.native);
    return copy;
  };
  for (const [change, pattern] of [
    [(native) => (native.package = "left-pad"), /native package must be @resvg\/resvg-js/u],
    [(native) => (native.targetRoot = "assets/native"), /under native\//u],
    [(native) => (native.source = "http://example.com"), /native source/u],
    [(native) => (native.binaries = {}), /at least one platform/u],
    [(native) => (native.binaries["darwin-arm64"] = native.binaries["linux-x64"]), /darwin-arm64 must be/u],
    [(native) => (native.binaries["linux-x64"].package = "@resvg/resvg-js-linux-x64-musl"), /platform package/u],
    [(native) => (native.binaries["linux-x64"].file = "../escape.node"), /\.node file name/u],
    [(native) => delete native.binaries["linux-x64"].libc, /libc glibc exactly for Linux/u],
    [(native) => (native.binaries["win32-x64"].libc = "glibc"), /libc glibc exactly for Linux/u],
    [(native) => (native.binaries["win32-x64"].extra = true), /unsupported fields: extra/u],
  ]) {
    assert.throws(() => validatePackageManifest(variant(change)), pattern);
  }
});

test("packaged MCP server renders Gate 2 diagrams to PNG with the shipped binary", async (context) => {
  if (!hostLoadsShippedBinary) {
    context.skip(`no loadable shipped binary for ${hostPlatform}`);
    return;
  }
  const { directory, readme } = await renderThroughPackagedServer(await offlinePlugin(context, undefined, "demo"));
  for (const name of diagramNames) {
    const png = await readFile(join(directory, `${name}.png`));
    assert.deepEqual([...png.subarray(0, 8)], pngSignature, `${name}.png`);
    assert.match(readme, new RegExp(`- ${name}: generated as Python, SVG, and PNG`, "u"));
  }
});

test("packaged MCP server writes SVG only on an unsupported platform or a tampered binary", async (context) => {
  const { outputDirectory } = await buildInto(context, "fallback-build");
  const unsupported = await offlinePlugin(context, outputDirectory, "demo");
  const arch = join(unsupported.sandbox, "unsupported-arch.mjs");
  await writeFile(arch, 'Object.defineProperty(process, "arch", { value: "riscv64" });\n');
  const tampered = await offlinePlugin(context, outputDirectory, "demo");
  const provenance = await readJson(join(tampered.pluginRoot, "native/resvg-js/manifest.json"));
  const hostBinary = provenance.binaries[hostPlatform]?.file ?? provenance.binaries["linux-x64"].file;
  await writeFile(join(tampered.pluginRoot, "native/resvg-js", hostBinary), "replaced");
  for (const [plugin, preload, reason] of [
    [unsupported, [arch], `is not bundled for ${process.platform}-riscv64`],
    ...(hostLoadsShippedBinary ? [[tampered, [], `binary for ${hostPlatform} failed its integrity check`]] : []),
  ]) {
    const { directory, readme } = await renderThroughPackagedServer(plugin, preload);
    for (const name of diagramNames) {
      await assert.rejects(stat(join(directory, `${name}.png`)), { code: "ENOENT" });
      assert.ok(
        readme.includes(
          `- ${name}: generated as Python and SVG; PNG unavailable (PNG rasterizer @resvg/resvg-js ${reason}; SVG output is available)`,
        ),
        readme,
      );
    }
  }
});
