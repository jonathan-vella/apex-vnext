#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { reportRegistryValidation } from "./_lib/registry-validator-reporter.mjs";

const REGISTRY = "tools/registry/guidance-delivery.v1.json";
const MAINTAINERS = [
  "apex-unslop",
  "context-management",
  "docs-writer",
  "github-operations",
  "golden-principles",
  "vendor-prompting",
  "wayfinder",
  "workflow-engine",
];
const DEFERRED_SHA256 = "c51878cf71f0ec36a80e43cbd226c8d308305fda3ce92fc0bb04e70543381b8f";

function safePath(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    !path.posix.isAbsolute(name) &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    !/^[a-z]:/iu.test(name) &&
    name.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function regularFile(root, name) {
  if (!safePath(name)) throw new Error(`Unsafe current source path: ${name}`);
  const parts = name.split("/");
  for (let index = 1; index <= parts.length; index++) {
    const info = lstatSync(path.join(root, ...parts.slice(0, index)));
    if (info.isSymbolicLink() || (index === parts.length ? !info.isFile() : !info.isDirectory())) {
      throw new Error(`Current source must be a regular contained file without symlinks: ${name}`);
    }
  }
  return readFileSync(path.join(root, name), "utf8");
}

function currentFiles(root, name) {
  const info = lstatSync(path.join(root, name));
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe current source directory: ${name}`);
  return readdirSync(path.join(root, name), { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.name === "__pycache__" || /\.(pyc|pyo)$/u.test(entry.name)) return [];
      const child = `${name}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Current source contains a symlink: ${child}`);
      if (entry.isDirectory()) return currentFiles(root, child);
      if (!entry.isFile()) throw new Error(`Unsupported current source entry: ${child}`);
      regularFile(root, child);
      return [child];
    })
    .sort();
}

export function collectGuidanceDeliveryInputs(root) {
  const readJson = (name) => JSON.parse(regularFile(root, name));
  const sourceSkills = currentFiles(root, "customizations/.github/skills").map((name) =>
    name.slice("customizations/".length),
  );
  const sourceInstructions = currentFiles(root, "customizations/.github/instructions")
    .filter((name) => name.endsWith(".instructions.md"))
    .map((name) => name.slice("customizations/".length));
  const maintainerEntrypoints = MAINTAINERS.map((id) => {
    const name = `.github/skills/${id}/SKILL.md`;
    regularFile(root, name);
    return name;
  });
  return {
    registry: readJson(REGISTRY),
    schema: readJson("tools/registry/schemas/guidance-delivery.schema.json"),
    manifest: readJson("customizations/manifest.json"),
    sourceSkills,
    sourceInstructions,
    maintainerEntrypoints,
  };
}

export function validateGuidanceDelivery({
  registry,
  schema,
  manifest,
  sourceSkills,
  sourceInstructions,
  maintainerEntrypoints,
}) {
  const errors = [];
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  if (!ajv.validate(schema, registry)) {
    return (ajv.errors ?? []).map((error) => `schema ${error.instancePath || "/"}: ${error.message}`);
  }
  function sortedUnique(values, label) {
    if (new Set(values).size !== values.length) errors.push(`${label} must be unique`);
    if (JSON.stringify(values) !== JSON.stringify([...values].sort())) errors.push(`${label} must be bytewise sorted`);
    if (values.some((name) => !safePath(name))) errors.push(`${label} contains an unsafe relative path`);
  }
  function equalSet(actual, expected, label) {
    if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
      errors.push(`${label} must match the exact current file set`);
    }
  }
  const pluginFiles = manifest?.plugin?.files;
  const managedFiles = manifest?.managedFiles;
  if (
    !Array.isArray(pluginFiles) ||
    !Array.isArray(managedFiles) ||
    pluginFiles.some((value) => typeof value !== "string") ||
    managedFiles.some((value) => typeof value !== "string")
  ) {
    return ["Managed customization manifest file lists are missing or invalid"];
  }
  sortedUnique(
    registry.skills.map((entry) => entry.id),
    "Skill IDs",
  );
  sortedUnique(
    registry.skills.map((entry) => entry.entrypoint),
    "Skill entrypoints",
  );
  const registeredFiles = [];
  for (const skill of registry.skills) {
    const prefix = `.github/skills/${skill.id}/`;
    if (skill.entrypoint !== `${prefix}SKILL.md` || !skill.files.includes(skill.entrypoint)) {
      errors.push(`${skill.id}: matching SKILL.md entrypoint is required`);
    }
    sortedUnique(skill.files, `${skill.id} files`);
    if (skill.files.some((name) => !name.startsWith(prefix)))
      errors.push(`${skill.id}: files must belong to that skill`);
    equalSet(
      skill.files,
      sourceSkills.filter((name) => name.startsWith(prefix)),
      `${skill.id} source`,
    );
    equalSet(
      skill.files,
      pluginFiles.filter((name) => name.startsWith(prefix)),
      `${skill.id} plugin ownership`,
    );
    registeredFiles.push(...skill.files);
  }
  equalSet(registeredFiles, sourceSkills, "Managed skill inventory");
  equalSet(
    registeredFiles,
    pluginFiles.filter((name) => name.startsWith(".github/skills/")),
    "Plugin skill inventory",
  );
  if (new Set(registeredFiles).size !== registeredFiles.length) errors.push("Managed skill paths must be unique");
  const instructionPaths = registry.instructions.map((entry) => entry.path);
  sortedUnique(instructionPaths, "Instruction paths");
  equalSet(instructionPaths, sourceInstructions, "Instruction source inventory");
  equalSet(
    instructionPaths,
    managedFiles.filter((name) => name.startsWith(".github/instructions/") && name.endsWith(".instructions.md")),
    "Workspace instruction inventory",
  );
  sortedUnique(
    registry.maintainerSkills.map((entry) => entry.id),
    "Maintainer skill IDs",
  );
  sortedUnique(
    registry.maintainerSkills.map((entry) => entry.entrypoint),
    "Maintainer entrypoints",
  );
  equalSet(
    registry.maintainerSkills.map((entry) => entry.id),
    MAINTAINERS,
    "Retained maintainer skills",
  );
  for (const entry of registry.maintainerSkills) {
    if (entry.entrypoint !== `.github/skills/${entry.id}/SKILL.md`)
      errors.push(`${entry.id}: maintainer entrypoint must match its ID`);
  }
  equalSet(
    registry.maintainerSkills.map((entry) => entry.entrypoint),
    maintainerEntrypoints,
    "Maintainer source inventory",
  );
  sortedUnique(
    registry.deferredCapabilities.map((entry) => entry.id),
    "Deferred IDs",
  );
  for (const entry of registry.deferredCapabilities) {
    if (!safePath(entry.archiveEntry)) errors.push(`${entry.id}: historical identifier must be a safe relative path`);
    if (!registry.skills.some((skill) => skill.id === entry.managedSkill))
      errors.push(`${entry.id}: referenced managed skill is missing`);
  }
  const digest = createHash("sha256").update(JSON.stringify(registry.deferredCapabilities)).digest("hex");
  if (digest !== DEFERRED_SHA256)
    errors.push(
      "Deferred obligations must retain their complete frozen IDs, hashes, ownership, proof and rollback boundaries",
    );
  return errors;
}

function main(args = process.argv.slice(2)) {
  let errors;
  if (args.length) errors = [`Unknown arguments: ${args.join(" ")}`];
  else {
    try {
      errors = validateGuidanceDelivery(collectGuidanceDeliveryInputs(process.cwd()));
    } catch (error) {
      errors = [`Unable to read current guidance sources: ${error.message}`];
    }
  }
  return reportRegistryValidation({
    title: "Current guidance delivery",
    source: REGISTRY,
    errors,
    passMessage: "Current guidance delivery and deferred obligations are valid",
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
