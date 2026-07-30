import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LIVE_QUALIFICATION_SCENARIO_IDS,
  SECRET_FIELD_PATTERN,
  SECRET_VALUE_PATTERN,
  hasValidLiveQualification,
} from "../../../packages/contracts/dist/index.js";
import { ApexService } from "../../../packages/cli/dist/index.js";
import { EventJournal, ObjectStore, sha256Json } from "../../../packages/kernel/dist/index.js";
import {
  assertCleanGitStatus,
  assertOutputOutsideDisposableRoot,
  assertReleaseManifest,
  collectCliSurfaceEvidence,
  collectCurrentCandidate,
  collectGuidedCheckpoint,
  collectClientInputEvidence,
  collectLifecycleEvidence,
  collectWorkspacePreparation,
  collectRuntimeEvidence,
  collectRestartEvidence,
  collectVscodeSurfaceEvidence,
  cleanupWorkspacePreparation,
  createEvidenceManifestTemplate,
  createLiveQualificationTemplate,
  packageRepository,
  parseLiveQualificationArguments,
  renderLiveQualification,
  validateEvidencePayloads,
  validateLiveQualification,
  writeWorkspacePreparation,
} from "../../scripts/live-qualification.mjs";

const hash = "a".repeat(64);
const otherHash = "b".repeat(64);
const timestamp = "2026-07-15T08:00:00.000Z";
const scenarioIds = [...LIVE_QUALIFICATION_SCENARIO_IDS];
const candidate = {
  repository: "https://github.com/jonathan-vella/apex-vnext",
  branch: "main",
  commit: "c".repeat(40),
  packageLockHash: hash,
  releaseManifestHash: otherHash,
  runtimeBundleHash: "d".repeat(64),
  customizationBundleHash: "e".repeat(64),
};
const dependencies = {
  qualificationSchemaErrors: () => [],
  evidenceManifestSchemaErrors: () => [],
  hasValidLiveQualification,
  secretFieldPattern: SECRET_FIELD_PATTERN,
  secretValuePattern: SECRET_VALUE_PATTERN,
};

const releaseManifest = {
  version: 1,
  sourceCommit: candidate.commit,
  sourceRepository: "git+https://github.com/jonathan-vella/apex-vnext.git",
  toolchain: { node: "24.18.0" },
  packages: [
    {
      package: "@apex/cli",
      version: "0.10.0",
      file: "apex-cli-0.10.0.tgz",
      sha256: hash,
      bytes: 1,
      dependencies: {},
    },
  ],
  security: {
    sbom: { file: "sbom.cdx.json", sha256: hash },
    provenance: { file: "provenance.intoto.jsonl", sha256: otherHash },
  },
};

function fixture() {
  const evidenceManifest = createEvidenceManifestTemplate({
    projectId: "live-test",
    runId: "run-1",
    createdAt: timestamp,
  });
  const qualification = createLiveQualificationTemplate({
    scenarioIds,
    projectId: evidenceManifest.projectId,
    runId: evidenceManifest.runId,
    candidate,
    evidenceManifestHash: hash,
    createdAt: timestamp,
    actor: "maintainer",
    environment: "sandbox",
    targetScope: "subscription/example",
    toolVersions: { apex: "0.10.0" },
  });
  return { evidenceManifest, qualification, actual: { candidate, evidenceManifestHash: hash } };
}

test("parses bounded live qualification commands", () => {
  assert.deepEqual(
    parseLiveQualificationArguments(["candidate", "--release-manifest", "release.json", "--output", "candidate.json"]),
    {
      command: "candidate",
      "release-manifest": "release.json",
      output: "candidate.json",
    },
  );
  assert.deepEqual(
    parseLiveQualificationArguments(["cleanup", "--root", "/tmp/qualification", "--preparation", "preparation.json"]),
    { command: "cleanup", root: "/tmp/qualification", preparation: "preparation.json" },
  );
  assert.deepEqual(parseLiveQualificationArguments(["render", "--file", "qualification.json"]), {
    command: "render",
    file: "qualification.json",
  });
  assert.deepEqual(
    parseLiveQualificationArguments([
      "cli",
      "--workspace",
      "consumer",
      "--binary",
      "bin/copilot",
      "--output",
      "cli.json",
    ]),
    { command: "cli", workspace: "consumer", binary: "bin/copilot", output: "cli.json" },
  );
  assert.deepEqual(
    parseLiveQualificationArguments([
      "checkpoint",
      "--release-manifest",
      "release.json",
      "--project",
      "demo",
      "--run",
      "run-1",
      "--cli-workspace",
      "cli",
      "--cli-binary",
      "bin/copilot",
      "--lifecycle-root",
      "/tmp/lifecycle-run",
      "--vscode-workspace",
      "vscode",
      "--vscode-host",
      "/opt/code",
      "--output",
      "checkpoint.json",
      "--previous",
      "previous.json",
    ]),
    {
      command: "checkpoint",
      "release-manifest": "release.json",
      project: "demo",
      run: "run-1",
      "cli-workspace": "cli",
      "cli-binary": "bin/copilot",
      "lifecycle-root": "/tmp/lifecycle-run",
      "vscode-workspace": "vscode",
      "vscode-host": "/opt/code",
      output: "checkpoint.json",
      previous: "previous.json",
    },
  );
  assert.deepEqual(
    parseLiveQualificationArguments(["runtime", "--project", "demo", "--run", "run-1", "--output", "runtime.json"]),
    { command: "runtime", project: "demo", run: "run-1", output: "runtime.json" },
  );
  assert.deepEqual(
    parseLiveQualificationArguments(["lifecycle", "--root", "/tmp/lifecycle", "--output", "lifecycle.json"]),
    { command: "lifecycle", root: "/tmp/lifecycle", output: "lifecycle.json" },
  );
  assert.deepEqual(parseLiveQualificationArguments(["input", "--workspace", "consumer", "--output", "input.json"]), {
    command: "input",
    workspace: "consumer",
    output: "input.json",
  });
  assert.deepEqual(
    parseLiveQualificationArguments(["restart", "--workspace", "consumer", "--output", "restart.json"]),
    { command: "restart", workspace: "consumer", output: "restart.json" },
  );
  assert.deepEqual(
    parseLiveQualificationArguments([
      "prepare",
      "--root",
      "/tmp/qualification",
      "--release-manifest",
      "release.json",
      "--output",
      "preparation.json",
    ]),
    {
      command: "prepare",
      root: "/tmp/qualification",
      "release-manifest": "release.json",
      output: "preparation.json",
    },
  );
  assert.deepEqual(
    parseLiveQualificationArguments([
      "vscode",
      "--workspace",
      "consumer",
      "--host",
      "/opt/code",
      "--output",
      "vscode.json",
    ]),
    { command: "vscode", workspace: "consumer", host: "/opt/code", output: "vscode.json" },
  );
  assert.deepEqual(
    parseLiveQualificationArguments(["validate", "--evidence-file", "first.json", "--evidence-file", "second.json"]),
    {
      command: "validate",
      "evidence-file": ["first.json", "second.json"],
    },
  );
  assert.throws(() => parseLiveQualificationArguments(["validate", "--unknown", "value"]), /Unknown/);
});

function fakeLifecycleService(root, calls, failUpdate = false) {
  let clientId;
  const writeLock = async (stage) => {
    await mkdir(join(root, ".apex"), { recursive: true });
    await writeFile(
      join(root, ".apex", "customizations.lock.json"),
      `${JSON.stringify({
        version: 1,
        clientId,
        files: [{ path: `${stage}.txt`, currentHash: hash }],
        runtime: [],
      })}\n`,
    );
  };
  return {
    async init(input) {
      clientId = input.clientId;
      calls.push(`${clientId}:init`);
      await writeLock("init");
    },
    async update() {
      calls.push(`${clientId}:update`);
      if (failUpdate) throw new Error("injected lifecycle failure");
      await writeLock("update");
    },
    async rollbackCustomizations() {
      calls.push(`${clientId}:rollback`);
      await writeLock("rollback");
      return { restored: ["managed"], conflicts: [] };
    },
    async uninstallCustomizations() {
      calls.push(`${clientId}:uninstall`);
      await rm(join(root, ".apex", "customizations.lock.json"));
      return { removed: ["managed"], conflicts: [] };
    },
    async reinstallCustomizations() {
      calls.push(`${clientId}:reinstall`);
      await writeLock("reinstall");
      return { installed: ["managed"], clientId };
    },
  };
}

function fakePreparationService(root, calls, failClient, driftClient) {
  return {
    async init({ projectId, clientId }) {
      calls.push(clientId);
      if (clientId === failClient) throw new Error("injected preparation failure");
      const managedRelativePath = clientId === "github-copilot-cli" ? ".github/mcp.json" : ".vscode/mcp.json";
      const managedPath =
        clientId === "github-copilot-cli" ? join(root, ".github", "mcp.json") : join(root, ".vscode", "mcp.json");
      const managedBytes = Buffer.from("{}\n");
      await mkdir(join(root, ".apex"), { recursive: true });
      await mkdir(clientId === "github-copilot-cli" ? join(root, ".github") : join(root, ".vscode"));
      await writeFile(managedPath, managedBytes);
      await writeFile(
        join(root, ".apex", "customizations.lock.json"),
        `${JSON.stringify({
          version: 1,
          clientId,
          files: [
            {
              path: managedRelativePath,
              currentHash: createHash("sha256").update(managedBytes).digest("hex"),
            },
          ],
        })}\n`,
      );
      await writeFile(
        join(root, ".apex", "config.json"),
        `${JSON.stringify({ projectId, runId: `run-${clientId}` })}\n`,
      );
      if (clientId === driftClient) await writeFile(managedPath, "drift\n");
      return { projectId, runId: `run-${clientId}` };
    },
  };
}

test("prepares exact paired client workspaces and cleans partial failure", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "apex-preparation-parent-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "qualification");
  const calls = [];
  const preparation = await collectWorkspacePreparation(
    { root },
    {
      collectCandidate: async () => candidate,
      serviceFactory: (workspace) => fakePreparationService(workspace, calls),
    },
  );
  assert.equal(preparation.kind, "guided-client-preparation-v1");
  assert.equal(preparation.candidate.commit, candidate.commit);
  assert.match(preparation.preparationId, /^[0-9a-f]{64}$/u);
  assert.equal(preparation.qualifiesClientParity, false);
  assert.equal(preparation.qualifiesRelease, false);
  const { preparationId, ...preparationContent } = preparation;
  assert.equal(preparationId, sha256Json(preparationContent));
  assert.deepEqual(calls, ["github-copilot-cli", "github-copilot-vscode"]);
  assert.equal(preparation.workspaces.cli.clientId, "github-copilot-cli");
  assert.equal(preparation.workspaces.vscode.clientId, "github-copilot-vscode");

  const failedRoot = join(parent, "failed");
  await assert.rejects(
    collectWorkspacePreparation(
      { root: failedRoot },
      {
        collectCandidate: async () => candidate,
        serviceFactory: (workspace) => fakePreparationService(workspace, [], "github-copilot-vscode"),
      },
    ),
    /injected preparation failure/,
  );
  await assert.rejects(lstat(failedRoot), (error) => error.code === "ENOENT");

  const driftedRoot = join(parent, "drifted");
  await assert.rejects(
    collectWorkspacePreparation(
      { root: driftedRoot },
      {
        collectCandidate: async () => candidate,
        serviceFactory: (workspace) => fakePreparationService(workspace, [], undefined, "github-copilot-vscode"),
      },
    ),
    /managed files do not match the customization lock/,
  );
  await assert.rejects(lstat(driftedRoot), (error) => error.code === "ENOENT");
});

