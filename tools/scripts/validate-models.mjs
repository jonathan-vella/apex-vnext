#!/usr/bin/env node
/**
 * Model Validators (consolidated)
 *
 * Three read-only validators for the agent ↔ registry ↔ model-catalog
 * triangle, selectable via `--only`:
 *
 *   --only=catalog      Catalog invariants (.github/model-catalog.json):
 *                       every referenced label is declared; the
 *                       `assignments` block matches the generator output;
 *                       deprecated models are absent from active use.
 *   --only=consistency  Every agent's frontmatter `model` equals the
 *                       registry `model` for the same agent.
 *   --only=deprecated   No deprecated model label reappears in agent
 *                       definitions, prompt files, or the registry.
 *
 * With no `--only` flag all three run in sequence and the process exits
 * non-zero if any failed. The generator (`generate-model-catalog.mjs`)
 * is a separate mutating tool and is intentionally NOT part of this file.
 *
 * @example
 *   node tools/scripts/validate-models.mjs                 # all three
 *   node tools/scripts/validate-models.mjs --only=catalog
 *   node tools/scripts/validate-models.mjs --only=consistency
 *   node tools/scripts/validate-models.mjs --only=deprecated
 */
import fs from "node:fs";
import path from "node:path";
import { Reporter } from "./_lib/reporter.mjs";
import { getAgents } from "./_lib/workspace-index.mjs";
import { normalizeModel, buildAssignments } from "./_lib/model-helpers.mjs";

const ROOT = process.cwd();
const CATALOG_PATH = path.join(ROOT, ".github", "model-catalog.json");
const CUSTOMIZATION_MANIFEST_PATH = path.join(ROOT, "customizations", "manifest.json");

/**
 * Print a Reporter's pass/fail message (mirroring `Reporter.exitOnError`
 * output) without exiting, and return whether the mode passed. Lets the
 * dispatcher aggregate multiple modes while preserving per-mode output.
 */
function finishMode(r, passMsg, failMsg) {
  if (r.errors > 0) {
    console.log(`\n❌ ${failMsg}`);
    return false;
  }
  if (r.warnings > 0) {
    console.log(`\n⚠️  Passed with ${r.warnings} warning(s)`);
  } else {
    console.log(`\n✅ ${passMsg}`);
  }
  return true;
}

// ── Mode: catalog ────────────────────────────────────────────────────────────

function collectRoleModels(manifest) {
  const out = new Map(); // model -> [origin labels]
  for (const role of manifest.roles ?? []) {
    const m = normalizeModel(role.model);
    if (!m) continue;
    if (!out.has(m)) out.set(m, []);
    out.get(m).push(role.agent);
  }
  return out;
}

function collectFrontmatterModels() {
  const out = new Map();
  for (const [file, a] of getAgents()) {
    const m = normalizeModel(a.frontmatter?.model);
    if (!m) continue;
    if (!out.has(m)) out.set(m, []);
    out.get(m).push(file);
  }
  return out;
}

function runCatalog() {
  const r = new Reporter("Model Catalog Validator");
  r.header();

  if (!fs.existsSync(CATALOG_PATH)) {
    r.error("model-catalog.json", `not found at ${CATALOG_PATH}`);
    r.summary();
    return finishMode(r, "Model catalog validation passed", "Model catalog validation failed — see errors above");
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const declared = new Set(Object.keys(catalog.models || {}));
  const deprecated = new Set(
    Object.entries(catalog.models || {})
      .filter(([, v]) => v?.deprecated === true)
      .map(([k]) => k),
  );

  console.log("  Check 1: referenced labels exist in catalog.models");
  const fmModels = collectFrontmatterModels();
  const manifest = JSON.parse(fs.readFileSync(CUSTOMIZATION_MANIFEST_PATH, "utf8"));
  const roleModels = collectRoleModels(manifest);
  for (const [model, origins] of fmModels) {
    r.tick();
    if (!declared.has(model)) {
      r.error(`frontmatter model "${model}"`, `not declared in catalog.models — used by ${origins.join(", ")}`);
    }
  }
  for (const [model, origins] of roleModels) {
    r.tick();
    if (!declared.has(model)) {
      r.error(`managed role model "${model}"`, `not declared in catalog.models — used by ${origins.join(", ")}`);
    }
  }

  console.log("  Check 2: assignments block matches frontmatter");
  const expected = buildAssignments();
  const actual = catalog.assignments;
  r.tick();
  if (!actual) {
    r.error("assignments", "missing from catalog — run `node tools/scripts/generate-model-catalog.mjs`");
  } else if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    r.error("assignments", "out of sync with frontmatter — run `node tools/scripts/generate-model-catalog.mjs`");
  }

  console.log("  Check 3: deprecated models absent from active assignments");
  for (const dep of deprecated) {
    r.tick();
    const fmHits = fmModels.get(dep) || [];
    const roleHits = roleModels.get(dep) || [];
    if (fmHits.length || roleHits.length) {
      r.error(
        `deprecated model "${dep}"`,
        `still in active use — frontmatter: ${fmHits.join(", ") || "none"}; managed roles: ${roleHits.join(", ") || "none"}`,
      );
    }
  }

  r.summary();
  return finishMode(r, "Model catalog validation passed", "Model catalog validation failed — see errors above");
}

