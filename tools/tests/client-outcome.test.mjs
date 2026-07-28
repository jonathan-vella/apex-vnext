import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson, sha256Json } from "../../packages/kernel/dist/index.js";
import {
  EvidenceManifestV1Schema,
  createClientQualificationEvidenceEntry,
  hasBoundClientQualification,
} from "../../packages/contracts/dist/index.js";
import { createAjv } from "../scripts/_lib/ajv-validator.mjs";
import {
  CLIENT_OUTCOME_SCENARIO_CORPUS,
  CLIENT_OUTCOME_SCENARIO_CORPUS_HASH,
  CLIENT_OUTCOME_TOOLCHAIN_HASH,
  calculateOutcomeId,
  collectClientOutcome,
  validateClientOutcomeScenarioCorpus,
  verifyClientOutcomeRuntimeReceipt,
} from "../scripts/collect-client-outcome.mjs";
import {
  calculateComparisonId,
  calculateQualificationId,
  compareClientOutcomes,
  qualifyClientOutcomes,
  verifyClientOutcomeComparison,
  verifyClientOutcomeQualification,
} from "../scripts/compare-client-outcomes.mjs";
import { parseStrictJson } from "../scripts/_lib/strict-json.mjs";
import { validateClientRuntimeEvidence, validateEvidencePayloads } from "../scripts/live-qualification.mjs";
import { resolveInputPath } from "../scripts/qualify-client-outcomes.mjs";

const hash = (character) => character.repeat(64);

function merge(base, overrides) {
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides)) return overrides;
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    result[key] =
      value !== null && typeof value === "object" && !Array.isArray(value) && typeof result[key] === "object"
        ? merge(result[key], value)
        : structuredClone(value);
  }
  return result;
}

function scenarioProof(scenarioId) {
  const scenario = CLIENT_OUTCOME_SCENARIO_CORPUS.scenarios.find(({ id }) => id === scenarioId);
  return {
    gates: scenario.requiredGates.map((gate) => ({ gate, state: "approved" })),
    artifacts: Object.fromEntries(scenario.requiredArtifacts.map((key) => [key, hash("a")])),
    evidence: Object.fromEntries(scenario.requiredEvidence.map((key) => [key, hash("b")])),
    denialCodes: [...scenario.requiredDenialCodes],
    transfer: structuredClone(scenario.transferPredicate),
    assertions: Object.fromEntries(scenario.requiredAssertions.map((key) => [key, "pass"])),
  };
}

function scenarioSemanticEvents(scenarioId) {
  const proof = scenarioProof(scenarioId);
  return [
    { type: "task", node: "quality", taskState: "completed" },
    ...proof.gates.map(({ gate, state }) => ({ type: "gate", gate, gateState: state })),
    ...Object.entries(proof.artifacts).map(([artifact, artifactHash]) => ({
      type: "artifact",
      artifact,
      artifactHash,
    })),
    ...Object.entries(proof.evidence).map(([evidence, evidenceHash]) => ({
      type: "evidence",
      evidence,
      evidenceHash,
    })),
    ...proof.denialCodes.map((denialCode) => ({ type: "denial", denialCode })),
    {
      type: "transfer",
      transferResult: proof.transfer.result,
      ownerEpochDelta: proof.transfer.ownerEpochDelta,
    },
    ...Object.entries(proof.assertions).map(([assertion, assertionState]) => ({
      type: "assertion",
      assertion,
      assertionState,
    })),
  ];
}

function journalReceipt(clientId, semanticEvents) {
  let previousHash = hash("0");
  const records = semanticEvents.map((semanticProjection, index) => {
    const payload = { semanticProjection, sourceIdentity: `${clientId}.${index}` };
    const content = {
      sequence: index + 1,
      type: semanticProjection.type.toUpperCase(),
      previousHash,
      payloadHash: sha256Json(payload),
      payload,
      ownerEpoch: 1,
    };
    const record = { ...content, hash: sha256Json(content) };
    previousHash = record.hash;
    return record;
  });
  return { schemaVersion: "1.0.0", head: records.at(-1).hash, records };
}

