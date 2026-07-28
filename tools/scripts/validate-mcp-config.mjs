#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseJsonc } from "./_lib/parse-jsonc.mjs";
import { Reporter } from "./_lib/reporter.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../..");
const mcpConfigPath = resolve(repoRoot, ".vscode/mcp.json");
const RETIRED_ASTRO_HOST = "mcp.docs.astro.build";
const RETIRED_TERRAFORM_EXECUTABLE = "terraform-mcp-server";

function isRetiredAstroEndpoint(value) {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.+$/u, "") === RETIRED_ASTRO_HOST;
  } catch {
    return false;
  }
}

function retiredTerraformMarker(name, server) {
  if (name.toLowerCase() === "terraform") return "legacy server key";
  const command = typeof server?.command === "string" ? server.command.replaceAll("\\", "/").toLowerCase() : "";
  if (command.split("/").at(-1) === RETIRED_TERRAFORM_EXECUTABLE) return "server executable";
  const serialized = JSON.stringify(server).toLowerCase().replaceAll("\\", "/");
  if (serialized.includes("hashicorp/terraform-mcp-server")) return "upstream source";
  if (serialized.includes("/go/bin/terraform-mcp-server")) return "legacy executable path";
  const args = Array.isArray(server?.args) ? server.args.map((argument) => String(argument).toLowerCase()) : [];
  if (args.includes("--toolsets") && args.includes("registry")) return "registry toolset signature";
  return null;
}

export function validateMcpConfig(mcpConfig) {
  const errors = [];
  const servers = mcpConfig?.servers;
  if (servers === null || typeof servers !== "object" || Array.isArray(servers)) {
    return ["MCP config must define a servers object"];
  }
  if (!servers.github) errors.push("Missing required MCP server: servers.github");

  const drawio = servers.drawio;
  if (!drawio) errors.push("Missing required MCP server: servers.drawio");
  else if (drawio.type !== "stdio") errors.push(`drawio server must use type: "stdio", got "${drawio.type}"`);
  else if (drawio.command !== "deno") errors.push(`drawio command must be "deno", got "${drawio.command}"`);
  else if (!Array.isArray(drawio.args) || !drawio.args.some((argument) => argument.includes("mcp-servers/drawio"))) {
    errors.push("drawio args must include the drawio MCP server path (tools/mcp-servers/drawio)");
  }

  for (const [name, server] of Object.entries(servers)) {
    if (name === "astro-docs" || isRetiredAstroEndpoint(server?.url)) {
      errors.push(`Retired Astro MCP server must not be active: servers.${name}`);
    }
    const terraformMarker = retiredTerraformMarker(name, server);
    if (terraformMarker !== null) {
      errors.push(`Retired Terraform MCP server must not be active: servers.${name} (${terraformMarker})`);
    }
  }
  return errors;
}

function main() {
  const r = new Reporter("MCP Config Validator");
  r.header();

  if (!existsSync(mcpConfigPath)) {
    r.error("Missing .vscode/mcp.json");
    r.summary();
    r.exitOnError();
  }

  let mcpConfig;
  try {
    mcpConfig = parseJsonc(readFileSync(mcpConfigPath, "utf-8"));
  } catch (error) {
    r.error(`Invalid JSON in .vscode/mcp.json: ${error.message}`);
    r.summary();
    r.exitOnError();
  }

  const errors = validateMcpConfig(mcpConfig);
  const hasServerMap =
    mcpConfig?.servers !== null && typeof mcpConfig?.servers === "object" && !Array.isArray(mcpConfig.servers);
  for (const error of errors) r.error(error);
  r.tick();
  if (mcpConfig?.servers?.github) r.ok("MCP config includes required server: github");
  r.tick();
  if (hasServerMap && !errors.some((error) => error.startsWith("drawio ") || error.includes("servers.drawio"))) {
    r.ok("MCP config includes valid drawio server (Deno stdio)");
  }
  r.tick();
  if (hasServerMap && !errors.some((error) => error.startsWith("Retired Astro MCP"))) {
    r.ok("Retired Astro MCP server is absent from active discovery");
  }
  r.tick();
  if (hasServerMap && !errors.some((error) => error.startsWith("Retired Terraform MCP"))) {
    r.ok("Retired Terraform MCP server is absent from active discovery");
  }

  r.summary();
  r.exitOnError("MCP config valid", "MCP config validation failed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
