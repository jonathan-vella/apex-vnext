import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CLIENT_OUTCOME_CLIENT_IDS,
  CLIENT_OUTCOME_SCENARIO_IDS,
  createClientQualificationEvidenceEntry,
} from "../../packages/contracts/dist/index.js";
import { canonicalJson, sha256Json } from "../../packages/kernel/dist/index.js";
import { bindClientOutcomeEvidence } from "../scripts/bind-client-outcome-evidence.mjs";
import { composeClientOutcomeClosure } from "../scripts/compose-client-outcome-closure.mjs";
import {
  CLIENT_OUTCOME_SCENARIO_CORPUS,
  CLIENT_OUTCOME_SCENARIO_CORPUS_HASH,
  CLIENT_OUTCOME_TOOLCHAIN,
  CLIENT_OUTCOME_TOOLCHAIN_HASH,
  collectClientOutcome,
} from "../scripts/collect-client-outcome.mjs";
import { validateClientRuntimeEvidence, validateEvidencePayloads } from "../scripts/live-qualification.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hash = (character) => character.repeat(64);

function runtimePayload(kind, value) {
  const bytes = Buffer.from(canonicalJson(value));
  return {
    bytes,
    entry: { kind, hash: digest(bytes), bytes: bytes.length, required: true, retention: "immutable" },
  };
}