function input(scenarioId, clientId, overrides = {}) {
  const fixture = CLIENT_OUTCOME_SCENARIO_CORPUS.fixtureClients;
  const base = {
    schemaVersion: "1.0.0",
    scenarioId,
    evidenceKind: "fixture",
    candidate: {
      repository: "jonathan-vella/apex-vnext",
      branch: "main",
      commit: "a".repeat(40),
      packageLockHash: hash("1"),
      releaseManifestHash: hash("2"),
      runtimeBundleHash: hash("3"),
      customizationBundleHash: hash("4"),
      scenarioCorpusHash: CLIENT_OUTCOME_SCENARIO_CORPUS_HASH,
      toolchainHash: CLIENT_OUTCOME_TOOLCHAIN_HASH,
    },
    client: {
      id: clientId,
      version: clientId === "github-copilot-cli" ? fixture.cliVersion : fixture.vscodeVersion,
      ...(clientId === "github-copilot-vscode" ? { extensionVersion: fixture.vscodeExtensionVersion } : {}),
      os: "linux",
      architecture: "x64",
    },
    execution: {
      projectId: "demo",
      runId: `run-${clientId}`,
      workflowNode: "quality",
      taskId: `task-${clientId}`,
      taskState: "completed",
      ownerEpoch: 1,
    },
    journalReceipt: journalReceipt(clientId, scenarioSemanticEvents(scenarioId)),
    observations: scenarioProof(scenarioId),
    disposition: { status: "pass" },
    evidence: {
      refs: [hash("d")],
      contentCapture: false,
    },
  };
  return merge(base, overrides);
}

function pair(scenarioId, cliOverrides = {}, vscodeOverrides = {}) {
  return [
    collectClientOutcome(input(scenarioId, "github-copilot-vscode", vscodeOverrides)),
    collectClientOutcome(input(scenarioId, "github-copilot-cli", cliOverrides)),
  ];
}

function triplet(scenarioId, cliOverrides = {}, vscodeOverrides = {}) {
  const outcomes = pair(scenarioId, cliOverrides, vscodeOverrides);
  return { outcomes, comparison: compareClientOutcomes(...outcomes) };
}

function fixtureQualificationContext() {
  const fixture = CLIENT_OUTCOME_SCENARIO_CORPUS.fixtureClients;
  return {
    mode: "fixture-only",
    scenarioIds: CLIENT_OUTCOME_SCENARIO_CORPUS.scenarios.map(({ id }) => id),
    scenarioCorpusHash: CLIENT_OUTCOME_SCENARIO_CORPUS_HASH,
    toolchainHash: CLIENT_OUTCOME_TOOLCHAIN_HASH,
    clients: {
      vscodeVersion: fixture.vscodeVersion,
      vscodeExtensionVersion: fixture.vscodeExtensionVersion,
      cliVersion: fixture.cliVersion,
    },
  };
}

test("the corpus defines exact scenario-specific proof and valid equality paths", () => {
  assert.deepEqual(
    CLIENT_OUTCOME_SCENARIO_CORPUS.scenarios.map(({ id }) => id),
    Array.from({ length: 10 }, (_, index) => `CLIENT-${String(index + 1).padStart(3, "0")}`),
  );
  assert.deepEqual(validateClientOutcomeScenarioCorpus(), []);
  for (const scenario of CLIENT_OUTCOME_SCENARIO_CORPUS.scenarios) {
    assert.ok(scenario.requiredAssertions.length > 0);
    assert.ok(scenario.requiredEvidence.length > 0);
    assert.ok(scenario.equalityPaths.length > 0);
    assert.ok(scenario.transferPredicate);
  }
});

test("all fixture comparisons pass but no per-scenario comparison qualifies", () => {
  for (const { id } of CLIENT_OUTCOME_SCENARIO_CORPUS.scenarios) {
    const comparison = compareClientOutcomes(...pair(id));
    assert.equal(comparison.status, "pass", id);
    assert.equal(comparison.qualifiesRelease, false, id);
  }
});

