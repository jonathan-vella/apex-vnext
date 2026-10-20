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
  const directory = join(root, "customizations/.github/skills/apex-fixture");
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
    join(root, "tools/registry/guidance-delivery.v1.json"),
    JSON.stringify({
      skills: [
        {
          id: "apex-fixture",
          entrypoint: ".github/skills/apex-fixture/SKILL.md",
          owner: "fixture",
          status: "current-source",
          capabilityQualification: "not-established-by-this-registry",
          files: ["SKILL.md", "LICENSE.txt", "scripts/diagram_io.py", "references/new-draft.md", "scripts/loop"]
            .map((name) => `.github/skills/apex-fixture/${name}`)
            .sort(),
        },
      ],
      deferredCapabilities: [],
    }),
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
  assert.match(withoutCache, /not-established-by-this-registry/u);
  assert.match(withoutCache, /not-run/u);
  assert.doesNotMatch(withoutCache, /guidance-migration\.v1\.json/u);

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
import domainSkillFs from "node:fs";

test("approved domain additions are plugin-only, pinned and covered by declared boundary scenarios", () => {
  const read = (relative) => JSON.parse(domainSkillFs.readFileSync(new URL(relative, import.meta.url), "utf8"));
  const manifest = read("../../customizations/manifest.json");
  const registry = read("../registry/guidance-delivery.v1.json");
  const pins = read("../registry/skill-upstream-pins.v1.json");
  const corpus = read("../registry/skill-catalog-review-scenarios.v1.json");
  for (const suffix of ["azure-kubernetes", "azure-reliability", "azure-upgrade", "python-diagrams"]) {
    const id = `apex-${suffix}`;
    const entrypoint = `.github/skills/${id}/SKILL.md`;
    const source = domainSkillFs.readFileSync(new URL(`../../customizations/${entrypoint}`, import.meta.url), "utf8");
    assert.ok(manifest.plugin.files.includes(entrypoint), id);
    assert.equal(JSON.stringify(manifest.clientProjections).includes(entrypoint), false, id);
    assert.equal(
      registry.skills.find((skill) => skill.id === id)?.capabilityQualification,
      "not-established-by-this-registry",
    );
    const pin = pins.entries.filter((entry) => entry.skill === id);
    assert.equal(pin.length, 1, id);
    assert.equal(pin[0].upstreamCommit, "c209d8bb765681aa21dce5d3cd2a3b080dad8d5e");
    assert.match(source, /user-invocable: false/u);
    assert.match(source, /upstream-coverage\.md/u);
    const prefix = suffix.replace(/^azure-/u, "");
    for (const [ending, category] of [
      ["discovery", "discovery-positive"],
      ["near-miss", "discovery-near-miss"],
      ["operation-denial", "direct-operation-denial"],
    ]) {
      const scenario = corpus.scenarios.find((entry) => entry.id === `${prefix}-${ending}`);
      assert.equal(scenario?.category, category, `${id}: ${ending}`);
      assert.equal(scenario.authority.liveQualification, "not-run");
      assert.equal(scenario.authority.clientQualification, "not-run");
    }
    assert.equal(
      registry.skills.find((skill) => skill.id === id).files.some((file) => /\.(?:py|sh|ps1)$/u.test(file)),
      false,
    );
  }
});
