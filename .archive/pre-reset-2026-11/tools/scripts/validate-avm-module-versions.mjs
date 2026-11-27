#!/usr/bin/env node
/**
 * AVM Module Version Validator
 *
 * Audits Bicep and Terraform source pins against published AVM versions.
 * This source audit is not deployment approval or Gate 4 evidence.
 *
 * Resolver pipeline (see _lib/avm-module-resolver.mjs):
 *   live registry (MCR for Bicep, registry.terraform.io for Terraform)
 *     → checked-in cache (tools/scripts/_data/avm-module-cache.json)
 *
 * Modes:
 *   --mode=local   default; cache fallback allowed; warnings only when offline.
 *   --mode=ci      fail closed when both live and fresh cache are missing.
 *   --mode=freeze  same fail-closed source-audit behavior as ci.
 *
 * Result categories (machine-readable):
 *   ok, stale_justified, stale_unjustified, missing_version, prerelease_ignored,
 *   lookup_unavailable, source_unclassified.
 *
 * Usage:
 *   node tools/scripts/validate-avm-module-versions.mjs
 *   node tools/scripts/validate-avm-module-versions.mjs --mode=ci
 *   node tools/scripts/validate-avm-module-versions.mjs --mode=freeze infra/bicep/example/main.bicep
 *   node tools/scripts/validate-avm-module-versions.mjs --no-network
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { globSync } from "node:fs";
import { Reporter } from "./_lib/reporter.mjs";
import { resolveLatest, classifyPin } from "./_lib/avm-module-resolver.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const BICEP_MODULE_RE =
  /(['"])?(br\/public:avm\/(?:res|ptn)\/[a-z0-9-]+(?:\/[a-z0-9-]+)+):(\d+\.\d+\.\d+(?:-[a-z0-9.]+)?)\1?/gi;
const TF_SOURCE_RE = /source\s*=\s*"(Azure\/avm-(?:res|ptn)-[a-z0-9-]+\/azurerm)"/gi;
const TF_VERSION_RE = /version\s*=\s*"([^"]+)"/i;

export function parseArgs(argv) {
  const opts = {
    mode: "local",
    allowNetwork: true,
    paths: [],
  };
  for (const arg of argv) {
    if (arg === "--no-network") opts.allowNetwork = false;
    else if (arg.startsWith("--mode=")) opts.mode = arg.slice("--mode=".length);
    else if (!arg.startsWith("--")) opts.paths.push(arg);
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  if (!["local", "ci", "freeze"].includes(opts.mode)) {
    throw new Error(`--mode must be local|ci|freeze (got ${opts.mode})`);
  }
  return opts;
}

export async function scanBicepFile(r, opts, filePath, resolveVersion = resolveLatest) {
  const rel = path.relative(ROOT, filePath);
  r.tick();
  const text = fs.readFileSync(filePath, "utf-8");
  const seen = new Set();
  let m;
  BICEP_MODULE_RE.lastIndex = 0;
  while ((m = BICEP_MODULE_RE.exec(text)) !== null) {
    const source = m[2];
    const pinned = m[3];
    const key = `${source}:${pinned}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const resolved = await resolveVersion({
      tool: "bicep",
      source,
      mode: opts.mode,
      allowNetwork: opts.allowNetwork,
    });
    const cls = classifyPin({ pinned, resolved });
    const where = `${rel} → ${source}:${pinned}`;
    if (cls.result === "ok" || cls.result === "prerelease_ignored") {
      r.ok(where, cls.message);
    } else if (cls.result === "missing_version") {
      r.error(where, `missing_version: ${cls.message}`);
    } else if (cls.result === "stale") {
      r.warn(where, `stale source pin: ${cls.message}`);
    } else if (cls.result === "lookup_unavailable") {
      if (opts.mode === "ci" || opts.mode === "freeze") {
        r.error(where, cls.message);
      } else {
        r.warn(where, cls.message);
      }
    } else {
      r.warn(where, `${cls.result}: ${cls.message}`);
    }
  }
}

export async function scanTerraformFile(r, opts, filePath, resolveVersion = resolveLatest) {
  const rel = path.relative(ROOT, filePath);
  r.tick();
  const text = fs.readFileSync(filePath, "utf-8");
  const seen = new Set();
  // crude block-level walk: find each `module "x" { ... }` block and check
  // whether it has both an Azure/avm-*/azurerm source and a version constraint
  const blockRe = /module\s+"[^"]+"\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = blockRe.exec(text)) !== null) {
    const body = m[1];
    TF_SOURCE_RE.lastIndex = 0;
    const sourceMatch = TF_SOURCE_RE.exec(body);
    if (!sourceMatch) continue;
    const source = sourceMatch[1];
    const versionMatch = TF_VERSION_RE.exec(body);
    if (!versionMatch) {
      r.warn(`${rel} → ${source}`, `Terraform module has no version pin.`);
      continue;
    }
    const rawVersion = versionMatch[1].trim();
    const where = `${rel} → ${source}@${rawVersion}`;
    if (seen.has(where)) continue;
    seen.add(where);

    // Range constraints — Terraform allows `~> 0.5`, `>= 1.2.0`, etc.
    // For source-scan we flag any constraint that is NOT an exact semver.
    const exact = /^\d+\.\d+\.\d+$/.test(rawVersion);
    if (!exact) {
      r.warn(
        where,
        `Terraform AVM-TF module uses range constraint "${rawVersion}"; source audit requires exact semver to resolve a single version.`,
      );
      continue;
    }
    const resolved = await resolveVersion({
      tool: "terraform",
      source,
      mode: opts.mode,
      allowNetwork: opts.allowNetwork,
    });
    const cls = classifyPin({ pinned: rawVersion, resolved });
    if (cls.result === "ok" || cls.result === "prerelease_ignored") {
      r.ok(where, cls.message);
    } else if (cls.result === "missing_version") {
      r.error(where, `missing_version: ${cls.message}`);
    } else if (cls.result === "stale") {
      r.warn(where, `stale source pin: ${cls.message}`);
    } else if (cls.result === "lookup_unavailable") {
      if (opts.mode === "ci" || opts.mode === "freeze") {
        r.error(where, cls.message);
      } else {
        r.warn(where, cls.message);
      }
    } else {
      r.warn(where, `${cls.result}: ${cls.message}`);
    }
  }
}

