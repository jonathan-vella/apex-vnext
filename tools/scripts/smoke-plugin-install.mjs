#!/usr/bin/env node
/**
 * Install the built APEX plugin with the Copilot CLI and smoke-test the installed MCP server over stdio (CP-08).
 *
 * Usage: node tools/scripts/smoke-plugin-install.mjs [--plugin-dir <dir>] [--copilot <command>] [--cli-version <x.y.z>]
 *        [--keep]
 * Default plugin dir: dist/apex-plugin (run `npm run build:plugin` first, or use `npm run test:plugin-install`).
 *
 * Everything runs in a fresh sandbox under the OS temp directory: HOME and COPILOT_HOME point into it, so the
 * developer's real Copilot configuration is never read or written, and the sandbox is deleted afterwards unless
 * --keep is passed. The CLI needs no sign-in for a local-path install. The smoke then:
 *   1. checks the installed tree hash equals the build's `.sha256` sidecar (the CLI copies the package verbatim) and
 *      that plugin.json, mcp.json, the agents, skills and managed hooks are present;
 *   2. starts the installed server exactly as mcp.json declares it, with `${PLUGIN_ROOT}` set to the installed
 *      folder and an environment of only PATH, PLUGIN_ROOT and HOME;
 *   3. sends `server/discover` (protocol 2026-07-28), a modern `tools/list` and `tools/call status` against an
 *      absolute temporary git workspace initialized with the repository CLI (packages/cli/dist, from build:plugin),
 *      and checks the result matches `apex status`.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { hashTree } from "./build-plugin.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryCli = join(repositoryRoot, "packages/cli/dist/cli.js");
const protocolVersion = "2026-07-28";
const installTimeoutMs = 300_000;
const responseTimeoutMs = 60_000;
const modernMeta = {
  "io.modelcontextprotocol/protocolVersion": protocolVersion,
  "io.modelcontextprotocol/clientInfo": { name: "apex-plugin-install-smoke", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};
const requiredPaths = [
  "plugin.json",
  "mcp.json",
  "com.github.copilot/hooks/hooks.json",
  "com.github.copilot/hooks/apex-hook.mjs",
  "com.github.copilot/hooks/apex-mcp-tools.json",
];

function parseArguments(argv) {
  const options = {
    pluginDirectory: join(repositoryRoot, "dist/apex-plugin"),
    copilot: "copilot",
    cliVersion: undefined,
    keep: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--plugin-dir", "--copilot", "--cli-version"].includes(argument)) {
      const value = argv[++index];
      if (value === undefined) throw new Error(`Missing value for ${argument}`);
      if (argument === "--plugin-dir") options.pluginDirectory = resolve(value);
      else if (argument === "--copilot") options.copilot = value;
      else if (/^\d+\.\d+\.\d+$/u.test(value)) options.cliVersion = value;
      else throw new Error(`--cli-version must be an exact x.y.z version, got ${value}`);
    } else if (argument === "--keep") {
      options.keep = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function contained(root, path) {
  const child = relative(root, path);
  return child !== "" && !child.startsWith("..") && !isAbsolute(child);
}

/** Copilot CLI writes config.json with leading `//` comment lines; strip them before parsing. */
function parseCopilotConfig(text) {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gmu, ""));
}

function installedPlugin(config, name) {
  const entries = (config.installedPlugins ?? []).filter((entry) => entry?.name === name);
  if (entries.length !== 1) throw new Error(`Expected one installed ${name} plugin, found ${entries.length}`);
  return entries[0];
}

/** Resolves the stdio launch from an installed mcp.json the way a client does: `${PLUGIN_ROOT}` is the plugin folder. */
function serverLaunch(mcp, serverName, pluginRoot) {
  const server = mcp?.mcpServers?.[serverName];
  if (server?.type !== "stdio" || typeof server.command !== "string")
    throw new Error(`mcp.json has no stdio server ${serverName}`);
  const expand = (value) => value.replaceAll("${PLUGIN_ROOT}", pluginRoot);
  return {
    command: expand(server.command),
    args: (server.args ?? []).map(expand),
    cwd: server.cwd === undefined ? pluginRoot : resolve(pluginRoot, expand(server.cwd)),
    env: Object.fromEntries(Object.entries(server.env ?? {}).map(([key, value]) => [key, expand(value)])),
  };
}

function homeEnvironment(home) {
  return process.platform === "win32" ? { HOME: home, USERPROFILE: home } : { HOME: home };
}

function run(command, args, { cwd, env, timeout = installTimeoutMs }) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", shell: false, timeout, windowsHide: true });
  if (result.error) throw new Error(`${command} ${args.join(" ")} failed to start: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}${result.stderr}`.trim();
}

