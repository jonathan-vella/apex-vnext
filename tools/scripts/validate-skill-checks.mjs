#!/usr/bin/env node
/**
 * Skill Checks Validator
 *
 * Canary-marker check: every references/*.md of the repository authoring skills
 * must start with `<!-- ref:{slug}-v1 -->` so docs-freshness can detect stale
 * references. SKILL.md size rules for both skill roots live in
 * validate-skills.mjs (with its shrink-only baseline).
 *
 * @example
 * node tools/scripts/validate-skill-checks.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { getSkills } from "./_lib/workspace-index.mjs";
import { Reporter } from "./_lib/reporter.mjs";

const r = new Reporter("Skill Checks Validator");
r.header();

// Pattern: matches `<!-- ref:any-slug-v1 -->` on the first non-blank line.
// The closing `-->` may be preceded by additional commentary, e.g.
// `<!-- ref:slug-v1 — Merged from foo -->`.
const CANARY_PATTERN = /^<!--\s*ref:[a-z0-9-]+-v\d+\b.*-->/;

const skills = getSkills();

for (const [skill, info] of skills) {
  if (!info.content) continue;
  r.tick();

  if (!info.hasRefs) continue;
  const refsDir = path.join(info.dir, "references");
  for (const refFile of info.refFiles) {
    const refPath = path.join(refsDir, refFile);
    const refContent = fs.readFileSync(refPath, "utf-8");
    // Allow leading blank lines, then require the marker.
    const firstNonBlank = refContent.split("\n").find((line) => line.trim().length > 0) || "";
    if (!CANARY_PATTERN.test(firstNonBlank)) {
      const slug = refFile.replace(/\.md$/, "");
      r.errorAnnotation(
        refPath,
        `${skill}/references/${refFile} missing canary marker (expected \`<!-- ref:${slug}-v1 -->\` on line 1)`,
      );
      console.log(`  Fix: Prepend \`<!-- ref:${slug}-v1 -->\` to the first line of ${refFile}.`);
    }
  }
}

r.summary();
r.exitOnError("Skill checks passed");