test("collector derives every scenario proof category and rejects missing semantic events", () => {
  const scenarioId = "CLIENT-010";
  for (const [eventType, code] of [
    ["assertion", /REQUIRED_ASSERTION_MISSING/],
    ["gate", /REQUIRED_GATE_MISSING/],
    ["artifact", /REQUIRED_ARTIFACT_MISSING/],
    ["evidence", /REQUIRED_EVIDENCE_MISSING/],
    ["denial", /REQUIRED_DENIAL_MISSING/],
    ["transfer", /SEMANTIC_TRANSFER_MISSING/],
  ]) {
    const missing = input(scenarioId, "github-copilot-cli");
    missing.observations = undefined;
    missing.journalReceipt = journalReceipt(
      missing.client.id,
      scenarioSemanticEvents(scenarioId).filter(({ type }) => type !== eventType),
    );
    assert.throws(() => collectClientOutcome(missing), code);
  }

  const taskOnly = input(scenarioId, "github-copilot-cli");
  taskOnly.observations = undefined;
  taskOnly.journalReceipt = journalReceipt(taskOnly.client.id, [
    { type: "task", node: "quality", taskState: "completed" },
  ]);
  assert.throws(() => collectClientOutcome(taskOnly), /SEMANTIC_TRANSFER_MISSING/);

  const disagreement = input(scenarioId, "github-copilot-cli");
  disagreement.observations.evidence["validation-attestation"] = hash("f");
  assert.throws(() => collectClientOutcome(disagreement), /OBSERVATIONS_SEMANTIC_MISMATCH/);
});

test("journal receipt derives chain, source, semantic, and attestation hashes", () => {
  const collected = collectClientOutcome(input("CLIENT-003", "github-copilot-cli"));
  assert.equal(collected.execution.semanticJournalHash, sha256Json(scenarioSemanticEvents("CLIENT-003")));
  assert.equal(
    collected.execution.rawJournalHead,
    input("CLIENT-003", "github-copilot-cli").journalReceipt.records.at(-1).hash,
  );
  assert.equal(collected.evidence.sourceDigest, collected.execution.rawJournalSourceDigest);
  assert.equal(
    collected.evidence.attestationHash,
    sha256Json({
      rawJournalHead: collected.execution.rawJournalHead,
      rawJournalSourceDigest: collected.execution.rawJournalSourceDigest,
      semanticJournalHash: collected.execution.semanticJournalHash,
    }),
  );
  assert.equal("journalReceipt" in collected, false);
  assert.throws(
    () =>
      collectClientOutcome(
        input("CLIENT-003", "github-copilot-cli", { execution: { semanticJournalHash: hash("f") } }),
      ),
    /DERIVED_JOURNAL_FIELD_INPUT_DENIED/,
  );
});

test("journal receipt rejects chain, record, and semantic tampering", () => {
  const head = input("CLIENT-003", "github-copilot-cli");
  head.journalReceipt.head = hash("f");
  assert.throws(() => collectClientOutcome(head), /JOURNAL_HEAD_INVALID/);

  const chain = input("CLIENT-003", "github-copilot-cli");
  chain.journalReceipt.records[1].previousHash = hash("f");
  assert.throws(() => collectClientOutcome(chain), /JOURNAL_PREVIOUS_HASH_INVALID/);

  const record = input("CLIENT-003", "github-copilot-cli");
  record.journalReceipt.records[0].payloadHash = hash("f");
  assert.throws(() => collectClientOutcome(record), /JOURNAL_RECORD_PAYLOAD_INVALID/);

  const type = input("CLIENT-003", "github-copilot-cli");
  type.journalReceipt.records[0].type = "EVIDENCE";
  const { hash: _typeHash, ...typeContent } = type.journalReceipt.records[0];
  type.journalReceipt.records[0].hash = sha256Json(typeContent);
  type.journalReceipt.head = type.journalReceipt.records.at(-1).hash;
  assert.throws(() => collectClientOutcome(type), /JOURNAL_RECORD_TYPE_MISMATCH/);

  const epoch = input("CLIENT-003", "github-copilot-cli");
  epoch.journalReceipt.records[0].ownerEpoch = 2;
  const { hash: _epochHash, ...epochContent } = epoch.journalReceipt.records[0];
  epoch.journalReceipt.records[0].hash = sha256Json(epochContent);
  assert.throws(() => collectClientOutcome(epoch), /JOURNAL_OWNER_EPOCH_MISMATCH/);

  const semantic = input("CLIENT-003", "github-copilot-cli");
  semantic.journalReceipt = journalReceipt(
    semantic.client.id,
    scenarioSemanticEvents("CLIENT-003").map((event) =>
      event.type === "assertion" && event.assertion === "typed-answer" ? { ...event, assertionState: "fail" } : event,
    ),
  );
  assert.throws(() => collectClientOutcome(semantic), /OBSERVATIONS_SEMANTIC_MISMATCH/);
});

