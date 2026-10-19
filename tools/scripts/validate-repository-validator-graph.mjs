#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { load } from "js-yaml";
import { reportRegistryValidation, requestedReportFormat } from "./_lib/registry-validator-reporter.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GRAPH_REL_PATH = "tools/registry/repository-validator-graph.json";
const GRAPH_PATH = path.join(repoRoot, GRAPH_REL_PATH);
const SCHEMA_PATH = path.join(repoRoot, "tools/registry/schemas/repository-validator-graph.schema.json");
const PACKAGE_JSON_PATH = path.join(repoRoot, "package.json");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function stripShellComments(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/u.test(line))
    .map((line) => line.replace(/\s+#.*$/u, ""))
    .join("\n");
}

function hasScriptToken(text, script) {
  if (typeof text !== "string") return false;
  const pattern = new RegExp(`(?:^|[\\s;&|()])npm\\s+run\\s+${escapeRegExp(script)}(?=$|[\\s;&|()])`, "mu");
  return pattern.test(stripShellComments(text));
}

function isActiveYamlCondition(condition) {
  if (condition === false) return false;
  if (typeof condition !== "string") return true;
  let expr = condition.trim();
  const match = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/u.exec(expr);
  if (match !== null) expr = match[1].trim();
  while (expr.startsWith("(") && expr.endsWith(")")) {
    expr = expr.slice(1, -1).trim();
  }
  return expr.toLowerCase() !== "false";
}

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
  const runnerMatch = /\brun-([ps])\s/.exec(pipeline);
  if (runnerMatch === null) return null;
  const runnerIndex = runnerMatch.index;
  const prerequisiteText = pipeline.slice(0, runnerIndex).replace(/ && $/, "").trim();
  const tokens = pipeline.slice(runnerIndex).split(" ");
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
  unique(
    errors,
    (graph.excludedScripts ?? []).map(({ script }) => script),
    "excluded scripts",
  );

  const profiles = new Map(graph.profiles.map((profile) => [profile.id, profile]));
  const commands = new Map(graph.commands.map((command) => [command.script, command]));
  const commandIds = new Set(graph.commands.map(({ id }) => id));
  const aliases = new Set(graph.commands.flatMap(({ aliases: values }) => values));
  const aggregates = new Map(graph.aggregates.map((aggregate) => [aggregate.script, aggregate]));
  const excludedScripts = new Set((graph.excludedScripts ?? []).map(({ script }) => script));

  const visiting = new Set();
  const visited = new Set();
  function visitAggregate(script) {
    if (visiting.has(script)) {
      errors.push(`aggregate dependency cycle includes ${script}`);
      return;
    }
    if (visited.has(script)) return;
    visiting.add(script);
    const aggregate = aggregates.get(script);
    for (const dependency of [...(aggregate?.prerequisites ?? []), ...(aggregate?.members ?? [])]) {
      if (aggregates.has(dependency)) visitAggregate(dependency);
    }
    visiting.delete(script);
    visited.add(script);
  }
  for (const script of aggregates.keys()) visitAggregate(script);

  function nestedCommands(script, seen = new Set()) {
    if (seen.has(script)) return [];
    seen.add(script);
    const aggregate = aggregates.get(script);
    if (aggregate === undefined) return commands.has(script) ? [script] : [];
    return [...aggregate.prerequisites, ...aggregate.members].flatMap((dependency) => nestedCommands(dependency, seen));
  }

  for (const command of graph.commands) {
    if (!profiles.has(command.profile)) errors.push(`${command.script}: unknown profile ${command.profile}`);
    if (scripts[command.script] === undefined) errors.push(`${command.script}: package script is missing`);
    const canonicalDelegate = scripts[command.script]?.match(/^npm run ([a-z0-9:_-]+)(?:\s|$)/u)?.[1];
    if (canonicalDelegate !== undefined && aliases.has(canonicalDelegate)) {
      errors.push(`${command.script}: canonical script delegates to alias ${canonicalDelegate}`);
    }
    for (const alias of command.aliases) {
      if (scripts[alias] === undefined)
        errors.push(`${command.script}: alias is missing from package scripts: ${alias}`);
      else if (scripts[alias] !== `npm run ${command.script} --`)
        errors.push(`${command.script}: alias delegation drift: ${alias}`);
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
      if (
        packageCommand.includes("run-p ") &&
        aggregate.members.includes(script) &&
        profile?.parallelSafety === "serial-only"
      ) {
        errors.push(`${aggregate.script}: parallel member is serial-only: ${script}`);
      }
    }
    if (aggregate.script === "validate:_node-ci") {
      for (const script of nestedCommands(aggregate.script)) {
        const command = commands.get(script);
        if (profiles.get(command?.profile)?.ciSafety !== "safe") {
          errors.push(`${aggregate.script}: CI-unsafe dependency ${script}`);
        }
      }
    }
  }

  for (const consumer of graph.consumers) {
    const value = consumers[consumer.id];
    if (value === undefined || value === null) errors.push(`${consumer.id}: consumer evidence is missing`);
    else if (value !== consumer.script) errors.push(`${consumer.id}: expected ${consumer.script}, found ${value}`);
  }

  for (const excluded of graph.excludedScripts ?? []) {
    if (scripts[excluded.script] === undefined) {
      errors.push(`${excluded.script}: excluded package script is missing`);
    }
    if (commands.has(excluded.script) || aggregates.has(excluded.script) || aliases.has(excluded.script)) {
      errors.push(`${excluded.script}: excluded script is already registered in graph`);
    }
  }

  const accountedScripts = new Set([...commands.keys(), ...aggregates.keys(), ...aliases, ...excludedScripts]);
  for (const script of Object.keys(scripts)) {
    if (/^(?:validate|lint):/u.test(script) && !accountedScripts.has(script)) {
      errors.push(`${script}: package validation/lint script is not registered in graph`);
    }
  }

  return errors;
}

