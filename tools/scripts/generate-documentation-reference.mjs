#!/usr/bin/env node
/** Generate or validate source-derived APEX documentation inventories. */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const check = process.argv.includes("--check");

function uniqueMatches(content, pattern) {
  return [...new Set([...content.matchAll(pattern)].map((match) => match[1]))].sort();
}

function render(title, description, items, source) {
  return (
    `# ${title}\n\n> [Current Version](../../VERSION.md) | ${description}\n\n` +
    `This file is generated from [${source}](../../${source}). Do not edit it manually.\n\n` +
    `## Inventory\n\n${items.map((item) => `- \`${item}\``).join("\n")}\n\n` +
    `## Related\n\n- [Reference index](README.md)\n`
  );
}

function emit(path, content) {
  const absolute = join(root, path);
  if (check) {
    if (!existsSync(absolute) || readFileSync(absolute, "utf8") !== content) {
      console.error(`❌ Generated documentation is stale: ${path}`);
      process.exitCode = 1;
    }
    return;
  }
  writeFileSync(absolute, content);
  console.log(`✅ Generated ${path}`);
}

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function repositoryPath(path) {
  return relative(root, path).replaceAll("\\", "/");
}

const cliSource = "packages/cli/src/cli.ts";
const mcpSource = "packages/cli/src/mcp.ts";
const commands = uniqueMatches(readFileSync(join(root, cliSource), "utf8"), /case "([^"]+)":/gu);
const tools = uniqueMatches(readFileSync(join(root, mcpSource), "utf8"), /server\.registerTool\(\s*"([^"]+)"/gu);

emit(
  "docs/reference/cli-commands.generated.md",
  render("CLI Command Inventory", "Source-derived APEX CLI command names.", commands, cliSource),
);
emit(
  "docs/reference/mcp-tools.generated.md",
  render("MCP Tool Inventory", "Source-derived APEX MCP tool names.", tools, mcpSource),
);

if (check) {
  for (const required of [
    "docs/README.md",
    "docs/tutorials/first-run.md",
    "docs/how-to/run-workflow.md",
    "docs/explanation/runtime-architecture.md",
    "docs/reference/README.md",
    "docs/vnext/documentation-inventory.v1.json",
  ]) {
    if (!existsSync(join(root, required))) {
      console.error(`❌ Required documentation is missing: ${required}`);
      process.exitCode = 1;
    }
  }
  if (existsSync(join(root, "docs/guides"))) {
    console.error("❌ Superseded docs/guides must remain archived");
    process.exitCode = 1;
  }
  const activeDocs = walk(join(root, "docs")).filter(
    (path) => !repositoryPath(path).startsWith("docs/vnext/phase-0a/") && repositoryPath(path) !== "docs/MIGRATION.md",
  );
  const forbidden = /original APEX|github\.com\/jonathan-vella\/apex(?!-vnext)/iu;
  for (const path of activeDocs) {
    if (forbidden.test(readFileSync(path, "utf8"))) {
      console.error(
        `❌ Predecessor history must stay in docs/MIGRATION.md or frozen evidence: ${repositoryPath(path)}`,
      );
      process.exitCode = 1;
    }
  }
  if (process.exitCode !== 1) console.log("✅ Documentation references and structure are current");
}