async function countFiles(root, predicate) {
  if (!existsSync(root)) return 0;
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && predicate(entry.name)).length;
}

async function settleWithin(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(undefined), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Spawns the server and bounds every wait, so a stuck or unspawnable server cannot block sandbox cleanup. */
function startServer(launch, env, { requestTimeoutMs = responseTimeoutMs, shutdownTimeoutMs = 10_000 } = {}) {
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  // A write to a dead child surfaces as EPIPE on stdin; the exit or spawn error reports the real cause.
  child.stdin.on("error", () => {});
  // Node emits `error` and `close`, but no `exit`, when the command cannot be spawned.
  const exited = new Promise((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
    child.once("error", (error) => resolveExit({ code: null, signal: null, error }));
  });
  const spawnFailed = new Promise((_, reject) => child.once("error", reject));
  spawnFailed.catch(() => {});
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const request = async (id, method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}\n${stderr}`)), requestTimeoutMs);
    });
    try {
      const line = await Promise.race([lines.next(), timeout, spawnFailed]);
      if (line.done) throw new Error(`MCP server closed stdout during ${method}\n${stderr}`);
      const response = JSON.parse(line.value);
      if (response.id !== id || response.error !== undefined)
        throw new Error(`${method} failed: ${JSON.stringify(response)}`);
      return response.result;
    } finally {
      clearTimeout(timer);
    }
  };
  const close = async () => {
    child.stdin.end();
    const exit = await settleWithin(exited, shutdownTimeoutMs);
    if (exit !== undefined) return { ...exit, stderr, timedOut: false };
    child.kill("SIGKILL");
    const killed = await settleWithin(exited, shutdownTimeoutMs);
    return { ...(killed ?? { code: null, signal: "SIGKILL" }), stderr, timedOut: true };
  };
  return { child, request, close };
}

function exitProblem(exit) {
  if (exit.error !== undefined) return `MCP server could not start: ${exit.error.message}`;
  if (exit.timedOut) return `MCP server did not exit after stdin closed and was killed\n${exit.stderr}`;
  if (exit.code !== 0 || exit.signal !== null) return `MCP server exited ${exit.code ?? exit.signal}\n${exit.stderr}`;
  return undefined;
}

async function smoke({ pluginDirectory, copilot, cliVersion: expectedCliVersion, keep }) {
  if (process.platform === "win32")
    throw new Error("The Copilot CLI host is Linux, macOS or WSL2; native Windows CLI is unsupported (DECISION-033)");
  const buildRoot = await realpath(pluginDirectory);
  const sidecar = (await readFile(`${buildRoot}.sha256`, "utf8")).split(/\s+/u)[0];
  const build = await hashTree(buildRoot);
  if (build.sha256 !== sidecar) throw new Error(`${buildRoot} does not match its .sha256 sidecar; rebuild it`);
  const plugin = JSON.parse(await readFile(join(buildRoot, "plugin.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(repositoryRoot, "plugin/package-manifest.json"), "utf8"));

  const sandbox = await realpath(await mkdtemp(join(tmpdir(), "apex-plugin-install-")));
  const home = join(sandbox, "home");
  const copilotHome = join(home, ".copilot");
  const workspace = join(sandbox, "workspace");
  try {
    await mkdir(home);
    await mkdir(workspace);
    const cliEnv = {
      PATH: process.env.PATH,
      ...homeEnvironment(home),
      COPILOT_HOME: copilotHome,
      COPILOT_AUTO_UPDATE: "false",
    };
    const cliVersion = run(copilot, ["--version"], { cwd: sandbox, env: cliEnv }).split(/\r?\n/u)[0];
    const reportedVersion = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/u.exec(cliVersion)?.[0];
    if (expectedCliVersion !== undefined && reportedVersion !== expectedCliVersion)
      throw new Error(`Expected Copilot CLI ${expectedCliVersion}, found: ${cliVersion}`);
    const installCommand = ["plugin", "install", buildRoot];
    const installOutput = run(copilot, installCommand, { cwd: sandbox, env: cliEnv });
    if (!installOutput.includes(`Plugin "${plugin.name}" installed successfully`))
      throw new Error(`Unexpected install output:\n${installOutput}`);

    const config = parseCopilotConfig(await readFile(join(copilotHome, "config.json"), "utf8"));
    const entry = installedPlugin(config, plugin.name);
    const pluginRoot = await realpath(entry.cache_path);
    if (!contained(copilotHome, pluginRoot)) throw new Error(`Installed outside COPILOT_HOME: ${pluginRoot}`);
    if (entry.enabled !== true || entry.version !== plugin.version || entry.source?.source !== "local")
      throw new Error(`Unexpected installed plugin record: ${JSON.stringify(entry)}`);
    if ((await realpath(entry.source.path)) !== buildRoot)
      throw new Error(`Installed from ${entry.source.path}, expected ${buildRoot}`);

    const installed = await hashTree(pluginRoot);
    if (installed.sha256 !== sidecar) {
      const missing = build.files.filter((file) => !installed.files.includes(file));
      const extra = installed.files.filter((file) => !build.files.includes(file));
      throw new Error(
        `Installed tree hash ${installed.sha256} != build ${sidecar}; missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}`,
      );
    }
    const missingPaths = [...requiredPaths, manifest.server.target].filter(
      (path) => !existsSync(join(pluginRoot, path)),
    );
    if (missingPaths.length > 0) throw new Error(`Installed plugin is missing ${missingPaths.join(", ")}`);
    const agents = await countFiles(join(pluginRoot, manifest.agents.targetRoot), (name) => name.endsWith(".md"));
    const skills = await countFiles(join(pluginRoot, manifest.skills.targetRoot), (name) => name === "SKILL.md");
    if (agents === 0 || skills === 0) throw new Error(`Installed plugin has ${agents} agents and ${skills} skills`);

    // The workspace is prepared with the repository CLI; only the installed server is under test.
    const fixtureEnv = { PATH: process.env.PATH, ...homeEnvironment(home) };
    run("git", ["init", "--quiet", workspace], { cwd: sandbox, env: fixtureEnv });
    const apex = (args) =>
      JSON.parse(run(process.execPath, [repositoryCli, ...args, "--json"], { cwd: workspace, env: fixtureEnv }));
    if (apex(["init", "--project", "plugin-smoke", "--risk-owner", "partner", "--target", "local"]).ok !== true)
      throw new Error("apex init failed in the smoke workspace");

    const mcp = JSON.parse(await readFile(join(pluginRoot, "mcp.json"), "utf8"));
    const launch = serverLaunch(mcp, manifest.mcp.server, pluginRoot);
    const server = startServer(launch, {
      ...launch.env,
      PATH: process.env.PATH,
      PLUGIN_ROOT: pluginRoot,
      ...homeEnvironment(home),
    });
    let exit;
    let discovered;
    let listed;
    let status;
    try {
      discovered = await server.request(1, "server/discover", { _meta: modernMeta });
      if (!discovered?.supportedVersions?.includes(protocolVersion))
        throw new Error(`server/discover lacks ${protocolVersion}: ${JSON.stringify(discovered)}`);
      if (typeof discovered.instructions !== "string" || discovered.instructions.length === 0)
        throw new Error("server/discover returned no instructions");
      listed = await server.request(2, "tools/list", { _meta: modernMeta });
      const tools = listed?.tools ?? [];
      if (!tools.some((tool) => tool.name === "status")) throw new Error("tools/list has no status tool");
      const withoutWorkspace = tools.filter((tool) => !tool.inputSchema?.required?.includes("workspace"));
      if (withoutWorkspace.length > 0)
        throw new Error(`Tools without a required workspace: ${withoutWorkspace.map((tool) => tool.name).join(", ")}`);
      status = await server.request(3, "tools/call", { name: "status", arguments: { workspace }, _meta: modernMeta });
      if (status?.isError === true || status?.structuredContent === undefined)
        throw new Error(`status failed: ${JSON.stringify(status)}`);
      if (!isDeepStrictEqual(status.structuredContent, apex(["status"]).result))
        throw new Error(`status differs from the APEX CLI: ${JSON.stringify(status.structuredContent)}`);
    } finally {
      exit = await server.close();
    }
    const problem = exitProblem(exit);
    if (problem !== undefined) throw new Error(problem);

    return {
      cli: cliVersion,
      install: `copilot ${installCommand.join(" ")}`,
      installOutput,
      installedPluginRoot: relative(sandbox, pluginRoot),
      treeSha256: installed.sha256,
      files: installed.files.length,
      agents,
      skills,
      server: { command: launch.command, args: launch.args.map((arg) => relative(sandbox, arg)) },
      supportedVersions: discovered.supportedVersions,
      tools: listed.tools.map((tool) => tool.name),
      status: {
        projectId: status.structuredContent.run?.projectId,
        task: status.structuredContent.task,
        events: status.structuredContent.events,
        blockers: status.structuredContent.blockers,
      },
      ...(keep ? { sandbox } : {}),
    };
  } finally {
    if (!keep) await rm(sandbox, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(await smoke(parseArguments(process.argv.slice(2))), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `APEX plugin install smoke failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

export { exitProblem, installedPlugin, parseArguments, parseCopilotConfig, serverLaunch, smoke, startServer };
