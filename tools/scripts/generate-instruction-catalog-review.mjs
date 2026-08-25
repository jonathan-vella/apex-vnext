#!/usr/bin/env node
/** Generate or validate the retired-source to managed-consumer instruction catalog. */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const check = process.argv.includes("--check");
const ledgerPath = join(root, "tools", "registry", "guidance-migration.v1.json");
const outputPath = join(root, "docs", "vnext", "INSTRUCTION-CATALOG-REVIEW.generated.md");

function renderTarget(targets) {
  return targets.length === 0 ? "not-declared" : targets.map((target) => `apex-* / ${target}`).join("; ");
}

const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const entries = [...(ledger.instructionDispositions ?? [])].sort((left, right) =>
  left.source.localeCompare(right.source),
);
const rows = entries.map(
  ({ source, disposition, targets, reason }) => `| ${source} | ${disposition} | ${renderTarget(targets)} | ${reason} |`,
);
const content = await format(
  [
    "# Instruction Catalog Review",
    "",
    "> [Current Version](../../VERSION.md) | Generated retired-source to managed-consumer instruction mapping.",
    "",
    "This file is generated from",
    "[`guidance-migration.v1.json`](../../tools/registry/guidance-migration.v1.json). Do not edit it manually.",
    "",
    "## Evidence Boundary",
    "",
    "The catalog proves only the declared instruction disposition and managed target inventory.",
    "It does not prove live client discovery or workflow behavior.",
    "",
    "## Source Dispositions",
    "",
    "| Retired source instruction | Disposition | Managed consumer target | Rationale |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## Related",
    "",
    "- [Instruction migration ledger](../../tools/registry/guidance-migration.v1.json)",
    "- [Skill catalog review](SKILL-CATALOG-REVIEW.generated.md)",
    "- [Client qualification](CLIENT-QUALIFICATION.md)",
    "",
  ].join("\n"),
  { parser: "markdown" },
);

if (check) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== content) {
    console.error("Instruction catalog review is stale. Run npm run generate:instruction-catalog-review.");
    process.exitCode = 1;
  } else console.log("Instruction catalog review is current");
} else {
  writeFileSync(outputPath, content);
  console.log("Generated docs/vnext/INSTRUCTION-CATALOG-REVIEW.generated.md");
}
