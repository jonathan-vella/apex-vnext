#!/usr/bin/env node
/** Compare client outcomes and aggregate all required live comparisons. */

import { pathToFileURL } from "node:url";
import {
  CLIENT_OUTCOME_SCENARIO_IDS,
  ClientOutcomeComparisonV1Schema,
  ClientOutcomeQualificationV1Schema,
  ClientOutcomeV1Schema,
  contractMetadata,
} from "../../packages/contracts/dist/index.js";
import { canonicalJson, sha256Json } from "../../packages/kernel/dist/index.js";
import { createAjv } from "./_lib/ajv-validator.mjs";
import {
  CLIENT_OUTCOME_SCENARIO_CORPUS,
  CLIENT_OUTCOME_SCENARIO_CORPUS_HASH,
  CLIENT_OUTCOME_TOOLCHAIN,
  CLIENT_OUTCOME_TOOLCHAIN_HASH,
  assertClientOutcomeContentFree,
  calculateOutcomeId,
  readBoundedJson,
  sanitizedClientOutcomeError,
} from "./collect-client-outcome.mjs";

const RAW_EXECUTION_FIELDS = new Set(["runId", "taskId", "rawJournalHead", "rawJournalSourceDigest"]);
const OUTCOME_SCHEMA_ID = "https://schemas.apexops.dev/client-outcome-v1.json";
const validateClientOutcome = createAjv().compile(ClientOutcomeV1Schema);
const validateComparison = createAjv().compile(ClientOutcomeComparisonV1Schema);
const validateQualification = createAjv().compile(ClientOutcomeQualificationV1Schema);

function sortedRecord(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

export function normalizeClientOutcome(outcome) {
  const execution = Object.fromEntries(
    Object.entries(outcome.execution).filter(([key]) => !RAW_EXECUTION_FIELDS.has(key)),
  );
  return {
    candidate: sortedRecord(outcome.candidate),
    execution,
    observations: {
      gates: [...outcome.observations.gates].sort((left, right) => left.gate - right.gate),
      artifacts: sortedRecord(outcome.observations.artifacts),
      evidence: sortedRecord(outcome.observations.evidence),
      denialCodes: [...outcome.observations.denialCodes].sort(),
      transfer: outcome.observations.transfer,
      assertions: sortedRecord(outcome.observations.assertions),
    },
    disposition: outcome.disposition,
  };
}

function collectMismatches(left, right, path = "") {
  if (
    left === undefined ||
    right === undefined ||
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return left === right ? [] : [path || "/"];
  }
  if (canonicalJson(left) === canonicalJson(right)) return [];
  if (Array.isArray(left)) {
    const paths = [];
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      paths.push(...collectMismatches(left[index], right[index], `${path}/${index}`));
    }
    return paths;
  }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.flatMap((key) => collectMismatches(left[key], right[key], `${path}/${key}`));
}

function valueAtPointer(value, pointer) {
  return pointer
    .slice(1)
    .split("/")
    .reduce((current, segment) => current?.[segment], value);
}

function comparisonStatus(blockers, mismatches) {
  if (blockers.some((code) => code.endsWith("_UNAVAILABLE"))) return "unavailable";
  return blockers.length > 0 || mismatches.length > 0 ? "fail" : "pass";
}

function comparisonBinding(vscode, cli) {
  const binding = {
    candidateId: sha256Json(vscode.candidate),
    toolchainHash: vscode.candidate.toolchainHash,
    clients: {
      vscodeVersion: vscode.client.version,
      vscodeExtensionVersion: vscode.client.extensionVersion,
      cliVersion: cli.client.version,
    },
  };
  if (vscode.evidenceKind === "live" && cli.evidenceKind === "live") {
    binding.clients.vscodeHostSha256 = vscode.client.binarySha256;
    binding.clients.cliBinarySha256 = cli.client.binarySha256;
  }
  return binding;
}

function assertOutcomeBinding(outcome) {
  if (outcome.candidate.scenarioCorpusHash !== CLIENT_OUTCOME_SCENARIO_CORPUS_HASH) {
    throw new TypeError("OUTCOME_CORPUS_BINDING_INVALID");
  }
  if (outcome.candidate.toolchainHash !== CLIENT_OUTCOME_TOOLCHAIN_HASH) {
    throw new TypeError("OUTCOME_TOOLCHAIN_BINDING_INVALID");
  }
  const fixture = CLIENT_OUTCOME_SCENARIO_CORPUS.fixtureClients;
  if (outcome.evidenceKind === "live") {
    const policy = CLIENT_OUTCOME_TOOLCHAIN.clientQualificationPolicy;
    if (
      policy?.mode !== "rolling-observed" ||
      policy.preference !== "latest-stable-supported" ||
      policy.versionBinding !== "observed-per-candidate" ||
      policy.extensionVersionBinding !== "observed-per-candidate" ||
      policy.binaryBinding !== "sha256-per-candidate" ||
      policy.historicalFixtures !== "immutable" ||
      policy.autoUpdateBetweenCandidates !== true ||
      !/^[0-9a-f]{64}$/u.test(outcome.client.binarySha256 ?? "") ||
      (outcome.client.id === "github-copilot-vscode" && outcome.client.extensionVersion === undefined) ||
      (outcome.client.id === "github-copilot-cli" && outcome.client.extensionVersion !== undefined)
    ) {
      throw new TypeError("LIVE_CLIENT_BINDING_INVALID");
    }
  } else if (
    (outcome.client.id === "github-copilot-vscode" &&
      (outcome.client.version !== fixture.vscodeVersion ||
        outcome.client.extensionVersion !== fixture.vscodeExtensionVersion)) ||
    (outcome.client.id === "github-copilot-cli" &&
      (outcome.client.version !== fixture.cliVersion || outcome.client.extensionVersion !== undefined))
  ) {
    throw new TypeError("FIXTURE_CLIENT_VERSION_MISMATCH");
  }
}

