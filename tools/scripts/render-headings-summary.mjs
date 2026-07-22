#!/usr/bin/env node

// render-headings-summary.mjs
//
// Generates the runtime heading module and compact JSON summary from canonical
// artifact templates. The public command name is retained for compatibility.
//
// Idempotent: re-running with no source change produces identical bytes.

import { writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildArtifactHeadings,
  renderArtifactHeadingsModule,
  renderArtifactHeadingsSummary,
} from "./_lib/artifact-heading-generator.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../..");
const headingsPath = resolve(__dirname, "_lib/artifact-headings.mjs");
const summaryPath = resolve(__dirname, "_lib/artifact-headings-summary.json");

const headings = buildArtifactHeadings(repoRoot);

function writeIfChanged(path, content) {
  let existing = null;
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    // The first generation creates the derivative.
  }
  if (existing === content) {
    console.log(`✓ ${path} (unchanged)`);
    return;
  }
  writeFileSync(path, content, "utf8");
  console.log(`✓ ${path} (rewritten)`);
}

writeIfChanged(headingsPath, await renderArtifactHeadingsModule(headings));
writeIfChanged(summaryPath, renderArtifactHeadingsSummary(headings));
