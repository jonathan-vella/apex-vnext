#!/usr/bin/env node
/**
 * Build the APEX Agent Plugins 1.0 package from plugin/package-manifest.json.
 *
 * Usage: node tools/scripts/build-plugin.mjs [--manifest <path>] [--output-dir <dir>]
 * Default output: dist/apex-plugin/ plus dist/apex-plugin.sha256. The output folder is deleted first.
 *
 * The MCP server ships as one esbuild bundle at mcp/apex.mjs with no node_modules. The CLI reads its bundled assets
 * from new URL("../assets/", import.meta.url), so assets/ sits beside mcp/ under the plugin root.
 *
 * PNG diagrams need the native @resvg/resvg-js binding, which a single-file bundle cannot carry. The build ships the
 * prebuilt platform binaries named in the manifest's native section under native/, taken from the npm tarballs pinned in
 * package-lock.json and verified against their lockfile integrity, and inlines their SHA-256 table into the bundle so
 * the runtime refuses a replaced binary. Tarballs come from the npm cache, node_modules/.cache/apex-plugin-native/ or
 * the lockfile URL, in that order; the plugin itself never downloads anything.
 *
 * Agents are rendered with the same Copilot CLI renderer the workspace projection used before CP-11, so the plugin
 * carries the client mechanics (ask_user, task delegation and Explore rules) the retired workspace copies carried.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { builtinModules } from "node:module";
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { build as esbuild } from "esbuild";
import { load as loadYaml } from "js-yaml";
import {
  renderClientAgentProjection,
  roleDelegatesOnClient,
  roleSupportsClient,
  validateCliToolInventory,
} from "../../packages/cli/scripts/prepare-assets.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixedTime = new Date("2000-01-01T00:00:00.000Z");
const pluginSchema = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const mcpSchema = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const pluginNamePattern = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u;
const maxAgentBodyCharacters = 30_000;
const forbiddenAgentFields = ["model", "model-policy", "reasoning-effort"];
const forbiddenBundleText = "@modelcontextprotocol/sdk";
// Copilot CLI reads Agent Plugins 1.0 components from these fixed locations.
const fixedTargets = {
  plugin: "plugin.json",
  mcp: "mcp.json",
  skills: "skills",
  agents: "com.github.copilot/agents",
  hooks: "com.github.copilot/hooks",
};
const manifestShape = {
  plugin: ["source", "target", "versionFrom"],
  mcp: ["source", "target", "server"],
  server: ["entry", "target", "nodeTarget"],
  agents: ["sourceRoot", "targetRoot"],
  skills: ["sourceRoot", "targetRoot"],
  hooks: ["sourceRoot", "targetRoot", "entries", "toolPolicy"],
  assets: ["sourceRoot", "targetRoot"],
  native: ["package", "targetRoot", "source", "binaries"],
};
const nativeBinaryShape = ["package", "file", "libc"];
const nativeCacheDirectory = join(repositoryRoot, "node_modules/.cache/apex-plugin-native");
const nativeFetchTimeoutMs = 120_000;
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
// The MCP adapter owns tool effects; build:vnext compiles it before the plugin build reads the policy from it.
const toolPolicyModule = "packages/cli/dist/mcp.js";
// camelCase events from the Copilot hooks reference; PascalCase names select the VS Code payload format instead.
const hookEvents = [
  "agentStop",
  "errorOccurred",
  "notification",
  "permissionRequest",
  "postToolUse",
  "postToolUseFailure",
  "preCompact",
  "preToolUse",
  "sessionEnd",
  "sessionStart",
  "subagentStart",
  "subagentStop",
  "userPromptSubmitted",
  "userPromptTransformed",
];

function bytewise(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portablePath(path) {
  return path.split(sep).join("/");
}

function contained(root, path) {
  const child = relative(resolve(root), resolve(path));
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function safeRelativePath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.includes(":") &&
    !isAbsolute(path) &&
    path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertKeys(label, value, allowed, required = allowed) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${label} has unsupported fields: ${unknown.sort(bytewise).join(", ")}`);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) throw new Error(`${label} is missing fields: ${missing.join(", ")}`);
}

function parseArguments(argv) {
  let manifestPath = join(repositoryRoot, "plugin/package-manifest.json");
  let outputDirectory;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--manifest") {
      const value = argv[++index];
      if (value === undefined) throw new Error("Missing value for --manifest");
      manifestPath = resolve(repositoryRoot, value);
    } else if (argument === "--output-dir") {
      const value = argv[++index];
      if (value === undefined) throw new Error("Missing value for --output-dir");
      outputDirectory = resolve(repositoryRoot, value);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { manifestPath, outputDirectory };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function validateNativeSection(manifest) {
  const native = manifest.native;
  if (typeof native.package !== "string" || !/^@resvg\/resvg-js$/u.test(native.package))
    throw new Error("Plugin native package must be @resvg/resvg-js");
  if (typeof native.source !== "string" || !native.source.startsWith("https://"))
    throw new Error("Plugin native source must be the https URL of the binaries' source code");
  const topLevel = native.targetRoot.split("/", 1)[0];
  const taken = [
    manifest.plugin.target,
    manifest.mcp.target,
    manifest.server.target,
    manifest.agents.targetRoot,
    manifest.skills.targetRoot,
    manifest.hooks.targetRoot,
    manifest.assets.targetRoot,
  ].map((target) => target.split("/", 1)[0]);
  if (topLevel !== "native" || taken.includes(topLevel))
    throw new Error("Plugin native targetRoot must sit under native/, apart from every other plugin component");
  if (!isPlainObject(native.binaries) || Object.keys(native.binaries).length === 0)
    throw new Error("Plugin native binaries must map at least one platform");
  for (const [platform, binary] of Object.entries(native.binaries)) {
    if (!/^(?:linux|win32)-(?:x64|arm64)$/u.test(platform))
      throw new Error(`Plugin native platform ${platform} must be <linux|win32>-<x64|arm64>`);
    assertKeys(`Plugin native binary ${platform}`, binary, nativeBinaryShape, ["package", "file"]);
    if (binary.package !== `${native.package}-${platform}${platform.startsWith("win32-") ? "-msvc" : "-gnu"}`)
      throw new Error(`Plugin native binary ${platform} must come from the ${platform} platform package`);
    if (!safeRelativePath(binary.file) || binary.file.includes("/") || extname(binary.file) !== ".node")
      throw new Error(`Plugin native binary ${platform} file must be a .node file name`);
    if (platform.startsWith("linux-") !== (binary.libc === "glibc"))
      throw new Error(`Plugin native binary ${platform} must set libc glibc exactly for Linux`);
  }
}

function validatePackageManifest(manifest) {
  assertKeys("Plugin package manifest", manifest, ["schemaVersion", "outputDirectory", ...Object.keys(manifestShape)]);
  if (manifest.schemaVersion !== "1.0.0") throw new Error("Plugin package manifest schemaVersion must be 1.0.0");
  for (const [section, fields] of Object.entries(manifestShape)) {
    assertKeys(`Plugin package manifest ${section}`, manifest[section], fields);
  }
  for (const [label, path] of [
    ["plugin.source", manifest.plugin.source],
    ["plugin.versionFrom", manifest.plugin.versionFrom],
    ["mcp.source", manifest.mcp.source],
    ["server.entry", manifest.server.entry],
    ["server.target", manifest.server.target],
    ["agents.sourceRoot", manifest.agents.sourceRoot],
    ["skills.sourceRoot", manifest.skills.sourceRoot],
    ["hooks.sourceRoot", manifest.hooks.sourceRoot],
    ["assets.sourceRoot", manifest.assets.sourceRoot],
    ["assets.targetRoot", manifest.assets.targetRoot],
    ["native.targetRoot", manifest.native.targetRoot],
  ]) {
    if (!safeRelativePath(path)) throw new Error(`Plugin package manifest ${label} must be a safe relative path`);
  }
  for (const [section, target] of Object.entries(fixedTargets)) {
    const actual = manifest[section].target ?? manifest[section].targetRoot;
    if (actual !== target) throw new Error(`Plugin package manifest ${section} target must be ${target}`);
  }
  validateNativeSection(manifest);
  if (!/^node\d+$/u.test(manifest.server.nodeTarget)) throw new Error("Plugin server nodeTarget must look like node24");
  const assetRoot = posix.normalize(posix.join(posix.dirname(manifest.server.target), "../assets"));
  if (manifest.assets.targetRoot !== assetRoot) {
    throw new Error(`Plugin assets must ship at ${assetRoot}, where the bundled CLI resolves ../assets/`);
  }
  if (
    !Array.isArray(manifest.hooks.entries) ||
    !manifest.hooks.entries.every(safeRelativePath) ||
    (manifest.hooks.entries.length > 0 && !manifest.hooks.entries.includes("hooks.json"))
  ) {
    throw new Error("Plugin hooks entries must be safe relative paths and include hooks.json when present");
  }
  if (
    !safeRelativePath(manifest.hooks.toolPolicy) ||
    !manifest.hooks.toolPolicy.endsWith(".json") ||
    manifest.hooks.entries.includes(manifest.hooks.toolPolicy)
  )
    throw new Error("Plugin hooks toolPolicy must be a generated .json path that is not a hook source entry");
}

async function readManifest(manifestPath, outputDirectoryOverride) {
  if (!contained(repositoryRoot, manifestPath))
    throw new Error(`Manifest path is outside the repository: ${manifestPath}`);
  const manifest = await readJson(manifestPath);
  validatePackageManifest(manifest);
  const outputDirectory = resolve(repositoryRoot, outputDirectoryOverride ?? manifest.outputDirectory ?? "");
  if (dirname(outputDirectory) === outputDirectory)
    throw new Error("Plugin output directory must not be a filesystem root");
  if (contained(outputDirectory, repositoryRoot))
    throw new Error("Plugin output directory must not contain the repository");
  for (const protectedPath of ["customizations", "packages", "plugin", "tools", ".github"]) {
    if (contained(join(repositoryRoot, protectedPath), outputDirectory)) {
      throw new Error(`Plugin output directory must not be inside source directory ${protectedPath}`);
    }
  }
  return { manifest, outputDirectory };
}

function shouldNormalizeText(path, buffer) {
  return (
    !buffer.includes(0) &&
    new Set([
      ".bat",
      ".cjs",
      ".cmd",
      ".css",
      ".html",
      ".js",
      ".json",
      ".md",
      ".mjs",
      ".ps1",
      ".sh",
      ".svg",
      ".ts",
      ".txt",
      ".xml",
      ".yaml",
      ".yml",
    ]).has(extname(path))
  );
}

async function readSourceFile(path) {
  const resolved = await realpath(path);
  if (!contained(repositoryRoot, resolved)) throw new Error(`Source path is outside the repository: ${path}`);
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Unsupported source file: ${path}`);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.readFile();
    return shouldNormalizeText(path, opened) ? Buffer.from(opened.toString("utf8").replace(/\r\n/g, "\n")) : opened;
  } finally {
    await handle.close();
  }
}

async function writeOutputFile(outputRoot, target, content) {
  if (!safeRelativePath(target)) throw new Error(`Unsafe plugin target path: ${target}`);
  const destination = join(outputRoot, target);
  if (!contained(outputRoot, destination)) throw new Error(`Plugin target escapes output: ${target}`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, { flag: "wx" });
  await chmod(destination, 0o644);
  await utimes(destination, fixedTime, fixedTime);
}

async function writeJsonOutput(outputRoot, target, value) {
  await writeOutputFile(outputRoot, target, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

async function sortedDirectoryEntries(root) {
  return (await readdir(root, { withFileTypes: true })).sort((left, right) => bytewise(left.name, right.name));
}

async function copyDirectory(sourceRoot, outputRoot, targetRoot) {
  const root = resolve(repositoryRoot, sourceRoot);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Source directory is invalid: ${sourceRoot}`);
  async function visit(current, relativeDirectory) {
    for (const entry of await sortedDirectoryEntries(current)) {
      const source = join(current, entry.name);
      const target = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) await visit(source, target);
      else if (entry.isFile())
        await writeOutputFile(outputRoot, `${targetRoot}/${target}`, await readSourceFile(source));
      else throw new Error(`Unsupported source entry: ${source}`);
    }
  }
  await visit(root, "");
}

const pricingReadToolsMarker =
  "export const PRICING_READ_TOOLS = Object.freeze([]); // @apex-build: pricing-read-tools";

/** The read-only ARM MCP tools APEX may call, from the one registry every validator and the hook use. */
export async function pricingReadTools() {
  const registry = JSON.parse(
    await readSourceFile(join(repositoryRoot, "tools/registry/arm-mcp-cost-pricing.v1.json")),
  );
  const tools = registry.managedPolicy?.candidateReadAllowlist;
  const toolsets = Object.values(registry.toolsets ?? {});
  if (
    !Array.isArray(tools) ||
    tools.length === 0 ||
    new Set(tools).size !== tools.length ||
    tools.some(
      (tool) =>
        typeof tool !== "string" ||
        !/^[a-z][a-z0-9_]*$/u.test(tool) ||
        !toolsets.some(({ readTools }) => Array.isArray(readTools) && readTools.includes(tool)),
    )
  )
    throw new Error("ARM MCP read allowlist must list unique read tools from the registry toolsets");
  return tools;
}

