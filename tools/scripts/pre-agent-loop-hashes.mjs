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
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST_REL = "docs/vnext/pre-agent-loop/authorization.json";
const MANIFEST = path.join(ROOT, MANIFEST_REL);

// Derived key, not a file on disk: the concatenated YAML frontmatter of every discoverable skill.
const SKILL_INVENTORY_KEY = "skill-metadata-inventory";
const SKILL_GLOBS = [".github/skills/*/SKILL.md", "customizations/.github/skills/*/SKILL.md"];

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** Returns the frontmatter block between the leading `---` fences, or "" when absent. */
function frontmatter(source) {
  const lines = source.split("\n");
  if (lines[0]?.trim() !== "---") {
    return "";
  }
  const end = lines.indexOf("---", 1);
  return end === -1 ? "" : lines.slice(1, end).join("\n");
}

function skillInventoryHash() {
  const files = SKILL_GLOBS.flatMap((pattern) => globSync(pattern, { cwd: ROOT })).sort();
  const metadata = files
    .map((file) => `${file}\n${frontmatter(readFileSync(path.join(ROOT, file), "utf8"))}`)
    .join("\n");
  return sha256(metadata);
}

function computeHashes(keys) {
  const computed = {};
  for (const key of keys) {
    computed[key] = key === SKILL_INVENTORY_KEY ? skillInventoryHash() : sha256(readFileSync(path.join(ROOT, key)));
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
      execFileSync("npx", ["prettier", "--write", "--log-level", "warn", MANIFEST_REL], {
        cwd: ROOT,
        stdio: "inherit",
      });
    } catch {
      console.warn(`⚠️  Prettier unavailable — run 'npx prettier --write ${MANIFEST_REL}' before committing`);
    }
    console.log(`✅ Rewrote ${drifted.length} context hash(es) in ${MANIFEST_REL}`);
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
