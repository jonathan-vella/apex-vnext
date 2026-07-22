import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { format } from "prettier";
import {
  ARTIFACT_TEMPLATE_PATHS,
  NON_TEMPLATE_ARTIFACT_HEADINGS,
  OPTIONAL_ARTIFACT_HEADINGS,
  TEMPLATE_META_HEADINGS,
} from "./artifact-heading-sources.mjs";

export function extractRequiredTemplateHeadings(text, artifactName) {
  const excluded = new Set([...TEMPLATE_META_HEADINGS, ...(OPTIONAL_ARTIFACT_HEADINGS[artifactName] ?? [])]);
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("## ") && !excluded.has(line));
}

export function buildArtifactHeadings(repoRoot, readFile = readFileSync) {
  const templatePaths = Object.values(ARTIFACT_TEMPLATE_PATHS);
  if (templatePaths.length !== new Set(templatePaths).size) {
    throw new Error("Artifact template paths must be unique");
  }
  const knownArtifacts = new Set([
    ...Object.keys(ARTIFACT_TEMPLATE_PATHS),
    ...Object.keys(NON_TEMPLATE_ARTIFACT_HEADINGS),
  ]);
  for (const artifactName of Object.keys(OPTIONAL_ARTIFACT_HEADINGS)) {
    if (!knownArtifacts.has(artifactName)) {
      throw new Error(`Optional headings reference unknown artifact: ${artifactName}`);
    }
  }
  const generated = {};
  for (const [artifactName, templatePath] of Object.entries(ARTIFACT_TEMPLATE_PATHS)) {
    const text = readFile(resolve(repoRoot, templatePath), "utf8");
    const headings = extractRequiredTemplateHeadings(text, artifactName);
    if (headings.length === 0) {
      throw new Error(`Artifact template has no required H2 headings: ${templatePath}`);
    }
    if (headings.length !== new Set(headings).size) {
      throw new Error(`Artifact template has duplicate required H2 headings: ${templatePath}`);
    }
    generated[artifactName] = headings;
  }
  return Object.fromEntries(
    Object.entries({ ...generated, ...NON_TEMPLATE_ARTIFACT_HEADINGS }).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export async function renderArtifactHeadingsModule(headings) {
  const source = `/**\n * Generated from canonical artifact templates by render-headings-summary.mjs.\n * Do not edit directly.\n */\n\nexport const ARTIFACT_HEADINGS = ${JSON.stringify(headings, null, 2)};\n`;
  return format(source, { parser: "babel", printWidth: 120 });
}

export function renderArtifactHeadingsSummary(headings) {
  return `${JSON.stringify(headings, null, 2)}\n`;
}
