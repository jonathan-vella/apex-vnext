#!/usr/bin/env node
/** Validate the bounded catalog-review scenario fixture without client or provider execution. */

import { readFileSync } from "node:fs";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";

const CORPUS_PATH = "tools/registry/skill-catalog-review-scenarios.v1.json";
const SCHEMA_PATH = "tools/registry/schemas/skill-catalog-review-scenarios.schema.json";
const REQUIRED_CATEGORIES = new Set([
  "discovery-positive",
  "discovery-near-miss",
  "unavailable-capability",
  "direct-operation-denial",
  "requirements-native-workflow",
  "bicep-complete-reference",
]);

export function validateSkillCatalogReviewScenarios(corpus, schema) {
  const errors = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  if (!ajv.validate(schema, corpus)) {
    return (ajv.errors ?? []).map(({ instancePath, message }) => `schema ${instancePath || "/"}: ${message}`);
  }

  const ids = corpus.scenarios.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) errors.push("scenario IDs must be unique");

  const categories = new Set(corpus.scenarios.map(({ category }) => category));
  for (const category of REQUIRED_CATEGORIES) {
    if (!categories.has(category)) errors.push(`required coverage category is missing: ${category}`);
  }

  for (const scenario of corpus.scenarios) {
    if (scenario.authority.liveQualification !== "not-run") {
      errors.push(`${scenario.id}: live qualification must remain not-run`);
    }
    if (scenario.authority.clientQualification !== "not-run") {
      errors.push(`${scenario.id}: client qualification must remain not-run`);
    }
  }
  return errors;
}

function main() {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const errors = validateSkillCatalogReviewScenarios(corpus, schema);
  for (const error of errors) console.error(`ERROR ${CORPUS_PATH}: ${error}`);
  if (errors.length === 0) console.log("Skill catalog review scenario fixture is valid");
  return errors.length === 0 ? 0 : 1;
}

if (process.argv[1]?.endsWith("validate-skill-catalog-review-scenarios.mjs")) process.exitCode = main();
