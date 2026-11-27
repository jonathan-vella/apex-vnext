#!/usr/bin/env node
/** Bind a verified client closure and immutable runtime payloads into one evidence manifest. */

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  CLIENT_OUTCOME_CLIENT_IDS,
  CLIENT_OUTCOME_SCENARIO_IDS,
  EvidenceManifestV1Schema,
  createClientQualificationEvidenceEntry,
} from "../../packages/contracts/dist/index.js";
import { canonicalJson, sha256Json } from "../../packages/kernel/dist/index.js";
import { createAjv } from "./_lib/ajv-validator.mjs";
import { parseStrictJson } from "./_lib/strict-json.mjs";
import { sanitizedClientOutcomeError } from "./collect-client-outcome.mjs";
import { validateEvidencePayloads } from "./live-qualification.mjs";
import { resolveInputPath } from "./qualify-client-outcomes.mjs";

const MANIFEST_MAX_BYTES = 65_536;
const CLOSURE_MAX_BYTES = 65_536;
const PAYLOAD_MAX_BYTES = 32 * 1024 * 1024;
const TOTAL_PAYLOAD_MAX_BYTES = 256 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const validateEvidenceManifest = createAjv().compile(EvidenceManifestV1Schema);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function readBounded(path, maxBytes) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maxBytes) || before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new TypeError("BINDING_INPUT_INVALID");
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) throw new TypeError("BINDING_INPUT_CHANGED");
      offset += result.bytesRead;
    }
    const extra = Buffer.alloc(1);
    const extraRead = await handle.read(extra, 0, 1, bytes.length);
    const after = await handle.stat({ bigint: true });
    if (
      extraRead.bytesRead !== 0 ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new TypeError("BINDING_INPUT_CHANGED");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function assertCandidate(candidate) {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate) ||
    Object.keys(candidate).sort().join(",") !==
      "branch,commit,customizationBundleHash,packageLockHash,releaseManifestHash,repository,runtimeBundleHash" ||
    typeof candidate.repository !== "string" ||
    candidate.repository.length === 0 ||
    candidate.repository.length > 256 ||
    typeof candidate.branch !== "string" ||
    candidate.branch.length === 0 ||
    candidate.branch.length > 128 ||
    !COMMIT_PATTERN.test(candidate.commit ?? "") ||
    [
      candidate.packageLockHash,
      candidate.releaseManifestHash,
      candidate.runtimeBundleHash,
      candidate.customizationBundleHash,
    ].some((value) => !SHA256_PATTERN.test(value ?? ""))
  ) {
    throw new TypeError("BINDING_CANDIDATE_INVALID");
  }
}

function assertClosure(closure) {
  const { closureId, ...content } = closure ?? {};
  const validPayload = (entry, kind) =>
    entry !== null &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    Object.keys(entry).sort().join(",") === "bytes,kind,path,sha256" &&
    entry.kind === kind &&
    typeof entry.path === "string" &&
    entry.path.length > 0 &&
    entry.path.length <= 4096 &&
    Number.isInteger(entry.bytes) &&
    entry.bytes > 0 &&
    entry.bytes <= PAYLOAD_MAX_BYTES &&
    SHA256_PATTERN.test(entry.sha256 ?? "");
  if (
    closure?.schemaVersion !== "1.0.0" ||
    closure.kind !== "client-outcome-closure-v1" ||
    closure.qualifiesClientParity !== true ||
    closure.qualifiesRelease !== false ||
    !SHA256_PATTERN.test(closureId ?? "") ||
    closureId !== sha256Json(content) ||
    !Array.isArray(closure.outcomes) ||
    !Array.isArray(closure.comparisons) ||
    closure.outcomes.length !== CLIENT_OUTCOME_SCENARIO_IDS.length * CLIENT_OUTCOME_CLIENT_IDS.length ||
    closure.comparisons.length !== CLIENT_OUTCOME_SCENARIO_IDS.length ||
    closure.outcomes.some((entry) => !validPayload(entry, "client-outcome")) ||
    closure.comparisons.some((entry) => !validPayload(entry, "client-outcome-comparison")) ||
    closure.qualification === null ||
    typeof closure.qualification !== "object" ||
    Array.isArray(closure.qualification) ||
    Object.keys(closure.qualification).sort().join(",") !== "bytes,kind,path,qualificationId,sha256" ||
    closure.qualification.kind !== "client-qualification" ||
    typeof closure.qualification.path !== "string" ||
    closure.qualification.path.length === 0 ||
    closure.qualification.path.length > 4096 ||
    !Number.isInteger(closure.qualification.bytes) ||
    closure.qualification.bytes < 1 ||
    closure.qualification.bytes > PAYLOAD_MAX_BYTES ||
    !SHA256_PATTERN.test(closure.qualification.sha256 ?? "") ||
    !SHA256_PATTERN.test(closure.qualification.qualificationId ?? "")
  ) {
    throw new TypeError("CLIENT_CLOSURE_INVALID");
  }
}

