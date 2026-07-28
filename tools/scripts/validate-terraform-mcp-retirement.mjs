#!/usr/bin/env node

import { createHash } from "node:crypto";
import { globSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Reporter } from "./_lib/reporter.mjs";

const ARCHIVE_ROOT = ".archive/retired-automation/terraform-mcp";
const PROVENANCE_PATH = `${ARCHIVE_ROOT}/provenance.json`;
const ARCHIVE_HASHES = {
  "tools/registry/terraform-mcp-characterization.json":
    "5c7ad2e8094bb66cd33afea1ab63c5d193b5e524b6b18a57fe768080eb8d5643",
  "tools/registry/terraform-mcp-tools-list.fixture.json":
    "0559fd51a2c05f08c2f74c1b64591a2f74837e416eb73cb1904d9b76f3cbfaec",
  "tools/registry/schemas/terraform-mcp-characterization.schema.json":
    "419a2b3817349644d5033bcec71038687611ba19cecebfa9d667c39a84f352e2",
  "tools/scripts/validate-terraform-mcp-characterization.mjs":
    "f4554e616ed320acf17fa670ff8c9d81f4515afae82bf4a98dd33bd234e21d7d",
  "tools/tests/validate-terraform-mcp-characterization.test.mjs":
    "6e84643f78d14b012b40a4794a769aedb6b9292cd71eb7674637f295d68079b0",
};

const ACTIVE_GLOBS = [
  ".vscode/**/*.{json,jsonc}",
  ".devcontainer/**/*.{json,md,sh}",
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const EXPECTED_PROVENANCE = {
  schemaVersion: "1.0.0",
  introducedBy: "69bac4e1d6e463a72d4a16111d1163ec30589094",
  archivedFrom: "7b3dee20b2713430c7302f5cdfc7b4a19e5a73e4",
  retirementIssue: 147,
  artifacts: Object.entries(ARCHIVE_HASHES).map(([path, hash]) => ({ path, sha256: hash })),
  replacementOwners: [
    "TerraformRegistryClient",
    "TerraformProviderIntrospection",
    "official-versioned-provider-documentation",
    "validate:avm-versions:freeze",
    "validate:terraform-mcp-retirement",
  ],
  rollback: [
    "restore-archived-files-byte-for-byte",
    "restore-characterization-package-and-graph-commands",
    "restore-only-pinned-reviewed-setup-and-discovery",
    "run-characterization-config-lifecycle-devcontainer-and-hosted-validation",
    "record-why-bounded-replacements-no-longer-satisfy-read-only-behavior",
  ],
};

export function findTerraformMcpRetirementErrors({ activeFiles, archivedFiles, provenance }) {
  const errors = [];
  for (const [path, content] of Object.entries(activeFiles)) {
    const normalized = content.replaceAll("\\", "/").toLowerCase();
    for (const marker of FORBIDDEN_MARKERS) {
      if (normalized.includes(marker.toLowerCase())) errors.push(`${path}: retired marker remains active: ${marker}`);
    }
  }
  for (const [originalPath, expectedHash] of Object.entries(ARCHIVE_HASHES)) {
    const archived = archivedFiles[originalPath];
    if (archived === undefined) errors.push(`${originalPath}: archived evidence is missing`);
    else if (sha256(archived) !== expectedHash) errors.push(`${originalPath}: archived evidence hash mismatch`);
  }
  if (JSON.stringify(provenance) !== JSON.stringify(EXPECTED_PROVENANCE)) {
    errors.push("archive provenance manifest does not match the exact retirement contract");
  }
  return errors;
}

export function collectTerraformMcpRetirementInputs(read = readFileSync) {
  const activePaths = globSync(ACTIVE_GLOBS, {
    exclude: [
      "**/node_modules/**",
      ".archive/**",
      "agent-output/**",
      "docs/vnext/phase-0a/**",
      "packages/**/dist/**",
      "site/**",
    ],
  });
  const activeFiles = Object.fromEntries(
    activePaths
      .filter(
        (path) =>
          path !== "tools/scripts/validate-terraform-mcp-retirement.mjs" &&
          path !== "tools/tests/validate-terraform-mcp-retirement.test.mjs" &&
          path !== "tools/scripts/validate-mcp-config.mjs" &&
          path !== "tools/tests/validate-mcp-config.test.mjs",
      )
      .map((path) => [path, read(path, "utf8")]),
  );
  const archivedFiles = Object.fromEntries(
    Object.keys(ARCHIVE_HASHES).map((path) => [path, read(`${ARCHIVE_ROOT}/${path}`)]),
  );
  return { activeFiles, archivedFiles, provenance: JSON.parse(read(PROVENANCE_PATH, "utf8")) };
}

function main() {
  const reporter = new Reporter("Terraform MCP Retirement Validator");
  reporter.header();
  let errors;
  try {
    errors = findTerraformMcpRetirementErrors(collectTerraformMcpRetirementInputs());
  } catch (error) {
    errors = [`retirement evidence is unreadable: ${error.message}`];
  }
  for (const error of errors) reporter.error(error);
  reporter.tick();
  if (errors.length === 0) reporter.ok("Terraform MCP is absent from active surfaces and archived evidence is intact");
  reporter.summary();
  reporter.exitOnError("Terraform MCP retirement is valid", "Terraform MCP retirement validation failed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