test("exports content-free pending and recorded input evidence from a real workspace", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-input-adapter-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const service = new ApexService(root);
  await service.init({ projectId: "demo", clientId: "github-copilot-cli" });
  const pending = await service.nextTask();
  assert.equal(pending.status, "needs_input");
  if (pending.status !== "needs_input") return;
  const before = await collectClientInputEvidence({ workspace: "." }, { root });
  assert.equal(before.client.id, "github-copilot-cli");
  assert.equal(before.status, "pending");
  assert.deepEqual(before.interaction, { needsInput: "observed", typedAnswer: "pending" });
  assert.equal(before.qualifiesClientParity, false);
  assert.equal(before.qualifiesRelease, false);
  assert.match(before.source.customizationLockSha256, /^[0-9a-f]{64}$/u);
  assert.ok(before.source.managedFiles > 0);
  assert.doesNotMatch(JSON.stringify(before), /What workload|outcomes and constraints/u);

  await service.recordInput({
    schemaVersion: "1.0.0",
    requestId: pending.request.requestId,
    expectedHead: pending.request.expectedHead,
    ownerEpoch: pending.request.ownerEpoch,
    answers: pending.request.questions.map(({ id }) => ({ questionId: id, value: `secret-${id}` })),
  });
  const after = await collectClientInputEvidence({ workspace: "." }, { root });
  assert.equal(after.status, "recorded");
  assert.deepEqual(after.interaction, { needsInput: "observed", typedAnswer: "observed" });
  assert.match(after.source.recordedEventHash, /^[0-9a-f]{64}$/u);
  assert.match(after.source.recordedPayloadHash, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(after), /secret-workload|secret-requirements/u);
  const { evidenceId, ...content } = after;
  assert.equal(evidenceId, sha256Json(content));
});

test("exports input evidence for the selected VS Code projection", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-vscode-input-adapter-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const service = new ApexService(root);
  await service.init({ projectId: "demo", clientId: "github-copilot-vscode" });
  const pending = await service.nextTask();
  assert.equal(pending.status, "needs_input");
  const evidence = await collectClientInputEvidence({ workspace: "." }, { root });
  assert.equal(evidence.client.id, "github-copilot-vscode");
  assert.equal(evidence.status, "pending");
  assert.match(evidence.source.customizationLockSha256, /^[0-9a-f]{64}$/u);
  assert.ok(evidence.source.managedFiles > 0);
  assert.equal(evidence.qualifiesClientParity, false);
  assert.equal(evidence.qualifiesRelease, false);
});

test("exports content-free restart evidence from distinct service instances", async (context) => {
  for (const clientId of ["github-copilot-cli", "github-copilot-vscode"]) {
    const root = await mkdtemp(join(tmpdir(), "apex-restart-adapter-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    const service = new ApexService(root);
    const initialized = await service.init({ projectId: "demo", clientId });
    await service.nextTask();
    const instances = [];
    const evidence = await collectRestartEvidence(
      { workspace: "." },
      {
        root,
        serviceFactory: (workspace) => {
          const instance = new ApexService(workspace);
          instances.push(instance);
          return instance;
        },
      },
    );
    assert.equal(instances.length, 2);
    assert.notEqual(instances[0], instances[1]);
    assert.equal(evidence.client.id, clientId);
    assert.equal(evidence.projectId, "demo");
    assert.equal(evidence.runId, initialized.runId);
    assert.equal(evidence.status, "observed");
    assert.match(evidence.source.stateDigest, /^[0-9a-f]{64}$/u);
    assert.equal(evidence.qualifiesClientParity, false);
    assert.equal(evidence.qualifiesRelease, false);
    assert.doesNotMatch(JSON.stringify(evidence), /What workload|outcomes and constraints/u);
    const { evidenceId, ...content } = evidence;
    assert.equal(evidenceId, sha256Json(content));
  }
});

test("restart evidence rejects state changes and managed projection drift", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-restart-refusal-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const service = new ApexService(root);
  const initialized = await service.init({ projectId: "demo", clientId: "github-copilot-cli" });
  await service.nextTask();
  const singleton = new ApexService(root);
  await assert.rejects(
    collectRestartEvidence({ workspace: "." }, { root, serviceFactory: () => singleton }),
    /requires distinct service instances/,
  );
  let calls = 0;
  await assert.rejects(
    collectRestartEvidence(
      { workspace: "." },
      {
        root,
        serviceFactory: () => ({
          async status() {
            calls += 1;
            const status = await new ApexService(root).status();
            return calls === 1 ? status : { ...status, events: status.events + 1 };
          },
        }),
      },
    ),
    /Restart changed persisted workspace state/,
  );
  await writeFile(join(root, ".github", "mcp.json"), "{}\n");
  await assert.rejects(collectRestartEvidence({ workspace: "." }, { root }), /managed files do not match/);
  assert.match(initialized.runId, /^[A-Za-z0-9_-]+$/u);
});

test("restart evidence rejects journal mutation and malformed status", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-restart-mutation-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const service = new ApexService(root);
  await service.init({ projectId: "demo", clientId: "github-copilot-cli" });
  await service.nextTask();
  const status = await service.status();
  const journal = new EventJournal(join(root, ".apex", "projects", "demo", "runs", status.run.runId, "journal"));
  let calls = 0;
  await assert.rejects(
    collectRestartEvidence(
      { workspace: "." },
      {
        root,
        serviceFactory: () => ({
          async status() {
            calls += 1;
            if (calls === 1) {
              await journal.append({
                eventId: "restart-mutation",
                projectId: "demo",
                runId: status.run.runId,
                type: "unrecognized.restart-mutation",
                timestamp,
                ownerEpoch: status.run.ownerEpoch,
                expectedHead: await journal.head(),
                payload: {},
              });
            }
            return new ApexService(root).status();
          },
        }),
      },
    ),
    /Restart changed persisted workspace state/,
  );

  for (const malformed of [
    { ...status, head: null },
    { ...status, events: 0 },
    { ...status, task: "" },
    { ...status, blockers: [123] },
    { ...status, run: { ...status.run, projectId: "../bad" } },
  ]) {
    await assert.rejects(
      collectRestartEvidence({ workspace: "." }, { root, serviceFactory: () => ({ status: async () => malformed }) }),
      /Restart status is invalid|Restart changed persisted workspace state/,
    );
  }
});

test("restart command refuses to overwrite an existing evidence file", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-restart-output-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const service = new ApexService(root);
  await service.init({ projectId: "demo", clientId: "github-copilot-cli" });
  await service.nextTask();
  const output = join(root, "existing.json");
  await writeFile(output, "preserve\n");
  const result = spawnSync(
    process.execPath,
    ["tools/scripts/live-qualification.mjs", "restart", "--workspace", root, "--output", output],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EEXIST|file already exists/u);
  assert.equal(await readFile(output, "utf8"), "preserve\n");
});

test("input command refuses to overwrite an existing evidence file", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-input-output-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const service = new ApexService(root);
  await service.init({ projectId: "demo", clientId: "github-copilot-cli" });
  await service.nextTask();
  const output = join(root, "existing.json");
  await writeFile(output, "preserve\n");
  const result = spawnSync(
    process.execPath,
    ["tools/scripts/live-qualification.mjs", "input", "--workspace", root, "--output", output],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EEXIST|file already exists/u);
  assert.equal(await readFile(output, "utf8"), "preserve\n");
});

test("input evidence rejects malformed, replayed, and drifted source state", async (context) => {
  const create = async (name) => {
    const root = await mkdtemp(join(tmpdir(), `apex-input-${name}-`));
    context.after(() => rm(root, { recursive: true, force: true }));
    const service = new ApexService(root);
    await service.init({ projectId: "demo", clientId: "github-copilot-cli" });
    const pending = await service.nextTask();
    assert.equal(pending.status, "needs_input");
    if (pending.status !== "needs_input") throw new Error("fixture did not request input");
    const journalPath = join(root, ".apex", "projects", "demo", "runs", (await service.status()).run.runId, "journal");
    const journal = new EventJournal(journalPath);
    return { root, service, pending, journal };
  };

  const malformed = await create("malformed");
  await malformed.journal.append({
    eventId: "malformed-record",
    projectId: "demo",
    runId: (await malformed.service.status()).run.runId,
    type: "requirements.input-recorded",
    timestamp,
    ownerEpoch: malformed.pending.request.ownerEpoch,
    expectedHead: await malformed.journal.head(),
    payload: { requestId: malformed.pending.request.requestId, answers: [] },
  });
  await assert.rejects(
    collectClientInputEvidence({ workspace: "." }, { root: malformed.root }),
    /recorded event has invalid payload/,
  );

  const numericRequest = await create("numeric-request");
  const numericEvents = await numericRequest.journal.replay();
  const numericEvent = numericEvents.find((event) => event.type === "requirements.input-requested");
  assert.ok(numericEvent);
  numericEvent.payload.requestId = 123;
  numericEvent.payloadHash = sha256Json(numericEvent.payload);
  const { hash: _numericHash, ...numericContent } = numericEvent;
  numericEvent.hash = sha256Json(numericContent);
  await writeFile(
    join(numericRequest.journal.directory, `${String(numericEvent.sequence).padStart(16, "0")}.json`),
    `${JSON.stringify(numericEvent)}\n`,
  );
  await assert.rejects(
    collectClientInputEvidence({ workspace: "." }, { root: numericRequest.root }),
    /request event has invalid payload/,
  );

  const replayed = await create("replayed");
  const submission = {
    schemaVersion: "1.0.0",
    requestId: replayed.pending.request.requestId,
    expectedHead: replayed.pending.request.expectedHead,
    ownerEpoch: replayed.pending.request.ownerEpoch,
    answers: replayed.pending.request.questions.map(({ id }) => ({ questionId: id, value: id })),
  };
  await replayed.service.recordInput(submission);
  await replayed.journal.append({
    eventId: "replayed-record",
    projectId: "demo",
    runId: (await replayed.service.status()).run.runId,
    type: "requirements.input-recorded",
    timestamp,
    ownerEpoch: replayed.pending.request.ownerEpoch,
    expectedHead: await replayed.journal.head(),
    payload: { requestId: submission.requestId, answers: submission.answers },
  });
  await assert.rejects(
    collectClientInputEvidence({ workspace: "." }, { root: replayed.root }),
    /does not match one request/,
  );

  const nonCanonical = await create("non-canonical");
  const runId = (await nonCanonical.service.status()).run.runId;
  const requestEvent = (await nonCanonical.journal.replay()).find(
    (event) => event.type === "requirements.input-requested",
  );
  assert.ok(requestEvent);
  requestEvent.payload.questions = [
    { id: "regions", prompt: "Select regions", options: ["primary", "secondary"], multiSelect: true },
  ];
  requestEvent.payloadHash = sha256Json(requestEvent.payload);
  const { hash: _hash, ...requestContent } = requestEvent;
  requestEvent.hash = sha256Json(requestContent);
  await writeFile(
    join(nonCanonical.journal.directory, `${String(requestEvent.sequence).padStart(16, "0")}.json`),
    `${JSON.stringify(requestEvent)}\n`,
  );
  await nonCanonical.journal.append({
    eventId: "non-canonical-record",
    projectId: "demo",
    runId,
    type: "requirements.input-recorded",
    timestamp,
    ownerEpoch: requestEvent.ownerEpoch,
    expectedHead: requestEvent.hash,
    payload: {
      requestId: requestEvent.payload.requestId,
      answers: [{ questionId: "regions", value: ["secondary", "primary"] }],
    },
  });
  await assert.rejects(
    collectClientInputEvidence({ workspace: "." }, { root: nonCanonical.root }),
    /recorded event has invalid payload/,
  );

  const drifted = await create("drifted");
  await writeFile(join(drifted.root, ".github", "mcp.json"), "{}\n");
  await assert.rejects(
    collectClientInputEvidence({ workspace: "." }, { root: drifted.root }),
    /managed files do not match/,
  );
});