async function closurePayloads(closurePath, closure) {
  const entries = [...closure.outcomes, ...closure.comparisons, closure.qualification];
  const paths = new Set();
  const payloads = [];
  for (const entry of entries) {
    const path = resolveInputPath(closurePath, entry.path);
    if (paths.has(path)) throw new TypeError("CLIENT_CLOSURE_PATH_DUPLICATE");
    paths.add(path);
    const bytes = await readBounded(path, PAYLOAD_MAX_BYTES);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
      throw new TypeError("CLIENT_CLOSURE_PAYLOAD_INVALID");
    }
    payloads.push({ path, bytes, kind: entry.kind, hash: entry.sha256 });
  }
  const qualification = payloads.at(-1);
  const qualificationEntry = createClientQualificationEvidenceEntry(qualification.bytes);
  if (
    qualificationEntry.hash !== closure.qualification.sha256 ||
    qualificationEntry.bytes !== closure.qualification.bytes
  ) {
    throw new TypeError("CLIENT_CLOSURE_QUALIFICATION_INVALID");
  }
  return { payloads, qualificationEntry };
}

function closureManifestEntries(closure) {
  return [...closure.outcomes, ...closure.comparisons].map(({ kind, sha256: hash, bytes }) => ({
    kind,
    hash,
    bytes,
    required: true,
    retention: "immutable",
  }));
}

