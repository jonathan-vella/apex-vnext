#!/usr/bin/env node
/** Credential-free tools/list and pure-learn capture; never calls an Azure operation. */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { azureRegistryPath, readJson } from "./_lib/mcp-contracts.mjs";

export async function captureInventory(root, mode, home, namespaces = [], { learn = false, onRequest } = {}) {
  const env = {
    PATH: process.env.PATH,
    ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}),
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    TMPDIR: home,
    TEMP: home,
    TMP: home,
    AZURE_CONFIG_DIR: join(home, ".azure"),
    DOTNET_EnableDiagnostics: "0",
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    AZURE_MCP_COLLECT_TELEMETRY: "false",
  };
  const installed = JSON.parse(await readFile(resolve(root, "node_modules/@azure/mcp/package.json"), "utf8"));
  const platformDirectory = resolve(root, `node_modules/@azure/mcp-${process.platform}-${process.arch}`);
  const platform = JSON.parse(await readFile(join(platformDirectory, "package.json"), "utf8"));
  if (platform.version !== installed.version) throw new Error("Azure MCP platform package version drifted");
  // Run the installed executable directly: metadata tests must never trigger the wrapper's npm-install fallback.
  const executable = resolve(platformDirectory, Object.values(platform.bin)[0]);
  const version = spawnSync(executable, ["--version"], { env, encoding: "utf8", windowsHide: true, timeout: 30_000 });
  if (version.status !== 0) throw new Error("Cannot inspect tracked Azure MCP binary version");
  const child = spawn(
    executable,
    ["server", "start", "--mode", mode, "--read-only", ...namespaces.flatMap((name) => ["--namespace", name])],
    {
      cwd: root,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const pending = new Map();
  let nextId = 0;
  let buffer = "";
  let stderr = "";
  const timeout = setTimeout(() => child.kill(), 60_000);
  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });
  child.stdout.on("data", (data) => {
    buffer += data.toString();
    for (;;) {
      const end = buffer.indexOf("\n");
      if (end < 0) break;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
  });
  child.on("error", (error) => {
    for (const request of pending.values()) request.reject(error);
  });
  child.stdin.on("error", (error) => {
    for (const request of pending.values()) request.reject(error);
  });
  child.on("exit", () => {
    for (const request of pending.values()) request.reject(new Error(`Azure MCP exited: ${stderr.slice(-1000)}`));
  });
  const send = (method, params) =>
    new Promise((resolveResult, reject) => {
      if (!["initialize", "tools/list", "tools/call"].includes(method))
        throw new Error("Inventory capture only permits metadata requests");
      if (
        method === "tools/call" &&
        (params.arguments?.intent !== "" ||
          params.arguments?.learn !== true ||
          JSON.stringify(Object.keys(params.arguments).sort()) !== JSON.stringify(["intent", "learn"]))
      )
        throw new Error("Inventory capture only permits pure-learn calls, never Azure commands");
      onRequest?.({ method, params });
      const id = ++nextId;
      pending.set(id, { resolve: resolveResult, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  try {
    const initialized = await send("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "apex-offline-inventory", version: "1.0.0" },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const listed = await send("tools/list", {});
    if (listed.nextCursor) throw new Error("Inventory capture must handle pagination before approval");
    const learned = {};
    if (learn) {
      for (const tool of listed.tools.filter(({ inputSchema }) => inputSchema.required?.includes("intent")))
        learned[tool.name] = await send("tools/call", { name: tool.name, arguments: { intent: "", learn: true } });
    }
    return {
      binaryVersion: version.stdout.trim(),
      initialized,
      tools: listed.tools,
      ...(learn ? { learned } : {}),
    };
  } finally {
    clearTimeout(timeout);
    await new Promise((resolveExit) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolveExit();
      const stop = setTimeout(() => child.kill(), 5_000);
      child.once("exit", () => {
        clearTimeout(stop);
        resolveExit();
      });
      child.stdin.end();
    });
  }
}

async function main() {
  const [output, option] = process.argv.slice(2);
  if (option !== undefined && option !== "--managed") throw new Error("Only --managed is supported");
  if (!output || isAbsolute(output) || output.split(/[\\/]/u).includes(".."))
    throw new Error("Supply a project-relative output directory");
  const root = process.cwd();
  const directory = resolve(root, output);
  const home = resolve(directory, "isolated-home");
  await mkdir(home, { recursive: true });
  try {
    const manifest = JSON.parse(await readFile("package.json", "utf8"));
    const installed = JSON.parse(await readFile("node_modules/@azure/mcp/package.json", "utf8"));
    if (manifest.devDependencies["@azure/mcp"] !== installed.version || !/^3\.\d+\.\d+$/u.test(installed.version))
      throw new Error("Inventory requires the exact tracked stable Azure MCP 3.x package");
    const managed = option === "--managed" ? readJson(azureRegistryPath) : undefined;
    for (const mode of managed ? ["namespace"] : ["namespace", "all"]) {
      const inventory = await captureInventory(root, mode, home, managed ? Object.keys(managed.namespaces) : [], {
        learn: Boolean(managed),
      });
      if (
        managed &&
        JSON.stringify(inventory.tools.map(({ name }) => name).sort()) !==
          JSON.stringify(Object.keys(managed.namespaces).sort())
      )
        throw new Error("Final managed launch tools/list does not exactly match approved namespace grants");
      await writeFile(
        resolve(directory, `${mode}${managed ? "-managed" : ""}.json`),
        `${JSON.stringify(inventory, null, 2)}\n`,
      );
      console.log(`${mode}: ${inventory.tools.length} tools (${inventory.binaryVersion})`);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