test("preparation rejects unsafe roots and malformed initialized identity", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "apex-preparation-refusal-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  await assert.rejects(collectWorkspacePreparation({ root: "relative" }), /absolute path/);
  await assert.rejects(
    collectWorkspacePreparation({ root: parent }, { collectCandidate: async () => candidate }),
    /must not already exist/,
  );
  await assert.rejects(
    collectWorkspacePreparation(
      { root: join(parent, "inside"), output: join(parent, "inside", "preparation.json") },
      { collectCandidate: async () => candidate },
    ),
    /output must be outside the disposable root/,
  );
  const physicalParent = join(parent, "physical");
  const linkedParent = join(parent, "linked");
  await mkdir(physicalParent);
  await symlink(physicalParent, linkedParent);
  await assert.rejects(
    collectWorkspacePreparation({ root: join(linkedParent, "run") }, { collectCandidate: async () => candidate }),
    /parent must not resolve through a symlink/,
  );
  const malformedRoot = join(parent, "malformed");
  await assert.rejects(
    collectWorkspacePreparation(
      { root: malformedRoot },
      {
        collectCandidate: async () => candidate,
        serviceFactory: (workspace) => ({
          async init({ clientId, projectId }) {
            await mkdir(join(workspace, ".apex"), { recursive: true });
            await writeFile(
              join(workspace, ".apex", "customizations.lock.json"),
              `${JSON.stringify({ clientId, files: [{ path: "managed.txt" }] })}\n`,
            );
            return { projectId, runId: 123 };
          },
        }),
      },
    ),
    /Prepared workspace identity is invalid/,
  );
  await assert.rejects(lstat(malformedRoot), (error) => error.code === "ENOENT");
});

test("preparation cleans retained workspaces when receipt persistence fails", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "apex-preparation-write-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "qualification");
  await assert.rejects(
    writeWorkspacePreparation(
      { root, output: join(parent, "preparation.json") },
      {
        collect: (options) =>
          collectWorkspacePreparation(options, {
            collectCandidate: async () => candidate,
            serviceFactory: (workspace) => fakePreparationService(workspace, []),
          }),
        write: async () => {
          throw new Error("injected receipt failure");
        },
      },
    ),
    /injected receipt failure/,
  );
  await assert.rejects(lstat(root), (error) => error.code === "ENOENT");
});

test("cleanup removes only an exact receipt-bound prepared root", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "apex-preparation-cleanup-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "qualification");
  const preparation = await collectWorkspacePreparation(
    { root },
    {
      collectCandidate: async () => candidate,
      serviceFactory: (workspace) => fakePreparationService(workspace, []),
    },
  );
  const preparationPath = join(parent, "preparation.json");
  await writeFile(preparationPath, `${JSON.stringify(preparation)}\n`);
  const cleanup = await cleanupWorkspacePreparation({ root, preparation: preparationPath });
  assert.equal(cleanup.kind, "guided-client-cleanup-v1");
  assert.equal(cleanup.preparationId, preparation.preparationId);
  assert.equal(cleanup.removed, true);
  assert.equal(cleanup.qualifiesClientParity, false);
  assert.equal(cleanup.qualifiesRelease, false);
  const { cleanupId, ...cleanupContent } = cleanup;
  assert.equal(cleanupId, sha256Json(cleanupContent));
  await assert.rejects(lstat(root), (error) => error.code === "ENOENT");
});

test("cleanup refuses substituted or changed prepared roots", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "apex-preparation-cleanup-refusal-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const prepare = async (name) => {
    const root = join(parent, name);
    const preparation = await collectWorkspacePreparation(
      { root },
      {
        collectCandidate: async () => candidate,
        serviceFactory: (workspace) => fakePreparationService(workspace, []),
      },
    );
    const preparationPath = join(parent, `${name}.json`);
    await writeFile(preparationPath, `${JSON.stringify(preparation)}\n`);
    return { root, preparation, preparationPath };
  };
  const tampered = await prepare("tampered");
  const forged = { ...tampered.preparation, preparationId: "f".repeat(64) };
  await writeFile(tampered.preparationPath, `${JSON.stringify(forged)}\n`);
  await assert.rejects(
    cleanupWorkspacePreparation({ root: tampered.root, preparation: tampered.preparationPath }),
    /receipt is invalid/,
  );
  assert.equal((await lstat(tampered.root)).isDirectory(), true);

  const drifted = await prepare("drifted");
  await writeFile(join(drifted.root, "vscode", ".vscode", "mcp.json"), "drift\n");
  await assert.rejects(
    cleanupWorkspacePreparation({ root: drifted.root, preparation: drifted.preparationPath }),
    /no longer matches its receipt/,
  );
  assert.equal((await lstat(drifted.root)).isDirectory(), true);

  const unexpected = await prepare("unexpected");
  await writeFile(join(unexpected.root, "unrelated.txt"), "preserve\n");
  await assert.rejects(
    cleanupWorkspacePreparation({ root: unexpected.root, preparation: unexpected.preparationPath }),
    /unexpected entries/,
  );
  assert.equal(await readFile(join(unexpected.root, "unrelated.txt"), "utf8"), "preserve\n");

  const nested = await prepare("nested");
  await writeFile(join(nested.root, "cli", ".github", "unrelated.txt"), "preserve\n");
  await assert.rejects(
    cleanupWorkspacePreparation({ root: nested.root, preparation: nested.preparationPath }),
    /unexpected file/,
  );
  assert.equal(await readFile(join(nested.root, "cli", ".github", "unrelated.txt"), "utf8"), "preserve\n");

  const lateMutation = await prepare("late-mutation");
  await assert.rejects(
    cleanupWorkspacePreparation(
      { root: lateMutation.root, preparation: lateMutation.preparationPath },
      {
        move: async (source, destination) => {
          await rename(source, destination);
          await writeFile(join(destination, "vscode", ".vscode", "late.txt"), "preserve\n");
        },
      },
    ),
    /renamed data remains/,
  );
  const quarantine = join(parent, `.late-mutation.apex-cleanup-${lateMutation.preparation.preparationId.slice(0, 12)}`);
  assert.equal(await readFile(join(quarantine, "vscode", ".vscode", "late.txt"), "utf8"), "preserve\n");
});

test("cleanup refuses unsafe paths, marker mismatch, and occupied quarantine", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "apex-preparation-cleanup-safety-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const prepare = async (name) => {
    const root = join(parent, name);
    const preparation = await collectWorkspacePreparation(
      { root },
      {
        collectCandidate: async () => candidate,
        serviceFactory: (workspace) => fakePreparationService(workspace, []),
      },
    );
    const preparationPath = join(parent, `${name}.json`);
    await writeFile(preparationPath, `${JSON.stringify(preparation)}\n`);
    return { root, preparation, preparationPath };
  };

  const contained = await prepare("contained");
  const containedReceipt = join(contained.root, "preparation.json");
  await writeFile(containedReceipt, `${JSON.stringify(contained.preparation)}\n`);
  await assert.rejects(
    cleanupWorkspacePreparation({ root: contained.root, preparation: containedReceipt }),
    /outside the disposable root/,
  );
  assert.equal((await lstat(contained.root)).isDirectory(), true);

  for (const [name, malformed] of [
    ["null-receipt", null],
    ["array-receipt", []],
  ]) {
    const value = await prepare(name);
    await writeFile(value.preparationPath, `${JSON.stringify(malformed)}\n`);
    await assert.rejects(
      cleanupWorkspacePreparation({ root: value.root, preparation: value.preparationPath }),
      /Workspace preparation receipt is invalid/,
    );
    assert.equal((await lstat(value.root)).isDirectory(), true);
  }

  const markerMismatch = await prepare("marker-mismatch");
  await writeFile(
    join(markerMismatch.root, ".apex-preparation.json"),
    `${JSON.stringify({
      schemaVersion: "1.0.0",
      kind: "guided-client-preparation-marker-v1",
      preparationId: "f".repeat(64),
    })}\n`,
  );
  await assert.rejects(
    cleanupWorkspacePreparation({ root: markerMismatch.root, preparation: markerMismatch.preparationPath }),
    /marker is invalid/,
  );
  assert.equal((await lstat(markerMismatch.root)).isDirectory(), true);

  const occupied = await prepare("occupied");
  const occupiedQuarantine = join(parent, `.occupied.apex-cleanup-${occupied.preparation.preparationId.slice(0, 12)}`);
  await mkdir(occupiedQuarantine);
  await assert.rejects(
    cleanupWorkspacePreparation({ root: occupied.root, preparation: occupied.preparationPath }),
    /quarantine path already exists/,
  );
  assert.equal((await lstat(occupied.root)).isDirectory(), true);

  const physicalParent = join(parent, "physical");
  const linkedParent = join(parent, "linked");
  await mkdir(physicalParent);
  const symlinkedRoot = join(physicalParent, "qualification");
  const symlinkedPreparation = await collectWorkspacePreparation(
    { root: symlinkedRoot },
    {
      collectCandidate: async () => candidate,
      serviceFactory: (workspace) => fakePreparationService(workspace, []),
    },
  );
  const symlinkedPreparationPath = join(parent, "symlinked.json");
  await writeFile(symlinkedPreparationPath, `${JSON.stringify(symlinkedPreparation)}\n`);
  await symlink(physicalParent, linkedParent);
  await assert.rejects(
    cleanupWorkspacePreparation({
      root: join(linkedParent, "qualification"),
      preparation: symlinkedPreparationPath,
    }),
    /parent must not resolve through a symlink/,
  );
  assert.equal((await lstat(symlinkedRoot)).isDirectory(), true);
});