export function calculateComparisonId(comparison) {
  const { comparisonId: _comparisonId, ...content } = comparison;
  return sha256Json(content);
}

export function compareClientOutcomes(first, second) {
  const outcomes = [first, second];
  for (const outcome of outcomes) {
    assertClientOutcomeContentFree(outcome);
    if (!validateClientOutcome(outcome)) throw new TypeError("OUTCOME_SCHEMA_INVALID");
    if (outcome.outcomeId !== calculateOutcomeId(outcome)) throw new TypeError("OUTCOME_ID_INVALID");
    assertOutcomeBinding(outcome);
  }

  const vscode = outcomes.find(({ client }) => client.id === "github-copilot-vscode");
  const cli = outcomes.find(({ client }) => client.id === "github-copilot-cli");
  const blockers = [];
  if (vscode === undefined || cli === undefined || vscode === cli) blockers.push("CLIENT_PAIR_INVALID");
  if (first.scenarioId !== second.scenarioId) blockers.push("SCENARIO_BINDING_MISMATCH");
  if (first.evidenceKind !== second.evidenceKind) blockers.push("EVIDENCE_KIND_MISMATCH");
  const boundVscode = vscode ?? first;
  const boundCli = cli ?? second;
  const scenario = CLIENT_OUTCOME_SCENARIO_CORPUS.scenarios.find(({ id }) => id === first.scenarioId);
  if (scenario === undefined) throw new TypeError("SCENARIO_CORPUS_MISSING");
  const normalized = outcomes.map(normalizeClientOutcome);
  const mismatches = scenario.equalityPaths
    .flatMap((pointer) =>
      collectMismatches(valueAtPointer(normalized[0], pointer), valueAtPointer(normalized[1], pointer), pointer),
    )
    .sort();
  for (const outcome of outcomes) {
    const clientCode = outcome.client.id === "github-copilot-vscode" ? "VSCODE" : "CLI";
    if (outcome.disposition.status === "unavailable") blockers.push(`${clientCode}_OUTCOME_UNAVAILABLE`);
    if (outcome.disposition.status === "fail") blockers.push(`${clientCode}_OUTCOME_FAILED`);
  }
  const uniqueBlockers = [...new Set(blockers)].sort();
  const comparison = {
    schemaVersion: "1.0.0",
    scenarioId: first.scenarioId,
    evidenceKind: first.evidenceKind,
    outcomeIds: { vscode: boundVscode.outcomeId, cli: boundCli.outcomeId },
    binding: comparisonBinding(boundVscode, boundCli),
    status: comparisonStatus(uniqueBlockers, mismatches),
    qualifiesRelease: false,
    mismatches,
    blockers: uniqueBlockers,
  };
  const result = { ...comparison, comparisonId: sha256Json(comparison) };
  if (!validateComparison(result)) throw new TypeError("COMPARISON_SCHEMA_INVALID");
  return result;
}

export function verifyClientOutcomeComparison(comparison, first, second) {
  if (!validateComparison(comparison)) throw new TypeError("COMPARISON_SCHEMA_INVALID");
  if (comparison.comparisonId !== calculateComparisonId(comparison)) throw new TypeError("COMPARISON_ID_INVALID");
  const expected = compareClientOutcomes(first, second);
  if (canonicalJson(comparison) !== canonicalJson(expected)) throw new TypeError("COMPARISON_CONTENT_INVALID");
  return true;
}

export function calculateQualificationId(qualification) {
  const { qualificationId: _qualificationId, ...content } = qualification;
  return sha256Json(content);
}

function qualificationPolicy(context) {
  if (context !== undefined) {
    const fixture = CLIENT_OUTCOME_SCENARIO_CORPUS.fixtureClients;
    const expected = {
      mode: "fixture-only",
      scenarioIds: CLIENT_OUTCOME_SCENARIO_IDS,
      scenarioCorpusHash: CLIENT_OUTCOME_SCENARIO_CORPUS_HASH,
      toolchainHash: CLIENT_OUTCOME_TOOLCHAIN_HASH,
      clients: {
        vscodeVersion: fixture.vscodeVersion,
        vscodeExtensionVersion: fixture.vscodeExtensionVersion,
        cliVersion: fixture.cliVersion,
      },
    };
    if (canonicalJson(context) !== canonicalJson(expected))
      throw new TypeError("FIXTURE_QUALIFICATION_CONTEXT_INVALID");
    return { evidenceKind: "fixture", ...expected };
  }
  const policy = CLIENT_OUTCOME_TOOLCHAIN.clientQualificationPolicy;
  if (policy?.mode !== "rolling-observed" || policy.preference !== "latest-stable-supported") {
    throw new TypeError("LIVE_CLIENT_POLICY_INVALID");
  }
  return {
    evidenceKind: "live",
    scenarioIds: CLIENT_OUTCOME_SCENARIO_IDS,
    scenarioCorpusHash: CLIENT_OUTCOME_SCENARIO_CORPUS_HASH,
    toolchainHash: CLIENT_OUTCOME_TOOLCHAIN_HASH,
  };
}

