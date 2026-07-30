import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LIVE_QUALIFICATION_SCENARIO_IDS,
  SECRET_FIELD_PATTERN,
  SECRET_VALUE_PATTERN,
  hasValidLiveQualification,
} from "../../../packages/contracts/dist/index.js";
import {
  assertCleanGitStatus,
  assertReleaseManifest,
  collectCurrentCandidate,
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
    parseLiveQualificationArguments(["validate", "--evidence-file", "first.json", "--evidence-file", "second.json"]),
    {
      command: "validate",
      "evidence-file": ["first.json", "second.json"],
    },
  );
  assert.throws(() => parseLiveQualificationArguments(["validate", "--unknown", "value"]), /Unknown/);
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