/**
 * Embeds the pricing read allowlist into the hook script, which must stay dependency-free. The source carries one
 * marker line with an empty list, so an unbuilt hook allows no pricing tool.
 */
export function renderHookScript(source, readTools) {
  const text = source.toString("utf8");
  if (text.split(pricingReadToolsMarker).length !== 2)
    throw new Error("Hook script must contain the pricing read-tools marker exactly once");
  return Buffer.from(
    text.replace(
      pricingReadToolsMarker,
      `export const PRICING_READ_TOOLS = Object.freeze(${JSON.stringify(readTools)}); // generated by build-plugin.mjs`,
    ),
  );
}

/**
 * Render every managed agent for the Copilot CLI agent format. Each agent file needs a manifest role that targets
 * github-copilot, and each such role needs its agent file, so the plugin and the manifest cannot drift apart.
 */
export async function renderPluginAgents(sourceRoot) {
  const clientId = "github-copilot-cli";
  const customizationsRoot = join(repositoryRoot, "customizations");
  const customizationManifest = JSON.parse(await readSourceFile(join(customizationsRoot, "manifest.json")));
  const toolInventory = validateCliToolInventory(
    JSON.parse(await readSourceFile(join(repositoryRoot, "tools/registry/copilot-cli-agent-tools.json"))),
  );
  const roles = customizationManifest.roles.filter((role) => roleSupportsClient(role, clientId));
  const root = resolve(repositoryRoot, sourceRoot);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Source directory is invalid: ${sourceRoot}`);
  const rendered = new Map();
  for (const entry of await sortedDirectoryEntries(root)) {
    if (!entry.isFile() || !entry.name.endsWith(".agent.md"))
      throw new Error(`Unsupported agent source entry: ${sourceRoot}/${entry.name}`);
    const sourcePath = join(root, entry.name);
    const roleSource = portablePath(relative(customizationsRoot, sourcePath));
    const role = roles.find(({ source }) => source === roleSource);
    if (role === undefined) throw new Error(`Plugin agent has no github-copilot manifest role: ${roleSource}`);
    const delegates = roleDelegatesOnClient(
      role,
      clientId,
      customizationManifest.roles,
      customizationManifest.invocationEdges,
    );
    const source = (await readSourceFile(sourcePath)).toString("utf8");
    rendered.set(entry.name, renderClientAgentProjection(source, clientId, toolInventory, { delegates }));
  }
  const missing = roles.find(({ source }) => ![...rendered.keys()].some((name) => source.endsWith(`/${name}`)));
  if (missing !== undefined) throw new Error(`Manifest role has no plugin agent: ${missing.source}`);
  return rendered;
}

function validatePluginJson(plugin) {
  assertKeys(
    "plugin.json",
    plugin,
    [
      "$schema",
      "name",
      "version",
      "description",
      "author",
      "homepage",
      "repository",
      "license",
      "keywords",
      "extensions",
    ],
    ["$schema", "name"],
  );
  if (plugin.$schema !== pluginSchema) throw new Error(`plugin.json $schema must be ${pluginSchema}`);
  if (typeof plugin.name !== "string" || plugin.name.length > 64 || !pluginNamePattern.test(plugin.name)) {
    throw new Error("plugin.json name violates the Agent Plugins 1.0 name constraints");
  }
  for (const field of ["version", "description", "homepage", "repository", "license"]) {
    if (plugin[field] !== undefined && typeof plugin[field] !== "string")
      throw new Error(`plugin.json ${field} must be a string`);
  }
  if (plugin.author !== undefined) {
    assertKeys("plugin.json author", plugin.author, ["name", "email", "url"], []);
    if (!Object.values(plugin.author).every((value) => typeof value === "string"))
      throw new Error("plugin.json author fields must be strings");
  }
  if (
    plugin.keywords !== undefined &&
    (!Array.isArray(plugin.keywords) || !plugin.keywords.every((keyword) => typeof keyword === "string"))
  ) {
    throw new Error("plugin.json keywords must be an array of strings");
  }
  if (
    plugin.extensions !== undefined &&
    (!isPlainObject(plugin.extensions) || !Object.values(plugin.extensions).every(isPlainObject))
  ) {
    throw new Error("plugin.json extensions must map namespaces to objects");
  }
}

function validateMcpJson(mcp, manifest) {
  assertKeys("mcp.json", mcp, ["$schema", "mcpServers"]);
  if (mcp.$schema !== mcpSchema) throw new Error(`mcp.json $schema must be ${mcpSchema}`);
  if (!isPlainObject(mcp.mcpServers)) throw new Error("mcp.json mcpServers must be an object");
  for (const [name, server] of Object.entries(mcp.mcpServers)) {
    if (!isPlainObject(server)) throw new Error(`mcp.json server ${name} must be an object`);
    if (server.type === "stdio") {
      assertKeys(`mcp.json server ${name}`, server, ["type", "command", "args", "env", "cwd"], ["type", "command"]);
      if (typeof server.command !== "string" || server.command.length === 0 || /\s/u.test(server.command))
        throw new Error(`mcp.json server ${name} command must be one executable token`);
      if (server.args !== undefined && !(Array.isArray(server.args) && server.args.every((a) => typeof a === "string")))
        throw new Error(`mcp.json server ${name} args must be strings`);
      if (server.env !== undefined) {
        if (!isPlainObject(server.env) || !Object.values(server.env).every((value) => typeof value === "string"))
          throw new Error(`mcp.json server ${name} env must map names to strings`);
        if (Object.keys(server.env).some((key) => ["PLUGIN_ROOT", "PLUGIN_DATA"].includes(key.toUpperCase())))
          throw new Error(`mcp.json server ${name} env must not set PLUGIN_ROOT or PLUGIN_DATA`);
      }
      if (
        server.cwd !== undefined &&
        (typeof server.cwd !== "string" ||
          !/^(?:\.\/|\$\{PLUGIN_ROOT\}(?:\/|$)|\$\{PLUGIN_DATA\}(?:\/|$))/u.test(server.cwd))
      ) {
        throw new Error(`mcp.json server ${name} cwd must be plugin-relative or rooted in a plugin variable`);
      }
    } else if (server.type === "streamable-http" || server.type === "sse") {
      assertKeys(`mcp.json server ${name}`, server, ["type", "url", "headers"], ["type", "url"]);
      if (typeof server.url !== "string" || server.url.length === 0)
        throw new Error(`mcp.json server ${name} url must be a non-empty string`);
      if (
        server.headers !== undefined &&
        (!isPlainObject(server.headers) || !Object.values(server.headers).every((value) => typeof value === "string"))
      ) {
        throw new Error(`mcp.json server ${name} headers must map names to strings`);
      }
    } else {
      throw new Error(`mcp.json server ${name} has unsupported type ${String(server.type)}`);
    }
  }
  const apex = mcp.mcpServers[manifest.mcp.server];
  const expectedArgs = [`\${PLUGIN_ROOT}/${manifest.server.target}`];
  if (
    apex?.type !== "stdio" ||
    apex.command !== "node" ||
    JSON.stringify(apex.args) !== JSON.stringify(expectedArgs) ||
    apex.env !== undefined ||
    apex.cwd !== undefined
  ) {
    throw new Error(`mcp.json server ${manifest.mcp.server} must run node ${expectedArgs[0]}`);
  }
}

function parseFrontmatter(path, source) {
  const match = /^---\n([\s\S]*?)\n---\n?/u.exec(source.replaceAll("\r\n", "\n"));
  if (match === null) throw new Error(`File must start with YAML frontmatter: ${path}`);
  const frontmatter = loadYaml(match[1]);
  if (!isPlainObject(frontmatter)) throw new Error(`Frontmatter must be an object: ${path}`);
  return { frontmatter, body: source.replaceAll("\r\n", "\n").slice(match[0].length) };
}

async function validatePackagedAgents(outputRoot, targetRoot) {
  const agentsRoot = join(outputRoot, targetRoot);
  const entries = await sortedDirectoryEntries(agentsRoot);
  const agentFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".agent.md"));
  if (agentFiles.length === 0 || agentFiles.length !== entries.length)
    throw new Error("Plugin agents must be one or more *.agent.md files");
  for (const entry of agentFiles) {
    const path = `${targetRoot}/${entry.name}`;
    const { frontmatter, body } = parseFrontmatter(path, await readFile(join(agentsRoot, entry.name), "utf8"));
    for (const field of forbiddenAgentFields) {
      if (Object.hasOwn(frontmatter, field)) throw new Error(`Agent must not pin ${field}: ${path}`);
    }
    for (const field of ["name", "description"]) {
      if (typeof frontmatter[field] !== "string" || frontmatter[field].length === 0)
        throw new Error(`Agent is missing ${field}: ${path}`);
    }
    if (body.length > maxAgentBodyCharacters)
      throw new Error(`Agent body exceeds ${maxAgentBodyCharacters} characters: ${path}`);
  }
}

async function validatePackagedSkills(outputRoot, targetRoot) {
  const skillsRoot = join(outputRoot, targetRoot);
  const entries = await sortedDirectoryEntries(skillsRoot);
  if (entries.length === 0 || !entries.every((entry) => entry.isDirectory()))
    throw new Error("Plugin skills must be one or more skill directories");
  for (const entry of entries) {
    const path = `${targetRoot}/${entry.name}/SKILL.md`;
    const source = await readFile(join(skillsRoot, entry.name, "SKILL.md"), "utf8").catch((error) => {
      if (error.code === "ENOENT") throw new Error(`Packaged skill is missing SKILL.md: ${entry.name}`);
      throw error;
    });
    const { frontmatter } = parseFrontmatter(path, source);
    if (frontmatter.name !== entry.name) throw new Error(`Skill name must match its directory: ${path}`);
    if (typeof frontmatter.description !== "string" || frontmatter.description.length === 0)
      throw new Error(`Skill is missing description: ${path}`);
  }
}

/**
 * The only accepted hook commands: run one shipped script from the plugin root with the event name as its argument.
 * bash quotes "${PLUGIN_ROOT}/..."; PowerShell (5.1 and 7) builds the same path and lets node inherit stdin, so the
 * payload is not re-encoded. A missing script drains stdin, warns and allows; the script itself always exits 0.
 */
function hookCommands(script, event) {
  const missing = "is missing; reinstall the APEX plugin. Call allowed.";
  const segments = script
    .split("/")
    .map((segment) => `'${segment}'`)
    .join(", ");
  return {
    bash: [
      `f="\${PLUGIN_ROOT}/${script}"`,
      `if [ -f "$f" ]; then exec node "$f" ${event}; fi`,
      "cat > /dev/null",
      `echo "APEX hook: $f ${missing}" >&2`,
    ].join("; "),
    powershell: [
      `$f = [System.IO.Path]::Combine([string]$env:PLUGIN_ROOT, ${segments})`,
      `if ([System.IO.File]::Exists($f)) { try { & node $f ${event} } catch { exit 1 }; exit $LASTEXITCODE }`,
      "[void][Console]::In.ReadToEnd()",
      `[Console]::Error.WriteLine("APEX hook: $f ${missing}")`,
      "exit 0",
    ].join("; "),
  };
}

function validateHookCommand(label, entry, event, scripts) {
  assertKeys(label, entry, ["type", "matcher", "bash", "powershell", "timeoutSec"], ["type", "bash", "powershell"]);
  if (entry.type !== "command") throw new Error(`${label} type must be command`);
  if (entry.matcher !== undefined) {
    if (typeof entry.matcher !== "string" || entry.matcher.length === 0)
      throw new Error(`${label} matcher must be a regex`);
    new RegExp(`^(?:${entry.matcher})$`, "u");
  }
  if (entry.timeoutSec !== undefined && !(Number.isInteger(entry.timeoutSec) && entry.timeoutSec > 0))
    throw new Error(`${label} timeoutSec must be a positive integer`);
  const script =
    typeof entry.bash === "string" ? /^f="\$\{PLUGIN_ROOT\}\/([^"$]+)";/u.exec(entry.bash)?.[1] : undefined;
  if (script === undefined) throw new Error(`${label} bash must start with f="\${PLUGIN_ROOT}/<script>";`);
  if (!scripts.has(script)) throw new Error(`${label} references a script the package does not ship: ${script}`);
  const expected = hookCommands(script, event);
  for (const shell of ["bash", "powershell"]) {
    if (entry[shell] !== expected[shell])
      throw new Error(`${label} ${shell} must be the standard command that runs node ${script} ${event}`);
  }
  return script;
}

/** Rejects hook scripts that load anything but Node builtins, including dynamic imports and re-exports. */
async function validateHookScript(outputRoot, script) {
  const label = `Hook script ${script} must import only Node builtins`;
  const result = await esbuild({
    absWorkingDir: outputRoot,
    entryPoints: [join(outputRoot, script)],
    bundle: true,
    platform: "node",
    format: "esm",
    metafile: true,
    write: false,
    logLevel: "silent",
  }).catch((error) => {
    throw new Error(`${label}: ${error.errors?.[0]?.text ?? error.message}`);
  });
  if (result.warnings.length > 0) throw new Error(`${label}: ${result.warnings[0].text}`);
  const inputs = Object.keys(result.metafile.inputs);
  if (inputs.length !== 1) throw new Error(`${label}: ${inputs.find((input) => input !== script) ?? inputs[0]}`);
  const external = Object.values(result.metafile.outputs)
    .flatMap(({ imports }) => imports)
    .map(({ path }) => path)
    .filter((path) => !builtins.has(path));
  if (external.length > 0) throw new Error(`${label}: ${external[0]}`);
  const output = Buffer.from(result.outputFiles[0].contents).toString("utf8");
  if (/\bimport\s*\(|\brequire\s*\(/u.test(output)) throw new Error(`${label}: dynamic import or require`);
}

/** Reads the APEX MCP tool effect policy from the compiled MCP adapter. */
async function mcpToolPolicy() {
  const module = await import(pathToFileURL(join(repositoryRoot, toolPolicyModule)).href).catch((error) => {
    throw new Error(
      `Cannot read the MCP tool policy from ${toolPolicyModule}; run npm run build:vnext (${error.message})`,
    );
  });
  return module.mcpToolPolicy();
}

function validateToolPolicy(policy, manifest) {
  assertKeys("Hook tool policy", policy, ["server", "tools", "readOnly"]);
  const names = (value) =>
    Array.isArray(value) &&
    value.every((name) => typeof name === "string" && /^[A-Za-z][A-Za-z0-9]*$/u.test(name)) &&
    value.every((name, index) => index === 0 || bytewise(value[index - 1], name) < 0);
  if (policy.server !== manifest.mcp.server) throw new Error("Hook tool policy server must be the bundled MCP server");
  if (!names(policy.tools) || policy.tools.length === 0 || !names(policy.readOnly))
    throw new Error("Hook tool policy must list sorted, unique tool names");
  const unknown = policy.readOnly.filter((name) => !policy.tools.includes(name));
  if (unknown.length > 0) throw new Error(`Hook tool policy marks an unknown tool read-only: ${unknown[0]}`);
}

/**
 * Checks hooks.json against the Copilot hook configuration format: version 1, camelCase events, and command entries
 * with both bash and PowerShell commands that run one shipped, dependency-free Node script from the plugin root.
 */
async function validatePackagedHooks(outputRoot, manifest) {
  if (manifest.hooks.entries.length === 0) return;
  const hooksRoot = manifest.hooks.targetRoot;
  const scripts = new Set(
    manifest.hooks.entries.filter((entry) => entry.endsWith(".mjs")).map((entry) => `${hooksRoot}/${entry}`),
  );
  for (const script of scripts) await validateHookScript(outputRoot, script);
  const hooks = JSON.parse(await readFile(join(outputRoot, hooksRoot, "hooks.json"), "utf8"));
  assertKeys("hooks.json", hooks, ["version", "hooks"]);
  if (hooks.version !== 1) throw new Error("hooks.json version must be 1");
  if (!isPlainObject(hooks.hooks) || Object.keys(hooks.hooks).length === 0)
    throw new Error("hooks.json hooks must map events to entries");
  const used = new Set();
  for (const [event, entries] of Object.entries(hooks.hooks)) {
    if (!hookEvents.includes(event)) throw new Error(`hooks.json has unsupported event ${event}`);
    if (!Array.isArray(entries) || entries.length === 0)
      throw new Error(`hooks.json ${event} must be a non-empty array`);
    entries.forEach((entry, index) =>
      used.add(validateHookCommand(`hooks.json ${event}[${index}]`, entry, event, scripts)),
    );
  }
  const unused = [...scripts].filter((script) => !used.has(script));
  if (unused.length > 0) throw new Error(`Hook script is not referenced by hooks.json: ${unused[0]}`);
  validateToolPolicy(
    JSON.parse(await readFile(join(outputRoot, hooksRoot, manifest.hooks.toolPolicy), "utf8")),
    manifest,
  );
}

function lockedPackage(lock, name) {
  const entry = lock.packages?.[`node_modules/${name}`];
  if (
    !isPlainObject(entry) ||
    typeof entry.version !== "string" ||
    typeof entry.resolved !== "string" ||
    !entry.resolved.startsWith("https://registry.npmjs.org/") ||
    typeof entry.integrity !== "string" ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(entry.integrity)
  ) {
    throw new Error(`package-lock.json must pin ${name} with an npmjs.org tarball and a sha512 integrity`);
  }
  return { name, version: entry.version, resolved: entry.resolved, integrity: entry.integrity, entry };
}

function matchesIntegrity(bytes, integrity) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}` === integrity;
}

