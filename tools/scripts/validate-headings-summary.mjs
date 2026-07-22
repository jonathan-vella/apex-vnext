#!/usr/bin/env node

// validate-headings-summary.mjs
//
// Verifies that both heading derivatives match canonical artifact templates.
//
// v3 plan Phase 10.

import { readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildArtifactHeadings,
  renderArtifactHeadingsModule,
  renderArtifactHeadingsSummary,
} from "./_lib/artifact-heading-generator.mjs";
import { Reporter } from "./_lib/reporter.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../..");
const headingsPath = resolve(__dirname, "_lib/artifact-headings.mjs");
const summaryPath = resolve(__dirname, "_lib/artifact-headings-summary.json");

const r = new Reporter("Headings Summary Sync");
r.header();

const headings = buildArtifactHeadings(repoRoot);
for (const [path, expected] of [
  [headingsPath, await renderArtifactHeadingsModule(headings)],
  [summaryPath, renderArtifactHeadingsSummary(headings)],
]) {
  let existing;
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    r.error(`Missing ${relative(repoRoot, path)}. Run: npm run render:headings-summary`);
    continue;
  }
  if (existing !== expected) {
    r.error(`${relative(repoRoot, path)} is out of sync with artifact templates. Run: npm run render:headings-summary`);
  } else {
    console.log(
      `✓ ${relative(repoRoot, path)} matches ${Object.keys(headings).length} template-derived artifact types`,
    );
  }
}

r.summary();
r.exitOnError();
