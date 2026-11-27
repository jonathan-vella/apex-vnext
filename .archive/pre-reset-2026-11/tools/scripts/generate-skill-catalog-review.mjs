#!/usr/bin/env node
/** Generate a current-source catalog without inventing capability or qualification evidence. */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { format } from "prettier";

const root = resolve(process.cwd());
const registryPath = "tools/registry/guidance-delivery.v1.json";
const sourceSkillsDirectory = "customizations/.github/skills";
const outputPath = "docs/vnext/SKILL-CATALOG-REVIEW.generated.md";
const check = process.argv.includes("--check");

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function sourceResources(directory) {
  const walk = (current) =>
    readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name === "__pycache__" || /\.(pyc|pyo)$/.test(entry.name)) return [];
      const entryPath = join(current, entry.name);
      return entry.isDirectory() ? walk(entryPath) : [relative(directory, entryPath).replaceAll("\\", "/")];
    });
  return walk(directory)
    .filter((path) => path !== "SKILL.md" && path !== "LICENSE.txt")
    .sort();
}

function render(registry) {
  const entries = [...registry.skills].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const resourceRows = entries.flatMap((entry) => {
    return sourceResources(join(root, sourceSkillsDirectory, entry.id)).map((source) => {
      const registered = entry.files.includes(`.github/skills/${entry.id}/${source}`);
      return {
        source: entry.id,
        resource: source,
        disposition: registered ? "current-source" : "unmapped-current-source",
        target: entry.owner,
        reason: registered
          ? "Plugin-owned managed source; not capability qualification."
          : "Current source requires an ownership entry.",
      };
    });
  });
  const mappingRows = entries.map((entry) => {
    return (
      `| ${escapeCell(entry.id)} | ${escapeCell(entry.entrypoint)} | ${escapeCell(entry.owner)} | ` +
      `${escapeCell(entry.status)} | ${escapeCell(entry.capabilityQualification)} | not-run |`
    );
  });
  const resources = resourceRows.map(
    (resource) =>
      `| ${escapeCell(resource.source)} | ${escapeCell(resource.resource)} | ${escapeCell(resource.disposition)} | ` +
      `${escapeCell(resource.target)} | ${escapeCell(resource.reason)} |`,
  );
  return [
    "# Skill Catalog Review",
    "",
    "> [Current Version](../../VERSION.md) | Generated current managed skill delivery and deferred obligations.",
    "",
    "Generated from [guidance-delivery.v1.json](../../tools/registry/guidance-delivery.v1.json). Do not edit manually.",
    "",
    "## Evidence Boundary",
    "",
    "This review proves only current delivery declarations and managed source inventory. It does not prove resource lifecycle,",
    "capability activation, renderer registration, packaged target presence, live provider behavior, or client behavior.",
    "Those facts require the lifecycle ledger and its qualification evidence before they can be marked complete.",
    "",
    "Live provider and paired-client qualification are not run by this artifact or its deterministic scenario fixture.",
    "",
    "## Current Managed Skills",
    "",
    "| Skill | Entrypoint | Owner | Availability | Capability evidence | Live qualification |",
    "| --- | --- | --- | --- | --- | --- |",
    ...mappingRows,
    "",
    "## Source Resource Review",
    "",
    "`unmapped-current-source` means a managed source file lacks a current delivery entry and must fail validation.",
    "",
    "| Skill | Resource | Availability | Owner | Evidence boundary |",
    "| --- | --- | --- | --- | --- |",
    ...resources,
    "",
    "## Deferred Obligations",
    "",
    "Historical archive entries are identifiers only. This generator does not read retired source or archive payloads.",
    "All obligations remain deferred until their recorded proof and rollback boundaries are satisfied.",
    "",
    "| ID | Owner | Managed skill | Status | Historical identifier | Source hash | Required proof | Rollback boundary |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...registry.deferredCapabilities.map(
      (entry) =>
        `| ${[
          entry.id,
          entry.ownerPackage,
          entry.managedSkill,
          entry.status,
          entry.archiveEntry,
          entry.sourceSha256,
          entry.replacementProof,
          entry.rollbackGate,
        ]
          .map(escapeCell)
          .join(" | ")} |`,
    ),
    "",
    "## Deterministic Evaluation Scope",
    "",
    "The catalog-review fixture tests discovery, unavailable-capability, authority, native-workflow, and Bicep reference",
    "intent categories. It is schema validation only; it does not execute a client, Azure, an external provider, or a",
    "runtime capability.",
    "",
  ].join("\n");
}

async function main() {
  const registry = JSON.parse(readFileSync(join(root, registryPath), "utf8"));
  const content = await format(render(registry), { parser: "markdown" });
  const destination = join(root, outputPath);
  if (check) {
    if (!existsSync(destination) || readFileSync(destination, "utf8") !== content) {
      console.error(`ERROR Generated catalog review is stale: ${outputPath}`);
      process.exitCode = 1;
    } else {
      console.log("Skill catalog review is current");
    }
  } else {
    writeFileSync(destination, content);
    console.log(`Generated ${outputPath}`);
  }
}

if (process.argv[1]?.endsWith("generate-skill-catalog-review.mjs")) await main();