test("caller cannot supply derived journal source, semantic, or attestation fields", () => {
  for (const override of [
    { execution: { rawJournalHead: hash("f") } },
    { execution: { rawJournalSourceDigest: hash("f") } },
    { execution: { semanticJournalHash: hash("f") } },
    { evidence: { sourceDigest: hash("f") } },
    { evidence: { attestationHash: hash("f") } },
  ]) {
    assert.throws(
      () => collectClientOutcome(input("CLIENT-003", "github-copilot-cli", override)),
      /DERIVED_JOURNAL_FIELD_INPUT_DENIED/,
    );
  }
});

test("scenario proof requires pass disposition and matching execution state", () => {
  assert.throws(
    () =>
      collectClientOutcome(
        input("CLIENT-006", "github-copilot-cli", { disposition: { status: "fail", reasonCode: "GATE_FAILED" } }),
      ),
    /SCENARIO_PROOF_DISPOSITION_INVALID/,
  );
  assert.throws(
    () => collectClientOutcome(input("CLIENT-006", "github-copilot-cli", { execution: { taskState: "failed" } })),
    /SCENARIO_TASK_STATE_INVALID/,
  );
});

test("exact fixture versions and toolchain hash are required while live collection is blocked", () => {
  assert.throws(
    () => collectClientOutcome(input("CLIENT-001", "github-copilot-cli", { client: { version: "1.0.72" } })),
    /FIXTURE_CLIENT_VERSION_MISMATCH/,
  );
  assert.throws(
    () => collectClientOutcome(input("CLIENT-001", "github-copilot-cli", { candidate: { toolchainHash: hash("f") } })),
    /TOOLCHAIN_HASH_MISMATCH/,
  );
  assert.throws(
    () => collectClientOutcome(input("CLIENT-001", "github-copilot-cli", { evidenceKind: "live" })),
    /LIVE_TOOLCHAIN_UNAVAILABLE/,
  );
});

test("duplicate gate numbers are rejected even when gate objects differ", () => {
  const duplicate = input("CLIENT-006", "github-copilot-cli");
  duplicate.observations = undefined;
  duplicate.journalReceipt = journalReceipt(duplicate.client.id, [
    ...scenarioSemanticEvents("CLIENT-006"),
    { type: "gate", gate: 1, gateState: "denied" },
  ]);
  assert.throws(() => collectClientOutcome(duplicate), /DUPLICATE_GATE_NUMBER/);
});

test("corpus validation rejects duplicate, overlapping, malformed, and nonexistent pointers", () => {
  for (const equalityPaths of [
    ["/candidate", "/candidate"],
    ["/execution", "/execution/taskState"],
    ["/notPresent"],
    ["/execution/~1bad"],
  ]) {
    const corpus = structuredClone(CLIENT_OUTCOME_SCENARIO_CORPUS);
    corpus.scenarios[0].equalityPaths = equalityPaths;
    assert.ok(validateClientOutcomeScenarioCorpus(corpus).includes("CLIENT-001_EQUALITY_PATHS_INVALID"));
  }
});

test("raw journal identities differ without affecting semantic equality", () => {
  const [vscode, cli] = pair("CLIENT-007");
  assert.notEqual(vscode.execution.rawJournalHead, cli.execution.rawJournalHead);
  assert.notEqual(vscode.execution.rawJournalSourceDigest, cli.execution.rawJournalSourceDigest);
  assert.equal(compareClientOutcomes(vscode, cli).status, "pass");
});

test("comparison verification rejects forged IDs and status", () => {
  const outcomes = pair("CLIENT-010");
  const comparison = compareClientOutcomes(...outcomes);
  assert.equal(verifyClientOutcomeComparison(comparison, ...outcomes), true);
  assert.throws(
    () => verifyClientOutcomeComparison({ ...comparison, comparisonId: hash("0") }, ...outcomes),
    /COMPARISON_ID_INVALID/,
  );
  const forged = { ...comparison, status: "fail" };
  forged.comparisonId = calculateComparisonId(forged);
  assert.throws(() => verifyClientOutcomeComparison(forged, ...outcomes), /COMPARISON_CONTENT_INVALID/);
  assert.throws(
    () => compareClientOutcomes({ ...outcomes[0], outcomeId: hash("0") }, outcomes[1]),
    /OUTCOME_ID_INVALID/,
  );
  const wrongVersion = merge(outcomes[1], { client: { version: "9.9.9" } });
  wrongVersion.outcomeId = calculateOutcomeId(wrongVersion);
  assert.throws(() => compareClientOutcomes(outcomes[0], wrongVersion), /FIXTURE_CLIENT_VERSION_MISMATCH/);
});

