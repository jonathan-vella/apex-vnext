#!/usr/bin/env node

import { readFileSync } from "node:fs";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";

const GRAPH_PATH = "tools/registry/repository-validator-graph.json";
const SCHEMA_PATH = "tools/registry/schemas/repository-validator-graph.schema.json";

function unique(errors, values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) errors.push(`${label} must be unique: ${value}`);
    seen.add(value);
  }
}

export function parseAggregate(command) {
  const normalized = command.trim().replace(/\s+/g, " ");
  const epilogueIndex = normalized.lastIndexOf(" && echo ");
  const epilogue = epilogueIndex === -1 ? null : normalized.slice(epilogueIndex + 4);
  const pipeline = epilogueIndex === -1 ? normalized : normalized.slice(0, epilogueIndex);
  const runParallelIndex = pipeline.indexOf("run-p ");
  if (runParallelIndex === -1) return null;
  const prerequisiteText = pipeline.slice(0, runParallelIndex).replace(/ && $/, "").trim();
  const tokens = pipeline.slice(runParallelIndex).split(" ");
  const prerequisites = [];
  if (prerequisiteText.length > 0) {
    for (const prerequisite of prerequisiteText.split(" && ")) {
      const match = prerequisite.match(/^npm run ([a-z0-9:_-]+)$/);
      if (match === null) return null;
      prerequisites.push(match[1]);
    }
  }
  let runIndex = 1;
  const continueOnError = tokens[runIndex] === "--continue-on-error";
  if (continueOnError) runIndex += 1;
  return { prerequisites, members: tokens.slice(runIndex), continueOnError, epilogue };
}

export function validateRepositoryValidatorGraph({ graph, schema, scripts, consumers = {} }) {
  const errors = [];
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  if (!ajv.validate(schema, graph)) {
    return (ajv.errors ?? []).map((error) => `schema ${error.instancePath || "/"}: ${error.message}`);
  }

  unique(
    errors,
    graph.profiles.map(({ id }) => id),
    "profile IDs",
  );
  unique(
    errors,
    graph.commands.map(({ id }) => id),
    "command IDs",
  );
  unique(
    errors,
    graph.commands.map(({ script }) => script),
    "command scripts",
  );
  unique(
    errors,
    graph.commands.flatMap(({ aliases }) => aliases),
    "aliases",
  );
  unique(
    errors,
    graph.aggregates.map(({ id }) => id),
    "aggregate IDs",
  );
  unique(
    errors,
    graph.aggregates.map(({ script }) => script),
    "aggregate scripts",
  );
  unique(
    errors,
    graph.consumers.map(({ id }) => id),
    "consumer IDs",
  );

  const profiles = new Map(graph.profiles.map((profile) => [profile.id, profile]));
  const commands = new Map(graph.commands.map((command) => [command.script, command]));
  const commandIds = new Set(graph.commands.map(({ id }) => id));
  const aggregates = new Map(graph.aggregates.map((aggregate) => [aggregate.script, aggregate]));

  const visiting = new Set();
  const visited = new Set();
  function visitAggregate(script) {
    if (visiting.has(script)) {
      errors.push(`aggregate dependency cycle includes ${script}`);
      return;
    }
    if (visited.has(script)) return;
    visiting.add(script);
    for (const member of aggregates.get(script)?.members ?? []) {
      if (aggregates.has(member)) visitAggregate(member);
    }
    visiting.delete(script);
    visited.add(script);
  }
  for (const script of aggregates.keys()) visitAggregate(script);

  for (const command of graph.commands) {
    if (!profiles.has(command.profile)) errors.push(`${command.script}: unknown profile ${command.profile}`);
    if (scripts[command.script] === undefined) errors.push(`${command.script}: package script is missing`);
    for (const alias of command.aliases) {
      if (scripts[alias] === undefined)
        errors.push(`${command.script}: alias is missing from package scripts: ${alias}`);
      else if (scripts[alias] !== scripts[command.script])
        errors.push(`${command.script}: alias implementation drift: ${alias}`);
    }
    for (const replacementId of command.retirement.replacementIds) {
      if (!commandIds.has(replacementId))
        errors.push(`${command.script}: unknown retirement replacement ${replacementId}`);
    }
    if (command.retirement.status !== "active" && command.retirement.replacementIds.length === 0) {
      errors.push(`${command.script}: ${command.retirement.status} command requires a replacement`);
    }
  }

  for (const aggregate of graph.aggregates) {
    const packageCommand = scripts[aggregate.script];
    if (packageCommand === undefined) {
      errors.push(`${aggregate.script}: aggregate package script is missing`);
      continue;
    }
    const actual = parseAggregate(packageCommand);
    if (actual === null) {
      errors.push(`${aggregate.script}: unsupported aggregate syntax`);
      continue;
    }
    for (const field of ["prerequisites", "members"]) {
      if (JSON.stringify(actual[field]) !== JSON.stringify(aggregate[field])) {
        errors.push(`${aggregate.script}: ${field} drift from package script`);
      }
    }
    if (actual.continueOnError !== aggregate.continueOnError) {
      errors.push(`${aggregate.script}: continue-on-error drift from package script`);
    }
    if (actual.epilogue !== aggregate.epilogue) errors.push(`${aggregate.script}: epilogue drift from package script`);
    for (const script of [...aggregate.prerequisites, ...aggregate.members]) {
      const command = commands.get(script);
      const nested = aggregates.has(script);
      if (command === undefined && !nested) errors.push(`${aggregate.script}: unknown dependency ${script}`);
      if (command?.retirement.status === "retired")
        errors.push(`${aggregate.script}: depends on retired command ${script}`);
      const profile = command === undefined ? null : profiles.get(command.profile);
      if (aggregate.script === "validate:_node-ci" && profile?.ciSafety !== "safe") {
        errors.push(`${aggregate.script}: CI-unsafe dependency ${script}`);
      }
      if (aggregate.members.includes(script) && profile?.parallelSafety === "serial-only") {
        errors.push(`${aggregate.script}: parallel member is serial-only: ${script}`);
      }
    }
  }

  for (const consumer of graph.consumers) {
    const value = consumers[consumer.id];
    if (value === undefined) errors.push(`${consumer.id}: consumer evidence is missing`);
    else if (value !== consumer.script) errors.push(`${consumer.id}: expected ${consumer.script}, found ${value}`);
  }

  return errors;
}

export function collectConsumerEvidence(graph, read = readFileSync) {
  return Object.fromEntries(
    graph.consumers.map((consumer) => {
      const content = read(consumer.path, "utf8");
      const hasName = content.includes(`name: ${consumer.name}`) || content.includes(`${consumer.name}:`);
      const hasScript = content.includes(`npm run ${consumer.script}`);
      return [consumer.id, hasName && hasScript ? consumer.script : null];
    }),
  );
}

function main() {
  const graph = JSON.parse(readFileSync(GRAPH_PATH, "utf8"));
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
  const consumers = collectConsumerEvidence(graph);
  const errors = validateRepositoryValidatorGraph({ graph, schema, scripts, consumers });
  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Repository validator dependency graph is valid");
  }
}

if (process.argv[1]?.endsWith("validate-repository-validator-graph.mjs")) main();
