#!/usr/bin/env node
/**
 * Verify (or refresh) the context hashes in the pre-agent loop run authorization.
 *
 * Bootstrap step 6 of .github/prompts/apex-autonomous-pre-agent-loop.prompt.md requires the
 * effective context inputs to match the manifest before any mutation. This script is that check.
 *
 * Usage:
 *   node tools/scripts/pre-agent-loop-hashes.mjs            # verify, exit 1 on mismatch
 *   node tools/scripts/pre-agent-loop-hashes.mjs --write    # recompute and rewrite the manifest
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { globSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const MANIFEST = "docs/vnext/pre-agent-loop/authorization.json";

// Derived key, not a file on disk: the concatenated frontmatter of every discoverable skill.
const SKILL_INVENTORY_KEY = "skill-metadata-inventory";
const SKILL_GLOBS = [".github/skills/*/SKILL.md", "customizations/.github/skills/*/SKILL.md"];
const SKILL_METADATA_LINES = 6;

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function skillInventoryHash() {
  const files = SKILL_GLOBS.flatMap((pattern) => globSync(pattern)).sort();
  const metadata = files
    .map((file) => readFileSync(file, "utf8").split("\n").slice(0, SKILL_METADATA_LINES).join("\n"))
    .join("\n");
  return sha256(`${metadata}\n`);
}

function computeHashes(keys) {
  const computed = {};
  for (const key of keys) {
    computed[key] = key === SKILL_INVENTORY_KEY ? skillInventoryHash() : sha256(readFileSync(key));
  }
  return computed;
}

function main() {
  const write = process.argv.includes("--write");
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const expected = manifest.context_hashes;
  const computed = computeHashes(Object.keys(expected));

  const drifted = Object.keys(expected).filter((key) => expected[key] !== computed[key]);

  if (write) {
    manifest.context_hashes = computed;
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    // JSON.stringify expands short arrays that Prettier keeps inline, which would
    // fail the repository format check on the next commit.
    try {
      execFileSync("npx", ["prettier", "--write", "--log-level", "warn", MANIFEST], { stdio: "inherit" });
    } catch {
      console.warn(`⚠️  Prettier unavailable — run 'npx prettier --write ${MANIFEST}' before committing`);
    }
    console.log(`✅ Rewrote ${drifted.length} context hash(es) in ${MANIFEST}`);
    return;
  }

  if (drifted.length > 0) {
    console.error("❌ Context input drift — the loop must not start:");
    for (const key of drifted) {
      console.error(`   ${key}\n     expected ${expected[key]}\n     actual   ${computed[key]}`);
    }
    console.error("\n🔧 Review the change, then refresh with --write and re-approve the manifest.");
    process.exit(1);
  }

  console.log(`✅ Context hashes match (${Object.keys(expected).length} inputs)`);
}

main();
