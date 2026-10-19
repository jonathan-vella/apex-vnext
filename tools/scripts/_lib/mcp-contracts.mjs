import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const azureRegistryPath = "tools/registry/azure-mcp.v1.json";
export const armRegistryPath = "tools/registry/arm-mcp-cost-pricing.v1.json";
export const digestPath = "tools/registry/mcp-contract-digests.v1.json";
export const readJson = (path, root = repositoryRoot) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

export function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  return value;
}

export const contractDigest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");

export function azureMcpArguments(registry, packageSpecifier) {
  return [
    ...(packageSpecifier ? ["--yes", packageSpecifier] : ["${workspaceFolder}/node_modules/@azure/mcp/index.js"]),
    "server",
    "start",
    "--mode",
    "namespace",
    "--read-only",
    ...Object.keys(registry.namespaces).flatMap((namespace) => ["--namespace", namespace]),
  ];
}

export function exactAzureMcpVersion(root = repositoryRoot) {
  const version = readJson("package.json", root).devDependencies?.["@azure/mcp"];
  const lock = readJson("package-lock.json", root);
  if (
    typeof version !== "string" ||
    !/^3\.\d+\.\d+$/u.test(version) ||
    lock.packages?.[""].devDependencies?.["@azure/mcp"] !== version ||
    lock.packages?.["node_modules/@azure/mcp"]?.version !== version
  )
    throw new Error("@azure/mcp must be an exact stable 3.x version matching package-lock.json");
  return version;
}

export function azureLaunchErrors(server, { development = false, source = false, root = repositoryRoot } = {}) {
  try {
    const registry = readJson(azureRegistryPath, root);
    const version = exactAzureMcpVersion(root);
    if (registry.package.version !== version) return ["Azure MCP approved inventory must match the exact dependency"];
    const expected = {
      type: "stdio",
      command: development ? "node" : "npx",
      args: azureMcpArguments(registry, development ? undefined : source ? "@azure/mcp" : `@azure/mcp@${version}`),
    };
    return JSON.stringify(canonicalValue(server)) === JSON.stringify(canonicalValue(expected))
      ? []
      : ["Azure MCP must use the approved namespace/read-only launch and exact tracked package"];
  } catch (error) {
    return [error.message];
  }
}