export function qualifyClientOutcomes(triplets, context) {
  const policy = qualificationPolicy(context);
  if (!Array.isArray(triplets) || triplets.length !== CLIENT_OUTCOME_SCENARIO_IDS.length) {
    throw new TypeError("QUALIFICATION_SCENARIO_COUNT_INVALID");
  }
  const verified = triplets.map((triplet) => {
    if (
      triplet === null ||
      typeof triplet !== "object" ||
      Array.isArray(triplet) ||
      !Array.isArray(triplet.outcomes) ||
      triplet.outcomes.length !== 2
    ) {
      throw new TypeError("QUALIFICATION_TRIPLET_INVALID");
    }
    verifyClientOutcomeComparison(triplet.comparison, triplet.outcomes[0], triplet.outcomes[1]);
    if (triplet.comparison.status !== "pass") throw new TypeError("QUALIFICATION_COMPARISON_NOT_PASSING");
    return { comparison: triplet.comparison, outcomes: triplet.outcomes };
  });
  const ordered = [...verified].sort((left, right) =>
    left.comparison.scenarioId.localeCompare(right.comparison.scenarioId),
  );
  if (
    canonicalJson(ordered.map(({ comparison }) => comparison.scenarioId)) !== canonicalJson(CLIENT_OUTCOME_SCENARIO_IDS)
  ) {
    throw new TypeError("QUALIFICATION_SCENARIO_SET_INVALID");
  }
  const outcomeIds = ordered.flatMap(({ outcomes }) => outcomes.map(({ outcomeId }) => outcomeId));
  if (new Set(outcomeIds).size !== CLIENT_OUTCOME_SCENARIO_IDS.length * 2) {
    throw new TypeError("QUALIFICATION_OUTCOME_SET_INVALID");
  }
  const binding = ordered[0].comparison.binding;
  const evidenceKind = ordered[0].comparison.evidenceKind;
  if (
    evidenceKind !== policy.evidenceKind ||
    binding.toolchainHash !== policy.toolchainHash ||
    (policy.clients !== undefined && canonicalJson(binding.clients) !== canonicalJson(policy.clients)) ||
    ordered.some(({ outcomes }) =>
      outcomes.some(({ candidate }) => candidate.scenarioCorpusHash !== policy.scenarioCorpusHash),
    ) ||
    ordered.some(
      ({ comparison }) =>
        canonicalJson(comparison.binding) !== canonicalJson(binding) || comparison.evidenceKind !== evidenceKind,
    )
  ) {
    throw new TypeError("QUALIFICATION_BINDING_MISMATCH");
  }
  const qualification = {
    schemaVersion: "1.0.0",
    evidenceKind,
    binding,
    comparisons: ordered.map(({ comparison }) => ({
      scenarioId: comparison.scenarioId,
      comparisonId: comparison.comparisonId,
      outcomeIds: comparison.outcomeIds,
    })),
    status: "pass",
    matrixComplete: true,
    qualifiesClientParity: true,
    qualifiesRelease: false,
  };
  const result = { ...qualification, qualificationId: sha256Json(qualification) };
  if (!validateQualification(result)) throw new TypeError("QUALIFICATION_SCHEMA_INVALID");
  return result;
}

export function verifyClientOutcomeQualification(qualification, triplets, context) {
  if (!validateQualification(qualification)) throw new TypeError("QUALIFICATION_SCHEMA_INVALID");
  if (qualification.qualificationId !== calculateQualificationId(qualification)) {
    throw new TypeError("QUALIFICATION_ID_INVALID");
  }
  const expected = qualifyClientOutcomes(triplets, context);
  if (canonicalJson(qualification) !== canonicalJson(expected)) throw new TypeError("QUALIFICATION_CONTENT_INVALID");
  return true;
}

function main() {
  try {
    if (process.argv.length !== 4) throw new TypeError("USAGE_INVALID");
    const maxBytes = contractMetadata[OUTCOME_SCHEMA_ID].maxBytes;
    const outcomes = process.argv.slice(2).map((filePath) => readBoundedJson(filePath, maxBytes));
    process.stdout.write(`${canonicalJson(compareClientOutcomes(outcomes[0], outcomes[1]))}\n`);
    return 0;
  } catch (error) {
    console.error(`CLIENT_OUTCOME_COMPARISON_FAILED:${sanitizedClientOutcomeError(error)}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main();
