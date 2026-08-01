#!/usr/bin/env node
/**
 * VS Code Configuration Validator
 *
 * Validates the vNext devcontainer and VS Code configuration:
 * 1. Required settings exist in devcontainer.json
 * 2. Features and mounts remain portable across supported hosts and CPUs
 * 3. Both extension inventories exactly match the approved vNext surface
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");

// Required VS Code 1.109 settings
const REQUIRED_SETTINGS = [
  "chat.customAgentInSubagent.enabled",
  "chat.agentFilesLocations",
  "chat.agentSkillsLocations",
  "chat.useAgentSkills",
];

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
const REQUIRED_FEATURES = new Map([
  ["ghcr.io/devcontainers/features/azure-cli:1", "latest"],
  ["ghcr.io/devcontainers/features/powershell:2", "latest"],
  ["ghcr.io/devcontainers/features/python:1", "3.14"],
  ["ghcr.io/devcontainers/features/node:1", "24"],
  ["ghcr.io/devcontainers/features/github-cli:1", "latest"],
  ["ghcr.io/azure/azure-dev/azd:latest", undefined],
  ["./features/terraform", undefined],
]);
const REQUIRED_VOLUME_TARGETS = new Set([
  "/home/vscode/.azure",
  "/home/vscode/.azd",
  "/home/vscode/.config/gh",
  "/home/vscode/.cache/uv",
  "/home/vscode/.terraform.d/plugin-cache",
]);
const ARCHITECTURE_AWARE_SCRIPTS = [".devcontainer/features/terraform/install.sh", ".devcontainer/post-create.sh"];

const errors = [];
const warnings = [];

function normalizeExtensionId(extensionId) {
  return String(extensionId || "")
    .trim()
    .toLowerCase();
}

function findDuplicateExtensions(extensions) {
  const counts = new Map();
  for (const extension of extensions) {
    const key = normalizeExtensionId(extension);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
}

function checkRequiredExtensionsInList(sourceName, extensions) {
  const normalized = new Set(extensions.map(normalizeExtensionId));
  for (const requiredExtension of REQUIRED_EXTENSIONS) {
    if (!normalized.has(normalizeExtensionId(requiredExtension))) {
      errors.push(`❌ Missing required extension in ${sourceName}: ${requiredExtension}`);
    }
  }
}

/**
 * Parse JSON with comments (JSONC) - handles devcontainer.json format
 */
import { parseJsonc } from "./_lib/parse-jsonc.mjs";

/**
 * Check devcontainer.json for required settings
 */
function validateDevcontainer() {
  const devcontainerPath = resolve(REPO_ROOT, ".devcontainer/devcontainer.json");

  if (!existsSync(devcontainerPath)) {
    errors.push("❌ .devcontainer/devcontainer.json not found");
    return;
  }

  console.log("📋 Checking devcontainer.json...");

  try {
    const content = readFileSync(devcontainerPath, "utf-8");
    const config = parseJsonc(content);

    const settings = config?.customizations?.vscode?.settings || {};
    const extensions = config?.customizations?.vscode?.extensions || [];
    const features = config?.features || {};
    const mounts = config?.mounts || [];

    if (config.image !== "mcr.microsoft.com/devcontainers/base:ubuntu26.04") {
      errors.push("❌ Devcontainer must use the Ubuntu 26.04 multi-architecture base image");
    }

    for (const featureId of Object.keys(features)) {
      if (featureId.endsWith(":")) {
        errors.push(`❌ Malformed devcontainer feature ID: ${featureId}`);
      }
      if (featureId.toLowerCase().includes("deno")) {
        errors.push(`❌ Optional Deno runtime must not be installed by the core devcontainer: ${featureId}`);
      }
    }
    for (const [featureId, version] of REQUIRED_FEATURES) {
      if (!(featureId in features)) {
        errors.push(`❌ Missing required devcontainer feature: ${featureId}`);
      } else if (version !== undefined && features[featureId]?.version !== version) {
        errors.push(`❌ ${featureId} must use version ${version}`);
      }
    }

    const mountTargets = new Set();
    for (const mount of mounts) {
      if (mount?.type !== "volume") {
        errors.push(`❌ Devcontainer mounts must use named volumes, not host binds: ${mount?.target ?? "unknown"}`);
      }
      if (typeof mount?.source !== "string" || !mount.source.includes("${devcontainerId}")) {
        errors.push(`❌ Named volume must be scoped by devcontainerId: ${mount?.source ?? "unknown"}`);
      }
      mountTargets.add(mount?.target);
    }
    for (const target of REQUIRED_VOLUME_TARGETS) {
      if (!mountTargets.has(target)) {
        errors.push(`❌ Missing cross-platform named volume target: ${target}`);
      }
    }

    if (config.postCreateCommand !== "bash .devcontainer/post-create.sh") {
      errors.push("❌ postCreateCommand must use the deterministic vNext bootstrap");
    }
    if (config.postStartCommand !== "npx lefthook install") {
      errors.push("❌ postStartCommand must not perform network upgrades or legacy setup");
    }

    for (const relativePath of ARCHITECTURE_AWARE_SCRIPTS) {
      const script = readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
      if (!script.includes("dpkg --print-architecture") || !script.includes("amd64|arm64")) {
        errors.push(`❌ ${relativePath} must explicitly support amd64 and arm64`);
      }
    }

    // Check required settings
    for (const setting of REQUIRED_SETTINGS) {
      if (!(setting in settings)) {
        errors.push(`❌ Missing required setting: ${setting}`);
      } else {
        console.log(`   ✓ ${setting}`);
      }
    }

    // Check if subagent setting is true
    if (settings["chat.customAgentInSubagent.enabled"] !== true) {
      errors.push("❌ chat.customAgentInSubagent.enabled must be true for Orchestrator");
    }

    // Check agent paths
    const agentPaths = settings["chat.agentFilesLocations"] || {};
    if (!agentPaths["customizations/.github/agents"]) {
      errors.push("❌ customizations/.github/agents not in chat.agentFilesLocations");
    }
    if (agentPaths[".github/agents"] || agentPaths[".github/agents/_subagents"]) {
      errors.push("❌ legacy .github/agents paths must not be discoverable");
    }

    // Check skills path
    const skillPaths = settings["chat.agentSkillsLocations"] || {};
    if (!skillPaths[".github/skills"]) {
      warnings.push("⚠️  .github/skills not in chat.agentSkillsLocations");
    }
    if (!skillPaths["customizations/.github/skills"]) {
      errors.push("❌ customizations/.github/skills not in chat.agentSkillsLocations");
    }
    for (const disabledPath of [
      ".agents/skills",
      ".claude/skills",
      "~/.agents/skills",
      "~/.copilot/skills",
      "~/.claude/skills",
    ]) {
      if (skillPaths[disabledPath] !== false) {
        errors.push(`❌ ${disabledPath} must be disabled in chat.agentSkillsLocations`);
      }
    }

    checkRequiredExtensionsInList("devcontainer.json", extensions);

    const duplicates = findDuplicateExtensions(extensions);
    for (const duplicate of duplicates) {
      warnings.push(`⚠️  Duplicate extension in devcontainer.json: ${duplicate}`);
    }

    return extensions;
  } catch (e) {
    errors.push(`❌ Failed to parse devcontainer.json: ${e.message}`);
    return [];
  }
}

