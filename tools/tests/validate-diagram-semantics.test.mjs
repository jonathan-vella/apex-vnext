import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateDiagramSemantics } from "../scripts/validate-diagram-semantics.mjs";

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
    (value) => (value.routing.inline.owner = "drawio"),
    (value) => value.routing.standalone.outputClasses.pop(),
    (value) => value.routing.standalone.formats.push("drawio"),
    (value) => (value.routing.transitional.newOutputAllowed = true),
    (value) => (value.authority.migrationReady = true),
    (value) => (value.authority.drawioRemovalAllowed = true),
    (value) => (value.scenarios[0].accessibility.nodeLabelsRequired = false),
    (value) => (value.scenarios[0].outputClass = "unknown"),
    (value) => (value.scenarios[0].resources.minimum = 20),
    (value) => (value.scenarios[0].dimensions.minimumWidth = 5000),
    (value) => value.scenarios[0].nodes.pop(),
    (value) => (value.scenarios[0].nodes[1].id = value.scenarios[0].nodes[0].id),
    (value) => value.scenarios[0].edges.splice(1, 1),
    (value) => (value.scenarios[0].edges[0].source = "missing-node"),
    (value) => (value.scenarios[0].nodes[0].zone = "Missing Zone"),
    (value) => (value.scenarios[0].nodes[1].label = "Changed Plan Label"),
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

test("legacy zones, edge labels, scope, pages, and resource bounds cannot drift", () => {
  for (const [field, replacement] of [
    ["zones", ["Unknown Zone"]],
    ["edgeLabels", ["Unknown Edge"]],
    ["scope", { subscriptions: 9, regions: 9, managementGroups: 9 }],
    ["pages", 2],
    ["resources", { minimum: 1, maximum: 2 }],
  ]) {
    const drifted = mutate((value) => {
      value.scenarios[0][field] = replacement;
    });
    assert.ok(validateDiagramSemantics(drifted, schema).some((error) => error.includes("g1-three-tier-web")));
  }
});