test("collects both customization lifecycles and cleans isolated workspaces", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "apex-lifecycle-parent-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "run");
  const calls = [];
  const evidence = await collectLifecycleEvidence(
    { root },
    { serviceFactory: (workspace) => fakeLifecycleService(workspace, calls) },
  );
  assert.equal(evidence.adapter, "customization-lifecycle-v1");
  assert.match(evidence.evidenceId, /^[0-9a-f]{64}$/u);
  assert.equal(evidence.qualifiesClientParity, false);
  assert.equal(evidence.qualifiesRelease, false);
  assert.ok(Object.values(evidence.operations).every((status) => status === "pass"));
  assert.deepEqual(calls, [
    "github-copilot-cli:init",
    "github-copilot-cli:update",
    "github-copilot-cli:rollback",
    "github-copilot-cli:uninstall",
    "github-copilot-cli:reinstall",
    "github-copilot-vscode:init",
    "github-copilot-vscode:update",
    "github-copilot-vscode:rollback",
    "github-copilot-vscode:uninstall",
    "github-copilot-vscode:reinstall",
  ]);
  await assert.rejects(readFile(root), /ENOENT|EISDIR/u);
});

test("lifecycle refuses existing roots and cleans up after failure", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "apex-lifecycle-refusal-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  await assert.rejects(collectLifecycleEvidence({ root: "relative" }), /absolute path/);
  await assert.rejects(collectLifecycleEvidence({ root: parent }), /must not already exist/);
  await assert.rejects(
    collectLifecycleEvidence({ root: join(parent, "inside"), output: join(parent, "inside", "evidence.json") }),
    /output must be outside/,
  );
  const physicalParent = join(parent, "physical");
  const linkedParent = join(parent, "linked");
  await mkdir(physicalParent);
  await symlink(physicalParent, linkedParent);
  await assert.rejects(
    collectLifecycleEvidence({ root: join(linkedParent, "run") }),
    /parent must not resolve through a symlink/,
  );
  const normalizedRoot = join(parent, "segment", "..", "normalized");
  const normalizedEvidence = await collectLifecycleEvidence(
    { root: normalizedRoot },
    { serviceFactory: (workspace) => fakeLifecycleService(workspace, []) },
  );
  assert.equal(normalizedEvidence.adapter, "customization-lifecycle-v1");

  const root = join(parent, "failed");
  await assert.rejects(
    collectLifecycleEvidence({ root }, { serviceFactory: (workspace) => fakeLifecycleService(workspace, [], true) }),
    /injected lifecycle failure/,
  );
  await assert.rejects(readFile(root), /ENOENT|EISDIR/u);
});

test("checkpoint output must be outside the disposable root", () => {
  assert.throws(
    () => assertOutputOutsideDisposableRoot("/tmp/lifecycle", "/tmp/lifecycle/checkpoint.json", "Checkpoint"),
    /Checkpoint output must be outside the disposable root/,
  );
  assert.doesNotThrow(() => assertOutputOutsideDisposableRoot("/tmp/lifecycle", "/tmp/checkpoint.json", "Checkpoint"));
});

function checkpointAdapters(overrides = {}) {
  const lifecycle = {
    schemaVersion: "1.0.0",
    adapter: "customization-lifecycle-v1",
    clients: {
      cli: { clientId: "github-copilot-cli" },
      vscode: { clientId: "github-copilot-vscode" },
    },
    operations: {
      init: "pass",
      update: "pass",
      rollback: "pass",
      uninstall: "pass",
      reinstall: "pass",
      unrelatedFilePreserved: "pass",
    },
    qualifiesClientParity: false,
    qualifiesRelease: false,
  };
  const input = (clientId, projectId, lockHash) => {
    const content = {
      schemaVersion: "1.0.0",
      adapter: "apex-client-input-journal-v1",
      client: { id: clientId },
      projectId,
      runId: `run-${clientId}`,
      source: {
        customizationLockSha256: lockHash,
        managedFiles: 1,
        journalHead: hash,
        eventCount: 2,
        requestEventHash: otherHash,
        requestPayloadHash: "c".repeat(64),
      },
      interaction: { needsInput: "observed", typedAnswer: "pending" },
      status: "pending",
      qualifiesClientParity: false,
      qualifiesRelease: false,
    };
    return { ...content, evidenceId: sha256Json(content) };
  };
  const cliLockHash = "d".repeat(64);
  const vscodeLockHash = "e".repeat(64);
  return {
    runtime: {
      schemaVersion: "1.0.0",
      adapter: "apex-runtime-journal-v1",
      projectId: "demo",
      runId: "run-1",
      source: { journalHead: hash, eventCount: 1, firstOwnerEpoch: 1, lastOwnerEpoch: 1 },
      records: [],
    },
    cli: {
      schemaVersion: "1.0.0",
      adapter: "copilot-cli-surface-v1",
      client: { id: "github-copilot-cli" },
      workspace: { lockSha256: cliLockHash },
      disposition: { status: "pass" },
    },
    vscode: {
      schemaVersion: "1.0.0",
      adapter: "vscode-surface-v1",
      client: { id: "github-copilot-vscode" },
      workspace: { lockSha256: vscodeLockHash },
      disposition: { status: "pass" },
    },
    cliInput: input("github-copilot-cli", "qualification-cli", cliLockHash),
    vscodeInput: input("github-copilot-vscode", "qualification-vscode", vscodeLockHash),
    lifecycle: { ...lifecycle, evidenceId: sha256Json(lifecycle) },
    ...overrides,
  };
}

function recordedInput(value) {
  const { evidenceId: _evidenceId, ...content } = structuredClone(value);
  content.source.recordedEventHash = "f".repeat(64);
  content.source.recordedPayloadHash = "1".repeat(64);
  content.interaction.typedAnswer = "observed";
  content.status = "recorded";
  return { ...content, evidenceId: sha256Json(content) };
}

async function guidedCheckpoint(overrides = {}, dependencies = {}) {
  const adapters = checkpointAdapters(overrides);
  return collectGuidedCheckpoint(
    {
      "release-manifest": "release.json",
      project: "demo",
      run: "run-1",
      "cli-workspace": "cli",
      "cli-binary": "bin/copilot",
      "lifecycle-root": "/tmp/lifecycle-run",
      "vscode-workspace": "vscode",
      "vscode-host": "/opt/code",
    },
    {
      collectCandidate: async () => candidate,
      collectRuntime: async () => adapters.runtime,
      collectCli: async () => adapters.cli,
      collectVscode: async () => adapters.vscode,
      collectInput: async ({ workspace }) => (workspace === "cli" ? adapters.cliInput : adapters.vscodeInput),
      collectLifecycle: async () => adapters.lifecycle,
      ...dependencies,
    },
  );
}

test("composes source-bound adapters into pending interactive checkpoints", async () => {
  const checkpoint = await guidedCheckpoint();
  const repeated = await guidedCheckpoint();
  assert.equal(checkpoint.kind, "guided-client-checkpoint-v1");
  assert.equal(checkpoint.status.automation, "ready");
  assert.equal(checkpoint.status.interaction, "waiting");
  assert.equal(checkpoint.status.qualifiesClientParity, false);
  assert.equal(checkpoint.status.qualifiesRelease, false);
  assert.match(checkpoint.checkpointId, /^[0-9a-f]{64}$/u);
  assert.equal(repeated.checkpointId, checkpoint.checkpointId);
  assert.deepEqual(Object.keys(checkpoint.adapterDigests), [
    "runtime",
    "cli",
    "vscode",
    "cliInput",
    "vscodeInput",
    "lifecycle",
  ]);
  assert.ok(Object.values(checkpoint.adapterDigests).every((value) => /^[0-9a-f]{64}$/u.test(value)));
  assert.ok(checkpoint.interactiveCheckpoints.every(({ status }) => status === "pending"));
  assert.notEqual(checkpoint.adapters.runtime.runId, checkpoint.adapters.cliInput.runId);
  assert.notEqual(checkpoint.adapters.runtime.runId, checkpoint.adapters.vscodeInput.runId);
  assert.notEqual(checkpoint.adapters.cliInput.runId, checkpoint.adapters.vscodeInput.runId);
  assert.deepEqual(
    checkpoint.interactiveCheckpoints
      .filter(({ id }) => id.endsWith("-input"))
      .map(({ id, status, kernelStatus }) => ({ id, status, kernelStatus })),
    [
      { id: "vscode-input", status: "pending", kernelStatus: "pending" },
      { id: "cli-input", status: "pending", kernelStatus: "pending" },
    ],
  );
  assert.ok(checkpoint.capabilityBlockers.some(({ scenarioIds }) => scenarioIds.includes("CLIENT-005")));
  assert.ok(checkpoint.interactiveCheckpoints.every(({ scenarioIds }) => !scenarioIds.includes("CLIENT-009")));
  assert.doesNotMatch(JSON.stringify(checkpoint), /assertionState|"assertions"|"pass"\s*:/u);
});

test("checkpoint status derives from adapters without converting blockers to assertions", async () => {
  const unavailable = await guidedCheckpoint({
    cli: {
      ...checkpointAdapters().cli,
      disposition: {
        status: "unavailable",
        reasonCode: "CLIENT_BINARY_MISMATCH",
        ownerCode: "CLIENT_ENVIRONMENT",
        nextActionCode: "INSTALL_SELECTED_CLI",
      },
    },
  });
  assert.equal(unavailable.status.automation, "unavailable");
  assert.ok(unavailable.interactiveCheckpoints.every(({ status }) => status === "blocked"));

  const blocked = await guidedCheckpoint({
    vscode: { ...checkpointAdapters().vscode, disposition: { status: "fail", reasonCode: "MANAGED_FILE_DRIFT" } },
  });
  assert.equal(blocked.status.automation, "blocked");
  assert.equal(blocked.interactiveCheckpoints[0].status, "blocked");
});