export async function bindClientOutcomeEvidence({ manifest, output }) {
  const bindingPath = resolve(manifest);
  const binding = parseStrictJson((await readBounded(bindingPath, MANIFEST_MAX_BYTES)).toString("utf8"));
  if (
    binding?.schemaVersion !== "1.0.0" ||
    !Array.isArray(binding.evidencePayloadPaths) ||
    Object.keys(binding).sort().join(",") !==
      "candidatePath,clientClosurePath,evidenceManifestPath,evidencePayloadPaths,schemaVersion" ||
    binding.evidencePayloadPaths.some((value) => typeof value !== "string")
  ) {
    throw new TypeError("EVIDENCE_BINDING_MANIFEST_INVALID");
  }
  const candidatePath = resolveInputPath(bindingPath, binding.candidatePath);
  const evidenceManifestPath = resolveInputPath(bindingPath, binding.evidenceManifestPath);
  const closurePath = resolveInputPath(bindingPath, binding.clientClosurePath);
  const sourcePaths = [candidatePath, evidenceManifestPath, closurePath];
  const evidencePaths = binding.evidencePayloadPaths.map((value) => resolveInputPath(bindingPath, value));
  if (new Set([...sourcePaths, ...evidencePaths]).size !== sourcePaths.length + evidencePaths.length) {
    throw new TypeError("EVIDENCE_BINDING_PATH_DUPLICATE");
  }

  const candidate = parseStrictJson((await readBounded(candidatePath, MANIFEST_MAX_BYTES)).toString("utf8"));
  assertCandidate(candidate);
  const baseManifest = parseStrictJson((await readBounded(evidenceManifestPath, MANIFEST_MAX_BYTES)).toString("utf8"));
  if (
    !validateEvidenceManifest(baseManifest) ||
    baseManifest.clientQualification !== undefined ||
    baseManifest.entries.some(({ kind }) =>
      ["client-outcome", "client-outcome-comparison", "client-qualification"].includes(kind),
    )
  ) {
    throw new TypeError("BASE_EVIDENCE_MANIFEST_INVALID");
  }
  const closure = parseStrictJson((await readBounded(closurePath, CLOSURE_MAX_BYTES)).toString("utf8"));
  assertClosure(closure);
  const client = await closurePayloads(closurePath, closure);
  const basePayloads = [];
  let totalBytes = client.payloads.reduce((total, item) => total + item.bytes.length, 0);
  for (const path of evidencePaths) {
    const bytes = await readBounded(path, PAYLOAD_MAX_BYTES);
    totalBytes += bytes.length;
    if (totalBytes > TOTAL_PAYLOAD_MAX_BYTES) throw new TypeError("EVIDENCE_BINDING_SIZE_INVALID");
    basePayloads.push({ path, bytes, hash: sha256(bytes) });
  }
  const combined = {
    ...baseManifest,
    entries: [...baseManifest.entries, ...closureManifestEntries(closure)],
    clientQualification: client.qualificationEntry,
  };
  if (!validateEvidenceManifest(combined)) throw new TypeError("BOUND_EVIDENCE_MANIFEST_INVALID");
  const payloads = [...basePayloads, ...client.payloads].map(({ path, bytes }) => ({ path, bytes }));
  const findings = validateEvidencePayloads(combined, payloads, {
    requireClientQualification: true,
    projectId: combined.projectId,
    candidate,
  });
  if (!Array.isArray(findings) || findings.length > 0) throw new TypeError("EVIDENCE_BINDING_VALIDATION_FAILED");

  const outputPath = resolve(output);
  const parent = await realpath(dirname(outputPath));
  if (resolve(parent, basename(outputPath)) !== outputPath || (await pathExists(outputPath))) {
    throw new TypeError("EVIDENCE_BINDING_OUTPUT_INVALID");
  }
  const manifestBytes = Buffer.from(canonicalJson(combined), "utf8");
  const allPayloads = [...basePayloads, ...client.payloads];
  const indexContent = {
    schemaVersion: "1.0.0",
    kind: "bound-client-evidence-v1",
    candidateDigest: sha256Json(candidate),
    evidenceManifest: { path: "evidence-manifest.json", bytes: manifestBytes.length, sha256: sha256(manifestBytes) },
    payloads: allPayloads
      .map(({ hash, bytes }) => ({ path: join("payloads", hash), bytes: bytes.length, sha256: hash }))
      .sort((left, right) => left.sha256.localeCompare(right.sha256)),
    qualifiesClientParity: true,
    qualifiesRelease: false,
  };
  const index = { ...indexContent, bindingId: sha256Json(indexContent) };
  const staging = await mkdtemp(join(parent, ".apex-client-evidence-"));
  try {
    await mkdir(join(staging, "payloads"), { mode: 0o700 });
    await writeFile(join(staging, "evidence-manifest.json"), manifestBytes, { flag: "wx", mode: 0o600 });
    for (const { hash, bytes } of allPayloads) {
      await writeFile(join(staging, "payloads", hash), bytes, { flag: "wx", mode: 0o600 });
    }
    await writeFile(join(staging, "binding.json"), `${canonicalJson(index)}\n`, { flag: "wx", mode: 0o600 });
    if (await pathExists(outputPath)) throw new TypeError("EVIDENCE_BINDING_OUTPUT_INVALID");
    await rename(staging, outputPath);
    return index;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  try {
    if (process.argv.length !== 4) throw new TypeError("USAGE_INVALID");
    const result = await bindClientOutcomeEvidence({ output: process.argv[2], manifest: process.argv[3] });
    process.stdout.write(`${canonicalJson(result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`CLIENT_OUTCOME_EVIDENCE_BINDING_FAILED:${sanitizedClientOutcomeError(error)}\n`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
