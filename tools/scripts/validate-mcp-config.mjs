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
const RETIRED_DRAWIO_EXECUTABLE = "deno";
const ARM_MCP_ENDPOINT = "https://mcp.management.azure.com";
const ARM_MCP_TOOLSET = "CostManagement,Pricing";

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
  const executable = command
    .split("/")
    .at(-1)
    ?.replace(/\.exe$/u, "");
  if (executable === RETIRED_TERRAFORM_EXECUTABLE) return "server executable";
  const serialized = JSON.stringify(server).toLowerCase().replaceAll("\\", "/");
  if (serialized.includes("hashicorp/terraform-mcp-server")) return "upstream source";
  if (serialized.includes("/go/bin/terraform-mcp-server")) return "legacy executable path";
  const args = Array.isArray(server?.args) ? server.args.map((argument) => String(argument).toLowerCase()) : [];
  if (args.includes("--toolsets") && args.includes("registry")) return "registry toolset signature";
  return null;
}

function retiredDrawioMarker(name, server) {
  const normalizedName = name.toLowerCase();
  if (normalizedName === "drawio" || normalizedName === "draw.io") return "legacy server key";
  const command = typeof server?.command === "string" ? server.command.replaceAll("\\", "/").toLowerCase() : "";
  const executable = command
    .split("/")
    .at(-1)
    ?.replace(/\.exe$/u, "");
  if (executable === RETIRED_DRAWIO_EXECUTABLE) {
    const args = Array.isArray(server?.args) ? server.args.map((value) => String(value).toLowerCase()) : [];
    if (args.some((value) => value.includes("mcp-servers/drawio"))) return "server executable";
  }
  const serialized = JSON.stringify(server).toLowerCase().replaceAll("\\", "/");
  if (serialized.includes("mcp-servers/drawio") || serialized.includes("drawio-mcp-server")) return "upstream source";
  return null;
}

export function validateMcpConfig(mcpConfig) {
  const errors = [];
  const servers = mcpConfig?.servers;
  if (servers === null || typeof servers !== "object" || Array.isArray(servers)) {
    return ["MCP config must define a servers object"];
  }
  if (!servers.github) errors.push("Missing required MCP server: servers.github");

  const armMcp = servers["azure-resource-manager-mcp"];
  if (!armMcp) errors.push("Missing required MCP server: servers.azure-resource-manager-mcp");
  else if (armMcp.type !== "http") errors.push('azure-resource-manager-mcp must use type: "http"');
  else if (armMcp.url !== ARM_MCP_ENDPOINT) {
    errors.push(`azure-resource-manager-mcp must use the managed endpoint: ${ARM_MCP_ENDPOINT}`);
  } else if (armMcp.headers?.["x-mcp-toolset"] !== ARM_MCP_TOOLSET) {
    errors.push(`azure-resource-manager-mcp must enable x-mcp-toolset: ${ARM_MCP_TOOLSET}`);
  }

  for (const [name, server] of Object.entries(servers)) {
    const serialized = JSON.stringify(server).toLowerCase().replaceAll("\\", "/");
    if (name.toLowerCase() === "azure-pricing" || serialized.includes("azure_pricing_mcp")) {
      errors.push(`Retired custom Azure Pricing MCP server must not be active: servers.${name}`);
    }
    if (name === "astro-docs" || isRetiredAstroEndpoint(server?.url)) {
      errors.push(`Retired Astro MCP server must not be active: servers.${name}`);
    }
    const terraformMarker = retiredTerraformMarker(name, server);
    if (terraformMarker !== null) {
      errors.push(`Retired Terraform MCP server must not be active: servers.${name} (${terraformMarker})`);
    }
    const drawioMarker = retiredDrawioMarker(name, server);
    if (drawioMarker !== null) {
      errors.push(`Retired Draw.io MCP server must not be active: servers.${name} (${drawioMarker})`);
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
  if (hasServerMap && !errors.some((error) => error.includes("azure-resource-manager-mcp"))) {
    r.ok("MCP config includes Microsoft ARM MCP with Cost Management and Pricing");
  }
  r.tick();
  if (hasServerMap && !errors.some((error) => error.startsWith("Retired custom Azure Pricing MCP"))) {
    r.ok("Retired custom Azure Pricing MCP server is absent from active discovery");
  }
  r.tick();
  if (hasServerMap && !errors.some((error) => error.startsWith("Retired Astro MCP"))) {
    r.ok("Retired Astro MCP server is absent from active discovery");
  }
  r.tick();
  if (hasServerMap && !errors.some((error) => error.startsWith("Retired Terraform MCP"))) {
    r.ok("Retired Terraform MCP server is absent from active discovery");
  }
  r.tick();
  if (hasServerMap && !errors.some((error) => error.startsWith("Retired Draw.io MCP"))) {
    r.ok("Retired Draw.io MCP server is absent from active discovery");
  }

  r.summary();
  r.exitOnError("MCP config valid", "MCP config validation failed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