test("checkpoint resume accepts exact sources and rejects tampering or stale adapters", async () => {
  const previous = await guidedCheckpoint();
  const resumed = await guidedCheckpoint({}, { previousCheckpoint: previous });
  assert.deepEqual(resumed, previous);

  const tampered = structuredClone(previous);
  tampered.status.interaction = "complete";
  await assert.rejects(guidedCheckpoint({}, { previousCheckpoint: tampered }), /self-hash is invalid/);

  await assert.rejects(
    guidedCheckpoint(
      {
        cli: {
          ...checkpointAdapters().cli,
          disposition: {
            status: "unavailable",
            reasonCode: "CLIENT_BINARY_MISMATCH",
            ownerCode: "CLIENT_ENVIRONMENT",
            nextActionCode: "INSTALL_SELECTED_CLI",
          },
        },
      },
      { previousCheckpoint: previous },
    ),
    /stale or belongs to different sources/,
  );

  const recordedCliInput = recordedInput(checkpointAdapters().cliInput);
  const recordedCheckpoint = await guidedCheckpoint({ cliInput: recordedCliInput });
  const cliInputStep = recordedCheckpoint.interactiveCheckpoints.find(({ id }) => id === "cli-input");
  assert.deepEqual(
    { status: cliInputStep.status, kernelStatus: cliInputStep.kernelStatus },
    { status: "pending", kernelStatus: "recorded" },
  );
  await assert.rejects(
    guidedCheckpoint({ cliInput: recordedCliInput }, { previousCheckpoint: previous }),
    /stale or belongs to different sources/,
  );
  const recordedVscodeInput = recordedInput(checkpointAdapters().vscodeInput);
  const recordedVscodeCheckpoint = await guidedCheckpoint({ vscodeInput: recordedVscodeInput });
  const vscodeInputStep = recordedVscodeCheckpoint.interactiveCheckpoints.find(({ id }) => id === "vscode-input");
  assert.deepEqual(
    { status: vscodeInputStep.status, kernelStatus: vscodeInputStep.kernelStatus },
    { status: "pending", kernelStatus: "recorded" },
  );
  await assert.rejects(
    guidedCheckpoint({ vscodeInput: recordedVscodeInput }, { previousCheckpoint: previous }),
    /stale or belongs to different sources/,
  );

  const forbidden = structuredClone(previous);
  forbidden.assertions = { forged: "pass" };
  const { checkpointId: _checkpointId, ...forbiddenContent } = forbidden;
  forbidden.checkpointId = sha256Json(forbiddenContent);
  await assert.rejects(guidedCheckpoint({}, { previousCheckpoint: forbidden }), /forbidden field/);
});

test("checkpoint rejects mismatched and malformed adapter identities", async () => {
  const missingRuntimeIdentity = { ...checkpointAdapters().runtime };
  delete missingRuntimeIdentity.projectId;
  await assert.rejects(
    guidedCheckpoint({ runtime: missingRuntimeIdentity }),
    /Checkpoint adapter apex-runtime-journal-v1 is invalid/,
  );
  await assert.rejects(
    guidedCheckpoint({ runtime: { ...checkpointAdapters().runtime, runId: "run.with-dot" } }),
    /Checkpoint adapter apex-runtime-journal-v1 is invalid/,
  );
  await assert.rejects(
    guidedCheckpoint({ runtime: { ...checkpointAdapters().runtime, runId: "other" } }),
    /identity does not match/,
  );
  await assert.rejects(
    guidedCheckpoint({ cli: { ...checkpointAdapters().cli, adapter: "forged" } }),
    /Checkpoint adapter copilot-cli-surface-v1 is invalid/,
  );
  await assert.rejects(
    guidedCheckpoint({ vscode: { ...checkpointAdapters().vscode, disposition: { status: "passed" } } }),
    /Checkpoint adapter vscode-surface-v1 is invalid/,
  );
  const cliWithoutDisposition = { ...checkpointAdapters().cli };
  delete cliWithoutDisposition.disposition;
  await assert.rejects(
    guidedCheckpoint({ cli: cliWithoutDisposition }),
    /Checkpoint adapter copilot-cli-surface-v1 is invalid/,
  );
  await assert.rejects(
    guidedCheckpoint({ runtime: { ...checkpointAdapters().runtime, assertions: { forged: "pass" } } }),
    /forbidden field/,
  );
  await assert.rejects(
    guidedCheckpoint({ lifecycle: { ...checkpointAdapters().lifecycle, evidenceId: "f".repeat(64) } }),
    /Checkpoint adapter customization-lifecycle-v1 is invalid/,
  );
  await assert.rejects(
    guidedCheckpoint({ cliInput: { ...checkpointAdapters().cliInput, evidenceId: "f".repeat(64) } }),
    /Checkpoint adapter apex-client-input-journal-v1/,
  );
  await assert.rejects(
    guidedCheckpoint({ vscodeInput: { ...checkpointAdapters().vscodeInput, evidenceId: "f".repeat(64) } }),
    /Checkpoint adapter apex-client-input-journal-v1/,
  );
  const extraInputField = structuredClone(checkpointAdapters().cliInput);
  extraInputField.extra = "bounded-but-unsupported";
  const { evidenceId: _extraEvidenceId, ...extraInputContent } = extraInputField;
  extraInputField.evidenceId = sha256Json(extraInputContent);
  await assert.rejects(
    guidedCheckpoint({ cliInput: extraInputField }),
    /Checkpoint adapter apex-client-input-journal-v1/,
  );
  const extraVscodeInputField = structuredClone(checkpointAdapters().vscodeInput);
  extraVscodeInputField.extra = "bounded-but-unsupported";
  const { evidenceId: _extraVscodeEvidenceId, ...extraVscodeInputContent } = extraVscodeInputField;
  extraVscodeInputField.evidenceId = sha256Json(extraVscodeInputContent);
  await assert.rejects(
    guidedCheckpoint({ vscodeInput: extraVscodeInputField }),
    /Checkpoint adapter apex-client-input-journal-v1/,
  );
  for (const [name, field, value] of [
    ["cliInput", "client", { id: "github-copilot-vscode" }],
    ["cliInput", "projectId", "qualification-vscode"],
    ["vscodeInput", "client", { id: "github-copilot-cli" }],
    ["vscodeInput", "projectId", "qualification-cli"],
  ]) {
    const mismatchedIdentity = structuredClone(checkpointAdapters()[name]);
    mismatchedIdentity[field] = value;
    const { evidenceId: _identityEvidenceId, ...mismatchedIdentityContent } = mismatchedIdentity;
    mismatchedIdentity.evidenceId = sha256Json(mismatchedIdentityContent);
    await assert.rejects(
      guidedCheckpoint({ [name]: mismatchedIdentity }),
      /Checkpoint adapter apex-client-input-journal-v1/,
    );
  }
  const mismatchedInput = structuredClone(checkpointAdapters().cliInput);
  mismatchedInput.source.customizationLockSha256 = "f".repeat(64);
  const { evidenceId: _inputEvidenceId, ...mismatchedInputContent } = mismatchedInput;
  mismatchedInput.evidenceId = sha256Json(mismatchedInputContent);
  await assert.rejects(guidedCheckpoint({ cliInput: mismatchedInput }), /customization lock does not match/);
  const mismatchedVscodeInput = structuredClone(checkpointAdapters().vscodeInput);
  mismatchedVscodeInput.source.customizationLockSha256 = "f".repeat(64);
  const { evidenceId: _vscodeInputEvidenceId, ...mismatchedVscodeInputContent } = mismatchedVscodeInput;
  mismatchedVscodeInput.evidenceId = sha256Json(mismatchedVscodeInputContent);
  await assert.rejects(guidedCheckpoint({ vscodeInput: mismatchedVscodeInput }), /customization lock does not match/);
  const incompleteLifecycle = structuredClone(checkpointAdapters().lifecycle);
  delete incompleteLifecycle.operations.unrelatedFilePreserved;
  const { evidenceId: _evidenceId, ...incompleteContent } = incompleteLifecycle;
  incompleteLifecycle.evidenceId = sha256Json(incompleteContent);
  await assert.rejects(
    guidedCheckpoint({ lifecycle: incompleteLifecycle }),
    /Checkpoint adapter customization-lifecycle-v1 is invalid/,
  );
  await assert.rejects(
    collectGuidedCheckpoint(
      {
        "release-manifest": "release.json",
        project: "demo",
        run: "run-1",
        "cli-workspace": "cli",
        "cli-binary": "bin/copilot",
        "lifecycle-root": "/tmp/lifecycle-run",
        "vscode-workspace": "vscode",
        "vscode-host": "/opt/code",
      },
      {
        collectCandidate: async () => ({ ...candidate, commit: "forged" }),
        collectRuntime: async () => checkpointAdapters().runtime,
        collectCli: async () => checkpointAdapters().cli,
        collectVscode: async () => checkpointAdapters().vscode,
        collectInput: async ({ workspace }) =>
          workspace === "cli" ? checkpointAdapters().cliInput : checkpointAdapters().vscodeInput,
        collectLifecycle: async () => checkpointAdapters().lifecycle,
      },
    ),
    /Checkpoint candidate is invalid/,
  );
  await assert.rejects(
    collectGuidedCheckpoint(
      {
        "release-manifest": "release.json",
        project: "demo",
        run: "run-1",
        "cli-workspace": "cli",
        "cli-binary": "bin/copilot",
        "lifecycle-root": "/tmp/lifecycle-run",
        "vscode-workspace": "vscode",
        "vscode-host": "/opt/code",
      },
      {
        collectCandidate: async () => ({ ...candidate, repository: "", branch: "" }),
        collectRuntime: async () => checkpointAdapters().runtime,
        collectCli: async () => checkpointAdapters().cli,
        collectVscode: async () => checkpointAdapters().vscode,
        collectInput: async ({ workspace }) =>
          workspace === "cli" ? checkpointAdapters().cliInput : checkpointAdapters().vscodeInput,
        collectLifecycle: async () => checkpointAdapters().lifecycle,
      },
    ),
    /Checkpoint candidate is invalid/,
  );
});

