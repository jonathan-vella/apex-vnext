#!/usr/bin/env node
/** Generate or validate the current managed workspace instruction catalog. */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const check = process.argv.includes("--check");
const ledgerPath = join(root, "tools", "registry", "guidance-delivery.v1.json");
const outputPath = join(root, "docs", "vnext", "INSTRUCTION-CATALOG-REVIEW.generated.md");

const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const entries = [...ledger.instructions].sort((left, right) =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
);
const rows = entries.map(
  ({ path, owner, manifestOwner }) => `| ${path} | ${owner} | ${manifestOwner} | current-source |`,
);
const content = await format(
  [
    "# Instruction Catalog Review",
    "",
    "> [Current Version](../../VERSION.md) | Generated current managed workspace instruction ownership.",
    "",
    "This file is generated from",
    "[`guidance-delivery.v1.json`](../../tools/registry/guidance-delivery.v1.json). Do not edit it manually.",
    "",
    "## Evidence Boundary",
    "",
    "The catalog proves only current managed source inventory and workspace ownership.",
    "It does not prove live client discovery or workflow behavior.",
    "",
    "## Current Workspace Instructions",
    "",
    "| Instruction | Owner | Manifest ownership | Availability |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## Related",
    "",
    "- [Current guidance delivery](../../tools/registry/guidance-delivery.v1.json)",
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