test("content, token aliases, token values, and prose disposition fields are rejected", () => {
  for (const override of [
    { chatLog: "captured" },
    { sessionCookie: "captured" },
    { note: "github_pat_abcdefghijklmnopqrstuvwxyz123456" },
    { note: "eyJabcdefghijk.abcdefghijkl.abcdefghijkl" },
    { disposition: { status: "fail", reason: "arbitrary prose" } },
  ]) {
    assert.throws(() => collectClientOutcome(input("CLIENT-001", "github-copilot-cli", override)));
  }
});

test("collection and comparison are order-independent and deterministic", () => {
  const proof = scenarioProof("CLIENT-010");
  const ordered = input("CLIENT-010", "github-copilot-cli", {
    observations: {
      ...proof,
      gates: [...proof.gates].reverse(),
      denialCodes: ["UNAPPROVED_OPERATION_DENIED", "ADDITIONAL_DENIAL"],
    },
    evidence: { refs: [hash("e"), hash("d")] },
  });
  ordered.journalReceipt = journalReceipt(ordered.client.id, [
    ...scenarioSemanticEvents("CLIENT-010"),
    { type: "denial", denialCode: "ADDITIONAL_DENIAL" },
  ]);
  assert.equal(
    canonicalJson(collectClientOutcome(ordered)),
    canonicalJson(collectClientOutcome(structuredClone(ordered))),
  );
  const outcomes = pair("CLIENT-010");
  assert.equal(
    canonicalJson(compareClientOutcomes(...outcomes)),
    canonicalJson(compareClientOutcomes(outcomes[1], outcomes[0])),
  );
});

test("complete verified fixture aggregate proves parity but never release authority", () => {
  const triplets = CLIENT_OUTCOME_SCENARIO_CORPUS.scenarios.map(({ id }) => triplet(id));
  const context = fixtureQualificationContext();
  assert.throws(() => qualifyClientOutcomes(triplets), /LIVE_TOOLCHAIN_UNAVAILABLE/);
  const qualification = qualifyClientOutcomes([...triplets].reverse(), context);
  assert.equal(qualification.matrixComplete, true);
  assert.equal(qualification.qualifiesClientParity, true);
  assert.equal(qualification.qualifiesRelease, false);
  assert.deepEqual(
    qualification.comparisons.map(({ scenarioId }) => scenarioId),
    CLIENT_OUTCOME_SCENARIO_CORPUS.scenarios.map(({ id }) => id),
  );
  assert.equal(verifyClientOutcomeQualification(qualification, triplets, context), true);
  assert.throws(() => qualifyClientOutcomes(triplets.slice(1), context), /QUALIFICATION_SCENARIO_COUNT_INVALID/);
  assert.throws(
    () => qualifyClientOutcomes([...triplets.slice(0, 9), triplets[0]], context),
    /QUALIFICATION_SCENARIO_SET_INVALID|QUALIFICATION_OUTCOME_SET_INVALID/,
  );
  const missingOutcome = structuredClone(triplets);
  missingOutcome[0].outcomes.pop();
  assert.throws(() => qualifyClientOutcomes(missingOutcome, context), /QUALIFICATION_TRIPLET_INVALID/);
  const forgedComparison = structuredClone(triplets);
  forgedComparison[0].comparison.outcomeIds.cli = hash("f");
  forgedComparison[0].comparison.comparisonId = calculateComparisonId(forgedComparison[0].comparison);
  assert.throws(() => qualifyClientOutcomes(forgedComparison, context), /COMPARISON_CONTENT_INVALID/);
  const forged = { ...qualification, qualifiesRelease: true, qualificationId: hash("0") };
  assert.throws(() => verifyClientOutcomeQualification(forged, triplets, context), /QUALIFICATION_SCHEMA_INVALID/);
  const forgedId = {
    ...qualification,
    qualificationId: calculateQualificationId({ ...qualification, status: "fail" }),
  };
  assert.throws(() => verifyClientOutcomeQualification(forgedId, triplets, context), /QUALIFICATION_ID_INVALID/);
});

