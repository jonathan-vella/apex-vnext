import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  collectConsumerEvidence,
  parseAggregate,
  validateRepositoryValidatorGraph,
} from "../scripts/validate-repository-validator-graph.mjs";

const schema = JSON.parse(
  readFileSync(new URL("../registry/schemas/repository-validator-graph.schema.json", import.meta.url), "utf8"),
);

const graph = {
  schemaVersion: "1.0.0",
  profiles: [
    {
      id: "deterministic-validation",
      category: "validation",
      owner: "Validation engineering",
      inputs: ["repository configuration"],
      ciSafety: "safe",
      parallelSafety: "safe",
    },
  ],
  commands: [
    {
      id: "build-vnext",
      script: "build:vnext",
      profile: "deterministic-validation",
      aliases: [],
      retirement: { status: "active", replacementIds: [] },
    },
    {
      id: "validate-example",
      script: "validate:example",
      profile: "deterministic-validation",
      aliases: ["lint:example"],
      retirement: { status: "active", replacementIds: [] },
    },
  ],
  aggregates: [
    {
      id: "validate-node-ci",
      script: "validate:_node-ci",
      prerequisites: ["build:vnext"],
      members: ["validate:example"],
      continueOnError: false,
      epilogue: null,
    },
  ],
  consumers: [
    {
      id: "ci-main",
      kind: "github-actions",
      path: ".github/workflows/ci.yml",
      name: "ci",
      script: "validate:_node-ci",
    },
  ],
};

const scripts = {
  "build:vnext": "tsc -b",
  "validate:example": "node example.mjs",
  "lint:example": "node example.mjs",
  "validate:_node-ci": "npm run build:vnext && run-p validate:example",
};

const options = { graph, schema, scripts, consumers: { "ci-main": "validate:_node-ci" } };

test("parses prerequisites, parallel members, continue-on-error, and epilogue", () => {
  assert.deepEqual(parseAggregate("npm run build:vnext && run-p validate:a validate:b"), {
    prerequisites: ["build:vnext"],
    members: ["validate:a", "validate:b"],
    continueOnError: false,
    epilogue: null,
  });
  assert.deepEqual(parseAggregate("run-p --continue-on-error validate:a validate:b && echo done"), {
    prerequisites: [],
    members: ["validate:a", "validate:b"],
    continueOnError: true,
    epilogue: "echo done",
  });
});

test("valid repository validator graph passes", () => {
  assert.deepEqual(validateRepositoryValidatorGraph(options), []);
});

test("collects read-only workflow and hook consumer evidence", () => {
  const evidence = collectConsumerEvidence(graph, () => "name: ci\nrun: npm run validate:_node-ci\n");
  assert.deepEqual(evidence, { "ci-main": "validate:_node-ci" });
});

test("rejects aggregate, alias, safety, retirement, and consumer drift", () => {
  const invalid = structuredClone(graph);
  invalid.profiles[0].ciSafety = "conditional";
  invalid.profiles[0].parallelSafety = "serial-only";
  invalid.commands[1].retirement = { status: "retired", replacementIds: [] };
  const errors = validateRepositoryValidatorGraph({
    ...options,
    graph: invalid,
    scripts: { ...scripts, "lint:example": "node other.mjs", "validate:_node-ci": "run-p validate:example" },
    consumers: { "ci-main": "validate:other" },
  });
  assert.ok(errors.some((error) => error.includes("alias implementation drift")));
  assert.ok(errors.some((error) => error.includes("retired command requires a replacement")));
  assert.ok(errors.some((error) => error.includes("prerequisites drift")));
  assert.ok(errors.some((error) => error.includes("CI-unsafe dependency")));
  assert.ok(errors.some((error) => error.includes("parallel member is serial-only")));
  assert.ok(errors.some((error) => error.includes("expected validate:_node-ci")));
});

test("rejects aggregate dependency cycles and missing consumer evidence", () => {
  const invalid = structuredClone(graph);
  invalid.aggregates.push({
    id: "validate-loop",
    script: "validate:loop",
    prerequisites: [],
    members: ["validate:_node-ci"],
    continueOnError: false,
    epilogue: null,
  });
  invalid.aggregates[0].members = ["validate:loop"];
  const errors = validateRepositoryValidatorGraph({
    ...options,
    graph: invalid,
    scripts: {
      ...scripts,
      "validate:_node-ci": "run-p validate:loop",
      "validate:loop": "run-p validate:_node-ci",
    },
    consumers: {},
  });
  assert.ok(errors.some((error) => error.includes("aggregate dependency cycle")));
  assert.ok(errors.some((error) => error.includes("consumer evidence is missing")));
});
