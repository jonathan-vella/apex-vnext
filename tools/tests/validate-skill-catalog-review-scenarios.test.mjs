import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateSkillCatalogReviewScenarios } from "../scripts/validate-skill-catalog-review-scenarios.mjs";

const corpus = JSON.parse(readFileSync("tools/registry/skill-catalog-review-scenarios.v1.json", "utf8"));
const schema = JSON.parse(readFileSync("tools/registry/schemas/skill-catalog-review-scenarios.schema.json", "utf8"));

test("catalog review scenarios provide bounded deterministic coverage", () => {
  assert.deepEqual(validateSkillCatalogReviewScenarios(corpus, schema), []);
});

test("catalog review scenarios reject duplicate identifiers, missing coverage, and qualification claims", () => {
  const duplicate = structuredClone(corpus);
  duplicate.scenarios[1].id = duplicate.scenarios[0].id;
  assert.ok(validateSkillCatalogReviewScenarios(duplicate, schema).includes("scenario IDs must be unique"));

  const missingCoverage = structuredClone(corpus);
  missingCoverage.scenarios = missingCoverage.scenarios.filter(
    ({ category }) => category !== "direct-operation-denial",
  );
  assert.ok(
    validateSkillCatalogReviewScenarios(missingCoverage, schema).includes(
      "required coverage category is missing: direct-operation-denial",
    ),
  );

  const claimedClientQualification = structuredClone(corpus);
  claimedClientQualification.scenarios[0].authority.clientQualification = "qualified";
  assert.ok(validateSkillCatalogReviewScenarios(claimedClientQualification, schema).length > 0);
});