test("client parity integrates into evidence manifest without becoming release authority", () => {
  const triplets = CLIENT_OUTCOME_SCENARIO_CORPUS.scenarios.map(({ id }) => triplet(id));
  const qualification = qualifyClientOutcomes(triplets, fixtureQualificationContext());
  const qualificationBytes = Buffer.from(canonicalJson(qualification), "utf8");
  const clientQualification = createClientQualificationEvidenceEntry(qualificationBytes);
  const supportingPayloads = triplets
    .flatMap(({ comparison, outcomes }) => [
      { path: `${comparison.comparisonId}.json`, kind: "client-outcome-comparison", value: comparison },
      ...outcomes.map((outcome) => ({
        path: `${outcome.outcomeId}.json`,
        kind: "client-outcome",
        value: outcome,
      })),
    ])
    .map(({ path, kind, value }) => {
      const bytes = Buffer.from(canonicalJson(value), "utf8");
      return {
        path,
        bytes,
        entry: {
          kind,
          hash: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.byteLength,
          required: true,
          retention: "immutable",
        },
      };
    });
  const qualificationPayload = { path: "client-qualification.json", bytes: qualificationBytes };
  const manifest = {
    schemaVersion: "1.0.0",
    projectId: "demo",
    runId: "run-demo",
    createdAt: "2026-07-28T00:00:00Z",
    entries: supportingPayloads.map(({ entry }) => entry),
    clientQualification,
  };
  assert.deepEqual(createClientQualificationEvidenceEntry(qualification), clientQualification);
  assert.equal(clientQualification.bytes, qualificationBytes.byteLength);
  assert.equal(clientQualification.hash, createHash("sha256").update(qualificationBytes).digest("hex"));
  assert.notEqual(clientQualification.hash, qualification.qualificationId);
  assert.equal(createAjv().compile(EvidenceManifestV1Schema)(manifest), true);
  assert.equal(hasBoundClientQualification(manifest, qualificationBytes), true);
  assert.deepEqual(validateEvidencePayloads(manifest, [qualificationPayload, ...supportingPayloads]), []);
  assert.ok(
    validateEvidencePayloads(manifest, [qualificationPayload, ...supportingPayloads], {
      requireClientQualification: true,
      projectId: "demo",
      candidate: {
        repository: "https://github.com/jonathan-vella/apex-vnext",
        branch: "main",
        commit: "a".repeat(40),
        packageLockHash: hash("1"),
        releaseManifestHash: hash("2"),
        runtimeBundleHash: hash("3"),
        customizationBundleHash: hash("4"),
      },
    }).some((finding) => finding.includes("supporting comparison/outcome closure is invalid")),
  );
  assert.ok(
    validateEvidencePayloads(manifest, [qualificationPayload, ...supportingPayloads.slice(1)]).some((finding) =>
      finding.includes("payload is missing"),
    ),
  );
  const partialManifest = { ...manifest, clientQualification: undefined, entries: [supportingPayloads[0].entry] };
  assert.ok(
    validateEvidencePayloads(partialManifest, [supportingPayloads[0]]).some((finding) =>
      finding.includes("requires a bound client qualification"),
    ),
  );
  const misplacedManifest = {
    ...manifest,
    clientQualification: undefined,
    entries: [{ ...clientQualification }],
  };
  assert.ok(
    validateEvidencePayloads(misplacedManifest, [qualificationPayload]).some((finding) =>
      finding.includes("only allowed in the dedicated property"),
    ),
  );
  const substituted = structuredClone(supportingPayloads);
  substituted[0].bytes = supportingPayloads[1].bytes;
  assert.ok(
    validateEvidencePayloads(manifest, [qualificationPayload, ...substituted]).some(
      (finding) => finding.includes("duplicates manifest entry") || finding.includes("payload is missing"),
    ),
  );
  assert.equal(
    hasBoundClientQualification(
      { ...manifest, clientQualification: { ...clientQualification, hash: hash("f") } },
      qualification,
    ),
    false,
  );
  assert.equal(
    hasBoundClientQualification(
      { ...manifest, clientQualification: { ...clientQualification, bytes: clientQualification.bytes + 1 } },
      qualification,
    ),
    false,
  );
  assert.equal(hasBoundClientQualification(manifest, { ...qualification, qualificationId: hash("f") }), false);
  assert.throws(
    () => createClientQualificationEvidenceEntry({ ...qualification, status: "fail" }),
    /CLIENT_QUALIFICATION_SCHEMA_INVALID/,
  );
  assert.throws(
    () => createClientQualificationEvidenceEntry(Buffer.concat([qualificationBytes, Buffer.from("\n")])),
    /CLIENT_QUALIFICATION_BYTES_NOT_CANONICAL/,
  );
  assert.ok(
    validateEvidencePayloads(manifest, [
      { path: "client-qualification.json", bytes: Buffer.from(canonicalJson({ ...qualification, status: "fail" })) },
    ]).some((finding) => finding.includes("is not declared")),
  );

  const forgedQualification = { ...qualification, qualifiesRelease: true };
  forgedQualification.qualificationId = calculateQualificationId(forgedQualification);
  const forgedBytes = Buffer.from(canonicalJson(forgedQualification), "utf8");
  const forgedManifest = {
    ...manifest,
    clientQualification: {
      ...clientQualification,
      hash: createHash("sha256").update(forgedBytes).digest("hex"),
      bytes: forgedBytes.byteLength,
    },
  };
  assert.match(
    validateEvidencePayloads(forgedManifest, [
      { path: "forged-client-qualification.json", bytes: forgedBytes },
      ...supportingPayloads,
    ])[0],
    /client qualification contract or binding is invalid/,
  );

  const nonJsonBytes = Buffer.from("not-json", "utf8");
  const nonJsonManifest = {
    ...manifest,
    clientQualification: {
      ...clientQualification,
      hash: createHash("sha256").update(nonJsonBytes).digest("hex"),
      bytes: nonJsonBytes.byteLength,
    },
  };
  assert.match(
    validateEvidencePayloads(nonJsonManifest, [
      { path: "client-qualification.bin", bytes: nonJsonBytes },
      ...supportingPayloads,
    ])[0],
    /client qualification must be strict UTF-8 JSON/,
  );

  const collidingManifest = {
    ...manifest,
    entries: [
      {
        kind: "comparison",
        hash: clientQualification.hash,
        bytes: clientQualification.bytes,
        required: true,
        retention: "immutable",
      },
    ],
  };
  assert.ok(
    validateEvidencePayloads(collidingManifest, [
      { path: "client-qualification.json", bytes: qualificationBytes },
      ...supportingPayloads,
    ]).some((finding) => finding.includes("duplicate entry hashes")),
  );
  assert.equal(qualification.qualifiesRelease, false);
});

