#!/usr/bin/env node
/**
 * Static context-budget validator for APEX vNext always-loaded surfaces.
 *
 * Enforces deterministic UTF-8 byte caps (LF-normalized) across:
 * 1. MCP `tools/list` wire payload (`packages/cli/src/test/fixtures/mcp-tools-list.json`)
 * 2. Primary `APEX` agent (`customizations/.github/agents/apex.agent.md`)
 * 3. All skill frontmatter blocks (`customizations/.github/skills/<skill>/SKILL.md`)
 * 4. Managed workspace instructions (`customizations/.github/copilot-instructions.md` + `customizations/.github/instructions/*.md`)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function utf8LfBytes(text) {
  return Buffer.byteLength(text.replace(/\r\n/gu, "\n"), "utf8");
}

function readLfText(filePath) {
  return readFileSync(filePath, "utf8").replace(/\r\n/gu, "\n");
}

export function evaluateContextBudget(root = defaultRoot) {
  const configPath = path.join(root, "config", "context-budget.v1.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const budgets = config.budgets ?? {};

  const toolsFixturePath = path.join(root, "packages", "cli", "src", "test", "fixtures", "mcp-tools-list.json");
  const tools = JSON.parse(readFileSync(toolsFixturePath, "utf8"));
  const mcpToolsListBytes = Buffer.byteLength(JSON.stringify(tools), "utf8");

  const apexAgentPath = path.join(root, "customizations", ".github", "agents", "apex.agent.md");
  const apexAgentBytes = utf8LfBytes(readFileSync(apexAgentPath, "utf8"));

  const skillsDir = path.join(root, "customizations", ".github", "skills");
  let skillFrontmatterBytes = 0;
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(skillsDir, entry.name, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      const content = readLfText(skillFile);
      const match = /^---\n[\s\S]*?\n---/u.exec(content);
      if (match !== null) {
        skillFrontmatterBytes += Buffer.byteLength(match[0], "utf8");
      }
    }
  }

  const instructionsDir = path.join(root, "customizations", ".github", "instructions");
  const copilotInstructionsPath = path.join(root, "customizations", ".github", "copilot-instructions.md");
  let managedInstructionsBytes = existsSync(copilotInstructionsPath)
    ? utf8LfBytes(readFileSync(copilotInstructionsPath, "utf8"))
    : 0;
  if (existsSync(instructionsDir)) {
    for (const entry of readdirSync(instructionsDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        managedInstructionsBytes += utf8LfBytes(readFileSync(path.join(instructionsDir, entry.name), "utf8"));
      }
    }
  }

  const surfaces = [
    {
      id: "mcpToolsList",
      label: "MCP tools/list wire payload",
      actualBytes: mcpToolsListBytes,
      maxBytes: budgets.mcpToolsListMaxBytes,
    },
    {
      id: "apexAgent",
      label: "APEX primary agent",
      actualBytes: apexAgentBytes,
      maxBytes: budgets.apexAgentMaxBytes,
    },
    {
      id: "skillFrontmatter",
      label: "Skill frontmatter catalog",
      actualBytes: skillFrontmatterBytes,
      maxBytes: budgets.skillFrontmatterMaxBytes,
    },
    {
      id: "managedInstructions",
      label: "Managed workspace instructions",
      actualBytes: managedInstructionsBytes,
      maxBytes: budgets.managedInstructionsMaxBytes,
    },
  ];

  const violations = [];
  for (const surface of surfaces) {
    if (!Number.isInteger(surface.maxBytes) || surface.maxBytes <= 0) {
      violations.push(`${surface.id}: missing or invalid maxBytes cap in config/context-budget.v1.json`);
      continue;
    }
    if (surface.actualBytes > surface.maxBytes) {
      violations.push(
        `${surface.label} (${surface.id}) exceeds cap: ${surface.actualBytes} bytes > ${surface.maxBytes} bytes`,
      );
    }
  }

  const totalActualBytes = surfaces.reduce((sum, item) => sum + item.actualBytes, 0);
  const totalMaxBytes = surfaces.reduce((sum, item) => sum + (Number.isInteger(item.maxBytes) ? item.maxBytes : 0), 0);

  return {
    ok: violations.length === 0,
    totalActualBytes,
    totalMaxBytes,
    surfaces,
    violations,
  };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const json = process.argv.includes("--json");
  const report = evaluateContextBudget(defaultRoot);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    const details = report.surfaces.map((s) => `${s.id}=${s.actualBytes}/${s.maxBytes}`).join(", ");
    console.log(`✅ Context budget passed (${report.totalActualBytes}/${report.totalMaxBytes} bytes): ${details}`);
  } else {
    for (const violation of report.violations) {
      console.error(`❌ ${violation}`);
    }
  }
  process.exit(report.ok ? 0 : 1);
}