function matchesWorkflowConsumer(content, consumer) {
  const doc = load(content);
  if (!doc || typeof doc !== "object" || !doc.jobs || typeof doc.jobs !== "object") return false;
  for (const [jobKey, job] of Object.entries(doc.jobs)) {
    if (!job || typeof job !== "object" || !isActiveYamlCondition(job.if)) continue;
    const jobMatches = jobKey === consumer.name || job.name === consumer.name;
    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const step of steps) {
      if (!step || typeof step !== "object" || !isActiveYamlCondition(step.if)) continue;
      if ((jobMatches || step.name === consumer.name) && hasScriptToken(step.run, consumer.script)) {
        return true;
      }
    }
  }
  return false;
}

function matchesNonWorkflowConsumer(content, consumer) {
  const uncommented = stripShellComments(content);
  const namePattern = new RegExp(`(?:^|\\n)\\s*(?:name:\\s*)?${escapeRegExp(consumer.name)}\\s*:?(?:\\s|$)`, "mu");
  return namePattern.test(uncommented) && hasScriptToken(uncommented, consumer.script);
}

export function collectConsumerEvidence(
  graph,
  read = (filePath, encoding) => readFileSync(path.resolve(repoRoot, filePath), encoding),
) {
  return Object.fromEntries(
    graph.consumers.map((consumer) => {
      try {
        const content = read(consumer.path, "utf8");
        const isWorkflow =
          consumer.kind === "github-actions" || /^\.github\/workflows\/.+\.ya?ml$/u.test(consumer.path);
        const matched = isWorkflow
          ? matchesWorkflowConsumer(content, consumer)
          : matchesNonWorkflowConsumer(content, consumer);
        return [consumer.id, matched ? consumer.script : null];
      } catch {
        return [consumer.id, null];
      }
    }),
  );
}

function main() {
  const graph = JSON.parse(readFileSync(GRAPH_PATH, "utf8"));
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const scripts = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")).scripts ?? {};
  const consumers = collectConsumerEvidence(graph);
  const errors = validateRepositoryValidatorGraph({ graph, schema, scripts, consumers });
  process.exitCode = reportRegistryValidation({
    title: "Repository Validator Graph Validator",
    source: GRAPH_REL_PATH,
    errors,
    passMessage: "Repository validator dependency graph is valid",
    format: requestedReportFormat(process.argv.slice(2)),
  });
}

if (process.argv[1]?.endsWith("validate-repository-validator-graph.mjs")) main();
