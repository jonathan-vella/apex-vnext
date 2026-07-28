#!/usr/bin/env node
/** Validate the canonical client outcome scenario corpus without runtime build dependencies. */

import fs from "node:fs";
import { parseStrictJson } from "./_lib/strict-json.mjs";

const CORPUS_PATH = "tools/registry/client-outcome-scenarios.v1.json";
const TOOLCHAIN_PATH = "config/toolchain.v1.json";
const EXPECTED_IDS = Array.from({ length: 10 }, (_, index) => `CLIENT-${String(index + 1).padStart(3, "0")}`);
const ALLOWED_PATHS = new Set([
  "/candidate",
  "/execution/projectId",
  "/execution/workflowNode",
  "/execution/taskState",
  "/execution/semanticJournalHash",
  "/execution/ownerEpoch",
  "/observations/gates",
  "/observations/artifacts",
  "/observations/evidence",
  "/observations/denialCodes",
  "/observations/transfer",
  "/observations/assertions",
  "/disposition",
]);
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function validStringSet(values, pattern) {
  return (
    Array.isArray(values) && new Set(values).size === values.length && values.every((value) => pattern.test(value))
  );
}

export function validateClientOutcomeScenarios(corpus, toolchain) {
  const errors = [];
  if (corpus?.schemaVersion !== "1.0.0") errors.push("schemaVersion must be 1.0.0");
  if (!Array.isArray(corpus?.scenarios)) return [...errors, "scenarios must be an array"];
  const ids = corpus.scenarios.map(({ id }) => id);
  if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_IDS))
    errors.push("scenario IDs must be CLIENT-001 through CLIENT-010 in order");
  for (const scenario of corpus.scenarios) {
    for (const field of ["requiredAssertions", "requiredArtifacts", "requiredEvidence"]) {
      if (!validStringSet(scenario[field], IDENTIFIER_PATTERN)) errors.push(`${scenario.id}: ${field} is invalid`);
    }
    if (!validStringSet(scenario.requiredDenialCodes, CODE_PATTERN))
      errors.push(`${scenario.id}: requiredDenialCodes is invalid`);
    if (
      !Array.isArray(scenario.requiredGates) ||
      new Set(scenario.requiredGates).size !== scenario.requiredGates.length ||
      scenario.requiredGates.some((gate) => !Number.isInteger(gate) || gate < 1 || gate > 4)
    ) {
      errors.push(`${scenario.id}: requiredGates is invalid`);
    }
    const pointers = scenario.equalityPaths;
    if (
      !Array.isArray(pointers) ||
      pointers.length === 0 ||
      new Set(pointers).size !== pointers.length ||
      pointers.some((pointer) => !ALLOWED_PATHS.has(pointer)) ||
      pointers.some((pointer, index) =>
        pointers.some((other, otherIndex) => index !== otherIndex && other.startsWith(`${pointer}/`)),
      )
    ) {
      errors.push(`${scenario.id}: equalityPaths is invalid`);
    }
    if (
      !["succeeded", "denied", "not-applicable"].includes(scenario.transferPredicate?.result) ||
      !Number.isInteger(scenario.transferPredicate?.ownerEpochDelta)
    ) {
      errors.push(`${scenario.id}: transferPredicate is invalid`);
    }
    if (!["completed", "failed", "blocked", "unavailable"].includes(scenario.expectedTaskState)) {
      errors.push(`${scenario.id}: expectedTaskState is invalid`);
    }
  }
  const vscode = toolchain?.core?.vscode;
  const cli = toolchain?.core?.copilotCli;
  const expectedVscodeVersion = vscode?.selectedExactVersion ?? vscode?.postCutoffObservation?.version;
  const expectedExtensionVersion =
    vscode?.selectedExactCopilotChatVersion ?? vscode?.postCutoffObservation?.copilotChatVersion;
  if (
    corpus.fixtureClients?.vscodeVersion !== expectedVscodeVersion ||
    corpus.fixtureClients?.vscodeExtensionVersion !== expectedExtensionVersion ||
    corpus.fixtureClients?.cliVersion !== cli?.selectedExactVersion ||
    corpus.fixtureClients?.cliArtifactHash !== cli?.releaseArtifact?.sha256
  ) {
    errors.push("fixtureClients must match canonical toolchain fixture and pinned values");
  }
  return errors;
}

function main() {
  const corpus = parseStrictJson(fs.readFileSync(CORPUS_PATH, "utf8"));
  const toolchain = parseStrictJson(fs.readFileSync(TOOLCHAIN_PATH, "utf8"));
  const errors = validateClientOutcomeScenarios(corpus, toolchain);
  if (errors.length > 0) {
    errors.forEach((error) => console.error(`❌ ${CORPUS_PATH}: ${error}`));
    return 1;
  }
  console.log("✅ Client outcome scenario corpus is valid");
  return 0;
}

if (process.argv[1]?.endsWith("validate-client-outcome-scenarios.mjs")) process.exitCode = main();
