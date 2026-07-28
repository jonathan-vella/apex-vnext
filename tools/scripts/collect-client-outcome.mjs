#!/usr/bin/env node
/** Collect a canonical, content-free client outcome from structured evidence. */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  CLIENT_OUTCOME_CLIENT_IDS,
  CLIENT_OUTCOME_EQUALITY_PATHS,
  CLIENT_OUTCOME_SCENARIO_IDS,
  ClientOutcomeV1Schema,
  SECRET_FIELD_PATTERN,
  SECRET_VALUE_PATTERN,
  contractMetadata,
} from "../../packages/contracts/dist/index.js";
import { canonicalJson, sha256Json } from "../../packages/kernel/dist/index.js";
import { createAjv } from "./_lib/ajv-validator.mjs";
import { parseStrictJson } from "./_lib/strict-json.mjs";

const CORPUS_URL = new URL("../registry/client-outcome-scenarios.v1.json", import.meta.url);
const TOOLCHAIN_URL = new URL("../../config/toolchain.v1.json", import.meta.url);
const OUTCOME_SCHEMA_ID = "https://schemas.apexops.dev/client-outcome-v1.json";
const ZERO_HASH = "0".repeat(64);
const CONTENT_FIELD_PATTERN =
  /^(?:chat(?:log|history)?|content|conversation|instruction|message|prompt|response|raw[-_]?(?:output|text)|transcript)$/i;
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const SEMANTIC_EVENT_FIELDS = new Set([
  "type",
  "node",
  "taskState",
  "gate",
  "gateState",
  "artifact",
  "artifactHash",
  "evidence",
  "evidenceHash",
  "denialCode",
  "transferResult",
  "ownerEpochDelta",
  "assertion",
  "assertionState",
]);
const SEMANTIC_EVENT_RULES = {
  task: ["node", "taskState"],
  gate: ["gate", "gateState"],
  artifact: ["artifact", "artifactHash"],
  evidence: ["evidence", "evidenceHash"],
  denial: ["denialCode"],
  transfer: ["transferResult", "ownerEpochDelta"],
  assertion: ["assertion", "assertionState"],
};

export const CLIENT_OUTCOME_SCENARIO_CORPUS = parseStrictJson(fs.readFileSync(CORPUS_URL, "utf8"));
export const CLIENT_OUTCOME_SCENARIO_CORPUS_HASH = sha256Json(CLIENT_OUTCOME_SCENARIO_CORPUS);
export const CLIENT_OUTCOME_TOOLCHAIN = parseStrictJson(fs.readFileSync(TOOLCHAIN_URL, "utf8"));
export const CLIENT_OUTCOME_TOOLCHAIN_HASH = sha256Json(CLIENT_OUTCOME_TOOLCHAIN);
const validateClientOutcome = createAjv().compile(ClientOutcomeV1Schema);

function isNormalizedPointer(pointer) {
  return typeof pointer === "string" && /^\/(?:[a-z][a-zA-Z0-9]*)(?:\/(?:[a-z][a-zA-Z0-9]*|[0-9]+))*$/.test(pointer);
}

function hasPointerOverlap(pointers) {
  return pointers.some((pointer, index) =>
    pointers.some((other, otherIndex) => index !== otherIndex && other.startsWith(`${pointer}/`)),
  );
}

export function assertClientOutcomeContentFree(value, path = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertClientOutcomeContentFree(item, `${path}/${index}`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_FIELD_PATTERN.test(key) || CONTENT_FIELD_PATTERN.test(key))
        throw new TypeError("CONTENT_FIELD_DENIED");
      assertClientOutcomeContentFree(child, `${path}/${key}`);
    }
    return;
  }
  if (typeof value === "string" && SECRET_VALUE_PATTERN.test(value)) throw new TypeError("SECRET_VALUE_DENIED");
}

