#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  azureRegistryPath,
  contractDigest,
  digestPath,
  exactAzureMcpVersion,
  readJson,
} from "./_lib/mcp-contracts.mjs";
import { APPROVED_COMMANDS, APPROVED_NAMESPACES } from "./generate-azure-mcp-registry.mjs";

export function validateAzureMcpRegistry(registry, schema = readJson("tools/registry/schemas/azure-mcp.schema.json")) {
  try {
    const errors = [];
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    if (!ajv.validate(schema, registry))
      return (ajv.errors ?? []).map(({ instancePath, message }) => `${instancePath || "/"}: ${message}`);
    if (contractDigest(registry) !== readJson(digestPath).files[azureRegistryPath])
      errors.push("canonical Azure MCP approved inventory drifted; recapture and review before regenerating");
    if (
      registry.package.version !== exactAzureMcpVersion() ||
      !registry.package.binaryVersion.startsWith(`${registry.package.version}+`)
    )
      errors.push("Azure MCP inventory must match the exact stable dependency");
    if (JSON.stringify(Object.keys(registry.namespaces)) !== JSON.stringify(APPROVED_NAMESPACES))
      errors.push("Azure MCP approved namespaces drifted");
    const launch = registry.capture.managedLaunch;
    if (
      launch.serverVersion !== registry.package.version ||
      launch.managedNamespaceToolCount !== Object.keys(registry.namespaces).length ||
      launch.managedToolNamesSha256 !== contractDigest(Object.keys(registry.namespaces).sort()) ||
      launch.pureLearnToolCount !== Object.values(registry.namespaces).filter(({ kind }) => kind === "router").length
    )
      errors.push("Azure MCP final managed launch evidence does not match the approved grants");
    const commands = [];
    for (const [name, namespace] of Object.entries(registry.namespaces)) {
      if (namespace.kind === "direct") {
        commands.push(name);
        ajv.compile(namespace.inputSchema);
      } else {
        for (const [command, tool] of Object.entries(namespace.commands)) {
          commands.push(command);
          if (name !== "documentation" && !command.startsWith(`${name}_`))
            errors.push(`Azure MCP command ${command} is in the wrong namespace`);
          ajv.compile(tool.inputSchema);
        }
      }
    }
    if (JSON.stringify([...commands].sort()) !== JSON.stringify([...APPROVED_COMMANDS].sort()))
      errors.push("Azure MCP explicit read command allowlist drifted");
    return errors.sort();
  } catch (error) {
    return [`Azure MCP inventory is malformed: ${error.message}`];
  }
}

function main() {
  const errors = validateAzureMcpRegistry(readJson(azureRegistryPath));
  for (const error of errors) console.error(`❌ ${error}`);
  if (!errors.length) console.log("✅ Azure MCP exact package, captured schemas and explicit command policy are valid");
  process.exitCode = errors.length ? 1 : 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
