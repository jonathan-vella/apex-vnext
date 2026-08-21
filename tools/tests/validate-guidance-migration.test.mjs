import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { collectGuidanceMigrationInputs, validateGuidanceMigration } from "../scripts/validate-guidance-migration.mjs";

const root = resolve(import.meta.dirname, "../..");
const sourceSkills = ["source-skill"];
const sourceResources = new Map([["source-skill", new Set(["references/rule.md"])]]);
const consumerResources = new Map([["consumer-skill", new Set(["SKILL.md", "references/rule.md"])]]);
const managedFiles = new Set([
  ".github/skills/consumer-skill/SKILL.md",
  ".github/skills/consumer-skill/references/rule.md",
]);

const resource = (overrides = {}) => ({
  source: "references/rule.md",
  disposition: "adapt",
  targets: ["references/rule.md"],
  reason: "Preserves the source decision rule in managed consumer guidance.",
  replacementProof: "Target is covered by deterministic consumer packaging tests.",
  rollbackGate: "Restore the source mapping when consumer packaging validation fails.",
  scenarioIds: ["guidance-migration-ledger"],
  ...overrides,
});

const matrix = (overrides = {}) => ({
  skillDispositions: [
    {
      source: "source-skill",
      disposition: "consumer",
      consumerSkill: "consumer-skill",
      owner: "APEX Architect",
      lifecycle: "complete",
      resourceDispositions: [resource()],
    },
  ],
  instructionDisposition: {
    sourceGlob: ".github/instructions/*.instructions.md",
    disposition: "repository-only",
    owner: "source authoring validators",
  },
  ...overrides,
});

const inputs = (overrides = {}) => ({
  matrix: matrix(),
  sourceSkills,
  sourceResources,
  consumerResources,
  managedFiles,
  ...overrides,
});

test("accepts a complete mapping with packaged targets", () => {
  assert.deepEqual(validateGuidanceMigration(inputs()), []);
});

test("scoped parity mappings are complete with explicit source dispositions and managed consumer skills", () => {
  const scopedSources = [
    "azure-artifacts",
    "azure-deploy",
    "iac-common",
    "azure-cost-optimization",
    "azure-governance-discovery",
    "mermaid",
  ];
  const repositoryInputs = collectGuidanceMigrationInputs(root);
  assert.ok(repositoryInputs.managedFiles, "managed consumer files must be collected");
  assert.ok(repositoryInputs.sourceResources, "source resources must be collected");
  assert.ok(repositoryInputs.matrix?.skillDispositions, "guidance migration mappings must be collected");

  for (const source of scopedSources) {
    const mapping = repositoryInputs.matrix.skillDispositions.find((entry) => entry.source === source);
    assert.ok(mapping, `${source} must have a guidance migration mapping`);
    assert.ok(Array.isArray(mapping.resourceDispositions), `${source} must collect resource dispositions`);
    const collectedResources = repositoryInputs.sourceResources.get(source);
    assert.ok(collectedResources, `${source} source resources must be collected`);
    assert.equal(mapping?.lifecycle, "complete", `${source} must be complete`);
    assert.equal(
      mapping?.resourceDispositions.length,
      collectedResources.size,
      `${source} must disposition every source resource`,
    );
    assert.ok(repositoryInputs.managedFiles.has(`.github/skills/${mapping.consumerSkill}/SKILL.md`));
  }
});

test("rejects a missing lifecycle and source resource disposition", () => {
  const candidate = matrix();
  delete candidate.skillDispositions[0].lifecycle;
  candidate.skillDispositions[0].resourceDispositions = [];
  const errors = validateGuidanceMigration(inputs({ matrix: candidate }));
  assert.ok(errors.some((error) => error.includes("Unsupported or missing lifecycle")));
  assert.ok(errors.some((error) => error.includes("Missing resource disposition")));
});

test("accepts a planned target that has not been created", () => {
  const candidate = matrix();
  candidate.skillDispositions[0].lifecycle = "planned";
  candidate.skillDispositions[0].resourceDispositions = [resource({ targets: ["references/future-rule.md"] })];
  assert.deepEqual(validateGuidanceMigration(inputs({ matrix: candidate })), []);
});