async function readIfPresent(path) {
  return readFile(path).catch((error) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
    throw error;
  });
}

/**
 * Returns the lockfile tarball verified against its integrity. npm's content-addressed cache already holds the
 * tarballs `npm ci` installed; other platforms' tarballs are downloaded once from the lockfile URL into a local cache.
 */
async function lockedTarball(locked) {
  const digest = Buffer.from(locked.integrity.slice("sha512-".length), "base64").toString("hex");
  const npmCache = process.env.npm_config_cache;
  const ownCache = join(nativeCacheDirectory, `${digest}.tgz`);
  const candidates = [
    ...(npmCache
      ? [join(npmCache, "_cacache/content-v2/sha512", digest.slice(0, 2), digest.slice(2, 4), digest.slice(4))]
      : []),
    ownCache,
  ];
  for (const candidate of candidates) {
    const cached = await readIfPresent(candidate);
    if (cached !== undefined && matchesIntegrity(cached, locked.integrity)) return cached;
  }
  if (process.env.npm_config_offline === "true" || process.env.NPM_CONFIG_OFFLINE === "true")
    throw new Error(`${locked.name}@${locked.version} is not cached and npm offline mode is set; build online once`);
  let response;
  try {
    response = await fetch(locked.resolved, { signal: AbortSignal.timeout(nativeFetchTimeoutMs) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not download ${locked.resolved}: ${reason}`, { cause: error });
  }
  if (!response.ok) throw new Error(`Could not download ${locked.resolved}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!matchesIntegrity(bytes, locked.integrity))
    throw new Error(`${locked.resolved} does not match its package-lock.json integrity`);
  await mkdir(nativeCacheDirectory, { recursive: true });
  const partial = `${ownCache}.${process.pid}.partial`;
  await writeFile(partial, bytes);
  await rename(partial, ownCache);
  return bytes;
}

function tarField(header, start, length) {
  const field = header.subarray(start, start + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? length : end).toString("utf8");
}

function tarNumber(header, start, length, label) {
  if ((header[start] & 0x80) !== 0) throw new Error(`Unsupported base-256 tar ${label}`);
  const text = tarField(header, start, length).trim();
  if (!/^[0-7]*$/u.test(text)) throw new Error(`Invalid tar ${label}`);
  return text === "" ? 0 : Number.parseInt(text, 8);
}

/** Reads the regular files of an npm package tarball (gzip ustar with optional pax headers) with Node builtins. */
function extractTarball(tgz, label) {
  const tar = gunzipSync(tgz);
  const files = new Map();
  let paxPath;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    let checksum = 0;
    for (let index = 0; index < 512; index += 1) checksum += index >= 148 && index < 156 ? 32 : header[index];
    if (checksum !== tarNumber(header, 148, 8, "checksum")) throw new Error(`${label} has a corrupt tar header`);
    const size = tarNumber(header, 124, 12, "size");
    const bodyStart = offset + 512;
    if (bodyStart + size > tar.length) throw new Error(`${label} is truncated`);
    const body = tar.subarray(bodyStart, bodyStart + size);
    const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const prefix = tarField(header, 257, 6).startsWith("ustar") ? tarField(header, 345, 155) : "";
    const name = tarField(header, 0, 100);
    if (type === "x") {
      const path = /(?:^|\n)\d+ path=([^\n]*)\n/u.exec(body.toString("utf8"));
      paxPath = path?.[1];
    } else {
      const path = paxPath ?? (prefix === "" ? name : `${prefix}/${name}`);
      paxPath = undefined;
      if (type === "0") {
        if (files.has(path)) throw new Error(`${label} repeats ${path}`);
        files.set(path, Buffer.from(body));
      }
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

function tarballFile(files, path, label) {
  const content = files.get(`package/${path}`);
  if (content === undefined) throw new Error(`${label} has no ${path}`);
  return content;
}

/**
 * Writes the native rasterizer binaries, their license and a provenance manifest, and returns the table the bundle
 * inlines as __APEX_PLUGIN_NATIVE__. The manifest pins the same hashes the bundle checks before loading a binary.
 */
async function packageNativeBinaries(manifest, outputRoot) {
  const native = manifest.native;
  const lock = await readJson(join(repositoryRoot, "package-lock.json"));
  const main = lockedPackage(lock, native.package);
  const mainLabel = `${main.name}@${main.version}`;
  const mainFiles = extractTarball(await lockedTarball(main), mainLabel);
  const mainPackage = JSON.parse(tarballFile(mainFiles, "package.json", mainLabel).toString("utf8"));
  if (mainPackage.name !== main.name || mainPackage.version !== main.version || mainPackage.license !== "MPL-2.0")
    throw new Error(`${mainLabel} tarball metadata does not match package-lock.json and MPL-2.0`);
  const license = tarballFile(mainFiles, "LICENSE", mainLabel);
  if (!license.toString("utf8").startsWith("Mozilla Public License Version 2.0"))
    throw new Error(`${mainLabel} LICENSE is not the MPL-2.0 text`);

  const runtimeBinaries = {};
  const provenance = {};
  for (const platform of Object.keys(native.binaries).sort(bytewise)) {
    const binary = native.binaries[platform];
    const locked = lockedPackage(lock, binary.package);
    const label = `${locked.name}@${locked.version}`;
    if (locked.version !== main.version || main.entry.optionalDependencies?.[locked.name] !== main.version)
      throw new Error(`${label} must be the ${mainLabel} optional dependency for ${platform}`);
    const [os, cpu] = platform.split("-");
    if (
      locked.entry.os?.join() !== os ||
      locked.entry.cpu?.join() !== cpu ||
      (binary.libc === undefined ? locked.entry.libc !== undefined : locked.entry.libc?.join() !== binary.libc)
    )
      throw new Error(`${label} is not the ${platform}${binary.libc ? ` ${binary.libc}` : ""} package`);
    const files = extractTarball(await lockedTarball(locked), label);
    const packageJson = JSON.parse(tarballFile(files, "package.json", label).toString("utf8"));
    if (packageJson.name !== locked.name || packageJson.version !== locked.version || packageJson.main !== binary.file)
      throw new Error(`${label} tarball metadata does not match package-lock.json and ${binary.file}`);
    const content = tarballFile(files, binary.file, label);
    const file = `${platform}/${binary.file}`;
    const sha256 = createHash("sha256").update(content).digest("hex");
    await writeOutputFile(outputRoot, `${native.targetRoot}/${file}`, content);
    runtimeBinaries[platform] = { file, sha256, ...(binary.libc === undefined ? {} : { libc: binary.libc }) };
    provenance[platform] = {
      file,
      bytes: content.length,
      sha256,
      ...(binary.libc === undefined ? {} : { libc: binary.libc }),
      package: locked.name,
      version: locked.version,
      tarball: locked.resolved,
      integrity: locked.integrity,
    };
  }
  await writeOutputFile(outputRoot, `${native.targetRoot}/LICENSE`, license);
  await writeJsonOutput(outputRoot, `${native.targetRoot}/manifest.json`, {
    package: main.name,
    version: main.version,
    license: "MPL-2.0",
    licenseFile: "LICENSE",
    source: `${native.source}/tree/v${main.version}`,
    note: "Unmodified binaries from the npm platform packages; other platforms write SVG diagrams only.",
    binaries: provenance,
  });
  const root = `${posix.relative(posix.dirname(manifest.server.target), native.targetRoot)}/`;
  return { package: main.name, version: main.version, root, binaries: runtimeBinaries };
}

/**
 * Bundles the MCP entry and its @apexops/* and npm dependencies into one ESM file. Paths in esbuild comments are
 * relative to the repository root, so the output does not depend on the checkout location.
 */
async function bundleServer(manifest, outputRoot, nativeTable) {
  const result = await esbuild({
    absWorkingDir: repositoryRoot,
    entryPoints: [join(repositoryRoot, manifest.server.entry)],
    outfile: join(outputRoot, manifest.server.target),
    bundle: true,
    platform: "node",
    format: "esm",
    target: manifest.server.nodeTarget,
    // Disables the CLI's "run main when executed directly" guard, which would match the shared bundle URL.
    // __APEX_PLUGIN_NATIVE__, a JSON string, switches the rasterizer to the hashed binaries under native/.
    define: { __APEX_PLUGIN_BUNDLE__: "true", __APEX_PLUGIN_NATIVE__: JSON.stringify(JSON.stringify(nativeTable)) },
    // CommonJS dependencies such as ajv call require(); ESM output needs a real one.
    banner: {
      js: [
        'import { createRequire as __apexCreateRequire } from "node:module";',
        "const require = __apexCreateRequire(import.meta.url);",
      ].join("\n"),
    },
    legalComments: "eof",
    sourcemap: false,
    minify: false,
    metafile: true,
    write: false,
    logLevel: "silent",
  });
  if (result.warnings.length > 0) {
    throw new Error(`esbuild reported warnings:\n${result.warnings.map(({ text }) => `- ${text}`).join("\n")}`);
  }
  const inputs = Object.keys(result.metafile.inputs).sort(bytewise);
  const sdkInputs = inputs.filter((input) => input.includes("node_modules/@modelcontextprotocol/sdk/"));
  if (sdkInputs.length > 0) throw new Error(`MCP bundle must not include the v1 SDK: ${sdkInputs[0]}`);
  const externals = Object.values(result.metafile.outputs)
    .flatMap(({ imports }) => imports)
    .filter(({ external }) => external)
    .map(({ path }) => path);
  const unbundled = externals.filter((path) => !builtins.has(path));
  if (unbundled.length > 0) throw new Error(`MCP bundle has non-builtin runtime imports: ${unbundled.join(", ")}`);
  if (result.outputFiles.length !== 1) throw new Error("MCP bundle must produce exactly one file");
  const contents = Buffer.from(result.outputFiles[0].contents);
  if (contents.includes(forbiddenBundleText)) throw new Error(`MCP bundle must not reference ${forbiddenBundleText}`);
  if (contents.includes(repositoryRoot) || contents.includes(portablePath(repositoryRoot)))
    throw new Error("MCP bundle must not embed the absolute repository path");
  await writeOutputFile(outputRoot, manifest.server.target, contents);
  return {
    path: manifest.server.target,
    bytes: contents.length,
    sha256: createHash("sha256").update(contents).digest("hex"),
    inputs: inputs.length,
  };
}

/**
 * Deletes the output only when it is missing, empty or a previous build (plugin.json plus the .sha256 sidecar), so a
 * mistaken --output-dir cannot remove an unrelated directory.
 */
async function clearOutputDirectory(outputDirectory) {
  const info = await lstat(outputDirectory).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (info !== undefined) {
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Plugin output path is not a directory: ${outputDirectory}`);
    const entries = await readdir(outputDirectory);
    const previousBuild =
      entries.includes("plugin.json") &&
      (await lstat(`${outputDirectory}.sha256`).then(
        (sidecar) => sidecar.isFile(),
        () => false,
      ));
    if (entries.length > 0 && !previousBuild)
      throw new Error(`Refusing to replace a directory that is not a previous plugin build: ${outputDirectory}`);
    await rm(outputDirectory, { recursive: true, force: true });
  }
  await mkdir(outputDirectory, { recursive: true });
}

async function setDirectoryTimes(root) {
  for (const entry of await sortedDirectoryEntries(root)) {
    if (entry.isDirectory()) await setDirectoryTimes(join(root, entry.name));
  }
  await utimes(root, fixedTime, fixedTime);
}

async function hashTree(root) {
  const files = [];
  async function visit(directory, relativeDirectory) {
    for (const entry of await sortedDirectoryEntries(directory)) {
      const child = join(directory, entry.name);
      const relativePath = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) await visit(child, relativePath);
      else if (entry.isFile()) files.push(relativePath);
      else throw new Error(`Unsupported output entry: ${child}`);
    }
  }
  await visit(root, "");
  const hash = createHash("sha256");
  for (const file of files.sort(bytewise)) {
    hash.update(file);
    hash.update("\0");
    hash.update(await readFile(join(root, file)));
    hash.update("\0");
  }
  return { files, sha256: hash.digest("hex") };
}

async function build(
  { manifestPath, outputDirectory: outputDirectoryOverride } = parseArguments(process.argv.slice(2)),
) {
  const { manifest, outputDirectory } = await readManifest(manifestPath, outputDirectoryOverride);
  await clearOutputDirectory(outputDirectory);

  const plugin = await readJson(join(repositoryRoot, manifest.plugin.source));
  const { version } = await readJson(join(repositoryRoot, manifest.plugin.versionFrom));
  if (Object.hasOwn(plugin, "version"))
    throw new Error(`${manifest.plugin.source} must not set version; it comes from ${manifest.plugin.versionFrom}`);
  const { $schema, name, ...rest } = plugin;
  const packagedPlugin = { $schema, name, version, ...rest };
  validatePluginJson(packagedPlugin);
  await writeJsonOutput(outputDirectory, manifest.plugin.target, packagedPlugin);

  const mcp = await readJson(join(repositoryRoot, manifest.mcp.source));
  validateMcpJson(mcp, manifest);
  await writeJsonOutput(outputDirectory, manifest.mcp.target, mcp);

  const nativeTable = await packageNativeBinaries(manifest, outputDirectory);
  const bundle = await bundleServer(manifest, outputDirectory, nativeTable);
  for (const [name, content] of await renderPluginAgents(manifest.agents.sourceRoot)) {
    await writeOutputFile(outputDirectory, `${manifest.agents.targetRoot}/${name}`, Buffer.from(content, "utf8"));
  }
  await copyDirectory(manifest.skills.sourceRoot, outputDirectory, manifest.skills.targetRoot);
  const readTools = await pricingReadTools();
  let renderedHooks = 0;
  for (const entry of [...manifest.hooks.entries].sort(bytewise)) {
    let content = await readSourceFile(join(repositoryRoot, manifest.hooks.sourceRoot, entry));
    if (entry.endsWith(".mjs") && content.includes(pricingReadToolsMarker)) {
      content = renderHookScript(content, readTools);
      renderedHooks += 1;
    }
    await writeOutputFile(outputDirectory, `${manifest.hooks.targetRoot}/${entry}`, content);
  }
  if (renderedHooks !== 1) throw new Error("Exactly one hook script must carry the pricing read-tools marker");
  if (manifest.hooks.entries.length > 0) {
    const policy = await mcpToolPolicy();
    validateToolPolicy(policy, manifest);
    await writeJsonOutput(outputDirectory, `${manifest.hooks.targetRoot}/${manifest.hooks.toolPolicy}`, policy);
  }
  await copyDirectory(manifest.assets.sourceRoot, outputDirectory, manifest.assets.targetRoot);

  await validatePackagedAgents(outputDirectory, manifest.agents.targetRoot);
  await validatePackagedSkills(outputDirectory, manifest.skills.targetRoot);
  await validatePackagedHooks(outputDirectory, manifest);
  await setDirectoryTimes(outputDirectory);
  const tree = await hashTree(outputDirectory);
  await writeFile(`${outputDirectory}.sha256`, `${tree.sha256}  ${basename(outputDirectory)}\n`);
  return { outputDirectory, bundle, native: nativeTable, ...tree };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await build();
    process.stdout.write(
      `${JSON.stringify(
        {
          outputDirectory: portablePath(relative(repositoryRoot, result.outputDirectory)),
          files: result.files.length,
          sha256: result.sha256,
          bundle: result.bundle,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export {
  build,
  hashTree,
  hookCommands,
  mcpToolPolicy,
  validateMcpJson,
  validatePackageManifest,
  validatePackagedAgents,
  validatePackagedHooks,
  validatePluginJson,
};
