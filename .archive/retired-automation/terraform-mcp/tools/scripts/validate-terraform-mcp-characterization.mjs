#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { reportRegistryValidation, requestedReportFormat } from "./_lib/registry-validator-reporter.mjs";

const CHARACTERIZATION = "tools/registry/terraform-mcp-characterization.json";
const SCHEMA = "tools/registry/schemas/terraform-mcp-characterization.schema.json";
const EXPECTED_CONSUMERS = [
  { path: ".vscode/mcp.json", kind: "active-config", marker: "--toolsets" },
  { path: ".devcontainer/post-create.sh", kind: "installer", marker: "terraform-mcp-server" },
  { path: ".devcontainer/post-start.sh", kind: "fallback-installer", marker: "terraform-mcp-server" },
  { path: ".devcontainer/README.md", kind: "setup-doc", marker: "Terraform MCP Server" },
  { path: "tools/scripts/validate-devcontainer.sh", kind: "compatibility-check", marker: "check_terraform_mcp" },
  {
    path: ".github/skills/terraform-search-import/SKILL.md",
    kind: "skill",
    marker: "mcp_terraform_search_providers",
  },
  { path: ".github/skills/terraform-test/SKILL.md", kind: "skill", marker: "mcp_terraform_search_providers" },
  {
    path: ".github/skills/iac-common/references/codegen-shared-workflow.md",
    kind: "workflow-guidance",
    marker: "terraform/search_modules",
  },
  {
    path: ".github/skills/azure-defaults/references/avm-modules.md",
    kind: "guidance",
    marker: "terraform MCP",
  },
  {
    path: ".github/instructions/iac-terraform-best-practices.instructions.md",
    kind: "instruction",
    marker: "mcp_terraform_get_latest_module_version",
  },
  {
    path: ".github/skills/azure-defaults/references/terraform-conventions.md",
    kind: "guidance",
    marker: "mcp_terraform_get_latest_module_version",
  },
  {
    path: ".github/skills/terraform-patterns/references/tf-best-practices-examples.md",
    kind: "guidance",
    marker: "mcp_terraform_get_latest_module_version",
  },
  {
    path: ".github/skills/iac-common/references/contract-emission-and-handoff.md",
    kind: "workflow-guidance",
    marker: "terraform/get_module_details",
  },
  {
    path: "tools/tests/validate-mcp-config.test.mjs",
    kind: "config-regression",
    marker: "terraform-mcp-server",
  },
];
const REQUIRED_DENIALS = ["apply", "destroy", "import", "init", "plan", "state", "workspace-mutation"];
const EXPECTED_REPLACEMENT_OWNERS = [
  { capability: "registry-search-details-versions", owner: "bounded Terraform Registry API client" },
  { capability: "installed-provider-schemas", owner: "terraform providers schema -json" },
  { capability: "import-guidance", owner: "official provider documentation" },
];
const EXPECTED_REMOVAL_GATE =
  "Implement and test deterministic Registry/native replacements, migrate all declared consumers, remove setup/config references, and prove Terraform lifecycle behavior unchanged.";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function validateTerraformMcpCharacterization({ characterization, schema, read = readFileSync }) {
  const errors = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  if (!ajv.validate(schema, characterization)) {
    errors.push(...(ajv.errors ?? []).map((error) => `schema ${error.instancePath || "/"}: ${error.message}`));
    return errors;
  }

  const fixtureBytes = read(characterization.toolsFixture.path);
  if (characterization.toolsFixture.sha256 !== sha256Bytes(fixtureBytes)) {
    errors.push("tools fixture SHA-256 does not match the tracked full-schema fixture");
  }
  const fixture = JSON.parse(fixtureBytes.toString("utf8"));
  const derivedTools = fixture.map(({ name, inputSchema }) => ({
    name,
    required: [...(inputSchema.required ?? [])].sort(),
    schemaSha256: sha256Bytes(stableJson(inputSchema)),
  }));
  if (stableJson(characterization.tools) !== stableJson(derivedTools)) {
    errors.push("tool summaries must derive from the tracked full input schemas");
  }
  if (characterization.toolsListSha256 !== sha256Bytes(stableJson(derivedTools))) {
    errors.push("toolsListSha256 does not match the derived registry-only tool list");
  }
  const denials = [...characterization.lifecycleAuthority.deniedToMcp].sort();
  if (JSON.stringify(denials) !== JSON.stringify(REQUIRED_DENIALS)) {
    errors.push("lifecycle denial must cover native Terraform and Gate 4 authority boundaries");
  }
  if (characterization.workspaceConfig.sha256 !== sha256Bytes(read(characterization.workspaceConfig.path))) {
    errors.push("workspace MCP config SHA-256 does not match .vscode/mcp.json");
  }
  if (stableJson(characterization.consumers) !== stableJson(EXPECTED_CONSUMERS)) {
    errors.push("consumers must match the complete active Terraform MCP inventory");
  }
  if (stableJson(characterization.replacementOwners) !== stableJson(EXPECTED_REPLACEMENT_OWNERS)) {
    errors.push("replacement owners must match the approved Registry/native ownership map");
  }
  if (characterization.removalGate !== EXPECTED_REMOVAL_GATE) {
    errors.push("removal gate must preserve deterministic replacement and lifecycle parity requirements");
  }
  for (const consumer of characterization.consumers) {
    if (!existsSync(consumer.path)) {
      errors.push(`consumer path does not exist: ${consumer.path}`);
      continue;
    }
    if (!read(consumer.path, "utf8").includes(consumer.marker)) {
      errors.push(`consumer marker is missing from ${consumer.path}: ${consumer.marker}`);
    }
  }
  return errors;
}

function main() {
  const characterization = JSON.parse(readFileSync(CHARACTERIZATION, "utf8"));
  const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
  const errors = validateTerraformMcpCharacterization({ characterization, schema });
  process.exitCode = reportRegistryValidation({
    title: "Terraform MCP Characterization Validator",
    source: CHARACTERIZATION,
    errors,
    passMessage: "Terraform MCP characterization is valid",
    format: requestedReportFormat(process.argv.slice(2)),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
