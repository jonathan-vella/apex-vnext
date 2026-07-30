import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LIVE_QUALIFICATION_SCENARIO_IDS,
  SECRET_FIELD_PATTERN,
  SECRET_VALUE_PATTERN,
  hasValidLiveQualification,
} from "../../../packages/contracts/dist/index.js";
import { EventJournal, ObjectStore } from "../../../packages/kernel/dist/index.js";
import {
  assertCleanGitStatus,
  assertReleaseManifest,
  collectCliSurfaceEvidence,
  collectCurrentCandidate,
  collectRuntimeEvidence,
  createEvidenceManifestTemplate,
  createLiveQualificationTemplate,
  packageRepository,
  parseLiveQualificationArguments,
  renderLiveQualification,
  validateEvidencePayloads,
  validateLiveQualification,
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
    parseLiveQualificationArguments(["runtime", "--project", "demo", "--run", "run-1", "--output", "runtime.json"]),
    { command: "runtime", project: "demo", run: "run-1", output: "runtime.json" },
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