// ── Mode: consistency ────────────────────────────────────────────────────────

function checkConsistencyEntry(r, role, agentsByName) {
  const fm = agentsByName.get(role.agent);
  if (!fm) {
    r.error(`Managed role "${role.agent}"`, "agent file not found in active workspace index");
    return;
  }
  const yamlModel = normalizeModel(fm.model);
  const roleModel = normalizeModel(role.model);

  if (!yamlModel) {
    r.error(`Managed role "${role.agent}"`, "frontmatter is missing `model` field");
    return;
  }
  if (!roleModel) {
    r.error(`Managed role "${role.agent}"`, "manifest role is missing `model` field");
    return;
  }
  if (yamlModel !== roleModel) {
    r.error(
      `Managed role "${role.agent}"`,
      `frontmatter model "${yamlModel}" does not equal role model "${roleModel}"`,
    );
  }
}

function runConsistency() {
  const r = new Reporter("Model Consistency Validator");
  console.log("\n📋 Validating model consistency (frontmatter ≡ customization manifest)...\n");

  if (!fs.existsSync(CUSTOMIZATION_MANIFEST_PATH)) {
    r.error(`Customization manifest not found at ${CUSTOMIZATION_MANIFEST_PATH}`);
    return false;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(CUSTOMIZATION_MANIFEST_PATH, "utf-8"));
  } catch (e) {
    r.error(`Cannot parse ${CUSTOMIZATION_MANIFEST_PATH}: ${e.message}`);
    return false;
  }

  const agentsByName = new Map([...getAgents().values()].map((agent) => [agent.frontmatter?.name, agent.frontmatter]));
  let count = 0;
  for (const role of manifest.roles ?? []) {
    checkConsistencyEntry(r, role, agentsByName);
    count++;
  }
  r.ok(`Checked ${count} managed roles`);
  console.log(`\n📊 Results: ${r.errors} error(s), ${r.warnings} warning(s)\n`);

  if (r.errors > 0) {
    console.error("❌ Model consistency validation failed\n");
    return false;
  }
  console.log("✅ Model consistency validation passed\n");
  return true;
}

// ── Mode: deprecated ─────────────────────────────────────────────────────────

const SCAN_GLOBS = ["customizations/.github/agents", "tools/apex-prompts", "tools/tests/prompts"];
const ALLOWED_FILES = new Set([
  ".github/model-catalog.json",
  "CHANGELOG.md",
  "docs/CHANGELOG.md",
  "QUALITY_SCORE.md",
  ".github/skills/docs-writer/references/freshness-checklist.md",
  "tools/scripts/validate-models.mjs",
]);

function loadDeprecatedModels() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const models = catalog.models ?? {};
  return Object.entries(models)
    .filter(([, v]) => v?.deprecated === true)
    .map(([name]) => name);
}

function walkDir(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(full));
    else out.push(full);
  }
  return out;
}

function collectDeprecatedScanFiles() {
  const files = [];
  for (const g of SCAN_GLOBS) {
    files.push(...walkDir(path.join(ROOT, g)));
  }
  files.push(CUSTOMIZATION_MANIFEST_PATH);
  return files.filter((f) => {
    const rel = path.relative(ROOT, f);
    if (ALLOWED_FILES.has(rel)) return false;
    return f.endsWith(".md") || f.endsWith(".json");
  });
}

function scanDeprecatedFile(file, deprecated) {
  const text = fs.readFileSync(file, "utf8");
  const hits = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const label of deprecated) {
      if (lines[i].includes(label)) {
        hits.push({ line: i + 1, label, content: lines[i].trim() });
      }
    }
  }
  return hits;
}

function runDeprecated() {
  const r = new Reporter("Deprecated Models Deny-List");
  r.header();
  const deprecated = loadDeprecatedModels();
  if (deprecated.length === 0) {
    console.log("  ℹ️  No deprecated models in catalog. Nothing to enforce.");
    r.summary();
    return true;
  }
  console.log(`  Deprecated labels (from catalog): ${deprecated.join(", ")}`);

  const files = collectDeprecatedScanFiles();
  for (const f of files) {
    r.tick();
    const hits = scanDeprecatedFile(f, deprecated);
    const rel = path.relative(ROOT, f);
    for (const h of hits) {
      r.errorAnnotation(
        rel,
        `Line ${h.line}: deprecated model label "${h.label}" — remove or migrate. Context: ${h.content.slice(0, 120)}`,
      );
    }
  }
  r.summary();
  return finishMode(
    r,
    "No deprecated model labels found.",
    "Deprecated model labels detected — see annotations above.",
  );
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

const MODES = {
  catalog: runCatalog,
  consistency: runConsistency,
  deprecated: runDeprecated,
};

function main() {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length) : null;

  if (only && !MODES[only]) {
    console.error(`Unknown --only=${only}. Valid: ${Object.keys(MODES).join(", ")}`);
    process.exit(2);
  }

  const selected = only ? [only] : Object.keys(MODES);
  let allPass = true;
  for (const mode of selected) {
    const pass = MODES[mode]();
    allPass = allPass && pass;
  }
  process.exit(allPass ? 0 : 1);
}

main();
