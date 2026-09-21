import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { sourceResources } from "../scripts/generate-skill-catalog-review.mjs";
import { validateSkillCatalogReviewScenarios } from "../scripts/validate-skill-catalog-review-scenarios.mjs";

const corpus = JSON.parse(readFileSync("tools/registry/skill-catalog-review-scenarios.v1.json", "utf8"));
const schema = JSON.parse(readFileSync("tools/registry/schemas/skill-catalog-review-scenarios.schema.json", "utf8"));

test("catalog inventory and generated output ignore runtime caches without hiding authored resources", (context) => {
  const root = mkdtempSync(join(tmpdir(), "apex-skill-catalog-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, ".github/skills/fixture");
  mkdirSync(join(directory, "scripts"), { recursive: true });
  mkdirSync(join(directory, "references"));
  for (const resource of ["SKILL.md", "LICENSE.txt", "scripts/diagram_io.py", "references/new-draft.md"]) {
    writeFileSync(join(directory, resource), "authored resource\n");
  }
  symlinkSync(directory, join(directory, "scripts/loop"), "dir");
  const expected = ["references/new-draft.md", "scripts/diagram_io.py", "scripts/loop"];
  assert.deepEqual(sourceResources(directory), expected);

  mkdirSync(join(root, "tools/registry"), { recursive: true });
  mkdirSync(join(root, "docs/vnext"), { recursive: true });
  writeFileSync(
    join(root, "tools/registry/guidance-migration.v1.json"),
    JSON.stringify({ skillDispositions: [{ source: "fixture", disposition: "retain", owner: "fixture" }] }),
  );
  const generator = resolve("tools/scripts/generate-skill-catalog-review.mjs");
  const generate = (...args) => {
    const result = spawnSync(process.execPath, [generator, ...args], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr + result.stdout);
  };
  const destination = join(root, "docs/vnext/SKILL-CATALOG-REVIEW.generated.md");
  generate();
  generate("--check");
  const withoutCache = readFileSync(destination, "utf8");

  mkdirSync(join(directory, "scripts/__pycache__/nested"), { recursive: true });
  mkdirSync(join(directory, "__pycache__"));
  for (const resource of [
    "__pycache__/cache.txt",
    "scripts/__pycache__/diagram_io.cpython-314.pyc",
    "scripts/__pycache__/nested/cache.md",
    "scripts/legacy.pyc",
    "scripts/legacy.pyo",
    "root.pyc",
    "root.pyo",
  ]) {
    writeFileSync(join(directory, resource), "runtime cache\n");
  }
  assert.deepEqual(sourceResources(directory), expected);
  generate("--check");
  generate();
  assert.equal(readFileSync(destination, "utf8"), withoutCache);
});

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

test("catalog review category coverage follows the schema", () => {
  const expandedSchema = structuredClone(schema);
  expandedSchema.properties.scenarios.items.properties.category.enum.push("new-required-category");

  assert.ok(
    validateSkillCatalogReviewScenarios(corpus, expandedSchema).includes(
      "required coverage category is missing: new-required-category",
    ),
  );
});
