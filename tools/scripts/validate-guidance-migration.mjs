#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const matrixPath = join(root, "tools", "registry", "guidance-migration.v1.json");
const sourceSkillsDirectory = join(root, ".github", "skills");
const sourceInstructionsDirectory = join(root, ".github", "instructions");
const customizationsDirectory = join(root, "customizations", ".github", "skills");
const manifestPath = join(root, "customizations", "manifest.json");
let errors = 0;

const reportError = (message) => {
  errors += 1;
  console.error(`❌ ${message}`);
};

const sourceSkills = readdirSync(sourceSkillsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(sourceSkillsDirectory, entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();
const sourceInstructions = readdirSync(sourceInstructionsDirectory)
  .filter((name) => name.endsWith(".instructions.md"))
  .sort();
const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const dispositions = new Map();

for (const entry of matrix.skillDispositions ?? []) {
  if (dispositions.has(entry.source)) {
    reportError(`Duplicate skill disposition: ${entry.source}`);
    continue;
  }
  dispositions.set(entry.source, entry);
  if (!["consumer", "repository-only", "deferred"].includes(entry.disposition)) {
    reportError(`Unsupported disposition for ${entry.source}: ${entry.disposition}`);
  }
  if (typeof entry.owner !== "string" || entry.owner.length === 0) {
    reportError(`Missing owner for ${entry.source}`);
  }
  if (entry.disposition === "consumer") {
    const skillPath = join(customizationsDirectory, entry.consumerSkill ?? "", "SKILL.md");
    const manifestPath = `.github/skills/${entry.consumerSkill}/SKILL.md`;
    if (!existsSync(skillPath)) {
      reportError(`Missing consumer skill for ${entry.source}: ${skillPath}`);
    }
    if (!manifest.managedFiles.includes(manifestPath)) {
      reportError(`Consumer skill is not managed for ${entry.source}: ${manifestPath}`);
    }
  }
}

for (const skill of sourceSkills) {
  if (!dispositions.has(skill)) {
    reportError(`Missing disposition for root skill: ${skill}`);
  }
}
for (const source of dispositions.keys()) {
  if (!sourceSkills.includes(source)) {
    reportError(`Disposition references an unknown root skill: ${source}`);
  }
}

const instructionDisposition = matrix.instructionDisposition;
if (
  instructionDisposition?.sourceGlob !== ".github/instructions/*.instructions.md" ||
  instructionDisposition?.disposition !== "repository-only" ||
  typeof instructionDisposition.owner !== "string" ||
  instructionDisposition.owner.length === 0
) {
  reportError("Instructions require a repository-only disposition with an owner");
}
if (sourceInstructions.length === 0) {
  reportError("No root instruction files were found");
}

if (errors > 0) {
  process.exit(1);
}

console.log(
  `✅ Guidance migration covers ${sourceSkills.length} root skills and ${sourceInstructions.length} instructions`,
);