function sortedRecord(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function validateStringSet(scenario, field, pattern) {
  const values = scenario[field];
  return (
    Array.isArray(values) &&
    new Set(values).size === values.length &&
    values.every((value) => typeof value === "string" && pattern.test(value))
  );
}

export function validateClientOutcomeScenarioCorpus(corpus = CLIENT_OUTCOME_SCENARIO_CORPUS) {
  const errors = [];
  if (corpus?.schemaVersion !== "1.0.0" || !Array.isArray(corpus.scenarios)) return ["CORPUS_SHAPE_INVALID"];
  const ids = corpus.scenarios.map(({ id }) => id);
  if (canonicalJson(ids) !== canonicalJson(CLIENT_OUTCOME_SCENARIO_IDS)) errors.push("CORPUS_SCENARIO_ORDER_INVALID");
  for (const scenario of corpus.scenarios) {
    for (const field of ["requiredAssertions", "requiredArtifacts", "requiredEvidence"]) {
      if (!validateStringSet(scenario, field, IDENTIFIER_PATTERN))
        errors.push(`${scenario.id}_${field.toUpperCase()}_INVALID`);
    }
    if (!validateStringSet(scenario, "requiredDenialCodes", CODE_PATTERN)) {
      errors.push(`${scenario.id}_REQUIRED_DENIAL_CODES_INVALID`);
    }
    if (
      !Array.isArray(scenario.requiredGates) ||
      new Set(scenario.requiredGates).size !== scenario.requiredGates.length ||
      scenario.requiredGates.some((gate) => !Number.isInteger(gate) || gate < 1 || gate > 4)
    ) {
      errors.push(`${scenario.id}_REQUIRED_GATES_INVALID`);
    }
    if (
      !Array.isArray(scenario.equalityPaths) ||
      scenario.equalityPaths.length === 0 ||
      new Set(scenario.equalityPaths).size !== scenario.equalityPaths.length ||
      scenario.equalityPaths.some(
        (pointer) => !isNormalizedPointer(pointer) || !CLIENT_OUTCOME_EQUALITY_PATHS.includes(pointer),
      ) ||
      hasPointerOverlap(scenario.equalityPaths)
    ) {
      errors.push(`${scenario.id}_EQUALITY_PATHS_INVALID`);
    }
    if (
      !["succeeded", "denied", "not-applicable"].includes(scenario.transferPredicate?.result) ||
      !Number.isInteger(scenario.transferPredicate?.ownerEpochDelta)
    ) {
      errors.push(`${scenario.id}_TRANSFER_PREDICATE_INVALID`);
    }
    if (!["completed", "failed", "blocked", "unavailable"].includes(scenario.expectedTaskState)) {
      errors.push(`${scenario.id}_EXPECTED_TASK_STATE_INVALID`);
    }
  }
  return errors;
}

function projectSemanticEvents(events) {
  if (!Array.isArray(events) || events.length === 0 || events.length > 128)
    throw new TypeError("SEMANTIC_EVENTS_INVALID");
  return events.map((event) => {
    if (event === null || typeof event !== "object" || Array.isArray(event))
      throw new TypeError("SEMANTIC_EVENT_INVALID");
    if (Object.keys(event).some((key) => !SEMANTIC_EVENT_FIELDS.has(key)))
      throw new TypeError("SEMANTIC_EVENT_FIELD_DENIED");
    const required = SEMANTIC_EVENT_RULES[event.type];
    if (
      required === undefined ||
      Object.keys(event).length !== required.length + 1 ||
      required.some((key) => !(key in event))
    ) {
      throw new TypeError("SEMANTIC_EVENT_SHAPE_INVALID");
    }
    if (event.node !== undefined && !IDENTIFIER_PATTERN.test(event.node))
      throw new TypeError("SEMANTIC_EVENT_NODE_INVALID");
    if (event.taskState !== undefined && !["completed", "failed", "blocked", "unavailable"].includes(event.taskState)) {
      throw new TypeError("SEMANTIC_EVENT_TASK_STATE_INVALID");
    }
    if (event.gate !== undefined && (!Number.isInteger(event.gate) || event.gate < 1 || event.gate > 4)) {
      throw new TypeError("SEMANTIC_EVENT_GATE_INVALID");
    }
    if (
      event.gateState !== undefined &&
      !["approved", "denied", "pending", "not-applicable"].includes(event.gateState)
    ) {
      throw new TypeError("SEMANTIC_EVENT_GATE_STATE_INVALID");
    }
    if (event.artifact !== undefined && !IDENTIFIER_PATTERN.test(event.artifact))
      throw new TypeError("SEMANTIC_EVENT_ARTIFACT_INVALID");
    if (event.artifactHash !== undefined && !/^[0-9a-f]{64}$/.test(event.artifactHash))
      throw new TypeError("SEMANTIC_EVENT_ARTIFACT_HASH_INVALID");
    if (event.evidence !== undefined && !IDENTIFIER_PATTERN.test(event.evidence))
      throw new TypeError("SEMANTIC_EVENT_EVIDENCE_INVALID");
    if (event.evidenceHash !== undefined && !/^[0-9a-f]{64}$/.test(event.evidenceHash))
      throw new TypeError("SEMANTIC_EVENT_EVIDENCE_HASH_INVALID");
    if (event.denialCode !== undefined && !CODE_PATTERN.test(event.denialCode))
      throw new TypeError("SEMANTIC_EVENT_DENIAL_INVALID");
    if (
      event.transferResult !== undefined &&
      !["succeeded", "denied", "not-applicable"].includes(event.transferResult)
    ) {
      throw new TypeError("SEMANTIC_EVENT_TRANSFER_RESULT_INVALID");
    }
    if (event.ownerEpochDelta !== undefined && !Number.isInteger(event.ownerEpochDelta))
      throw new TypeError("SEMANTIC_EVENT_EPOCH_INVALID");
    if (event.assertion !== undefined && !IDENTIFIER_PATTERN.test(event.assertion))
      throw new TypeError("SEMANTIC_EVENT_ASSERTION_INVALID");
    if (event.assertionState !== undefined && !["pass", "fail", "unavailable"].includes(event.assertionState)) {
      throw new TypeError("SEMANTIC_EVENT_ASSERTION_STATE_INVALID");
    }
    return Object.fromEntries(
      [...SEMANTIC_EVENT_FIELDS].filter((key) => event[key] !== undefined).map((key) => [key, event[key]]),
    );
  });
}

function deriveObservations(semanticEvents) {
  const gates = [];
  const artifacts = {};
  const evidence = {};
  const denialCodes = [];
  const assertions = {};
  let transfer;
  for (const event of semanticEvents) {
    if (event.type === "gate") {
      if (gates.some(({ gate }) => gate === event.gate)) throw new TypeError("DUPLICATE_GATE_NUMBER");
      gates.push({ gate: event.gate, state: event.gateState });
    } else if (event.type === "artifact") {
      if (artifacts[event.artifact] !== undefined) throw new TypeError("DUPLICATE_ARTIFACT_OBSERVATION");
      artifacts[event.artifact] = event.artifactHash;
    } else if (event.type === "evidence") {
      if (evidence[event.evidence] !== undefined) throw new TypeError("DUPLICATE_EVIDENCE_OBSERVATION");
      evidence[event.evidence] = event.evidenceHash;
    } else if (event.type === "denial") {
      if (denialCodes.includes(event.denialCode)) throw new TypeError("DUPLICATE_DENIAL_OBSERVATION");
      denialCodes.push(event.denialCode);
    } else if (event.type === "transfer") {
      if (transfer !== undefined) throw new TypeError("DUPLICATE_TRANSFER_OBSERVATION");
      transfer = { result: event.transferResult, ownerEpochDelta: event.ownerEpochDelta };
    } else if (event.type === "assertion") {
      if (assertions[event.assertion] !== undefined) throw new TypeError("DUPLICATE_ASSERTION_OBSERVATION");
      assertions[event.assertion] = event.assertionState;
    }
  }
  if (transfer === undefined) throw new TypeError("SEMANTIC_TRANSFER_MISSING");
  return {
    gates: gates.sort((left, right) => left.gate - right.gate),
    artifacts: sortedRecord(artifacts),
    evidence: sortedRecord(evidence),
    denialCodes: denialCodes.sort(),
    transfer,
    assertions: sortedRecord(assertions),
  };
}

function normalizeObservations(observations) {
  return {
    ...observations,
    gates: [...observations.gates].sort((left, right) => left.gate - right.gate),
    artifacts: sortedRecord(observations.artifacts),
    evidence: sortedRecord(observations.evidence),
    denialCodes: [...observations.denialCodes].sort(),
    assertions: sortedRecord(observations.assertions),
  };
}

function assertClientVersionBinding(input) {
  const fixture = CLIENT_OUTCOME_SCENARIO_CORPUS.fixtureClients;
  const vscode = CLIENT_OUTCOME_TOOLCHAIN.core.vscode;
  const cli = CLIENT_OUTCOME_TOOLCHAIN.core.copilotCli;
  if (input.evidenceKind === "live") {
    if (vscode.selectedExactVersion === null || vscode.selectedExactCopilotChatVersion == null) {
      throw new TypeError("LIVE_TOOLCHAIN_UNAVAILABLE");
    }
    const expectedVersion =
      input.client.id === "github-copilot-vscode" ? vscode.selectedExactVersion : cli.selectedExactVersion;
    const expectedExtension =
      input.client.id === "github-copilot-vscode" ? vscode.selectedExactCopilotChatVersion : undefined;
    if (input.client.version !== expectedVersion || input.client.extensionVersion !== expectedExtension) {
      throw new TypeError("LIVE_CLIENT_VERSION_MISMATCH");
    }
  } else if (
    (input.client.id === "github-copilot-vscode" &&
      (input.client.version !== fixture.vscodeVersion ||
        input.client.extensionVersion !== fixture.vscodeExtensionVersion)) ||
    (input.client.id === "github-copilot-cli" &&
      (input.client.version !== fixture.cliVersion || input.client.extensionVersion !== undefined)) ||
    fixture.cliVersion !== cli.selectedExactVersion ||
    fixture.cliArtifactHash !== cli.releaseArtifact.sha256
  ) {
    throw new TypeError("FIXTURE_CLIENT_VERSION_MISMATCH");
  }
}

function assertScenarioProof(input, scenario, semanticEvents) {
  const taskEvents = semanticEvents.filter(({ type }) => type === "task");
  const observations = deriveObservations(semanticEvents);
  if (input.disposition?.status !== "pass") throw new TypeError("SCENARIO_PROOF_DISPOSITION_INVALID");
  if (input.execution?.taskState !== scenario.expectedTaskState) throw new TypeError("SCENARIO_TASK_STATE_INVALID");
  if (
    taskEvents.length !== 1 ||
    taskEvents[0].node !== input.execution.workflowNode ||
    taskEvents[0].taskState !== scenario.expectedTaskState
  ) {
    throw new TypeError("SEMANTIC_TASK_STATE_MISMATCH");
  }
  if (
    input.observations !== undefined &&
    canonicalJson(normalizeObservations(input.observations)) !== canonicalJson(observations)
  ) {
    throw new TypeError("OBSERVATIONS_SEMANTIC_MISMATCH");
  }
  for (const key of scenario.requiredAssertions) {
    if (observations.assertions[key] !== "pass") throw new TypeError("REQUIRED_ASSERTION_MISSING");
  }
  for (const gate of scenario.requiredGates) {
    if (!observations.gates.some((entry) => entry.gate === gate && entry.state === "approved")) {
      throw new TypeError("REQUIRED_GATE_MISSING");
    }
  }
  for (const key of scenario.requiredArtifacts) {
    if (observations.artifacts[key] === undefined) throw new TypeError("REQUIRED_ARTIFACT_MISSING");
  }
  for (const key of scenario.requiredEvidence) {
    if (observations.evidence[key] === undefined) throw new TypeError("REQUIRED_EVIDENCE_MISSING");
  }
  for (const code of scenario.requiredDenialCodes) {
    if (!observations.denialCodes.includes(code)) throw new TypeError("REQUIRED_DENIAL_MISSING");
  }
  if (canonicalJson(observations.transfer) !== canonicalJson(scenario.transferPredicate)) {
    throw new TypeError("TRANSFER_PREDICATE_FAILED");
  }
  return observations;
}

function collectJournalReceipt(receipt, expectedOwnerEpoch) {
  if (
    receipt?.schemaVersion !== "1.0.0" ||
    !/^[0-9a-f]{64}$/.test(receipt.head) ||
    !Array.isArray(receipt.records) ||
    receipt.records.length === 0 ||
    receipt.records.length > 128 ||
    Object.keys(receipt).sort().join(",") !== "head,records,schemaVersion"
  ) {
    throw new TypeError("JOURNAL_RECEIPT_INVALID");
  }
  let previousHash = ZERO_HASH;
  const records = receipt.records.map((record, index) => {
    if (record === null || typeof record !== "object" || Array.isArray(record))
      throw new TypeError("JOURNAL_RECORD_INVALID");
    const expectedKeys = ["hash", "ownerEpoch", "payload", "payloadHash", "previousHash", "sequence", "type"];
    if (canonicalJson(Object.keys(record).sort()) !== canonicalJson(expectedKeys))
      throw new TypeError("JOURNAL_RECORD_SHAPE_INVALID");
    if (record.sequence !== index + 1) throw new TypeError("JOURNAL_SEQUENCE_INVALID");
    if (record.previousHash !== previousHash) throw new TypeError("JOURNAL_PREVIOUS_HASH_INVALID");
    if (
      !CODE_PATTERN.test(record.type) ||
      !/^[0-9a-f]{64}$/.test(record.payloadHash) ||
      !Number.isInteger(record.ownerEpoch) ||
      record.ownerEpoch < 0
    ) {
      throw new TypeError("JOURNAL_RECORD_METADATA_INVALID");
    }
    if (
      record.payload === null ||
      typeof record.payload !== "object" ||
      Array.isArray(record.payload) ||
      Object.keys(record.payload).sort().join(",") !== "semanticProjection,sourceIdentity" ||
      typeof record.payload.sourceIdentity !== "string" ||
      !IDENTIFIER_PATTERN.test(record.payload.sourceIdentity) ||
      record.payloadHash !== sha256Json(record.payload)
    ) {
      throw new TypeError("JOURNAL_RECORD_PAYLOAD_INVALID");
    }
    const [semanticProjection] = projectSemanticEvents([record.payload.semanticProjection]);
    if (record.type !== semanticProjection.type.toUpperCase()) throw new TypeError("JOURNAL_RECORD_TYPE_MISMATCH");
    if (record.ownerEpoch !== expectedOwnerEpoch) throw new TypeError("JOURNAL_OWNER_EPOCH_MISMATCH");
    const content = {
      sequence: record.sequence,
      type: record.type,
      previousHash: record.previousHash,
      payloadHash: record.payloadHash,
      payload: record.payload,
      ownerEpoch: record.ownerEpoch,
    };
    if (record.hash !== sha256Json(content)) throw new TypeError("JOURNAL_RECORD_HASH_INVALID");
    previousHash = record.hash;
    return { record: { ...content, hash: record.hash }, semanticProjection };
  });
  const sourceRecords = records.map(({ record }) => record);
  const semanticEvents = records.map(({ semanticProjection }) => semanticProjection);
  const rawJournalHead = sourceRecords.at(-1).hash;
  if (receipt.head !== rawJournalHead) throw new TypeError("JOURNAL_HEAD_INVALID");
  const rawJournalSourceDigest = sha256Json({ schemaVersion: receipt.schemaVersion, records: sourceRecords });
  const semanticJournalHash = sha256Json(semanticEvents);
  const attestationHash = sha256Json({ rawJournalHead, rawJournalSourceDigest, semanticJournalHash });
  return {
    rawJournalHead,
    rawJournalSourceDigest,
    semanticJournalHash,
    attestationHash,
    semanticEvents,
  };
}

export function verifyClientOutcomeRuntimeReceipt(outcome, receipt) {
  const journal = collectJournalReceipt(receipt, outcome?.execution?.ownerEpoch);
  const observations = deriveObservations(journal.semanticEvents);
  if (
    journal.rawJournalHead !== outcome?.execution?.rawJournalHead ||
    journal.rawJournalSourceDigest !== outcome?.evidence?.sourceDigest ||
    journal.rawJournalSourceDigest !== outcome?.execution?.rawJournalSourceDigest ||
    journal.semanticJournalHash !== outcome?.execution?.semanticJournalHash ||
    journal.attestationHash !== outcome?.evidence?.attestationHash ||
    canonicalJson(observations) !== canonicalJson(outcome?.observations)
  ) {
    throw new TypeError("RUNTIME_RECEIPT_OUTCOME_MISMATCH");
  }
  return true;
}

export function calculateOutcomeId(outcome) {
  const { outcomeId: _outcomeId, ...content } = outcome;
  return sha256Json(content);
}

export function collectClientOutcome(input) {
  assertClientOutcomeContentFree(input);
  const corpusErrors = validateClientOutcomeScenarioCorpus();
  if (corpusErrors.length > 0) throw new TypeError("SCENARIO_CORPUS_INVALID");
  const scenario = CLIENT_OUTCOME_SCENARIO_CORPUS.scenarios.find(({ id }) => id === input?.scenarioId);
  if (scenario === undefined) throw new TypeError("SCENARIO_UNKNOWN");
  if (!CLIENT_OUTCOME_CLIENT_IDS.includes(input?.client?.id)) throw new TypeError("CLIENT_UNSUPPORTED");
  if (
    input.execution?.rawJournalHead !== undefined ||
    input.execution?.rawJournalSourceDigest !== undefined ||
    input.execution?.semanticJournalHash !== undefined ||
    input.evidence?.sourceDigest !== undefined ||
    input.evidence?.attestationHash !== undefined
  ) {
    throw new TypeError("DERIVED_JOURNAL_FIELD_INPUT_DENIED");
  }
  if (input.candidate?.scenarioCorpusHash !== CLIENT_OUTCOME_SCENARIO_CORPUS_HASH)
    throw new TypeError("CORPUS_HASH_MISMATCH");
  if (input.candidate?.toolchainHash !== CLIENT_OUTCOME_TOOLCHAIN_HASH) throw new TypeError("TOOLCHAIN_HASH_MISMATCH");
  assertClientVersionBinding(input);
  const journal = collectJournalReceipt(input.journalReceipt, input.execution.ownerEpoch);
  const observations = assertScenarioProof(input, scenario, journal.semanticEvents);
  const { outcomeId: _outcomeId, journalReceipt: _journalReceipt, ...source } = input;
  const collected = {
    ...source,
    candidate: sortedRecord(source.candidate),
    execution: {
      ...source.execution,
      rawJournalHead: journal.rawJournalHead,
      rawJournalSourceDigest: journal.rawJournalSourceDigest,
      semanticJournalHash: journal.semanticJournalHash,
    },
    observations,
    evidence: {
      ...source.evidence,
      sourceDigest: journal.rawJournalSourceDigest,
      attestationHash: journal.attestationHash,
      refs: [...source.evidence.refs].sort(),
    },
  };
  const outcome = { ...collected, outcomeId: sha256Json(collected) };
  if (!validateClientOutcome(outcome)) throw new TypeError("OUTCOME_SCHEMA_INVALID");
  return outcome;
}

export function readBoundedJson(filePath, maxBytes) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new TypeError("INPUT_NOT_REGULAR_FILE");
  if (stat.size > maxBytes) throw new TypeError("INPUT_TOO_LARGE");
  return parseStrictJson(fs.readFileSync(filePath, "utf8"));
}

export function sanitizedClientOutcomeError(error) {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message) ? error.message : "IO_ERROR";
}

function main() {
  try {
    if (process.argv.length < 3 || process.argv.length > 4) throw new TypeError("USAGE_INVALID");
    const maxBytes = contractMetadata[OUTCOME_SCHEMA_ID].maxBytes;
    const outcome = collectClientOutcome(readBoundedJson(process.argv[2], maxBytes));
    const serialized = `${canonicalJson(outcome)}\n`;
    if (process.argv[3] === undefined) process.stdout.write(serialized);
    else fs.writeFileSync(process.argv[3], serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return 0;
  } catch (error) {
    console.error(`CLIENT_OUTCOME_COLLECTION_FAILED:${sanitizedClientOutcomeError(error)}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main();
