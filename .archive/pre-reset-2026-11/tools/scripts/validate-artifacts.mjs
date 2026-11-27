#!/usr/bin/env node

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOCUMENT_REGISTRY, REQUIREMENTS_TEMPLATE_SLOTS } from "../../packages/renderers/dist/index.js";
import { reportRegistryValidation } from "./_lib/registry-validator-reporter.mjs";

function safeAssetPath(assetPath) {
  return (
    typeof assetPath === "string" &&
    assetPath.length > 0 &&
    !path.posix.isAbsolute(assetPath) &&
    !assetPath.includes("\\") &&
    !assetPath.includes("\0") &&
    !/^[a-z]:/iu.test(assetPath) &&
    assetPath.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

export function collectArtifactSourceInputs(root) {
  const manifest = JSON.parse(readFileSync(path.join(root, "customizations/manifest.json"), "utf8"));
  const assetPath = DOCUMENT_REGISTRY.requirements?.template?.assetPath;
  if (!safeAssetPath(assetPath)) throw new Error("Registered requirements template path is unsafe");
  const components = ["customizations", ...assetPath.split("/")];
  for (let index = 1; index <= components.length; index++) {
    const filename = path.join(root, ...components.slice(0, index));
    const info = lstatSync(filename);
    if (info.isSymbolicLink()) throw new Error(`Requirements template source must not use symlinks: ${filename}`);
    if (index === components.length ? !info.isFile() : !info.isDirectory()) {
      throw new Error(`Requirements template source is not a contained regular file: ${filename}`);
    }
  }
  const customizationRoot = realpathSync(path.join(root, "customizations"));
  const filename = path.join(root, ...components);
  if (!realpathSync(filename).startsWith(customizationRoot + path.sep)) {
    throw new Error("Requirements template source escapes customizations");
  }
  return {
    manifest,
    registry: DOCUMENT_REGISTRY,
    slots: REQUIREMENTS_TEMPLATE_SLOTS,
    template: { assetPath, text: readFileSync(filename, "utf8") },
  };
}

export function validateArtifactSourceInputs({ manifest, registry, slots, template }) {
  const errors = [];
  const definition = registry?.requirements;
  if (
    definition?.sourceArtifactKind !== "requirements" ||
    definition?.sourceAvailability !== "available" ||
    definition?.templateAvailability !== "available" ||
    definition?.renderer !== "requirements-template-v1"
  ) {
    errors.push("Requirements document must retain its registered source, availability and renderer");
  }
  const assetPath = definition?.template?.assetPath;
  if (!safeAssetPath(assetPath)) errors.push("Requirements template asset path must be safe and relative");
  if (assetPath !== ".github/skills/apex-artifacts/templates/requirements.md") {
    errors.push("Requirements template must retain its current managed asset path");
  }
  if (
    !Array.isArray(manifest?.plugin?.files) ||
    manifest.plugin.files.filter((name) => name === assetPath).length !== 1
  ) {
    errors.push("Requirements template must have exactly one plugin manifest entry");
  }
  if (!Array.isArray(slots) || slots.length === 0 || new Set(slots).size !== slots.length) {
    errors.push("Registered requirements slots must be nonempty and unique");
    return errors;
  }
  if (
    !Array.isArray(definition?.template?.slots) ||
    JSON.stringify(definition.template.slots) !== JSON.stringify(slots)
  ) {
    errors.push("Requirements template registry slots must match renderer slots");
  }
  if (template?.assetPath !== assetPath || typeof template?.text !== "string") {
    errors.push("Registered requirements template source is missing or mismatched");
    return errors;
  }
  const actualSlots = [...template.text.matchAll(/\{([^{}\r\n]+)\}/gu)].map((match) => match[1]);
  for (const slot of slots) {
    if (actualSlots.filter((value) => value === slot).length !== 1) {
      errors.push(`Requirements template must contain exactly one {${slot}} slot`);
    }
  }
  for (const slot of new Set(actualSlots)) {
    if (!slots.includes(slot)) errors.push(`Requirements template contains unknown slot: {${slot}}`);
  }
  const headings = template.text.split(/\r?\n/u).filter((line) => /^#{1,2} /u.test(line));
  const h1 = headings.filter((line) => line.startsWith("# "));
  const h2 = headings.filter((line) => line.startsWith("## "));
  if (h1.length !== 1 || headings[0] !== h1[0])
    errors.push("Requirements template must start its headings with one H1");
  if (h2.length === 0 || new Set(h2).size !== h2.length) {
    errors.push("Requirements template must contain unique ordered H2 headings");
  }
  return errors;
}

export function main(args = process.argv.slice(2), root = process.cwd()) {
  let errors;
  if (args.length > 0) {
    errors = [`Unknown arguments: ${args.join(" ")}. Artifact source validation takes no arguments.`];
  } else {
    try {
      errors = validateArtifactSourceInputs(collectArtifactSourceInputs(root));
    } catch (error) {
      errors = [`Unable to collect current artifact sources: ${error.message}`];
    }
  }
  return reportRegistryValidation({
    title: "Current artifact source validation",
    source: "customizations/manifest.json",
    errors,
    passMessage: "Current registered artifact sources are valid",
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
