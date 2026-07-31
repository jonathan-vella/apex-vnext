import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateActiveConsumers, validateDiagramSemantics } from "../scripts/validate-diagram-semantics.mjs";

const registry = JSON.parse(readFileSync("tools/registry/diagram-semantics.v1.json", "utf8"));
const schema = JSON.parse(readFileSync("tools/registry/schemas/diagram-semantics.schema.json", "utf8"));
const mutate = (callback) => {
  const value = structuredClone(registry);
  callback(value);
  return value;
};

test("all legacy golden scenarios have format-neutral semantic coverage", () => {
  assert.deepEqual(validateDiagramSemantics(registry, schema), []);
});

test("routing, format, authority, accessibility, and scenario drift fail closed", () => {
  for (const mutation of [
    (value) => (value.routing.inline.owner = "python-diagrams"),
    (value) => value.routing.standalone.outputClasses.pop(),
    (value) => value.routing.standalone.formats.push("mmd"),
    (value) => (value.authority.activeConsumersMigrated = false),
    (value) => (value.authority.migrationReady = false),
    (value) => (value.authority.maintainerParityOverride = false),
    (value) => (value.scenarios[0].accessibility.nodeLabelsRequired = false),
    (value) => (value.scenarios[0].outputClass = "unknown"),
    (value) => (value.scenarios[0].resources.minimum = 20),
    (value) => (value.scenarios[0].dimensions.minimumWidth = 5000),
    (value) => value.scenarios[0].nodes.pop(),
    (value) => (value.scenarios[0].nodes[1].id = value.scenarios[0].nodes[0].id),
    (value) => value.scenarios[0].edges.splice(1, 1),
    (value) => (value.scenarios[0].edges[0].source = "missing-node"),
    (value) => (value.scenarios[0].nodes[0].zone = "Missing Zone"),
    (value) => value.scenarios[2].legacyReconciliations.pop(),
    (value) => value.scenarios.pop(),
    (value) => (value.scenarios[1].id = value.scenarios[0].id),
  ]) {
    assert.ok(validateDiagramSemantics(mutate(mutation), schema).length > 0);
  }
});

test("known contradictory legacy fields are explicitly reconciled", () => {
  const runtime = registry.scenarios[2];
  assert.equal(runtime.outputClass, "runtime");
  assert.equal(runtime.diagramType, "runtime-flow");
  assert.equal(registry.scenarios[4].scope.managementGroups, 6);
  assert.deepEqual(registry.scenarios[5].resources, { minimum: 28, maximum: 32 });
});

test("required edge labels match exact slash-delimited segments", () => {
  const drifted = mutate((value) => {
    const sqlEdge = value.scenarios[0].edges.find((edge) => edge.label === "SQL");
    sqlEdge.label = "NoSQL";
  });

  assert.ok(
    validateDiagramSemantics(drifted, schema).includes(
      "g1-three-tier-web: required edge label SQL has no semantic edge",
    ),
  );
});

test("active consumers reject Draw.io output and missing Python markers", () => {
  const files = new Map(registry.activeConsumers.map(({ path }) => [path, readFileSync(path, "utf8")]));
  const designPrompt = registry.activeConsumers.find(({ id }) => id === "step-3-design-prompt");
  files.set(designPrompt.path, files.get(designPrompt.path).replaceAll("03-des-diagram.py", "03-des-diagram.drawio"));

  assert.deepEqual(
    validateActiveConsumers(registry.activeConsumers, (filePath) => files.get(filePath)),
    [
      "step-3-design-prompt: active consumer references retired Draw.io output",
      "step-3-design-prompt: required marker 03-des-diagram.py is missing",
    ],
  );
});

test("zones, edge labels, scope, pages, and resource bounds fail closed", () => {
  for (const [field, replacement] of [
    ["zones", []],
    ["edgeLabels", ["Unknown Edge"]],
    ["scope", { subscriptions: -1, regions: 1, managementGroups: 0 }],
    ["pages", 0],
    ["resources", { minimum: 2, maximum: 1 }],
  ]) {
    const drifted = mutate((value) => {
      value.scenarios[0][field] = replacement;
    });
    assert.ok(validateDiagramSemantics(drifted, schema).length > 0);
  }
});
