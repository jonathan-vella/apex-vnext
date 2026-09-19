#!/usr/bin/env node

// validate-extension-bloat.mjs
//
// Rejects workspace recommendations of VS Code extensions known to ship heavy
// Copilot chat customizations (chatSkills / chatAgents / chatPromptFiles)
// that duplicate the APEX workflow and inflate per-turn input-token cost
// by ~5-7k each.
//
// Denylist is intentionally conservative: only extensions audited as
// adding bloat WITHOUT serving the APEX workflow. Borderline cases
// (Cosmos DB, GitHub PR review) stay off the denylist; they are
// `unwantedRecommendations` only.
//
// Linked docs:
//   - docs/how-to/prepare-windows-11.md (WSL editor setup)
//   - .vscode/extensions.json (unwantedRecommendations dialog)
//
// Extension packs are also denied because their transitive members bypass
// the repository's exact editor inventory.

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "./_lib/parse-jsonc.mjs";
import { Reporter } from "./_lib/reporter.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../..");
const extensionsPath = resolve(repoRoot, ".vscode/extensions.json");

// Extensions audited as contributing heavy Copilot chat customizations
// without serving the APEX workflow. Source: extension package.json
// `contributes.chatSkills` / `chatAgents` / `chatPromptFiles` inspection
// against the test03 debug log (a3ca0888).
const DENYLIST = new Map([
  ["ms-vscode.vscode-node-azure-pack", "Azure Tools extension pack installs untracked transitive extensions"],
  [
    "ms-azuretools.vscode-azure-github-copilot",
    "9 chatAgents + 7 chatPromptFiles duplicating APEX's own end-to-end agent set",
  ],
  ["ms-windows-ai-studio", "AI Toolkit: 2 chatSkills + 2 chatAgents, out of scope for APEX"],
  ["teamsdevapp.vscode-ai-foundry", "AI Foundry chatAgents, out of scope for APEX"],
]);

const r = new Reporter("Extension Bloat Validator");
r.header();

if (!existsSync(extensionsPath)) {
  r.error("Missing .vscode/extensions.json");
  r.summary();
  r.exitOnError();
}

let config;
try {
  config = parseJsonc(readFileSync(extensionsPath, "utf-8"));
} catch (error) {
  r.error(`Invalid JSONC in .vscode/extensions.json: ${error.message}`);
  r.summary();
  r.exitOnError();
}

const extensions = config?.recommendations;
if (!Array.isArray(extensions)) {
  r.error("recommendations is not an array");
  r.summary();
  r.exitOnError();
}

// Case-insensitive compare (VS Code extension IDs are typically lowercase but
// `.vscode/extensions.json` may use mixed case e.g. `HashiCorp.terraform`).
const lowerDenylist = new Map(Array.from(DENYLIST, ([k, v]) => [k.toLowerCase(), { id: k, reason: v }]));

for (const ext of extensions) {
  if (typeof ext !== "string") continue;
  const hit = lowerDenylist.get(ext.toLowerCase());
  if (hit) {
    r.errorAnnotation(".vscode/extensions.json", `Bloat extension declared: ${hit.id} — ${hit.reason}`);
    console.log(`  Fix: Remove "${hit.id}" from recommendations[]. See docs/how-to/prepare-windows-11.md.`);
  }
}

console.log(
  `Checked ${extensions.length} workspace extension(s) against ${DENYLIST.size} denylisted bloat contributor(s).`,
);

r.summary();
r.exitOnError();