test("production client evidence requires independently supplied runtime payloads", () => {
  const outcome = triplet("CLIENT-001").outcomes[0];
  const findings = validateClientRuntimeEvidence([outcome], new Map(), new Map());
  assert.ok(findings.some((finding) => finding.includes("journal source")));
  assert.ok(findings.some((finding) => finding.includes("journal attestation")));
  assert.ok(findings.some((finding) => finding.includes("semantic journal")));
  assert.ok(findings.some((finding) => finding.includes("evidence toolchain-attestation")));
  assert.ok(findings.some((finding) => finding.includes("evidence ref")));
  const malformedReceipt = {
    schemaVersion: "1.0.0",
    head: hash("f"),
    records: [{ sequence: 1, previousHash: hash("0"), payloadHash: hash("d"), payload: {}, hash: hash("f") }],
  };
  assert.throws(() => verifyClientOutcomeRuntimeReceipt(outcome, malformedReceipt), /JOURNAL_RECORD_SHAPE_INVALID/);
});

test("strict JSON accepts only JSON whitespace and rejects dangerous keys and token syntax", () => {
  assert.deepEqual(parseStrictJson(' \t\r\n{"safe":1}'), { safe: 1 });
  assert.throws(() => parseStrictJson("\u00a0{}"), /INVALID_JSON_VALUE/);
  for (const key of ["__proto__", "constructor", "prototype"]) {
    assert.throws(() => parseStrictJson(`{"${key}":1}`), /DANGEROUS_JSON_KEY/);
  }
  assert.throws(() => parseStrictJson('{"value":NaN}'), /INVALID_JSON_VALUE/);
  assert.throws(() => parseStrictJson('{"value":1,"value":2}'), /DUPLICATE_JSON_KEY/);
});