/**
 * Check extensions.json for required extensions
 */
function validateExtensions() {
  const extensionsPath = resolve(REPO_ROOT, ".vscode/extensions.json");

  if (!existsSync(extensionsPath)) {
    warnings.push("⚠️  .vscode/extensions.json not found (optional but recommended)");
    return [];
  }

  console.log("\n📦 Checking extensions.json...");

  try {
    const content = readFileSync(extensionsPath, "utf-8");
    const config = JSON.parse(content);
    const recommendations = config?.recommendations || [];

    checkRequiredExtensionsInList("extensions.json", recommendations);

    for (const ext of REQUIRED_EXTENSIONS) {
      const found = recommendations.some((r) => normalizeExtensionId(r) === normalizeExtensionId(ext));
      if (found) {
        console.log(`   ✓ ${ext}`);
      }
    }

    const duplicates = findDuplicateExtensions(recommendations);
    for (const duplicate of duplicates) {
      warnings.push(`⚠️  Duplicate extension in extensions.json: ${duplicate}`);
    }

    return recommendations;
  } catch (e) {
    errors.push(`❌ Failed to parse extensions.json: ${e.message}`);
    return [];
  }
}

/**
 * Cross-check devcontainer extensions with extensions.json
 */
function crossCheckExtensions(devcontainerExts, extensionsJsonExts) {
  if (devcontainerExts.length === 0 || extensionsJsonExts.length === 0) {
    return;
  }

  console.log("\n🔗 Cross-checking extension lists...");

  const devSet = new Set(devcontainerExts.map(normalizeExtensionId));
  const extSet = new Set(extensionsJsonExts.map(normalizeExtensionId));

  const onlyInDevcontainer = [...devSet].filter((extension) => !extSet.has(extension)).sort();
  const onlyInExtensionsJson = [...extSet].filter((extension) => !devSet.has(extension)).sort();

  for (const extension of onlyInDevcontainer) {
    errors.push(`❌ Extension only in devcontainer.json: ${extension}`);
  }
  for (const extension of onlyInExtensionsJson) {
    errors.push(`❌ Extension only in extensions.json: ${extension}`);
  }

  console.log(`   ✓ ${devcontainerExts.length} extensions in devcontainer.json`);
  console.log(`   ✓ ${extensionsJsonExts.length} extensions in extensions.json`);
}

// Main execution
console.log("🔍 VS Code 1.109 Configuration Validator\n");
console.log(`${"=".repeat(50)}\n`);

const devcontainerExts = validateDevcontainer();
const extensionsJsonExts = validateExtensions();
crossCheckExtensions(devcontainerExts, extensionsJsonExts);

// Summary
console.log(`\n${"=".repeat(50)}`);
console.log("📊 Validation Summary\n");

if (warnings.length > 0) {
  console.log("Warnings:");
  warnings.forEach((w) => console.log(`  ${w}`));
}

if (errors.length > 0) {
  console.log("\nErrors:");
  errors.forEach((e) => console.log(`  ${e}`));
  console.log(`\n❌ Validation FAILED with ${errors.length} error(s)`);
  console.log("\n🔧 Remediation:");
  console.log("   1. Review devcontainer.json customizations.vscode.settings");
  console.log("   2. Ensure all required VS Code 1.109 settings are present");
  console.log("   3. Check .vscode/extensions.json for recommended extensions");
  process.exit(1);
} else {
  console.log("\n✅ VS Code configuration is valid for 1.109 orchestration");
  process.exit(0);
}
