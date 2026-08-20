#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const resourceDispositionTypes = new Set(["retain", "adapt", "already-owned", "exclude-unsafe", "defer-capability"]);
const lifecycleTypes = new Set(["planned", "complete"]);

const listResourceFiles = (directory, prefix = "") => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resourcePath = join(directory, entry.name);
    const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? listResourceFiles(resourcePath, relativePath) : [relativePath];
  });
};

const isSourceResource = (resource) => resource !== "SKILL.md" && resource !== "LICENSE" && resource !== "LICENSE.txt";
const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
const isRelativeTarget = (target) =>
  isNonEmptyString(target) && !target.startsWith("/") && !target.includes("..") && !target.startsWith("owner:");

const resolveTarget = (target, consumerSkill) => {
  if (target.startsWith("owner:")) {
    const ownerTarget = target.slice("owner:".length);
    const separator = ownerTarget.indexOf("/");
    if (separator <= 0 || separator === ownerTarget.length - 1) return null;
    return { owner: ownerTarget.slice(0, separator), path: ownerTarget.slice(separator + 1) };
  }
  if (!isRelativeTarget(target)) return null;
  return { owner: consumerSkill, path: target };
};

export function validateGuidanceMigration({ matrix, sourceSkills, sourceResources, consumerResources, managedFiles }) {
  const errors = [];
  const reportError = (message) => errors.push(message);
  const dispositions = new Map();
  const consumerMappings = new Map();

  if (!(managedFiles instanceof Set)) reportError("managedFiles must be a set");

  for (const entry of matrix.skillDispositions ?? []) {
    if (dispositions.has(entry.source)) {
      reportError(`Duplicate skill disposition: ${entry.source}`);
      continue;
    }
    dispositions.set(entry.source, entry);
    if (!new Set(["consumer", "repository-only", "deferred"]).has(entry.disposition)) {
      reportError(`Unsupported disposition for ${entry.source}: ${entry.disposition}`);
    }
    if (!isNonEmptyString(entry.owner)) reportError(`Missing owner for ${entry.source}`);
    if (entry.disposition !== "consumer") continue;

    if (!isNonEmptyString(entry.consumerSkill)) {
      reportError(`Missing consumer skill for ${entry.source}`);
      continue;
    }
    consumerMappings.set(entry.consumerSkill, entry.source);
    if (!lifecycleTypes.has(entry.lifecycle)) {
      reportError(`Unsupported or missing lifecycle for ${entry.source}: ${entry.lifecycle}`);
    }
    if (!Array.isArray(entry.resourceDispositions)) {
      reportError(`Resource dispositions must be an array for ${entry.source}`);
      continue;
    }

    const sourceResourceSet = sourceResources.get(entry.source) ?? new Set();
    const seenResources = new Set();
    for (const resource of entry.resourceDispositions) {
      if (resource === null || typeof resource !== "object" || Array.isArray(resource)) {
        reportError(`Resource disposition must be an object for ${entry.source}`);
        continue;
      }
      if (!isNonEmptyString(resource.source)) {
        reportError(`Missing resource source for ${entry.source}`);
        continue;
      }
      if (seenResources.has(resource.source)) {
        reportError(`Duplicate resource disposition for ${entry.source}: ${resource.source}`);
        continue;
      }
      seenResources.add(resource.source);
      if (!sourceResourceSet.has(resource.source)) {
        reportError(`Unknown source resource for ${entry.source}: ${resource.source}`);
      }
      if (!resourceDispositionTypes.has(resource.disposition)) {
        reportError(`Unsupported resource disposition for ${entry.source}/${resource.source}: ${resource.disposition}`);
      }
      for (const field of ["reason", "replacementProof", "rollbackGate"]) {
        if (!isNonEmptyString(resource[field]))
          reportError(`Missing resource ${field} for ${entry.source}/${resource.source}`);
      }
      if (
        !Array.isArray(resource.scenarioIds) ||
        resource.scenarioIds.length === 0 ||
        !resource.scenarioIds.every(isNonEmptyString)
      ) {
        reportError(`Resource scenarioIds must be a non-empty string array for ${entry.source}/${resource.source}`);
      }
      if (resource.disposition === "defer-capability" && !isNonEmptyString(resource.capabilityOwner)) {
        reportError(`Deferred resource requires a capabilityOwner for ${entry.source}/${resource.source}`);
      }
      if (!Array.isArray(resource.targets)) {
        reportError(`Resource targets must be an array for ${entry.source}/${resource.source}`);
        continue;
      }
      if (["retain", "adapt", "already-owned"].includes(resource.disposition) && resource.targets.length === 0) {
        reportError(`Retained resource requires a target for ${entry.source}/${resource.source}`);
      }
      for (const target of resource.targets) {
        if (!isNonEmptyString(target)) {
          reportError(`Invalid resource target for ${entry.source}/${resource.source}`);
          continue;
        }
        const resolvedTarget = resolveTarget(target, entry.consumerSkill);
        if (resolvedTarget === null) {
          reportError(`Invalid resource target for ${entry.source}/${resource.source}: ${target}`);
          continue;
        }
        if (!consumerMappings.has(resolvedTarget.owner)) {
          reportError(`Unknown target owner for ${entry.source}/${resource.source}: ${resolvedTarget.owner}`);
          continue;
        }
        if (entry.lifecycle !== "complete") continue;
        if (!consumerResources.get(resolvedTarget.owner)?.has(resolvedTarget.path)) {
          reportError(`Missing complete target for ${entry.source}/${resource.source}: ${target}`);
        }
        const managedTargetPath = `.github/skills/${resolvedTarget.owner}/${resolvedTarget.path}`;
        if (managedFiles instanceof Set && !managedFiles.has(managedTargetPath)) {
          reportError(`Complete target is not managed for ${entry.source}/${resource.source}: ${managedTargetPath}`);
        }
      }
    }
    for (const sourceResource of sourceResourceSet) {
      if (!seenResources.has(sourceResource))
        reportError(`Missing resource disposition for ${entry.source}: ${sourceResource}`);
    }

    if (entry.lifecycle === "complete") {
      if (!consumerResources.get(entry.consumerSkill)?.has("SKILL.md")) {
        reportError(`Missing complete consumer skill for ${entry.source}: ${entry.consumerSkill}`);
      }
      const managedSkillPath = `.github/skills/${entry.consumerSkill}/SKILL.md`;
      if (managedFiles instanceof Set && !managedFiles.has(managedSkillPath)) {
        reportError(`Complete consumer skill is not managed for ${entry.source}: ${managedSkillPath}`);
      }
    }
  }

  for (const skill of sourceSkills) {
    if (!dispositions.has(skill)) reportError(`Missing disposition for root skill: ${skill}`);
  }
  for (const source of dispositions.keys()) {
    if (!sourceSkills.includes(source)) reportError(`Disposition references an unknown root skill: ${source}`);
  }

  const instructionDisposition = matrix.instructionDisposition;
  if (
    instructionDisposition?.sourceGlob !== ".github/instructions/*.instructions.md" ||
    instructionDisposition?.disposition !== "repository-only" ||
    !isNonEmptyString(instructionDisposition.owner)
  ) {
    reportError("Instructions require a repository-only disposition with an owner");
  }
  return errors;
}