test("accepts a target owned by a consumer mapping declared later", () => {
  const candidate = matrix();
  candidate.skillDispositions[0].lifecycle = "planned";
  candidate.skillDispositions[0].resourceDispositions = [
    resource({ targets: ["owner:later-consumer/references/future-rule.md"] }),
  ];
  candidate.skillDispositions.push({
    source: "later-source",
    disposition: "consumer",
    consumerSkill: "later-consumer",
    owner: "APEX Planner",
    lifecycle: "planned",
    resourceDispositions: [],
  });
  const resources = new Map([...sourceResources, ["later-source", new Set()]]);
  const consumers = new Map([...consumerResources, ["later-consumer", new Set(["SKILL.md"])]]);

  assert.deepEqual(
    validateGuidanceMigration(
      inputs({
        matrix: candidate,
        sourceSkills: [...sourceSkills, "later-source"],
        sourceResources: resources,
        consumerResources: consumers,
      }),
    ),
    [],
  );
});

test("rejects a missing complete target and duplicate source row", () => {
  const candidate = matrix();
  candidate.skillDispositions[0].resourceDispositions = [
    resource({ targets: ["references/future-rule.md"] }),
    resource(),
  ];
  const errors = validateGuidanceMigration(inputs({ matrix: candidate }));
  assert.ok(errors.some((error) => error.includes("Missing complete target")));
  assert.ok(errors.some((error) => error.includes("Duplicate resource disposition")));
});

test("rejects malformed rows and incomplete deferred capability metadata", () => {
  const candidate = matrix();
  candidate.skillDispositions[0].resourceDispositions = [null];
  let errors = validateGuidanceMigration(inputs({ matrix: candidate }));
  assert.ok(errors.some((error) => error.includes("Resource disposition must be an object")));

  candidate.skillDispositions[0].resourceDispositions = [
    resource({ disposition: "defer-capability", targets: [], capabilityOwner: "" }),
  ];
  errors = validateGuidanceMigration(inputs({ matrix: candidate }));
  assert.ok(errors.some((error) => error.includes("Deferred resource requires a capabilityOwner")));
});

test("rejects unknown source resources and target owners", () => {
  const candidate = matrix();
  candidate.skillDispositions[0].resourceDispositions = [resource({ source: "references/missing.md" })];
  let errors = validateGuidanceMigration(inputs({ matrix: candidate }));
  assert.ok(errors.some((error) => error.includes("Unknown source resource")));

  candidate.skillDispositions[0].resourceDispositions = [
    resource({ targets: ["owner:unknown-skill/references/rule.md"] }),
  ];
  errors = validateGuidanceMigration(inputs({ matrix: candidate }));
  assert.ok(errors.some((error) => error.includes("Unknown target owner")));
});

test("completed design guidance mappings retain only packaged or deferred ownership", async () => {
  const { matrix, sourceResources } = collectGuidanceMigrationInputs(root);
  const completed = new Map(
    matrix.skillDispositions
      .filter(({ source }) => ["azure-adr", "azure-defaults", "azure-rbac", "microsoft-docs"].includes(source))
      .map((entry) => [entry.source, entry]),
  );

  assert.deepEqual([...completed.keys()].sort(), ["azure-adr", "azure-defaults", "azure-rbac", "microsoft-docs"]);
  for (const entry of completed.values()) assert.equal(entry.lifecycle, "complete");
  assert.deepEqual(completed.get("azure-rbac").resourceDispositions, []);
  assert.deepEqual(completed.get("microsoft-docs").resourceDispositions, []);
  assert.deepEqual(
    new Set(completed.get("azure-adr").resourceDispositions.map(({ source }) => source)),
    sourceResources.get("azure-adr"),
  );
  assert.deepEqual(
    new Set(completed.get("azure-defaults").resourceDispositions.map(({ source }) => source)),
    sourceResources.get("azure-defaults"),
  );
  assert.ok(
    completed
      .get("azure-defaults")
      .resourceDispositions.some(
        ({ source, disposition, targets }) =>
          source === "references/service-matrices.md" &&
          disposition === "adapt" &&
          targets.includes("references/decision-boundaries.md"),
      ),
  );
  const manifest = JSON.parse(await readFile(resolve(root, "customizations/manifest.json"), "utf8"));
  assert.ok(manifest.managedFiles.includes(".github/skills/apex-azure-defaults/references/decision-boundaries.md"));
});