test("qualification manifest inputs cannot escape their directory", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "apex-qualification-path-"));
  const manifestPath = path.join(directory, "manifest.json");
  const inputPath = path.join(directory, "outcome.json");
  const outsidePath = path.join(path.dirname(directory), `${path.basename(directory)}-outside.json`);
  try {
    writeFileSync(manifestPath, "{}", "utf8");
    writeFileSync(inputPath, "{}", "utf8");
    writeFileSync(outsidePath, "{}", "utf8");
    symlinkSync(outsidePath, path.join(directory, "outside-link.json"));
    assert.equal(resolveInputPath(manifestPath, "outcome.json"), inputPath);
    assert.throws(() => resolveInputPath(manifestPath, outsidePath), /MANIFEST_PATH_INVALID/);
    assert.throws(() => resolveInputPath(manifestPath, `../${path.basename(outsidePath)}`), /MANIFEST_PATH_INVALID/);
    assert.throws(() => resolveInputPath(manifestPath, "outside-link.json"), /MANIFEST_PATH_INVALID/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outsidePath, { force: true });
  }
});

test("CLI rejects duplicate keys and oversized files with sanitized errors and writes 0600 exclusively", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "apex-client-outcome-"));
  try {
    const inputPath = path.join(directory, "input.json");
    const outputPath = path.join(directory, "outcome.json");
    writeFileSync(inputPath, JSON.stringify(input("CLIENT-010", "github-copilot-cli")));
    const collected = spawnSync(process.execPath, ["tools/scripts/collect-client-outcome.mjs", inputPath, outputPath], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(collected.status, 0, collected.stderr);
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(outputPath, "utf8")).scenarioId, "CLIENT-010");
    const exclusive = spawnSync(process.execPath, ["tools/scripts/collect-client-outcome.mjs", inputPath, outputPath], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(exclusive.status, 2);
    assert.equal(exclusive.stderr.includes(inputPath), false);
    assert.equal(exclusive.stderr.includes(outputPath), false);

    const duplicatePath = path.join(directory, "duplicate.json");
    writeFileSync(duplicatePath, '{"schemaVersion":"1.0.0","schemaVersion":"1.0.0"}');
    const duplicate = spawnSync(process.execPath, ["tools/scripts/collect-client-outcome.mjs", duplicatePath], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(duplicate.status, 2);
    assert.match(duplicate.stderr, /DUPLICATE_JSON_KEY/);
    assert.equal(duplicate.stderr.includes(duplicatePath), false);

    const oversizePath = path.join(directory, "oversize.json");
    writeFileSync(oversizePath, " ".repeat(262_145));
    const oversize = spawnSync(process.execPath, ["tools/scripts/collect-client-outcome.mjs", oversizePath], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(oversize.status, 2);
    assert.match(oversize.stderr, /INPUT_TOO_LARGE/);

    const manifest = { schemaVersion: "1.0.0", triplets: [] };
    CLIENT_OUTCOME_SCENARIO_CORPUS.scenarios.forEach(({ id }, index) => {
      const scenarioTriplet = triplet(id);
      const vscodePath = path.join(directory, `vscode-${index}.json`);
      const cliPath = path.join(directory, `cli-${index}.json`);
      const comparisonPath = path.join(directory, `comparison-${index}.json`);
      writeFileSync(
        vscodePath,
        canonicalJson(scenarioTriplet.outcomes.find(({ client }) => client.id === "github-copilot-vscode")),
      );
      writeFileSync(
        cliPath,
        canonicalJson(scenarioTriplet.outcomes.find(({ client }) => client.id === "github-copilot-cli")),
      );
      writeFileSync(comparisonPath, canonicalJson(scenarioTriplet.comparison));
      manifest.triplets.push({
        scenarioId: id,
        vscodeOutcomePath: path.basename(vscodePath),
        cliOutcomePath: path.basename(cliPath),
        comparisonPath: path.basename(comparisonPath),
      });
    });
    const manifestPath = path.join(directory, "qualification-manifest.json");
    writeFileSync(manifestPath, canonicalJson(manifest));
    const qualificationPath = path.join(directory, "qualification.json");
    const qualified = spawnSync(
      process.execPath,
      ["tools/scripts/qualify-client-outcomes.mjs", qualificationPath, manifestPath],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(qualified.status, 2);
    assert.match(qualified.stderr, /LIVE_TOOLCHAIN_UNAVAILABLE/);
    assert.throws(() => statSync(qualificationPath));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
