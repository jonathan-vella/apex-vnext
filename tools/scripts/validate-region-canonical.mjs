#!/usr/bin/env node
/**
 * Region Canonical Validator
 *
 * Checks the canonical region table and its skill reference without
 * requiring a duplicate table in the skill.
 *
 * @example
 * node tools/scripts/validate-region-canonical.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { Reporter } from "./_lib/reporter.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const CANONICAL_PATH = path.join(REPO_ROOT, ".github/copilot-instructions.md");
const MIRROR_PATH = path.join(REPO_ROOT, ".github/skills/azure-defaults/SKILL.md");

const r = new Reporter("Region Canonical Validator");
r.header();

/**
 * Extract the `### Default Regions` table from a markdown body.
 * Returns the table rows as an array of trimmed lines, or null if not found.
 */
function extractRegionsTable(filePath) {
  if (!fs.existsSync(filePath)) {
    r.error(filePath, "file not found");
    return null;
  }
  const body = fs.readFileSync(filePath, "utf-8");
  const lines = body.split("\n");

  let i = lines.findIndex((line) => /^###\s+Default Regions\s*$/.test(line));
  if (i === -1) {
    r.error(filePath, "missing `### Default Regions` heading");
    return null;
  }

  // Skip blank line(s) after heading
  i += 1;
  while (i < lines.length && lines[i].trim() === "") i += 1;

  // Collect contiguous table rows (lines starting with `|`)
  const table = [];
  while (i < lines.length && lines[i].trim().startsWith("|")) {
    table.push(lines[i].trim());
    i += 1;
  }

  if (table.length < 3) {
    r.error(filePath, `expected at least 3 table rows (header + sep + 1 data), got ${table.length}`);
    return null;
  }

  return table;
}

r.tick();
const canonical = extractRegionsTable(CANONICAL_PATH);
r.tick();
const skill = fs.readFileSync(MIRROR_PATH, "utf8");
if (!skill.includes("../../copilot-instructions.md#azure-defaults-canonical")) {
  r.error(MIRROR_PATH, "Skill must reference the canonical Azure defaults");
}
if (/^###\s+Default Regions\s*$/mu.test(skill)) {
  r.error(MIRROR_PATH, "Do not duplicate the canonical region table in skill guidance");
}
if (canonical) r.ok("regions-table", "Canonical region table exists and skill guidance references its owner");

r.summary();
r.exitOnError("Region canonical check passed");