export function collectGuidanceMigrationInputs(root = process.cwd()) {
  const matrixPath = join(root, "tools", "registry", "guidance-migration.v1.json");
  const sourceSkillsDirectory = join(root, ".github", "skills");
  const sourceInstructionsDirectory = join(root, ".github", "instructions");
  const customizationsDirectory = join(root, "customizations", ".github", "skills");
  const manifestPath = join(root, "customizations", "manifest.json");
  const sourceSkills = readdirSync(sourceSkillsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(sourceSkillsDirectory, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
  const sourceResources = new Map(
    sourceSkills.map((skill) => [
      skill,
      new Set(listResourceFiles(join(sourceSkillsDirectory, skill)).filter(isSourceResource)),
    ]),
  );
  const consumerResources = new Map(
    readdirSync(customizationsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => [entry.name, new Set(listResourceFiles(join(customizationsDirectory, entry.name)))]),
  );
  const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const managedFiles = Array.isArray(manifest.managedFiles) ? new Set(manifest.managedFiles) : null;
  const sourceInstructions = readdirSync(sourceInstructionsDirectory).filter((name) =>
    name.endsWith(".instructions.md"),
  );
  return { matrix, sourceSkills, sourceResources, consumerResources, managedFiles, sourceInstructions };
}

function main() {
  let inputs;
  try {
    inputs = collectGuidanceMigrationInputs();
  } catch (error) {
    console.error(`❌ Guidance migration inputs are unreadable: ${error.message}`);
    process.exit(1);
  }
  const errors = validateGuidanceMigration(inputs);
  if (inputs.sourceInstructions.length === 0) errors.push("No root instruction files were found");
  for (const error of errors) console.error(`❌ ${error}`);
  if (errors.length > 0) process.exit(1);
  console.log(
    `✅ Guidance migration covers ${inputs.sourceSkills.length} root skills and ${inputs.sourceInstructions.length} instructions`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

/* import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const matrixPath = join(root, "tools", "registry", "guidance-migration.v1.json");
const sourceSkillsDirectory = join(root, ".github", "skills");
const sourceInstructionsDirectory = join(root, ".github", "instructions");
const customizationsDirectory = join(root, "customizations", ".github", "skills");
const manifestPath = join(root, "customizations", "manifest.json");
const resourceDispositions = new Set(["retain", "adapt", "already-owned", "exclude-unsafe", "defer-capability"]);
let errors = 0;

const reportError = (message) => {
  errors += 1;
  console.error(`❌ ${message}`);
};

const listResourceFiles = (directory, prefix = "") => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resourcePath = join(directory, entry.name);
    const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? listResourceFiles(resourcePath, relativePath) : [relativePath];
  });
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
const managedFiles = Array.isArray(manifest.managedFiles) ? manifest.managedFiles : null;
const dispositions = new Map();

if (managedFiles === null) {
  reportError(`${manifestPath}: managedFiles must be an array`);
}

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
    if (typeof entry.consumerSkill !== "string" || entry.consumerSkill.length === 0) {
      reportError(`Missing consumer skill for ${entry.source}`);
      continue;
    }
    const skillPath = join(customizationsDirectory, entry.consumerSkill, "SKILL.md");
    const managedSkillPath = `.github/skills/${entry.consumerSkill}/SKILL.md`;
    if (!existsSync(skillPath)) {
      reportError(`Missing consumer skill for ${entry.source}: ${skillPath}`);
    }
    if (managedFiles !== null && !managedFiles.includes(managedSkillPath)) {
      reportError(`Consumer skill is not managed for ${entry.source}: ${managedSkillPath}`);
    }
    const seenResources = new Set();
    let resources = [];
    if (entry.resourceDispositions !== undefined) {
      if (Array.isArray(entry.resourceDispositions)) {
        resources = entry.resourceDispositions;
      } else {
        reportError(`Resource dispositions must be an array for ${entry.source}`);
      }
    }
    for (const resource of resources) {
      if (resource === null || typeof resource !== "object" || Array.isArray(resource)) {
        reportError(`Resource disposition must be an object for ${entry.source}`);
        continue;
      }
      if (typeof resource.source !== "string" || resource.source.length === 0) {
        reportError(`Missing resource source for ${entry.source}`);
        continue;
      }
      if (seenResources.has(resource.source)) {
        reportError(`Duplicate resource disposition for ${entry.source}: ${resource.source}`);
        continue;
      }
      seenResources.add(resource.source);
      const sourceResourcePath = join(sourceSkillsDirectory, entry.source, resource.source);
      if (!existsSync(sourceResourcePath)) {
        reportError(`Missing source resource for ${entry.source}: ${sourceResourcePath}`);
      }
      if (!resourceDispositions.has(resource.disposition)) {
        reportError(`Unsupported resource disposition for ${entry.source}/${resource.source}: ${resource.disposition}`);
      }
      if (typeof resource.reason !== "string" || resource.reason.length === 0) {
        reportError(`Missing resource disposition reason for ${entry.source}/${resource.source}`);
      }
      if (!Array.isArray(resource.targets)) {
        reportError(`Resource targets must be an array for ${entry.source}/${resource.source}`);
        continue;
      }
      if (["retain", "adapt", "already-owned"].includes(resource.disposition) && resource.targets.length === 0) {
        reportError(`Retained resource requires a target for ${entry.source}/${resource.source}`);
      }
      for (const target of resource.targets) {
        if (typeof target !== "string" || target.length === 0) {
          reportError(`Invalid resource target for ${entry.source}/${resource.source}`);
          continue;
        }
        const targetPath = join(customizationsDirectory, entry.consumerSkill, target);
        const managedTargetPath = `.github/skills/${entry.consumerSkill}/${target}`;
        if (!existsSync(targetPath)) {
          reportError(`Missing retained target for ${entry.source}/${resource.source}: ${targetPath}`);
        }
        if (managedFiles !== null && !managedFiles.includes(managedTargetPath)) {
          reportError(`Retained target is not managed for ${entry.source}/${resource.source}: ${managedTargetPath}`);
        }
      }
    }
    if (entry.resourceDispositions !== undefined) {
      const sourceResources = listResourceFiles(join(sourceSkillsDirectory, entry.source)).filter(
        (resource) => resource !== "SKILL.md" && resource !== "LICENSE.txt",
      );
      for (const sourceResource of sourceResources) {
        if (!seenResources.has(sourceResource)) {
          reportError(`Missing resource disposition for ${entry.source}: ${sourceResource}`);
        }
      }
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
*/