export function collectSourcePaths(opts, root = ROOT) {
  if (opts.paths.length === 0) {
    return {
      bicepPaths: globSync("infra/bicep/**/*.bicep", { cwd: root }).map((filename) => path.resolve(root, filename)),
      tfPaths: globSync("infra/terraform/**/*.tf", { cwd: root }).map((filename) => path.resolve(root, filename)),
    };
  }
  const result = { bicepPaths: [], tfPaths: [] };
  for (const target of opts.paths) {
    const filename = path.resolve(root, target);
    const info = fs.lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Source target must be a regular file: ${target}`);
    if (target.endsWith(".bicep")) result.bicepPaths.push(filename);
    else if (target.endsWith(".tf")) result.tfPaths.push(filename);
    else throw new Error(`Unsupported source target: ${target}; expected .bicep or .tf`);
  }
  return result;
}

async function main() {
  const r = new Reporter("AVM Module Version Validator");
  r.header();

  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    r.error("args", err.message);
    r.summary();
    process.exit(1);
  }

  const { bicepPaths, tfPaths } = collectSourcePaths(opts);

  if (bicepPaths.length === 0 && tfPaths.length === 0) {
    r.info("(no AVM module references found)");
    r.summary();
    process.exit(0);
  }

  console.log(`  Mode: ${opts.mode} | Network: ${opts.allowNetwork ? "on" : "off"}`);
  console.log(`  Bicep files: ${bicepPaths.length} | Terraform files: ${tfPaths.length}\n`);

  for (const p of bicepPaths) await scanBicepFile(r, opts, p);
  for (const p of tfPaths) await scanTerraformFile(r, opts, p);

  r.summary();
  r.exitOnError(
    "AVM module version validator passed",
    `${r.errors} unresolved AVM version issue(s) — see entries above`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((err) => {
    console.error("\n💥 Validator crashed:", err);
    process.exit(2);
  });
