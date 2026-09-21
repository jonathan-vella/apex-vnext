#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "./_lib/parse-jsonc.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REQUIRED_EXTENSIONS = [
  "GitHub.copilot-chat",
  "ms-python.python",
  "ms-python.vscode-pylance",
  "ms-azuretools.vscode-bicep",
  "ms-vscode.powershell",
  "DavidAnson.vscode-markdownlint",
  "github.vscode-github-actions",
  "github.vscode-pull-request-github",
  "esbenp.prettier-vscode",
  "redhat.vscode-yaml",
  "HashiCorp.terraform",
];

export function validateVscodeConfiguration(settings, recommendations) {
  const errors = [];
  for (const key of ["chat.customAgentInSubagent.enabled", "chat.useAgentSkills"]) {
    if (settings?.[key] !== true) errors.push(`${key} must be true`);
  }
  const agentPaths = settings?.["chat.agentFilesLocations"] ?? {};
  if (agentPaths["customizations/.github/agents"] !== true) {
    errors.push("customizations/.github/agents must be enabled in chat.agentFilesLocations");
  }
  if (agentPaths[".github/agents"] || agentPaths[".github/agents/_subagents"]) {
    errors.push("legacy .github/agents paths must not be discoverable");
  }
  const skillPaths = settings?.["chat.agentSkillsLocations"] ?? {};
  for (const path of [".github/skills", "customizations/.github/skills"]) {
    if (skillPaths[path] !== true) errors.push(`${path} must be enabled in chat.agentSkillsLocations`);
  }
  for (const path of [
    ".agents/skills",
    ".claude/skills",
    "~/.agents/skills",
    "~/.copilot/skills",
    "~/.claude/skills",
  ]) {
    if (skillPaths[path] !== false) errors.push(`${path} must be disabled in chat.agentSkillsLocations`);
  }
  if (!Array.isArray(recommendations) || recommendations.some((value) => typeof value !== "string")) {
    return [...errors, "Extension recommendations must be an array of strings"];
  }
  const extensions = recommendations.map((value) => value.trim().toLowerCase());
  if (new Set(extensions).size !== extensions.length) errors.push("Duplicate extension recommendations");
  const required = REQUIRED_EXTENSIONS.map((value) => value.toLowerCase());
  for (const extension of required) {
    if (!extensions.includes(extension)) errors.push(`Missing required extension: ${extension}`);
  }
  for (const extension of extensions) {
    if (!required.includes(extension)) errors.push(`Unapproved extension: ${extension}`);
  }
  return errors;
}

function main() {
  try {
    const settings = parseJsonc(readFileSync(resolve(REPO_ROOT, ".vscode/settings.json"), "utf8"));
    const extensions = parseJsonc(readFileSync(resolve(REPO_ROOT, ".vscode/extensions.json"), "utf8"));
    const errors = validateVscodeConfiguration(settings, extensions?.recommendations);
    for (const error of errors) console.error(error);
    if (errors.length === 0) console.log("WSL workspace settings and extension inventory are valid");
    return errors.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`Cannot validate workspace configuration: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
