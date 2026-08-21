#!/usr/bin/env node
/** Generate a matrix-derived catalog review without inventing lifecycle or qualification evidence. */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { format } from "prettier";

const root = resolve(process.cwd());
const matrixPath = "tools/registry/guidance-migration.v1.json";
const sourceSkillsDirectory = ".github/skills";
const outputPath = "docs/vnext/SKILL-CATALOG-REVIEW.generated.md";
const check = process.argv.includes("--check");

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function sourceResources(skill) {
  const directory = join(root, sourceSkillsDirectory, skill);
  const walk = (current) =>
    readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = join(current, entry.name);
      return entry.isDirectory() ? walk(entryPath) : [relative(directory, entryPath).replaceAll("\\", "/")];
    });
  return walk(directory)
    .filter((path) => path !== "SKILL.md" && path !== "LICENSE.txt")
    .sort();
}

function render(matrix) {
  const entries = [...(matrix.skillDispositions ?? [])].sort((left, right) => left.source.localeCompare(right.source));
  const resourceRows = entries.flatMap((entry) => {
    if (!existsSync(join(root, sourceSkillsDirectory, entry.source))) return [];
    const dispositions = new Map((entry.resourceDispositions ?? []).map((resource) => [resource.source, resource]));
    return sourceResources(entry.source).map((source) => {
      const resource = dispositions.get(source);
      return {
        source: entry.source,
        resource: source,
        disposition: resource?.disposition ?? "ledger-pending",
        target: resource?.targets?.join(", ") || "not-declared",
        reason: resource?.reason ?? "No resource disposition exists in the current matrix.",
      };
    });
  });
  const mappingRows = entries.map((entry) => {
    const lifecycle = entry.lifecycle ?? "not-declared";
    const target = entry.consumerSkill ?? "not-declared";
    return (
      `| ${escapeCell(entry.source)} | ${escapeCell(entry.disposition)} | ${escapeCell(target)} | ` +
      `${escapeCell(entry.owner)} | ${escapeCell(lifecycle)} | not-proven | not-proven | not-run |`
    );
  });
  const resources = resourceRows.map(
    (resource) =>
      `| ${escapeCell(resource.source)} | ${escapeCell(resource.resource)} | ${escapeCell(resource.disposition)} | ` +
      `${escapeCell(resource.target)} | ${escapeCell(resource.reason)} |`,
  );
  return [
    "## Skill Catalog Review",
    "",
    "Generated from the migration matrix and source skill tree. Do not edit manually.",
    "",
    "## Evidence Boundary",
    "",
    "This review proves only current matrix declarations and source-tree inventory. It does not prove resource lifecycle,",
    "capability activation, renderer registration, packaged target presence, live provider behavior, or client behavior.",
    "Those facts require the lifecycle ledger and its qualification evidence before they can be marked complete.",
    "",
    "Live provider and paired-client qualification are not run by this artifact or its deterministic scenario fixture.",
    "",
    "## Source Skill Dispositions",
    "",
    "| Source skill | Matrix disposition | Consumer target | Canonical owner | Lifecycle | Capability | Renderer | Live qualification |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...mappingRows,
    "",
    "## Source Resource Review",
    "",
    "`ledger-pending` means the source resource exists but the current matrix does not yet declare its disposition.",
    "",
    "| Source skill | Source resource | Matrix disposition | Target | Rationale or unresolved gap |",
    "| --- | --- | --- | --- | --- |",
    ...resources,
    "",
    "## Deterministic Evaluation Scope",
    "",
    "The catalog-review fixture tests discovery, unavailable-capability, authority, native-workflow, and Bicep reference",
    "intent categories. It is schema validation only; it does not execute a client, Azure, an external provider, or a",
    "runtime capability.",
    "",
  ].join("\n");
}

const matrix = JSON.parse(readFileSync(join(root, matrixPath), "utf8"));
const content = await format(render(matrix), { parser: "markdown" });
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