async function vscodeSurfaceFixture(context, { managedHash } = {}) {
  const root = await mkdtemp(join(tmpdir(), "apex-client-vscode-surface-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const contractRoot = join(root, "contract");
  const workspace = join(root, "consumer");
  const managed = Buffer.from('{"servers":{}}\n');
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  await mkdir(join(contractRoot, "config"), { recursive: true });
  await mkdir(join(root, "bin"), { recursive: true });
  await mkdir(join(workspace, ".apex"), { recursive: true });
  await mkdir(join(workspace, ".vscode"), { recursive: true });
  await writeFile(
    join(contractRoot, "config", "toolchain.v1.json"),
    `${JSON.stringify({
      core: { vscode: { selectedExactVersion: "1.130.0", selectedExactCopilotChatVersion: "0.58.0" } },
    })}\n`,
  );
  await writeFile(join(workspace, ".vscode", "mcp.json"), managed);
  await writeFile(join(root, "bin", "code"), "code-host");
  await writeFile(
    join(workspace, ".apex", "customizations.lock.json"),
    `${JSON.stringify({
      version: 1,
      source: "/private/source/path",
      clientId: "github-copilot-vscode",
      runtime: [],
      files: [
        {
          path: ".vscode/mcp.json",
          sourceHash: digest(managed),
          baseHash: digest(managed),
          currentHash: managedHash ?? digest(managed),
        },
      ],
    })}\n`,
  );
  return { root, contractRoot, workspace, host: join(root, "bin", "code") };
}

test("exports exact VS Code host, Copilot Chat, and managed projection binding", async (context) => {
  const fixture = await vscodeSurfaceFixture(context);
  const calls = [];
  const exported = await collectVscodeSurfaceEvidence(
    { workspace: "consumer", host: fixture.host },
    {
      root: fixture.root,
      contractRoot: fixture.contractRoot,
      runVscode: (_host, args) => {
        calls.push(args);
        return args[0] === "--version"
          ? "1.130.0\ncommit\nx64\n"
          : "Extensions installed on Dev Container: Test:\ngithub.copilot-chat@0.58.0\nexample.unrelated@2.0.0\n";
      },
    },
  );
  assert.deepEqual(exported.disposition, { status: "pass" });
  assert.equal(exported.client.observedVersion, "1.130.0");
  assert.match(exported.client.observedHostSha256, /^[0-9a-f]{64}$/u);
  assert.equal(exported.client.observedExtensionVersion, "0.58.0");
  assert.equal(exported.workspace.files[0].matches, true);
  assert.deepEqual(calls, [["--version"], ["--list-extensions", "--show-versions"]]);
  assert.doesNotMatch(JSON.stringify(exported), /example\.unrelated|private\/source\/path/u);
});

test("VS Code surface binding emits specific unavailable client dispositions", async (context) => {
  const hostMismatchFixture = await vscodeSurfaceFixture(context);
  const hostMismatch = await collectVscodeSurfaceEvidence(
    { workspace: "consumer", host: hostMismatchFixture.host },
    {
      root: hostMismatchFixture.root,
      contractRoot: hostMismatchFixture.contractRoot,
      runVscode: (_host, args) => (args[0] === "--version" ? "1.131.0\ncommit\nx64\n" : "github.copilot-chat@0.58.0\n"),
    },
  );
  assert.equal(hostMismatch.disposition.reasonCode, "HOST_VERSION_MISMATCH");

  const missingFixture = await vscodeSurfaceFixture(context);
  const missing = await collectVscodeSurfaceEvidence(
    { workspace: "consumer", host: missingFixture.host },
    {
      root: missingFixture.root,
      contractRoot: missingFixture.contractRoot,
      runVscode: (_host, args) => (args[0] === "--version" ? "1.130.0\ncommit\nx64\n" : "example.other@1.0.0\n"),
    },
  );
  assert.equal(missing.disposition.reasonCode, "COPILOT_CHAT_EXTENSION_MISSING");

  const versionFixture = await vscodeSurfaceFixture(context);
  const versionMismatch = await collectVscodeSurfaceEvidence(
    { workspace: "consumer", host: versionFixture.host },
    {
      root: versionFixture.root,
      contractRoot: versionFixture.contractRoot,
      runVscode: (_host, args) => (args[0] === "--version" ? "1.130.0\ncommit\nx64\n" : "github.copilot-chat@0.59.0\n"),
    },
  );
  assert.equal(versionMismatch.disposition.reasonCode, "COPILOT_CHAT_VERSION_MISMATCH");
});

test("VS Code surface binding reports managed drift and rejects duplicate extensions", async (context) => {
  const driftFixture = await vscodeSurfaceFixture(context, { managedHash: "f".repeat(64) });
  const drift = await collectVscodeSurfaceEvidence(
    { workspace: "consumer", host: driftFixture.host },
    {
      root: driftFixture.root,
      contractRoot: driftFixture.contractRoot,
      runVscode: (_host, args) => (args[0] === "--version" ? "1.130.0\ncommit\nx64\n" : "github.copilot-chat@0.58.0\n"),
    },
  );
  assert.deepEqual(drift.disposition, { status: "fail", reasonCode: "MANAGED_FILE_DRIFT" });

  const duplicateFixture = await vscodeSurfaceFixture(context);
  await assert.rejects(
    collectVscodeSurfaceEvidence(
      { workspace: "consumer", host: duplicateFixture.host },
      {
        root: duplicateFixture.root,
        contractRoot: duplicateFixture.contractRoot,
        runVscode: (_host, args) =>
          args[0] === "--version"
            ? "1.130.0\ncommit\nx64\n"
            : "github.copilot-chat@0.58.0\nGITHUB.COPILOT-CHAT@0.58.0\n",
      },
    ),
    /extension inventory is invalid/,
  );

  await assert.rejects(
    collectVscodeSurfaceEvidence(
      { workspace: "consumer", host: "code" },
      {
        root: duplicateFixture.root,
        contractRoot: duplicateFixture.contractRoot,
        runVscode: () => "1.130.0\ncommit\nx64\n",
      },
    ),
    /host must be an absolute path/,
  );

  await rm(join(duplicateFixture.workspace, ".apex", "customizations.lock.json"));
  await assert.rejects(
    collectVscodeSurfaceEvidence(
      { workspace: "consumer", host: duplicateFixture.host },
      {
        root: duplicateFixture.root,
        contractRoot: duplicateFixture.contractRoot,
        runVscode: (_host, args) =>
          args[0] === "--version" ? "1.130.0\ncommit\nx64\n" : "github.copilot-chat@0.58.0\n",
      },
    ),
    /VS Code customization lock/,
  );

  const malformedFixture = await vscodeSurfaceFixture(context);
  const malformedLockPath = join(malformedFixture.workspace, ".apex", "customizations.lock.json");
  const malformedLock = JSON.parse(await readFile(malformedLockPath, "utf8"));
  const malformedEntry = { ...malformedLock.files[0] };
  delete malformedEntry.path;
  malformedLock.files.push(malformedEntry);
  await writeFile(malformedLockPath, JSON.stringify(malformedLock));
  await assert.rejects(
    collectVscodeSurfaceEvidence(
      { workspace: "consumer", host: malformedFixture.host },
      {
        root: malformedFixture.root,
        contractRoot: malformedFixture.contractRoot,
        runVscode: (_host, args) =>
          args[0] === "--version" ? "1.130.0\ncommit\nx64\n" : "github.copilot-chat@0.58.0\n",
      },
    ),
    /VS Code managed file entry is invalid/,
  );
});

async function cliSurfaceFixture(context, { selectedHash, managedHash } = {}) {
  const root = await mkdtemp(join(tmpdir(), "apex-client-cli-surface-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const contractRoot = join(root, "contract");
  const workspace = join(root, "consumer");
  const binary = Buffer.from("copilot-binary");
  const managed = Buffer.from('{"mcpServers":{}}\n');
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  await mkdir(join(contractRoot, "tools", "registry"), { recursive: true });
  await mkdir(join(workspace, "bin"), { recursive: true });
  await mkdir(join(workspace, ".apex"), { recursive: true });
  await mkdir(join(workspace, ".github"), { recursive: true });
  await writeFile(join(workspace, "bin", "copilot"), binary);
  await writeFile(join(workspace, ".github", "mcp.json"), managed);
  await writeFile(
    join(contractRoot, "tools", "registry", "copilot-cli-agent-tools.json"),
    `${JSON.stringify({
      schemaVersion: "1.0.0",
      client: "github-copilot-cli",
      clientVersion: "1.0.73",
      clientBinarySha256: selectedHash ?? digest(binary),
      workspaceServer: "apex",
    })}\n`,
  );
  await writeFile(
    join(workspace, ".apex", "customizations.lock.json"),
    `${JSON.stringify({
      version: 1,
      source: "/private/source/path",
      clientId: "github-copilot-cli",
      runtime: [],
      files: [
        {
          path: ".github/mcp.json",
          sourceHash: digest(managed),
          baseHash: digest(managed),
          currentHash: managedHash ?? digest(managed),
        },
      ],
    })}\n`,
  );
  return { root, contractRoot, workspace, binaryHash: digest(binary), managedHash: digest(managed) };
}

test("exports exact CLI binding, managed files, and bounded MCP server names", async (context) => {
  const fixture = await cliSurfaceFixture(context);
  const calls = [];
  const exported = await collectCliSurfaceEvidence(
    { workspace: "consumer", binary: "bin/copilot" },
    {
      root: fixture.root,
      contractRoot: fixture.contractRoot,
      runCli: (_binary, args) => {
        calls.push(args);
        return args[0] === "version" ? "GitHub Copilot CLI 1.0.73\n" : '{"mcpServers":{"apex":{"status":"ok"}}}\n';
      },
    },
  );
  assert.equal(exported.disposition.status, "pass");
  assert.equal(exported.client.observedBinarySha256, fixture.binaryHash);
  assert.deepEqual(exported.mcp.servers, ["apex"]);
  assert.equal(exported.workspace.files[0].matches, true);
  assert.deepEqual(calls, [
    ["version", "--no-auto-update"],
    ["mcp", "list", "--json", "--no-auto-update", "--no-remote"],
  ]);
  assert.doesNotMatch(JSON.stringify(exported), /private\/source\/path|status.*ok/u);
});

test("CLI binding mismatch is unavailable and does not inspect MCP", async (context) => {
  const fixture = await cliSurfaceFixture(context, { selectedHash: "f".repeat(64) });
  const calls = [];
  const exported = await collectCliSurfaceEvidence(
    { workspace: "consumer", binary: "bin/copilot" },
    {
      root: fixture.root,
      contractRoot: fixture.contractRoot,
      runCli: (_binary, args) => {
        calls.push(args);
        return "GitHub Copilot CLI 1.0.73\n";
      },
    },
  );
  assert.equal(exported.disposition.status, "unavailable");
  assert.equal(exported.disposition.reasonCode, "CLIENT_BINARY_MISMATCH");
  assert.deepEqual(calls, [["version", "--no-auto-update"]]);
  assert.equal(exported.mcp.status, "not-run");

  const versionFixture = await cliSurfaceFixture(context);
  const versionCalls = [];
  const versionMismatch = await collectCliSurfaceEvidence(
    { workspace: "consumer", binary: "bin/copilot" },
    {
      root: versionFixture.root,
      contractRoot: versionFixture.contractRoot,
      runCli: (_binary, args) => {
        versionCalls.push(args);
        return "GitHub Copilot CLI 1.0.74\n";
      },
    },
  );
  assert.equal(versionMismatch.disposition.status, "unavailable");
  assert.equal(versionMismatch.disposition.reasonCode, "CLIENT_VERSION_MISMATCH");
  assert.deepEqual(versionCalls, [["version", "--no-auto-update"]]);
  assert.equal(versionMismatch.mcp.status, "not-run");
});

test("CLI surface export reports managed drift and rejects unsafe lock paths", async (context) => {
  const drift = await cliSurfaceFixture(context, { managedHash: "e".repeat(64) });
  const driftCalls = [];
  const exported = await collectCliSurfaceEvidence(
    { workspace: "consumer", binary: "bin/copilot" },
    {
      root: drift.root,
      contractRoot: drift.contractRoot,
      runCli: (_binary, args) => {
        driftCalls.push(args);
        return "GitHub Copilot CLI 1.0.73\n";
      },
    },
  );
  assert.deepEqual(exported.disposition, { status: "fail", reasonCode: "MANAGED_FILE_DRIFT" });
  assert.deepEqual(driftCalls, [["version", "--no-auto-update"]]);
  assert.equal(exported.mcp.status, "not-run");

  const unsafe = await cliSurfaceFixture(context);
  const lockPath = join(unsafe.workspace, ".apex", "customizations.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  lock.files.push({ ...lock.files[0], path: "../outside.json" });
  await writeFile(lockPath, JSON.stringify(lock));
  await assert.rejects(
    collectCliSurfaceEvidence(
      { workspace: "consumer", binary: "bin/copilot" },
      {
        root: unsafe.root,
        contractRoot: unsafe.contractRoot,
        runCli: () => "GitHub Copilot CLI 1.0.73\n",
      },
    ),
    /unsafe|escapes/,
  );

  const linked = await cliSurfaceFixture(context);
  const outsideDirectory = join(linked.root, "outside-managed");
  await mkdir(outsideDirectory);
  await writeFile(join(outsideDirectory, "mcp.json"), '{"mcpServers":{}}\n');
  await rm(join(linked.workspace, ".github"), { recursive: true });
  await symlink(outsideDirectory, join(linked.workspace, ".github"));
  await assert.rejects(
    collectCliSurfaceEvidence(
      { workspace: "consumer", binary: "bin/copilot" },
      {
        root: linked.root,
        contractRoot: linked.contractRoot,
        runCli: () => "GitHub Copilot CLI 1.0.73\n",
      },
    ),
    /parent escapes/,
  );

  const oversized = await cliSurfaceFixture(context);
  const oversizedLockPath = join(oversized.workspace, ".apex", "customizations.lock.json");
  const oversizedLock = JSON.parse(await readFile(oversizedLockPath, "utf8"));
  oversizedLock.files = Array.from({ length: 257 }, (_, index) => ({
    ...oversizedLock.files[0],
    path: index === 0 ? ".github/mcp.json" : `.github/agents/agent-${index}.md`,
  }));
  await writeFile(oversizedLockPath, JSON.stringify(oversizedLock));
  await assert.rejects(
    collectCliSurfaceEvidence(
      { workspace: "consumer", binary: "bin/copilot" },
      {
        root: oversized.root,
        contractRoot: oversized.contractRoot,
        runCli: () => "GitHub Copilot CLI 1.0.73\n",
      },
    ),
    /customization lock is invalid/,
  );

  const duplicate = await cliSurfaceFixture(context);
  const duplicateLockPath = join(duplicate.workspace, ".apex", "customizations.lock.json");
  const duplicateLock = JSON.parse(await readFile(duplicateLockPath, "utf8"));
  duplicateLock.files.push({ ...duplicateLock.files[0], path: "./.github/mcp.json" });
  await writeFile(duplicateLockPath, JSON.stringify(duplicateLock));
  await assert.rejects(
    collectCliSurfaceEvidence(
      { workspace: "consumer", binary: "bin/copilot" },
      {
        root: duplicate.root,
        contractRoot: duplicate.contractRoot,
        runCli: () => "GitHub Copilot CLI 1.0.73\n",
      },
    ),
    /destination is duplicated/,
  );
});

test("CLI surface export fails when exact-client MCP inventory omits APEX", async (context) => {
  const fixture = await cliSurfaceFixture(context);
  const calls = [];
  const exported = await collectCliSurfaceEvidence(
    { workspace: "consumer", binary: "bin/copilot" },
    {
      root: fixture.root,
      contractRoot: fixture.contractRoot,
      runCli: (_binary, args) => {
        calls.push(args);
        return args[0] === "version" ? "GitHub Copilot CLI 1.0.73\n" : '{"mcpServers":{}}\n';
      },
    },
  );
  assert.deepEqual(exported.disposition, { status: "fail", reasonCode: "MCP_SERVER_MISSING" });
  assert.equal(exported.mcp.status, "observed");
  assert.deepEqual(exported.mcp.servers, []);
  assert.deepEqual(calls, [
    ["version", "--no-auto-update"],
    ["mcp", "list", "--json", "--no-auto-update", "--no-remote"],
  ]);
});

async function runtimeFixture(context, runId = "run-1") {
  const root = await mkdtemp(join(tmpdir(), "apex-client-runtime-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const projectId = "demo";
  const journalPath = join(root, ".apex", "projects", projectId, "runs", runId, "journal");
  await mkdir(journalPath, { recursive: true });
  const journal = new EventJournal(journalPath);
  const objects = new ObjectStore(root);
  const append = async (type, payload, ownerEpoch = 1) =>
    journal.append({
      eventId: `event-${type}-${ownerEpoch}-${(await journal.replay()).length + 1}`,
      projectId,
      runId,
      type,
      timestamp: "2026-07-30T00:00:00.000Z",
      ownerEpoch,
      expectedHead: await journal.head(),
      payload,
    });
  const artifactHash = "a".repeat(64);
  const evidenceHash = "b".repeat(64);
  const operationHash = "c".repeat(64);
  const inventoryHash = "d".repeat(64);
  await append("task.completed", {
    taskId: "task-1",
    nodeId: "quality",
    artifactHashes: { "quality-report": artifactHash },
    prompt: "must-not-escape",
  });
  const approvalHash = await objects.putJson({
    projectId,
    runId,
    gate: 1,
    decision: "approved",
    writerEpoch: 1,
  });
  await append("gate.decided", { gate: 1, approvalHash });
  await append("evidence.accepted", { kind: "validation-evidence", status: "accepted", hash: evidenceHash });
  await append("deployment.completed", { operationHash, inventoryHash });
  await append("transfer-accepted", { claimHash: "e".repeat(64), recipient: "ci" }, 2);
  return { root, projectId, runId, journalPath, artifactHash, evidenceHash, operationHash, inventoryHash };
}

test("exports source-bound runtime facts without copying unrecognized content", async (context) => {
  const fixture = await runtimeFixture(context);
  const exported = await collectRuntimeEvidence(
    { project: fixture.projectId, run: fixture.runId },
    { root: fixture.root },
  );
  assert.equal(exported.adapter, "apex-runtime-journal-v1");
  assert.equal(exported.source.eventCount, 5);
  assert.equal(exported.source.firstOwnerEpoch, 1);
  assert.equal(exported.source.lastOwnerEpoch, 2);
  assert.deepEqual(
    exported.records.map(({ fact }) => fact),
    [
      { type: "task", node: "quality", taskState: "completed" },
      { type: "artifact", artifact: "quality-report", artifactHash: fixture.artifactHash },
      { type: "gate", gate: 1, gateState: "approved" },
      { type: "evidence", evidence: "validation-evidence", evidenceHash: fixture.evidenceHash },
      { type: "artifact", artifact: "operation-record", artifactHash: fixture.operationHash },
      { type: "artifact", artifact: "resource-inventory", artifactHash: fixture.inventoryHash },
      { type: "transfer", transferResult: "succeeded", ownerEpochDelta: 1 },
    ],
  );
  assert.ok(exported.records.every(({ source }) => /^[0-9a-f]{64}$/.test(source.eventHash)));
  assert.doesNotMatch(JSON.stringify(exported), /must-not-escape/u);
});

test("accepts canonical maximum-length run IDs", async (context) => {
  const runId = `run_${"a".repeat(124)}`;
  assert.equal(runId.length, 128);
  const fixture = await runtimeFixture(context, runId);
  const exported = await collectRuntimeEvidence({ project: fixture.projectId, run: runId }, { root: fixture.root });
  assert.equal(exported.runId, runId);
});

test("runtime export rejects traversal, journal tampering, and symlinked entries", async (context) => {
  const traversal = await runtimeFixture(context);
  await assert.rejects(
    collectRuntimeEvidence({ project: "../demo", run: traversal.runId }, { root: traversal.root }),
    /Project ID is invalid/,
  );

  const tampered = await runtimeFixture(context);
  const firstEvent = join(tampered.journalPath, "0000000000000001.json");
  await writeFile(firstEvent, `${(await readFile(firstEvent, "utf8")).replace("quality", "tampered")}\n`);
  await assert.rejects(
    collectRuntimeEvidence({ project: tampered.projectId, run: tampered.runId }, { root: tampered.root }),
    /Corrupt journal payload|Corrupt journal hash/,
  );

  const linked = await runtimeFixture(context);
  const linkedEvent = join(linked.journalPath, "0000000000000001.json");
  const outside = join(linked.root, "outside.json");
  await writeFile(outside, await readFile(linkedEvent));
  await unlink(linkedEvent);
  await symlink(outside, linkedEvent);
  await assert.rejects(
    collectRuntimeEvidence({ project: linked.projectId, run: linked.runId }, { root: linked.root }),
    /unsafe file/,
  );

  await assert.rejects(
    collectRuntimeEvidence({ project: "demo.with-dot", run: linked.runId }, { root: linked.root }),
    /Project ID is invalid/,
  );

  const mismatched = await runtimeFixture(context);
  const mismatchedJournalPath = join(
    mismatched.root,
    ".apex",
    "projects",
    "requested",
    "runs",
    mismatched.runId,
    "journal",
  );
  await mkdir(mismatchedJournalPath, { recursive: true });
  const mismatchedJournal = new EventJournal(mismatchedJournalPath);
  await mismatchedJournal.append({
    eventId: "event-mismatched",
    projectId: "embedded",
    runId: mismatched.runId,
    type: "task.completed",
    timestamp: "2026-07-30T00:00:00.000Z",
    ownerEpoch: 1,
    expectedHead: null,
    payload: { taskId: "task-1", nodeId: "quality", artifactHashes: {} },
  });
  await assert.rejects(
    collectRuntimeEvidence({ project: "requested", run: mismatched.runId }, { root: mismatched.root }),
    /identity does not match/,
  );
});

test("runtime export rejects malformed recognized events and invalid owner epochs", async (context) => {
  const malformed = await runtimeFixture(context);
  const malformedJournal = new EventJournal(malformed.journalPath);
  await malformedJournal.append({
    eventId: "event-malformed-recognized",
    projectId: malformed.projectId,
    runId: malformed.runId,
    type: "task.completed",
    timestamp: "2026-07-30T00:01:00.000Z",
    ownerEpoch: 2,
    expectedHead: await malformedJournal.head(),
    payload: "invalid",
  });
  await assert.rejects(
    collectRuntimeEvidence({ project: malformed.projectId, run: malformed.runId }, { root: malformed.root }),
    /recognized runtime event task\.completed has invalid payload/i,
  );

  const invalidEpoch = await runtimeFixture(context);
  const events = await new EventJournal(invalidEpoch.journalPath).replay();
  const invalidEvents = events.map((event, index) => (index === 0 ? { ...event, ownerEpoch: "one" } : event));
  await assert.rejects(
    collectRuntimeEvidence(
      { project: invalidEpoch.projectId, run: invalidEpoch.runId },
      { root: invalidEpoch.root, journalFactory: () => ({ replay: async () => invalidEvents }) },
    ),
    /owner epochs/,
  );
});

test("collects an exact candidate from bound repository inputs", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-client-candidate-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const commit = "c".repeat(40);
  const packageLock = Buffer.from('{"lockfileVersion":3}\n');
  const runtimeBundle = Buffer.from('{"schemaVersion":"1.0.0"}\n');
  const releaseBytes = Buffer.from(`${JSON.stringify({ ...releaseManifest, sourceCommit: commit })}\n`);
  const customizationHash = "f".repeat(64);
  await mkdir(join(root, "config"), { recursive: true });
  await mkdir(join(root, "packages", "cli", "assets"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ repository: { url: "git+https://github.com/jonathan-vella/apex-vnext.git" } })}\n`,
  );
  await writeFile(join(root, "package-lock.json"), packageLock);
  await writeFile(join(root, "config", "runtime-bundle.v1.json"), runtimeBundle);
  await writeFile(join(root, "release.json"), releaseBytes);
  await writeFile(
    join(root, "packages", "cli", "assets", "manifest.json"),
    `${JSON.stringify({ lock: { digest: customizationHash } })}\n`,
  );
  const git = (args) => (args.includes("--abbrev-ref") ? "main" : commit);
  const candidate = await collectCurrentCandidate({ "release-manifest": "release.json" }, { root, git });
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.deepEqual(candidate, {
    repository: "https://github.com/jonathan-vella/apex-vnext",
    branch: "main",
    commit,
    packageLockHash: digest(packageLock),
    releaseManifestHash: digest(releaseBytes),
    runtimeBundleHash: digest(runtimeBundle),
    customizationBundleHash: customizationHash,
  });
  await assert.rejects(
    collectCurrentCandidate({ branch: "other", "release-manifest": "release.json" }, { root, git }),
    /does not match checked-out branch/,
  );
  await assert.rejects(
    collectCurrentCandidate(
      { "release-manifest": "release.json" },
      { root, git: (args) => (args.includes("--abbrev-ref") ? "HEAD" : commit) },
    ),
    /--branch is required/,
  );
  await writeFile(join(root, "release.json"), '{"version":1,"version":1}\n');
  await assert.rejects(
    collectCurrentCandidate({ "release-manifest": "release.json" }, { root, git }),
    /DUPLICATE_JSON_KEY/,
  );
});

test("resolves candidate overrides against the injected root", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "apex-client-candidate-root-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const commit = "c".repeat(40);
  const packageLock = Buffer.from('{"lockfileVersion":3}\n');
  const runtimeBundle = Buffer.from('{"schemaVersion":"1.0.0"}\n');
  const releaseBytes = Buffer.from(`${JSON.stringify({ ...releaseManifest, sourceCommit: commit })}\n`);
  await mkdir(join(root, "inputs"), { recursive: true });
  await mkdir(join(root, "packages", "cli", "assets"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ repository: "git+https://github.com/jonathan-vella/apex-vnext.git" })}\n`,
  );
  await writeFile(join(root, "inputs", "lock.json"), packageLock);
  await writeFile(join(root, "inputs", "runtime.json"), runtimeBundle);
  await writeFile(join(root, "inputs", "release.json"), releaseBytes);
  await writeFile(
    join(root, "packages", "cli", "assets", "manifest.json"),
    `${JSON.stringify({ lock: { digest: "f".repeat(64) } })}\n`,
  );
  const git = (args) => (args.includes("--abbrev-ref") ? "main" : commit);
  const candidate = await collectCurrentCandidate(
    {
      "package-lock": join("inputs", "lock.json"),
      "runtime-bundle": join("inputs", "runtime.json"),
      "release-manifest": join("inputs", "release.json"),
    },
    { root, git },
  );
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(candidate.packageLockHash, digest(packageLock));
  assert.equal(candidate.runtimeBundleHash, digest(runtimeBundle));
  assert.equal(candidate.releaseManifestHash, digest(releaseBytes));
});

test("validates package repository metadata", () => {
  assert.equal(
    packageRepository({ repository: "git+https://github.com/jonathan-vella/apex-vnext.git" }),
    "https://github.com/jonathan-vella/apex-vnext",
  );
  assert.equal(
    packageRepository({ repository: { url: "git+https://github.com/jonathan-vella/apex-vnext.git" } }),
    "https://github.com/jonathan-vella/apex-vnext",
  );
  for (const packageMetadata of [{}, { repository: {} }, { repository: "" }, { repository: { url: 42 } }]) {
    assert.throws(() => packageRepository(packageMetadata), /must declare a repository URL/);
  }
});

test("requires clean source and a same-candidate release manifest", () => {
  assert.doesNotThrow(() => assertCleanGitStatus(""));
  assert.throws(() => assertCleanGitStatus(" M packages/cli/src/cli.ts"), /clean Git worktree/);
  assert.doesNotThrow(() => assertReleaseManifest(releaseManifest, candidate.commit, candidate.repository));
  assert.doesNotThrow(() =>
    assertReleaseManifest(
      { ...releaseManifest, sourceRepository: "git+ssh://git@github.com/jonathan-vella/apex-vnext.git" },
      candidate.commit,
      candidate.repository,
    ),
  );
  assert.throws(
    () =>
      assertReleaseManifest(
        { ...releaseManifest, sourceCommit: "e".repeat(40) },
        candidate.commit,
        candidate.repository,
      ),
    /does not match/,
  );
  assert.throws(
    () =>
      assertReleaseManifest(
        { ...releaseManifest, sourceRepository: "https://github.com/owner/repo" },
        candidate.commit,
        "https://github.com/owner/repo",
      ),
    /destination repository/,
  );
  assert.throws(
    () =>
      assertReleaseManifest(
        { ...releaseManifest, sourceRepository: "https://github.com/owner/repo" },
        candidate.commit,
        candidate.repository,
      ),
    /does not match/,
  );
  assert.throws(
    () => assertReleaseManifest({ ...releaseManifest, packages: [] }, candidate.commit, candidate.repository),
    /invalid/,
  );
});

test("template is unavailable by default and renders deterministically", () => {
  const { qualification } = fixture();
  assert.deepEqual(
    qualification.scenarios.map(({ id }) => id),
    scenarioIds,
  );
  assert.ok(qualification.scenarios.every(({ outcome }) => outcome === "unavailable"));
  assert.equal(renderLiveQualification(qualification), renderLiveQualification(qualification));
  assert.match(renderLiveQualification(qualification), /6 unavailable/);
});

test("validator binds candidate, evidence membership, coverage, and secret policy", () => {
  const { qualification, evidenceManifest, actual } = fixture();
  assert.deepEqual(validateLiveQualification(qualification, evidenceManifest, actual, dependencies), []);

  const tampered = structuredClone(qualification);
  tampered.candidate.commit = "e".repeat(40);
  tampered.runId = "other-run";
  tampered.scenarios[0].actor = "Bearer abcdefghijklmnop";
  tampered.scenarios[0].evidenceRefs = [otherHash];
  tampered.scenarios[1].id = tampered.scenarios[0].id;
  const findings = validateLiveQualification(tampered, evidenceManifest, actual, dependencies);
  assert.ok(findings.some((finding) => finding.includes("candidate.commit")));
  assert.ok(findings.some((finding) => finding.includes("runId")));
  assert.ok(findings.some((finding) => finding.includes("secret-bearing value")));
  assert.ok(findings.some((finding) => finding.includes("unknown evidence reference")));
  assert.ok(findings.some((finding) => finding.includes("qualification semantics")));
});

test("validator binds evidence manifest entries to supplied payload bytes", () => {
  const bytes = Buffer.from('{"result":"pass"}');
  const payloadHash = createHash("sha256").update(bytes).digest("hex");
  const evidenceManifest = {
    ...createEvidenceManifestTemplate({ projectId: "live-test", runId: "run-1", createdAt: timestamp }),
    entries: [{ kind: "vscode", hash: payloadHash, bytes: bytes.byteLength, required: true, retention: "immutable" }],
  };
  const payload = { path: "vscode.json", bytes };

  assert.match(validateEvidencePayloads({}, [payload])[0], /manifest entries are invalid/);
  assert.match(validateEvidencePayloads({ entries: [null] }, [payload])[0], /manifest entries are invalid/);
  assert.deepEqual(validateEvidencePayloads(evidenceManifest, [payload]), []);
  assert.match(validateEvidencePayloads(evidenceManifest, [])[0], /payload is missing/);
  assert.match(
    validateEvidencePayloads(evidenceManifest, [payload], {
      requireClientQualification: true,
      projectId: "live-test",
      candidate,
    })[0],
    /requires client qualification evidence/,
  );

  const tampered = validateEvidencePayloads(evidenceManifest, [
    { path: payload.path, bytes: Buffer.concat([bytes, Buffer.from("\n")]) },
  ]);
  assert.ok(tampered.some((finding) => finding.includes("is not declared")));
  assert.ok(tampered.some((finding) => finding.includes("payload is missing")));
  assert.match(validateEvidencePayloads(evidenceManifest, [payload, payload])[0], /duplicates manifest entry/);

  const wrongSize = { ...evidenceManifest, entries: [{ ...evidenceManifest.entries[0], bytes: bytes.byteLength + 1 }] };
  assert.match(validateEvidencePayloads(wrongSize, [payload])[0], /expected 18 bytes, found 17/);
});