function liveOutcomeFixture(scenarioId, clientId) {
  const scenario = CLIENT_OUTCOME_SCENARIO_CORPUS.scenarios.find(({ id }) => id === scenarioId);
  const payloads = [];
  const observed = (kind, name) => {
    const payload = runtimePayload(kind, { name, scenarioId });
    payloads.push(payload);
    return payload.entry.hash;
  };
  const proof = {
    gates: scenario.requiredGates.map((gate) => ({ gate, state: "approved" })),
    artifacts: Object.fromEntries(
      scenario.requiredArtifacts.map((name) => [name, observed(`client-artifact:${name}`, name)]),
    ),
    evidence: Object.fromEntries(
      scenario.requiredEvidence.map((name) => [name, observed(`client-evidence:${name}`, name)]),
    ),
    denialCodes: [...scenario.requiredDenialCodes],
    transfer: structuredClone(scenario.transferPredicate),
    assertions: Object.fromEntries(scenario.requiredAssertions.map((name) => [name, "pass"])),
  };
  const semanticEvents = [
    { type: "task", node: "quality", taskState: "completed" },
    ...proof.gates.map(({ gate, state }) => ({ type: "gate", gate, gateState: state })),
    ...Object.entries(proof.artifacts).map(([artifact, artifactHash]) => ({
      type: "artifact",
      artifact,
      artifactHash,
    })),
    ...Object.entries(proof.evidence).map(([evidence, evidenceHash]) => ({ type: "evidence", evidence, evidenceHash })),
    ...proof.denialCodes.map((denialCode) => ({ type: "denial", denialCode })),
    { type: "transfer", transferResult: proof.transfer.result, ownerEpochDelta: proof.transfer.ownerEpochDelta },
    ...Object.entries(proof.assertions).map(([assertion, assertionState]) => ({
      type: "assertion",
      assertion,
      assertionState,
    })),
  ];
  let previousHash = hash("0");
  const records = semanticEvents.map((semanticProjection, index) => {
    const payload = { semanticProjection, sourceIdentity: `source-${index}` };
    const payloadEvidence = runtimePayload("client-journal-payload", payload);
    payloads.push(payloadEvidence);
    const content = {
      sequence: index + 1,
      type: semanticProjection.type.toUpperCase(),
      previousHash,
      payloadHash: payloadEvidence.entry.hash,
      payload,
      ownerEpoch: 1,
    };
    const record = { ...content, hash: sha256Json(content) };
    previousHash = record.hash;
    return record;
  });
  const receipt = { schemaVersion: "1.0.0", head: records.at(-1).hash, records };
  const source = runtimePayload("client-journal-source", { schemaVersion: receipt.schemaVersion, records });
  const semantic = runtimePayload("client-semantic-journal", semanticEvents);
  const attestation = runtimePayload("client-journal-attestation", {
    rawJournalHead: receipt.head,
    rawJournalSourceDigest: source.entry.hash,
    semanticJournalHash: semantic.entry.hash,
  });
  const evidenceRef = runtimePayload("client-evidence-ref", { clientId, scenarioId, type: "evidence-ref" });
  payloads.push(source, semantic, attestation, evidenceRef);
  const cli = CLIENT_OUTCOME_TOOLCHAIN.core.copilotCli;
  const input = {
    schemaVersion: "1.0.0",
    scenarioId,
    evidenceKind: "live",
    candidate: {
      repository: "jonathan-vella/apex-vnext",
      branch: "main",
      commit: "b".repeat(40),
      packageLockHash: hash("1"),
      releaseManifestHash: hash("2"),
      runtimeBundleHash: hash("3"),
      customizationBundleHash: hash("4"),
      scenarioCorpusHash: CLIENT_OUTCOME_SCENARIO_CORPUS_HASH,
      toolchainHash: CLIENT_OUTCOME_TOOLCHAIN_HASH,
    },
    client: {
      id: clientId,
      version: clientId === "github-copilot-cli" ? cli.selectedExactVersion : "1.134.0",
      binarySha256: clientId === "github-copilot-cli" ? hash("8") : hash("9"),
      ...(clientId === "github-copilot-vscode" ? { extensionVersion: "0.60.0" } : {}),
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
    journalReceipt: receipt,
    observations: proof,
    disposition: { status: "pass" },
    evidence: { refs: [evidenceRef.entry.hash], contentCapture: false },
  };
  return { outcome: collectClientOutcome(input), payloads };
}

function writeClosure(root) {
  const closureRoot = path.join(root, "closure");
  mkdirSync(path.join(closureRoot, "outcomes"), { recursive: true });
  mkdirSync(path.join(closureRoot, "comparisons"), { recursive: true });
  const outcomes = [];
  for (let index = 0; index < CLIENT_OUTCOME_SCENARIO_IDS.length * CLIENT_OUTCOME_CLIENT_IDS.length; index += 1) {
    const relative = path.join("outcomes", `${index}.json`);
    const bytes = Buffer.from(canonicalJson({ index, type: "outcome" }));
    writeFileSync(path.join(closureRoot, relative), bytes);
    outcomes.push({ path: relative, kind: "client-outcome", bytes: bytes.length, sha256: digest(bytes) });
  }
  const comparisons = [];
  for (let index = 0; index < CLIENT_OUTCOME_SCENARIO_IDS.length; index += 1) {
    const relative = path.join("comparisons", `${index}.json`);
    const bytes = Buffer.from(canonicalJson({ index, type: "comparison" }));
    writeFileSync(path.join(closureRoot, relative), bytes);
    comparisons.push({
      path: relative,
      kind: "client-outcome-comparison",
      bytes: bytes.length,
      sha256: digest(bytes),
    });
  }
  const qualificationBytes = Buffer.from("{}");
  writeFileSync(path.join(closureRoot, "client-qualification.json"), qualificationBytes);
  const content = {
    schemaVersion: "1.0.0",
    kind: "client-outcome-closure-v1",
    outcomes,
    comparisons,
    qualification: {
      path: "client-qualification.json",
      kind: "client-qualification",
      bytes: qualificationBytes.length,
      sha256: digest(qualificationBytes),
      qualificationId: hash("a"),
    },
    qualifiesClientParity: true,
    qualifiesRelease: false,
  };
  const closure = { ...content, closureId: sha256Json(content) };
  const closurePath = path.join(closureRoot, "closure.json");
  writeFileSync(closurePath, canonicalJson(closure));
  return { closurePath, closure, qualificationBytes };
}

function writeBindingFixture(root) {
  const candidate = {
    repository: "https://github.com/jonathan-vella/apex-vnext",
    branch: "main",
    commit: "b".repeat(40),
    packageLockHash: hash("1"),
    releaseManifestHash: hash("2"),
    runtimeBundleHash: hash("3"),
    customizationBundleHash: hash("4"),
  };
  writeFileSync(path.join(root, "candidate.json"), canonicalJson(candidate));
  const baseBytes = Buffer.from("runtime-evidence");
  writeFileSync(path.join(root, "runtime.bin"), baseBytes);
  const baseManifest = {
    schemaVersion: "1.0.0",
    projectId: "demo",
    runId: "run-demo",
    createdAt: "2026-07-31T00:00:00.000Z",
    entries: [
      {
        kind: "runtime-evidence",
        hash: digest(baseBytes),
        bytes: baseBytes.length,
        required: true,
        retention: "immutable",
      },
    ],
  };
  writeFileSync(path.join(root, "evidence-manifest.json"), canonicalJson(baseManifest));
  const closure = writeClosure(root);
  const binding = {
    schemaVersion: "1.0.0",
    candidatePath: "candidate.json",
    evidenceManifestPath: "evidence-manifest.json",
    evidencePayloadPaths: ["runtime.bin"],
    clientClosurePath: path.relative(root, closure.closurePath),
  };
  const bindingPath = path.join(root, "binding-manifest.json");
  writeFileSync(bindingPath, canonicalJson(binding));
  return { bindingPath, candidate, baseBytes, baseManifest, ...closure };
}

test("binds complete live outcomes and runtime payloads deterministically", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "apex-live-client-evidence-"));
  try {
    const outcomesRoot = path.join(root, "outcomes");
    const runtimeRoot = path.join(root, "runtime");
    mkdirSync(outcomesRoot, { recursive: true });
    mkdirSync(runtimeRoot, { recursive: true });
    const outcomeManifest = { schemaVersion: "1.0.0", outcomes: [] };
    const payloads = new Map();
    for (const scenarioId of CLIENT_OUTCOME_SCENARIO_IDS) {
      for (const clientId of CLIENT_OUTCOME_CLIENT_IDS) {
        const fixture = liveOutcomeFixture(scenarioId, clientId);
        const client = clientId === "github-copilot-vscode" ? "vscode" : "cli";
        const outcomePath = path.join("outcomes", `${scenarioId}-${client}.json`);
        writeFileSync(path.join(root, outcomePath), canonicalJson(fixture.outcome));
        outcomeManifest.outcomes.push({ scenarioId, clientId, outcomePath });
        for (const payload of fixture.payloads) payloads.set(payload.entry.hash, payload);
      }
    }
    const outcomeManifestPath = path.join(root, "outcome-manifest.json");
    writeFileSync(outcomeManifestPath, canonicalJson(outcomeManifest));
    const closureRoot = path.join(root, "closure");
    const closure = await composeClientOutcomeClosure({ manifest: outcomeManifestPath, output: closureRoot });

    const evidencePayloadPaths = [];
    for (const [payloadHash, payload] of payloads) {
      const payloadPath = path.join("runtime", payloadHash);
      writeFileSync(path.join(root, payloadPath), payload.bytes);
      evidencePayloadPaths.push(payloadPath);
    }
    const baseManifest = {
      schemaVersion: "1.0.0",
      projectId: "demo",
      runId: "run-demo",
      createdAt: "2026-07-31T00:00:00.000Z",
      entries: [...payloads.values()].map(({ entry }) => entry),
    };
    writeFileSync(path.join(root, "evidence-manifest.json"), canonicalJson(baseManifest));
    const candidate = {
      repository: "https://github.com/jonathan-vella/apex-vnext",
      branch: "main",
      commit: "b".repeat(40),
      packageLockHash: hash("1"),
      releaseManifestHash: hash("2"),
      runtimeBundleHash: hash("3"),
      customizationBundleHash: hash("4"),
    };
    writeFileSync(path.join(root, "candidate.json"), canonicalJson(candidate));
    const binding = {
      schemaVersion: "1.0.0",
      candidatePath: "candidate.json",
      evidenceManifestPath: "evidence-manifest.json",
      evidencePayloadPaths,
      clientClosurePath: "closure/closure.json",
    };
    const bindingPath = path.join(root, "binding.json");
    writeFileSync(bindingPath, canonicalJson(binding));
    const qualificationBytes = readFileSync(path.join(closureRoot, closure.qualification.path));
    const combinedManifest = {
      ...baseManifest,
      entries: [
        ...baseManifest.entries,
        ...[...closure.outcomes, ...closure.comparisons].map(({ kind, sha256: payloadHash, bytes }) => ({
          kind,
          hash: payloadHash,
          bytes,
          required: true,
          retention: "immutable",
        })),
      ],
      clientQualification: createClientQualificationEvidenceEntry(qualificationBytes),
    };
    const validationPayloads = [
      ...[...payloads.entries()].map(([payloadHash, payload]) => ({ path: payloadHash, bytes: payload.bytes })),
      ...[...closure.outcomes, ...closure.comparisons, closure.qualification].map((entry) => ({
        path: entry.path,
        bytes: readFileSync(path.join(closureRoot, entry.path)),
      })),
    ];
    const entriesByHash = new Map(
      [...combinedManifest.entries, combinedManifest.clientQualification].map((entry) => [entry.hash, entry]),
    );
    const payloadBytesByHash = new Map(validationPayloads.map(({ bytes }) => [digest(bytes), bytes]));
    const parsedOutcomes = closure.outcomes.map((entry) =>
      JSON.parse(readFileSync(path.join(closureRoot, entry.path), "utf8")),
    );
    assert.deepEqual(validateClientRuntimeEvidence(parsedOutcomes, entriesByHash, payloadBytesByHash), []);
    assert.deepEqual(
      validateEvidencePayloads(combinedManifest, validationPayloads, {
        requireClientQualification: true,
        projectId: "demo",
        candidate,
      }),
      [],
    );
    const first = await bindClientOutcomeEvidence({ manifest: bindingPath, output: path.join(root, "bound-first") });
    const second = await bindClientOutcomeEvidence({ manifest: bindingPath, output: path.join(root, "bound-second") });
    assert.deepEqual(first, second);
    assert.equal(first.qualifiesClientParity, true);
    assert.equal(first.qualifiesRelease, false);
    assert.equal(
      first.bindingId,
      sha256Json(Object.fromEntries(Object.entries(first).filter(([key]) => key !== "bindingId"))),
    );
    assert.equal(statSync(path.join(root, "bound-first")).mode & 0o777, 0o700);
    assert.equal(statSync(path.join(root, "bound-first", "binding.json")).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("client evidence binding fails closed before publishing incomplete proof", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "apex-client-evidence-binding-"));
  try {
    const fixture = writeBindingFixture(root);
    const canonicalOutput = path.join(root, "canonical-rejected");
    await assert.rejects(
      bindClientOutcomeEvidence({ manifest: fixture.bindingPath, output: canonicalOutput }),
      /CLIENT_QUALIFICATION_SCHEMA_INVALID/,
    );
    assert.throws(() => statSync(canonicalOutput));

    const cliOutput = path.join(root, "cli-rejected");
    const cli = spawnSync(
      process.execPath,
      ["tools/scripts/bind-client-outcome-evidence.mjs", cliOutput, fixture.bindingPath],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(cli.status, 2);
    assert.match(cli.stderr, /CLIENT_OUTCOME_EVIDENCE_BINDING_FAILED:CLIENT_QUALIFICATION_SCHEMA_INVALID/);
    assert.equal(cli.stderr.includes(root), false);
    assert.throws(() => statSync(cliOutput));

    writeFileSync(path.join(path.dirname(fixture.closurePath), fixture.closure.outcomes[0].path), "tampered");
    const tamperedOutput = path.join(root, "tampered");
    await assert.rejects(
      bindClientOutcomeEvidence({ manifest: fixture.bindingPath, output: tamperedOutput }),
      /CLIENT_CLOSURE_PAYLOAD_INVALID/,
    );
    assert.throws(() => statSync(tamperedOutput));

    const bindingLink = path.join(root, "binding-link.json");
    symlinkSync(fixture.bindingPath, bindingLink);
    const symlinkOutput = path.join(root, "symlinked");
    await assert.rejects(bindClientOutcomeEvidence({ manifest: bindingLink, output: symlinkOutput }), /ELOOP/);
    assert.throws(() => statSync(symlinkOutput));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
