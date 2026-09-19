#!/usr/bin/env node

import { globSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Reporter } from "./_lib/reporter.mjs";

const ACTIVE_GLOBS = [
  ".vscode/**/*.{json,jsonc}",
  ".github/skills/**/*.{md,sh,mjs,js}",
  ".github/instructions/**/*.md",
  "tools/scripts/**/*.{mjs,js,sh,md}",
  "tools/schemas/**/*.json",
  "tools/tests/**/*.{mjs,js,sh,md,json}",
  "config/**/*.{json,jsonc,md}",
  "packages/*/src/**/*.{ts,js,mjs,json,md}",
  "package.json",
];
const FORBIDDEN_MARKERS = [
  "terraform-mcp-server",
  "hashicorp/terraform-mcp-server",
  "/go/bin/terraform-mcp-server",
  "mcp_terraform_",
  "mcp-terraform",
  "terraform/search_modules",
  "terraform/get_module_details",
  "terraform/get_latest_module_version",
  "ghcr.io/devcontainers/features/go:1",
];

export function findTerraformMcpRetirementErrors({ activeFiles }) {
  const errors = [];
  for (const [path, content] of Object.entries(activeFiles)) {
    const normalized = content.replaceAll("\\", "/").toLowerCase();
    for (const marker of FORBIDDEN_MARKERS) {
      if (normalized.includes(marker.toLowerCase())) errors.push(`${path}: retired marker remains active: ${marker}`);
    }
  }
  return errors;
}

export function collectTerraformMcpRetirementInputs(read = readFileSync) {
  const activePaths = globSync(ACTIVE_GLOBS, { exclude: ["**/node_modules/**", "packages/**/dist/**"] });
  const excluded = new Set([
    "tools/scripts/validate-terraform-mcp-retirement.mjs",
    "tools/tests/validate-terraform-mcp-retirement.test.mjs",
    "tools/scripts/validate-mcp-config.mjs",
    "tools/tests/validate-mcp-config.test.mjs",
  ]);
  return {
    activeFiles: Object.fromEntries(
      activePaths.filter((path) => !excluded.has(path)).map((path) => [path, read(path, "utf8")]),
    ),
  };
}

function main() {
  const reporter = new Reporter("Terraform MCP Retirement Validator");
  reporter.header();
  try {
    const errors = findTerraformMcpRetirementErrors(collectTerraformMcpRetirementInputs());
    for (const error of errors) reporter.error(error);
    reporter.tick();
    if (errors.length === 0) reporter.ok("Terraform MCP is absent from active surfaces");
  } catch (error) {
    reporter.error(`Active retirement surfaces are unreadable: ${error.message}`);
  }
  reporter.summary();
  reporter.exitOnError("Terraform MCP retirement is valid", "Terraform MCP retirement validation failed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
