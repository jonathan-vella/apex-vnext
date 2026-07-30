#!/usr/bin/env node
/**
 * Create, validate, and render exact-head live qualification evidence.
 *
 * @example
 * node tools/scripts/live-qualification.mjs validate --file evidence.json --evidence-manifest manifest.json --evidence-file payload.json --release-manifest release-manifest.json
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  VNEXT_QUALIFICATION_REPOSITORY,
  VNEXT_QUALIFICATION_REPOSITORY_IDENTITY,
} from "./_lib/vnext-qualification.mjs";
import { parseStrictJson } from "./_lib/strict-json.mjs";
import { hasBoundClientQualification } from "../../packages/contracts/dist/index.js";
import { EventJournal, ObjectStore, sha256Json } from "../../packages/kernel/dist/index.js";
import { verifyClientOutcomeQualification } from "./compare-client-outcomes.mjs";
import {
  CLIENT_OUTCOME_SCENARIO_CORPUS,
  CLIENT_OUTCOME_SCENARIO_CORPUS_HASH,
  CLIENT_OUTCOME_TOOLCHAIN_HASH,
  verifyClientOutcomeRuntimeReceipt,
} from "./collect-client-outcome.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const COMMAND_OPTIONS = {
  candidate: new Set(["branch", "output", "package-lock", "release-manifest", "runtime-bundle"]),
  checkpoint: new Set([
    "branch",
    "cli-binary",
    "cli-workspace",
    "output",
    "package-lock",
    "previous",
    "project",
    "release-manifest",
    "run",
    "runtime-bundle",
    "vscode-host",
    "vscode-workspace",
  ]),
  cli: new Set(["binary", "output", "workspace"]),
  runtime: new Set(["output", "project", "run"]),
  template: new Set([
    "actor",
    "branch",
    "created-at",
    "environment",
    "evidence-manifest",
    "output",
    "package-lock",
    "project",
    "release-manifest",
    "run",
    "runtime-bundle",
    "target-scope",
  ]),
  validate: new Set([
    "branch",
    "evidence-file",
    "evidence-manifest",
    "file",
    "package-lock",
    "release-manifest",
    "runtime-bundle",
  ]),
  vscode: new Set(["host", "output", "workspace"]),
  render: new Set(["file", "output"]),
};

export function parseLiveQualificationArguments(argv) {
  const command = argv[0];
  const allowed = COMMAND_OPTIONS[command];
  if (allowed === undefined)
    throw new Error("Command must be candidate, checkpoint, cli, runtime, template, validate, vscode, or render");
  const options = { command };
  for (let index = 1; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!argument?.startsWith("--") || value === undefined) throw new Error(`Expected --name value at ${argument}`);
    const name = argument.slice(2);
    if (!allowed.has(name)) throw new Error(`Unknown ${command} option: --${name}`);
    if (name === "evidence-file") {
      options[name] ??= [];
      options[name].push(value);
    } else {
      options[name] = value;
    }
  }
  return options;
}

const GUIDED_CHECKPOINTS = [
  { id: "vscode-discovery", client: "github-copilot-vscode", scenarioIds: ["CLIENT-002"] },
  { id: "cli-discovery", client: "github-copilot-cli", scenarioIds: ["CLIENT-002"] },
  { id: "vscode-input", client: "github-copilot-vscode", scenarioIds: ["CLIENT-003"] },
  { id: "cli-input", client: "github-copilot-cli", scenarioIds: ["CLIENT-003"] },
  { id: "vscode-mcp-startup", client: "github-copilot-vscode", scenarioIds: ["CLIENT-004"] },
  { id: "client-tool-denials", client: "paired", scenarioIds: ["CLIENT-004", "CLIENT-006"] },
  { id: "vscode-routing", client: "github-copilot-vscode", scenarioIds: ["CLIENT-005"] },
  { id: "restart-resume", client: "paired", scenarioIds: ["CLIENT-007"] },
  { id: "writer-transfer", client: "paired", scenarioIds: ["CLIENT-008"] },
  { id: "customization-lifecycle", client: "paired", scenarioIds: ["CLIENT-009"] },
  { id: "terminal-workflow", client: "paired", scenarioIds: ["CLIENT-010"] },
];

const GUIDED_CAPABILITY_BLOCKERS = [
  {
    id: "cli-hidden-worker-unavailable",
    client: "github-copilot-cli",
    scenarioIds: ["CLIENT-005"],
    reasonCode: "CLI_AUTONOMOUS_WORKERS_OMITTED",
    ownerCode: "UPSTREAM_CLIENT",
    nextActionCode: "REQUALIFY_INDEPENDENT_WORKER_CONTROLS",
  },
];
const CHECKPOINT_FORBIDDEN_FIELD =
  /^(?:assertion|assertions|assertionState|chat(?:log|history)?|content|conversation|instruction|message|prompt|response|raw[-_]?(?:output|text)|transcript)$/iu;

function adapterDigest(value) {
  return sha256Json(value);
}

function assertCheckpointContentFree(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertCheckpointContentFree(item);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (CHECKPOINT_FORBIDDEN_FIELD.test(key)) throw new Error("Checkpoint adapter contains a forbidden field");
      assertCheckpointContentFree(child);
    }
  }
}

function assertCheckpointAdapter(value, adapter, clientId) {
  const runtimeIdentityInvalid =
    clientId === undefined &&
    (typeof value?.projectId !== "string" ||
      !PROJECT_ID_PATTERN.test(value.projectId) ||
      typeof value?.runId !== "string" ||
      !RUN_ID_PATTERN.test(value.runId));
  if (
    value?.schemaVersion !== "1.0.0" ||
    value.adapter !== adapter ||
    (clientId !== undefined && value?.client?.id !== clientId) ||
    (clientId !== undefined && !["pass", "fail", "unavailable"].includes(value?.disposition?.status)) ||
    (clientId === undefined && value.disposition !== undefined) ||
    runtimeIdentityInvalid
  ) {
    throw new Error(`Checkpoint adapter ${adapter} is invalid`);
  }
}

function assertCheckpointCandidate(value) {
  const hashes = [
    value?.packageLockHash,
    value?.releaseManifestHash,
    value?.runtimeBundleHash,
    value?.customizationBundleHash,
  ];
  if (
    typeof value?.repository !== "string" ||
    value.repository.length === 0 ||
    value.repository.length > 256 ||
    typeof value?.branch !== "string" ||
    value.branch.length === 0 ||
    value.branch.length > 128 ||
    !/^[0-9a-f]{40}$/u.test(value?.commit ?? "") ||
    hashes.some((hash) => !SHA256_PATTERN.test(hash ?? ""))
  ) {
    throw new Error("Checkpoint candidate is invalid");
  }
}

function assertPreviousCheckpoint(previous, current) {
  if (
    previous?.schemaVersion !== "1.0.0" ||
    previous.kind !== "guided-client-checkpoint-v1" ||
    !SHA256_PATTERN.test(previous.checkpointId ?? "")
  ) {
    throw new Error("Previous guided checkpoint is invalid");
  }
  assertCheckpointContentFree(previous);
  const { checkpointId, ...content } = previous;
  if (checkpointId !== sha256Json(content)) throw new Error("Previous guided checkpoint self-hash is invalid");
  if (checkpointId !== current.checkpointId) {
    throw new Error("Previous guided checkpoint is stale or belongs to different sources");
  }
}

export async function collectGuidedCheckpoint(
  options,
  {
    root = ROOT,
    collectCandidate = (input) => collectCurrentCandidate(input, { root }),
    collectRuntime = (input) => collectRuntimeEvidence(input, { root }),
    collectCli = (input) => collectCliSurfaceEvidence(input, { root }),
    collectVscode = (input) => collectVscodeSurfaceEvidence(input, { root }),
    previousCheckpoint,
  } = {},
) {
  const candidate = await collectCandidate(options);
  const runtime = await collectRuntime({ project: required(options, "project"), run: required(options, "run") });
  const cli = await collectCli({
    workspace: required(options, "cli-workspace"),
    binary: required(options, "cli-binary"),
  });
  const vscode = await collectVscode({
    workspace: required(options, "vscode-workspace"),
    host: required(options, "vscode-host"),
  });
  assertCheckpointCandidate(candidate);
  assertCheckpointAdapter(runtime, "apex-runtime-journal-v1");
  assertCheckpointAdapter(cli, "copilot-cli-surface-v1", "github-copilot-cli");
  assertCheckpointAdapter(vscode, "vscode-surface-v1", "github-copilot-vscode");
  assertCheckpointContentFree(runtime);
  assertCheckpointContentFree(cli);
  assertCheckpointContentFree(vscode);
  if (runtime.projectId !== options.project || runtime.runId !== options.run) {
    throw new Error("Runtime adapter identity does not match the checkpoint request");
  }
  const adapters = { runtime, cli, vscode };
  const adapterDigests = Object.fromEntries(
    Object.entries(adapters).map(([name, value]) => [name, adapterDigest(value)]),
  );
  const clientDispositions = [cli.disposition, vscode.disposition];
  const automationStatus = clientDispositions.some(({ status }) => status === "fail")
    ? "blocked"
    : clientDispositions.some(({ status }) => status === "unavailable")
      ? "unavailable"
      : "ready";
  const checkpoint = {
    schemaVersion: "1.0.0",
    kind: "guided-client-checkpoint-v1",
    scenarioCorpusHash: CLIENT_OUTCOME_SCENARIO_CORPUS_HASH,
    toolchainHash: CLIENT_OUTCOME_TOOLCHAIN_HASH,
    candidate,
    projectId: runtime.projectId,
    runId: runtime.runId,
    adapters,
    adapterDigests,
    status: {
      automation: automationStatus,
      interaction: "waiting",
      qualifiesClientParity: false,
      qualifiesRelease: false,
    },
    capabilityBlockers: GUIDED_CAPABILITY_BLOCKERS.map((blocker) => ({
      ...blocker,
      scenarioIds: [...blocker.scenarioIds],
    })),
    interactiveCheckpoints: GUIDED_CHECKPOINTS.map((checkpoint) => ({
      ...checkpoint,
      scenarioIds: [...checkpoint.scenarioIds],
      status: automationStatus === "ready" ? "pending" : "blocked",
    })),
  };
  const current = { ...checkpoint, checkpointId: sha256Json(checkpoint) };
  if (previousCheckpoint !== undefined) assertPreviousCheckpoint(previousCheckpoint, current);
  return current;
}

const MAX_CLI_BINARY_BYTES = 256 * 1024 * 1024;
const MAX_CLI_OUTPUT_BYTES = 1024 * 1024;
const MAX_MANAGED_FILE_BYTES = 2 * 1024 * 1024;
const MANAGED_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;
const MCP_SERVER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

async function readBoundedRegularFile(path, maxBytes, label) {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maxBytes)) {
    throw new Error(`${label} must be a bounded regular file`);
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > BigInt(maxBytes)) {
      throw new Error(`${label} changed before read`);
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > maxBytes) throw new Error(`${label} exceeds its byte budget`);
    const after = await lstat(path, { bigint: true });
    if (after.isSymbolicLink() || after.dev !== opened.dev || after.ino !== opened.ino) {
      throw new Error(`${label} changed during read`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function hashBoundedRegularFile(path, maxBytes, label) {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maxBytes)) {
    throw new Error(`${label} must be a bounded regular file`);
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > BigInt(maxBytes)) {
      throw new Error(`${label} changed before read`);
    }
    const hash = createHash("sha256");
    let bytesRead = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytesRead += chunk.byteLength;
      if (bytesRead > maxBytes) throw new Error(`${label} exceeds its byte budget`);
      hash.update(chunk);
    }
    const after = await lstat(path, { bigint: true });
    if (
      after.isSymbolicLink() ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      BigInt(bytesRead) !== opened.size
    ) {
      throw new Error(`${label} changed during read`);
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

async function managedPath(root, canonicalRoot, value) {
  if (typeof value !== "string" || !MANAGED_PATH_PATTERN.test(value) || isAbsolute(value)) {
    throw new Error("Managed customization path is unsafe");
  }
  const path = resolve(root, value);
  const relation = relative(root, path);
  if (relation === "" || relation === ".." || relation.startsWith(`..${sep}`)) {
    throw new Error("Managed customization path escapes the workspace");
  }
  const parentPath = await realpath(dirname(path));
  const parentRelation = relative(canonicalRoot, parentPath);
  if (
    parentRelation === ".." ||
    parentRelation.startsWith(`..${sep}`) ||
    resolve(parentPath, basename(path)) !== path
  ) {
    throw new Error("Managed customization parent escapes the workspace");
  }
  return path;
}

function cliVersion(output) {
  const match = /^GitHub Copilot CLI ([0-9]+(?:\.[0-9]+){1,3}(?:-[0-9A-Za-z.-]+)?)/m.exec(output);
  if (match === null) throw new Error("Copilot CLI version output is invalid");
  return match[1];
}

function defaultCliRunner(binary, args, workspace) {
  return execFileSync(binary, args, {
    cwd: workspace,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: MAX_CLI_OUTPUT_BYTES,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

async function collectManagedProjection(workspace, expectedClientId, requiredFile, label) {
  const canonicalWorkspace = await realpath(workspace);
  const lockPath = join(workspace, ".apex", "customizations.lock.json");
  let lockBytes;
  try {
    lockBytes = await readBoundedRegularFile(lockPath, MAX_MANAGED_FILE_BYTES, `${label} customization lock`);
  } catch (error) {
    throw new Error(`${label} customization lock could not be read`, { cause: error });
  }
  const lock = parseStrictJson(lockBytes.toString("utf8"));
  if (
    lock?.version !== 1 ||
    lock.clientId !== expectedClientId ||
    !Array.isArray(lock.files) ||
    lock.files.length === 0 ||
    lock.files.length > 256 ||
    !lock.files.some((entry) => entry?.path === requiredFile)
  ) {
    throw new Error(`${label} customization lock is invalid`);
  }
  const files = [];
  const managedDestinations = new Set();
  for (const entry of lock.files) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.path !== "string" ||
      !SHA256_PATTERN.test(entry.currentHash ?? "")
    ) {
      throw new Error(`${label} managed file entry is invalid`);
    }
    const destination = await managedPath(workspace, canonicalWorkspace, entry.path);
    if (managedDestinations.has(destination)) throw new Error(`${label} managed file destination is duplicated`);
    managedDestinations.add(destination);
    let bytes;
    try {
      bytes = await readBoundedRegularFile(destination, MAX_MANAGED_FILE_BYTES, `${label} managed customization file`);
    } catch (error) {
      throw new Error(`${label} managed customization file could not be read`, { cause: error });
    }
    const actualHash = sha256(bytes);
    files.push({
      path: entry.path,
      expectedHash: entry.currentHash,
      actualHash,
      matches: actualHash === entry.currentHash,
    });
  }
  files.sort(({ path: left }, { path: right }) => left.localeCompare(right));
  return { clientId: lock.clientId, lockSha256: sha256(lockBytes), files };
}

export async function collectCliSurfaceEvidence(
  options,
  { root = ROOT, contractRoot = ROOT, runCli = defaultCliRunner } = {},
) {
  const workspace = resolve(root, options.workspace ?? ".");
  await assertRuntimeDirectory(workspace, "CLI workspace");
  const binary = resolve(workspace, required(options, "binary"));
  const observedBinarySha256 = await hashBoundedRegularFile(binary, MAX_CLI_BINARY_BYTES, "Copilot CLI binary");
  const inventory = parseStrictJson(
    (
      await readBoundedRegularFile(
        join(contractRoot, "tools", "registry", "copilot-cli-agent-tools.json"),
        MAX_CLI_OUTPUT_BYTES,
        "Copilot CLI inventory",
      )
    ).toString("utf8"),
  );
  if (
    inventory?.client !== "github-copilot-cli" ||
    typeof inventory.clientVersion !== "string" ||
    !SHA256_PATTERN.test(inventory.clientBinarySha256 ?? "") ||
    typeof inventory.workspaceServer !== "string"
  ) {
    throw new Error("Copilot CLI inventory is invalid");
  }
  const versionOutput = runCli(binary, ["version", "--no-auto-update"], workspace);
  if (Buffer.byteLength(versionOutput) > MAX_CLI_OUTPUT_BYTES)
    throw new Error("Copilot CLI version output is too large");
  const observedVersion = cliVersion(versionOutput);
  const projection = await collectManagedProjection(workspace, "github-copilot-cli", ".github/mcp.json", "Copilot CLI");
  const { files } = projection;
  const versionMatches = observedVersion === inventory.clientVersion;
  const binaryMatches = observedBinarySha256 === inventory.clientBinarySha256;
  const exactClient = versionMatches && binaryMatches;
  const drift = files.some(({ matches }) => !matches);
  let mcp = { status: "not-run", servers: [], sourceDigest: null };
  if (exactClient && !drift) {
    const output = runCli(binary, ["mcp", "list", "--json", "--no-auto-update", "--no-remote"], workspace);
    if (Buffer.byteLength(output) > MAX_CLI_OUTPUT_BYTES) throw new Error("Copilot CLI MCP output is too large");
    const value = parseStrictJson(output);
    if (value?.mcpServers === null || typeof value?.mcpServers !== "object" || Array.isArray(value.mcpServers)) {
      throw new Error("Copilot CLI MCP inventory is invalid");
    }
    const servers = Object.keys(value.mcpServers).sort();
    if (servers.some((server) => !MCP_SERVER_PATTERN.test(server)))
      throw new Error("Copilot CLI MCP server name is invalid");
    mcp = { status: "observed", servers, sourceDigest: sha256(Buffer.from(output)) };
  }
  const missingMcp = exactClient && !mcp.servers.includes(inventory.workspaceServer);
  const disposition = !exactClient
    ? {
        status: "unavailable",
        reasonCode: versionMatches ? "CLIENT_BINARY_MISMATCH" : "CLIENT_VERSION_MISMATCH",
        ownerCode: "CLIENT_ENVIRONMENT",
        nextActionCode: "INSTALL_SELECTED_CLI",
      }
    : drift
      ? { status: "fail", reasonCode: "MANAGED_FILE_DRIFT" }
      : missingMcp
        ? { status: "fail", reasonCode: "MCP_SERVER_MISSING" }
        : { status: "pass" };
  return {
    schemaVersion: "1.0.0",
    adapter: "copilot-cli-surface-v1",
    client: {
      id: "github-copilot-cli",
      selectedVersion: inventory.clientVersion,
      observedVersion,
      selectedBinarySha256: inventory.clientBinarySha256,
      observedBinarySha256,
      versionOutputSha256: sha256(Buffer.from(versionOutput)),
    },
    workspace: {
      clientId: projection.clientId,
      lockSha256: projection.lockSha256,
      files,
    },
    mcp,
    disposition,
  };
}

const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){1,3}(?:-[0-9A-Za-z.-]+)?$/;
const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,127}$/;

function defaultVscodeRunner(host, args, workspace) {
  return execFileSync(host, args, {
    cwd: workspace,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: MAX_CLI_OUTPUT_BYTES,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function vscodeVersion(output) {
  const version = output.split(/\r?\n/u)[0]?.trim();
  if (version === undefined || !VERSION_PATTERN.test(version)) throw new Error("VS Code version output is invalid");
  return version;
}

function vscodeExtensions(output) {
  if (Buffer.byteLength(output) > MAX_CLI_OUTPUT_BYTES) throw new Error("VS Code extension output is too large");
  const extensions = new Map();
  for (const line of output.split(/\r?\n/u).filter((value) => value.length > 0)) {
    if (/^Extensions installed on [^\r\n]{1,160}:$/u.test(line)) continue;
    const separator = line.lastIndexOf("@");
    const id = line.slice(0, separator).toLowerCase();
    const version = line.slice(separator + 1);
    if (separator < 1 || !EXTENSION_ID_PATTERN.test(id) || !VERSION_PATTERN.test(version) || extensions.has(id)) {
      throw new Error("VS Code extension inventory is invalid");
    }
    extensions.set(id, version);
    if (extensions.size > 2048) throw new Error("VS Code extension inventory is too large");
  }
  return extensions;
}

export async function collectVscodeSurfaceEvidence(
  options,
  { root = ROOT, contractRoot = ROOT, runVscode = defaultVscodeRunner } = {},
) {
  const workspace = resolve(root, options.workspace ?? ".");
  await assertRuntimeDirectory(workspace, "VS Code workspace");
  const toolchain = parseStrictJson(
    (
      await readBoundedRegularFile(
        join(contractRoot, "config", "toolchain.v1.json"),
        MAX_CLI_OUTPUT_BYTES,
        "Toolchain configuration",
      )
    ).toString("utf8"),
  );
  const selectedVersion = toolchain?.core?.vscode?.selectedExactVersion;
  const selectedExtensionVersion = toolchain?.core?.vscode?.selectedExactCopilotChatVersion;
  if (!VERSION_PATTERN.test(selectedVersion ?? "") || !VERSION_PATTERN.test(selectedExtensionVersion ?? "")) {
    throw new Error("Selected VS Code toolchain is invalid");
  }
  const host = required(options, "host");
  if (!isAbsolute(host)) throw new Error("VS Code host must be an absolute path");
  const observedHostSha256 = await hashBoundedRegularFile(host, MAX_CLI_BINARY_BYTES, "VS Code host");
  const versionOutput = runVscode(host, ["--version"], workspace);
  if (Buffer.byteLength(versionOutput) > MAX_CLI_OUTPUT_BYTES) throw new Error("VS Code version output is too large");
  const observedVersion = vscodeVersion(versionOutput);
  const extensionOutput = runVscode(host, ["--list-extensions", "--show-versions"], workspace);
  const extensions = vscodeExtensions(extensionOutput);
  const observedExtensionVersion = extensions.get("github.copilot-chat") ?? null;
  const projection = await collectManagedProjection(workspace, "github-copilot-vscode", ".vscode/mcp.json", "VS Code");
  const drift = projection.files.some(({ matches }) => !matches);
  const disposition =
    observedVersion !== selectedVersion
      ? {
          status: "unavailable",
          reasonCode: "HOST_VERSION_MISMATCH",
          ownerCode: "CLIENT_ENVIRONMENT",
          nextActionCode: "INSTALL_SELECTED_VSCODE",
        }
      : observedExtensionVersion === null
        ? {
            status: "unavailable",
            reasonCode: "COPILOT_CHAT_EXTENSION_MISSING",
            ownerCode: "CLIENT_ENVIRONMENT",
            nextActionCode: "INSTALL_SELECTED_COPILOT_CHAT",
          }
        : observedExtensionVersion !== selectedExtensionVersion
          ? {
              status: "unavailable",
              reasonCode: "COPILOT_CHAT_VERSION_MISMATCH",
              ownerCode: "CLIENT_ENVIRONMENT",
              nextActionCode: "INSTALL_SELECTED_COPILOT_CHAT",
            }
          : drift
            ? { status: "fail", reasonCode: "MANAGED_FILE_DRIFT" }
            : { status: "pass" };
  return {
    schemaVersion: "1.0.0",
    adapter: "vscode-surface-v1",
    client: {
      id: "github-copilot-vscode",
      selectedVersion,
      observedVersion,
      observedHostSha256,
      selectedExtensionVersion,
      observedExtensionVersion,
      versionOutputSha256: sha256(Buffer.from(versionOutput)),
      extensionInventorySha256: sha256(Buffer.from(extensionOutput)),
    },
    workspace: projection,
    disposition,
  };
}

const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const RUNTIME_FACT_ID_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RUNTIME_EVENT_TYPES = new Set([
  "task.completed",
  "gate.decided",
  "evidence.accepted",
  "deployment.completed",
  "transfer-accepted",
]);

async function assertRuntimeDirectory(path, label) {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (await realpath(path)) !== resolve(path)) {
    throw new Error(`${label} must be a real directory`);
  }
}

async function assertJournalFiles(journalPath) {
  await assertRuntimeDirectory(journalPath, "Runtime journal");
  const names = await readdir(journalPath);
  if (names.length === 0 || names.length > 4096 || names.some((name) => !/^\d{16}\.json$/.test(name))) {
    throw new Error("Runtime journal file set is invalid");
  }
}

function runtimeId(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function runtimeFactId(value, label) {
  if (typeof value !== "string" || !RUNTIME_FACT_ID_PATTERN.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function runtimeHash(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

async function runtimeFacts(event, objects, firstOwnerEpoch) {
  const payload = event.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    if (RUNTIME_EVENT_TYPES.has(event.type))
      throw new Error(`Recognized runtime event ${event.type} has invalid payload`);
    return [];
  }
  const facts = [];
  if (event.type === "task.completed") {
    facts.push({ type: "task", node: runtimeFactId(payload.nodeId, "Task node"), taskState: "completed" });
    const artifactHashes = payload.artifactHashes;
    if (artifactHashes !== undefined) {
      if (artifactHashes === null || typeof artifactHashes !== "object" || Array.isArray(artifactHashes)) {
        throw new Error("Task artifact hashes are invalid");
      }
      for (const [artifact, artifactHash] of Object.entries(artifactHashes).sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        facts.push({
          type: "artifact",
          artifact: runtimeFactId(artifact, "Artifact kind"),
          artifactHash: runtimeHash(artifactHash, "Artifact hash"),
        });
      }
    }
  } else if (event.type === "gate.decided") {
    if (!Number.isInteger(payload.gate) || payload.gate < 1 || payload.gate > 4) {
      throw new Error("Gate number is invalid");
    }
    const approvalHash = runtimeHash(payload.approvalHash, "Approval hash");
    const approval = await objects.getJson(approvalHash);
    if (
      approval?.projectId !== event.projectId ||
      approval?.runId !== event.runId ||
      approval?.gate !== payload.gate ||
      approval?.writerEpoch !== event.ownerEpoch ||
      !["approved", "rejected"].includes(approval?.decision)
    ) {
      throw new Error("Gate approval object does not match its journal event");
    }
    facts.push({
      type: "gate",
      gate: payload.gate,
      gateState: approval.decision === "approved" ? "approved" : "denied",
    });
  } else if (event.type === "evidence.accepted" && payload.status === "accepted" && payload.hash !== undefined) {
    facts.push({
      type: "evidence",
      evidence: runtimeFactId(payload.kind, "Evidence kind"),
      evidenceHash: runtimeHash(payload.hash, "Evidence hash"),
    });
  } else if (event.type === "deployment.completed") {
    for (const [artifact, field] of [
      ["operation-record", "operationHash"],
      ["resource-inventory", "inventoryHash"],
    ]) {
      if (payload[field] !== undefined) {
        facts.push({ type: "artifact", artifact, artifactHash: runtimeHash(payload[field], `${artifact} hash`) });
      }
    }
  } else if (event.type === "transfer-accepted") {
    facts.push({ type: "transfer", transferResult: "succeeded", ownerEpochDelta: event.ownerEpoch - firstOwnerEpoch });
  }
  return facts;
}

export async function collectRuntimeEvidence(
  options,
  { root = ROOT, journalFactory = (path) => new EventJournal(path), objectStore = new ObjectStore(root) } = {},
) {
  const projectId = runtimeId(required(options, "project"), "Project ID", PROJECT_ID_PATTERN);
  const runId = runtimeId(required(options, "run"), "Run ID", RUN_ID_PATTERN);
  const runPath = join(root, ".apex", "projects", projectId, "runs", runId);
  await assertRuntimeDirectory(runPath, "Runtime run");
  const journalPath = join(runPath, "journal");
  await assertJournalFiles(journalPath);
  const events = await journalFactory(journalPath).replay();
  if (events.length === 0 || events.length > 4096) throw new Error("Runtime journal event count is invalid");
  if (events.some((event) => event.projectId !== projectId || event.runId !== runId)) {
    throw new Error("Runtime journal identity does not match the requested project and run");
  }
  let previousOwnerEpoch = 0;
  for (const event of events) {
    if (!Number.isInteger(event.ownerEpoch) || event.ownerEpoch < 1 || event.ownerEpoch < previousOwnerEpoch) {
      throw new Error("Runtime journal owner epochs must be positive non-decreasing integers");
    }
    previousOwnerEpoch = event.ownerEpoch;
  }
  const firstOwnerEpoch = events[0].ownerEpoch;
  const records = [];
  for (const event of events) {
    for (const fact of await runtimeFacts(event, objectStore, firstOwnerEpoch)) {
      records.push({
        source: {
          eventHash: event.hash,
          sequence: event.sequence,
          eventType: event.type,
          payloadHash: event.payloadHash,
          ownerEpoch: event.ownerEpoch,
        },
        fact,
      });
    }
  }
  return {
    schemaVersion: "1.0.0",
    adapter: "apex-runtime-journal-v1",
    projectId,
    runId,
    source: {
      journalHead: events.at(-1).hash,
      eventCount: events.length,
      firstOwnerEpoch,
      lastOwnerEpoch: events.at(-1).ownerEpoch,
    },
    records,
  };
}

export function createEvidenceManifestTemplate({ projectId, runId, createdAt }) {
  return { schemaVersion: "1.0.0", projectId, runId, createdAt, entries: [] };
}

export function createLiveQualificationTemplate({
  scenarioIds,
  projectId,
  runId,
  candidate,
  evidenceManifestHash,
  createdAt,
  actor,
  environment,
  targetScope,
  toolVersions,
}) {
  return {
    schemaVersion: "1.0.0",
    projectId,
    runId,
    candidate,
    createdAt,
    evidenceManifestHash,
    scenarios: scenarioIds.map((id) => ({
      id,
      environment,
      targetScope,
      actor,
      startedAt: createdAt,
      completedAt: createdAt,
      toolVersions,
      outcome: "unavailable",
      evidenceRefs: [],
      disposition: {
        reason: "Scenario has not been executed",
        owner: actor,
        nextAction: `Execute ${id} against the bound candidate`,
      },
    })),
  };
}

function secretIssues(value, fieldPattern, valuePattern, path = "") {
  if (Array.isArray(value))
    return value.flatMap((item, index) => secretIssues(item, fieldPattern, valuePattern, `${path}/${index}`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, item]) => [
        ...(fieldPattern.test(key) ? [`${path}/${key}: secret-bearing field is not allowed`] : []),
        ...secretIssues(item, fieldPattern, valuePattern, `${path}/${key}`),
      ]);
  }
  return typeof value === "string" && valuePattern.test(value)
    ? [`${path || "/"}: secret-bearing value is not allowed`]
    : [];
}

export function validateLiveQualification(qualification, evidenceManifest, actual, dependencies) {
  const findings = [
    ...dependencies.qualificationSchemaErrors(qualification).map((message) => `qualification schema: ${message}`),
    ...dependencies
      .evidenceManifestSchemaErrors(evidenceManifest)
      .map((message) => `evidence manifest schema: ${message}`),
  ];
  if (findings.length > 0) return findings;
  if (!dependencies.hasValidLiveQualification(qualification))
    findings.push("qualification semantics: required scenarios or timestamps are invalid");
  for (const [field, expected] of Object.entries(actual.candidate)) {
    if (qualification.candidate[field] !== expected)
      findings.push(`candidate.${field}: expected ${expected}, found ${qualification.candidate[field]}`);
  }
  if (qualification.evidenceManifestHash !== actual.evidenceManifestHash)
    findings.push("evidenceManifestHash: evidence manifest bytes do not match");
  if (qualification.projectId !== evidenceManifest.projectId)
    findings.push(`projectId: expected evidence manifest project ${evidenceManifest.projectId}`);
  if (qualification.runId !== evidenceManifest.runId)
    findings.push(`runId: expected evidence manifest run ${evidenceManifest.runId}`);
  const evidenceEntries = [
    ...evidenceManifest.entries,
    ...(evidenceManifest.clientQualification === undefined ? [] : [evidenceManifest.clientQualification]),
  ];
  const knownEvidence = new Set(evidenceEntries.map(({ hash }) => hash));
  if (knownEvidence.size !== evidenceEntries.length)
    findings.push("evidence manifest: duplicate entry hashes are not allowed");
  for (const scenario of qualification.scenarios) {
    for (const reference of scenario.evidenceRefs) {
      if (!knownEvidence.has(reference))
        findings.push(`scenarios/${scenario.id}: unknown evidence reference ${reference}`);
    }
  }
  if (
    evidenceManifest.clientQualification !== undefined &&
    !qualification.scenarios.some(({ evidenceRefs }) =>
      evidenceRefs.includes(evidenceManifest.clientQualification.hash),
    )
  ) {
    findings.push("client qualification: no live scenario references the bound qualification");
  }
  findings.push(...secretIssues(qualification, dependencies.secretFieldPattern, dependencies.secretValuePattern));
  return findings.sort();
}

export function validateEvidencePayloads(evidenceManifest, payloads, releaseContext) {
  if (
    !Array.isArray(evidenceManifest?.entries) ||
    evidenceManifest.entries.some(
      (entry) =>
        entry === null ||
        typeof entry !== "object" ||
        typeof entry.kind !== "string" ||
        typeof entry.hash !== "string" ||
        !Number.isInteger(entry.bytes),
    ) ||
    (evidenceManifest.clientQualification !== undefined &&
      (evidenceManifest.clientQualification === null ||
        typeof evidenceManifest.clientQualification !== "object" ||
        evidenceManifest.clientQualification.kind !== "client-qualification" ||
        typeof evidenceManifest.clientQualification.hash !== "string" ||
        !Number.isInteger(evidenceManifest.clientQualification.bytes)))
  ) {
    return ["evidence payloads: evidence manifest entries are invalid"];
  }
  const findings = [];
  if (releaseContext?.requireClientQualification && evidenceManifest.clientQualification === undefined) {
    findings.push("evidence manifest: live release qualification requires client qualification evidence");
  }
  const supportingClientEntries = evidenceManifest.entries.filter(
    ({ kind }) => kind === "client-outcome" || kind === "client-outcome-comparison",
  );
  if (evidenceManifest.entries.some(({ kind }) => kind === "client-qualification")) {
    findings.push("evidence manifest: client-qualification is only allowed in the dedicated property");
  }
  if (supportingClientEntries.length > 0 && evidenceManifest.clientQualification === undefined) {
    findings.push("evidence manifest: client outcome evidence requires a bound client qualification");
  }
  const entries = [
    ...evidenceManifest.entries,
    ...(evidenceManifest.clientQualification === undefined ? [] : [evidenceManifest.clientQualification]),
  ];
  const uniqueHashes = new Set(entries.map(({ hash }) => hash));
  if (uniqueHashes.size !== entries.length) {
    findings.push("evidence manifest: duplicate entry hashes are not allowed");
  }
  const entriesByHash = new Map(entries.map((entry) => [entry.hash, entry]));
  const matchedHashes = new Set();
  const payloadBytesByHash = new Map();
  const clientPayloads = {
    qualification: [],
    comparisons: [],
    outcomes: [],
  };
  for (const { path, bytes } of payloads) {
    const hash = sha256(bytes);
    const entry = entriesByHash.get(hash);
    if (entry === undefined) {
      findings.push(`evidence payload ${path}: hash ${hash} is not declared in the evidence manifest`);
      continue;
    }
    if (matchedHashes.has(hash)) {
      findings.push(`evidence payload ${path}: duplicates manifest entry ${entry.kind}`);
      continue;
    }
    matchedHashes.add(hash);
    payloadBytesByHash.set(hash, bytes);
    if (bytes.byteLength !== entry.bytes) {
      findings.push(`evidence payload ${path}: expected ${entry.bytes} bytes, found ${bytes.byteLength}`);
    }
    if (
      entry === evidenceManifest.clientQualification ||
      entry.kind === "client-outcome-comparison" ||
      entry.kind === "client-outcome"
    ) {
      let value;
      try {
        value = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        const label = entry === evidenceManifest.clientQualification ? "client qualification" : entry.kind;
        findings.push(`evidence payload ${path}: ${label} must be strict UTF-8 JSON`);
        continue;
      }
      if (entry === evidenceManifest.clientQualification) {
        if (!hasBoundClientQualification(evidenceManifest, bytes)) {
          findings.push(`evidence payload ${path}: client qualification contract or binding is invalid`);
        } else {
          clientPayloads.qualification.push(value);
        }
      } else if (entry.kind === "client-outcome-comparison") {
        clientPayloads.comparisons.push(value);
      } else {
        clientPayloads.outcomes.push(value);
      }
    }
  }
  for (const entry of entries) {
    if (!matchedHashes.has(entry.hash)) findings.push(`evidence manifest entry ${entry.kind}: payload is missing`);
  }
  if (evidenceManifest.clientQualification !== undefined && clientPayloads.qualification.length === 1) {
    try {
      const qualification = clientPayloads.qualification[0];
      const comparisons = new Map(clientPayloads.comparisons.map((value) => [value?.comparisonId, value]));
      const outcomes = new Map(clientPayloads.outcomes.map((value) => [value?.outcomeId, value]));
      if (comparisons.size !== clientPayloads.comparisons.length || outcomes.size !== clientPayloads.outcomes.length) {
        throw new TypeError("CLIENT_QUALIFICATION_DUPLICATE_PAYLOAD_ID");
      }
      const referencedComparisons = new Set(qualification.comparisons.map(({ comparisonId }) => comparisonId));
      const referencedOutcomes = new Set(
        qualification.comparisons.flatMap(({ outcomeIds }) => [outcomeIds.vscode, outcomeIds.cli]),
      );
      if (
        referencedComparisons.size !== comparisons.size ||
        referencedOutcomes.size !== outcomes.size ||
        [...comparisons.keys()].some((id) => !referencedComparisons.has(id)) ||
        [...outcomes.keys()].some((id) => !referencedOutcomes.has(id))
      ) {
        throw new TypeError("CLIENT_QUALIFICATION_PAYLOAD_SET_INVALID");
      }
      const triplets = qualification.comparisons.map(({ comparisonId, outcomeIds }) => ({
        comparison: comparisons.get(comparisonId),
        outcomes: [outcomes.get(outcomeIds.vscode), outcomes.get(outcomeIds.cli)],
      }));
      if (releaseContext !== undefined) {
        const expectedCandidate = releaseContext.candidate;
        const expectedRepository = repositoryIdentity(expectedCandidate.repository);
        const outcomesInClosure = triplets.flatMap(({ outcomes: values }) => values);
        if (
          qualification.evidenceKind !== "live" ||
          outcomesInClosure.some(
            (outcome) =>
              outcome?.evidenceKind !== "live" ||
              outcome.execution?.projectId !== releaseContext.projectId ||
              repositoryIdentity(outcome.candidate?.repository) !== expectedRepository ||
              outcome.candidate?.branch !== expectedCandidate.branch ||
              outcome.candidate?.commit !== expectedCandidate.commit ||
              outcome.candidate?.packageLockHash !== expectedCandidate.packageLockHash ||
              outcome.candidate?.releaseManifestHash !== expectedCandidate.releaseManifestHash ||
              outcome.candidate?.runtimeBundleHash !== expectedCandidate.runtimeBundleHash ||
              outcome.candidate?.customizationBundleHash !== expectedCandidate.customizationBundleHash ||
              outcome.candidate?.scenarioCorpusHash !== CLIENT_OUTCOME_SCENARIO_CORPUS_HASH ||
              outcome.candidate?.toolchainHash !== CLIENT_OUTCOME_TOOLCHAIN_HASH,
          )
        ) {
          throw new TypeError("CLIENT_QUALIFICATION_RELEASE_BINDING_INVALID");
        }
        if (validateClientRuntimeEvidence(outcomesInClosure, entriesByHash, payloadBytesByHash).length > 0) {
          throw new TypeError("CLIENT_RUNTIME_EVIDENCE_INVALID");
        }
      }
      const context =
        qualification.evidenceKind === "fixture"
          ? {
              mode: "fixture-only",
              scenarioIds: CLIENT_OUTCOME_SCENARIO_CORPUS.scenarios.map(({ id }) => id),
              scenarioCorpusHash: CLIENT_OUTCOME_SCENARIO_CORPUS_HASH,
              toolchainHash: CLIENT_OUTCOME_TOOLCHAIN_HASH,
              clients: {
                vscodeVersion: CLIENT_OUTCOME_SCENARIO_CORPUS.fixtureClients.vscodeVersion,
                vscodeExtensionVersion: CLIENT_OUTCOME_SCENARIO_CORPUS.fixtureClients.vscodeExtensionVersion,
                cliVersion: CLIENT_OUTCOME_SCENARIO_CORPUS.fixtureClients.cliVersion,
              },
            }
          : undefined;
      verifyClientOutcomeQualification(qualification, triplets, context);
    } catch {
      findings.push("client qualification: supporting comparison/outcome closure is invalid");
    }
  }
  return findings.sort();
}

const escapeCell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");

export function renderLiveQualification(qualification) {
  const counts = Object.fromEntries(
    ["pass", "fail", "unavailable"].map((outcome) => [
      outcome,
      qualification.scenarios.filter((scenario) => scenario.outcome === outcome).length,
    ]),
  );
  const rows = qualification.scenarios.map(
    (scenario) =>
      `| ${escapeCell(scenario.id)} | ${scenario.outcome} | ${escapeCell(scenario.environment)} | ${escapeCell(scenario.targetScope)} | ${scenario.evidenceRefs.length} |`,
  );
  return [
    "# Live Qualification",
    "",
    `- Repository: \`${qualification.candidate.repository}\``,
    `- Branch: \`${qualification.candidate.branch}\``,
    `- Commit: \`${qualification.candidate.commit}\``,
    `- Project/run: \`${qualification.projectId}\` / \`${qualification.runId}\``,
    `- Created: ${qualification.createdAt}`,
    `- Outcomes: ${counts.pass} pass, ${counts.fail} fail, ${counts.unavailable} unavailable`,
    "",
    "| Scenario | Outcome | Environment | Target | Evidence |",
    "| -------- | ------- | ----------- | ------ | -------- |",
    ...rows,
    "",
  ].join("\n");
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function validateClientRuntimeEvidence(outcomes, entriesByHash, payloadBytesByHash) {
  const findings = [];
  const requireImmutablePayload = (hash, expectedKind, label) => {
    const entry = entriesByHash.get(hash);
    if (
      entry === undefined ||
      entry.kind !== expectedKind ||
      entry.retention !== "immutable" ||
      !payloadBytesByHash.has(hash)
    ) {
      findings.push(`${label}: immutable evidence payload ${hash} is missing`);
      return false;
    }
    return true;
  };
  for (const outcome of outcomes) {
    const prefix = `client outcome ${outcome?.outcomeId ?? "unknown"}`;
    const sourceDigest = outcome?.evidence?.sourceDigest;
    const attestationHash = outcome?.evidence?.attestationHash;
    const semanticJournalHash = outcome?.execution?.semanticJournalHash;
    const references = [
      ["journal source", sourceDigest, "client-journal-source"],
      ["journal attestation", attestationHash, "client-journal-attestation"],
      ["semantic journal", semanticJournalHash, "client-semantic-journal"],
      ...Object.entries(outcome?.observations?.artifacts ?? {}).map(([name, value]) => [
        `artifact ${name}`,
        value,
        `client-artifact:${name}`,
      ]),
      ...Object.entries(outcome?.observations?.evidence ?? {}).map(([name, value]) => [
        `evidence ${name}`,
        value,
        `client-evidence:${name}`,
      ]),
      ...(outcome?.evidence?.refs ?? []).map((value) => ["evidence ref", value, "client-evidence-ref"]),
    ];
    for (const [label, hash, expectedKind] of references) {
      if (typeof hash === "string") requireImmutablePayload(hash, expectedKind, `${prefix} ${label}`);
    }
    if (typeof sourceDigest !== "string" || !payloadBytesByHash.has(sourceDigest)) continue;
    try {
      const source = parseStrictJson(
        new TextDecoder("utf-8", { fatal: true }).decode(payloadBytesByHash.get(sourceDigest)),
      );
      if (source?.schemaVersion !== "1.0.0" || !Array.isArray(source.records) || source.records.length === 0) {
        throw new TypeError("SOURCE_SHAPE_INVALID");
      }
      for (const record of source.records) {
        if (
          !requireImmutablePayload(
            record?.payloadHash,
            "client-journal-payload",
            `${prefix} journal record ${record?.sequence ?? "unknown"}`,
          )
        ) {
          throw new TypeError("SOURCE_PAYLOAD_MISSING");
        }
      }
      verifyClientOutcomeRuntimeReceipt(outcome, source);
    } catch {
      findings.push(`${prefix}: journal source evidence is invalid`);
    }
  }
  return findings.sort();
}

async function readJsonBytes(path) {
  const bytes = await readFile(path);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

async function writeNew(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, { encoding: "utf8", flag: "wx" });
}

async function writeNewFiles(files) {
  const written = [];
  try {
    for (const [path, contents] of files) {
      await writeNew(path, contents);
      written.push(path);
    }
  } catch (error) {
    await Promise.all(written.map((path) => rm(path, { force: true })));
    throw error;
  }
}

async function writeRendered(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

const required = (options, name) => {
  const value = options[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`--${name} is required`);
  return value;
};

function gitValue(args, root = ROOT) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

export function assertCleanGitStatus(status) {
  if (status.trim().length > 0) throw new Error("Live qualification requires a clean Git worktree");
}

function repositoryIdentity(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(value)) return `github.com/${value.toLowerCase()}`;
  const remote = value.replace(/^git\+/, "");
  const normalized = /^git@[^:]+:/.test(remote) ? remote.replace(/^git@([^:]+):/, "ssh://git@$1/") : remote;
  try {
    const url = new URL(normalized);
    const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
    return path.length > 0 ? `${url.hostname.toLowerCase()}/${path.toLowerCase()}` : null;
  } catch {
    return null;
  }
}

export function assertReleaseManifest(manifest, commit, repository) {
  const candidateRepository = repositoryIdentity(repository);
  if (candidateRepository !== VNEXT_QUALIFICATION_REPOSITORY_IDENTITY) {
    throw new Error(`Live qualification requires destination repository ${VNEXT_QUALIFICATION_REPOSITORY}`);
  }
  const validPackage = (entry) =>
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.package === "string" &&
    typeof entry.version === "string" &&
    typeof entry.file === "string" &&
    typeof entry.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(entry.sha256) &&
    Number.isInteger(entry.bytes) &&
    entry.bytes >= 0 &&
    entry.dependencies !== null &&
    typeof entry.dependencies === "object" &&
    !Array.isArray(entry.dependencies);
  const validSecurityEntry = (entry) =>
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.file === "string" &&
    typeof entry.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(entry.sha256);
  const packageNames = new Set(manifest?.packages?.map((entry) => entry.package));
  const packageFiles = new Set(manifest?.packages?.map((entry) => entry.file));
  if (
    manifest?.version !== 1 ||
    manifest.sourceCommit !== commit ||
    repositoryIdentity(manifest.sourceRepository) !== candidateRepository ||
    manifest.toolchain === null ||
    typeof manifest.toolchain !== "object" ||
    !Array.isArray(manifest.packages) ||
    manifest.packages.length === 0 ||
    !manifest.packages.every(validPackage) ||
    packageNames.size !== manifest.packages.length ||
    packageFiles.size !== manifest.packages.length ||
    !validSecurityEntry(manifest.security?.sbom) ||
    !validSecurityEntry(manifest.security?.provenance)
  ) {
    throw new Error("Release manifest is invalid or does not match the current candidate");
  }
}

function candidateInputPath(root, value, fallback) {
  return resolve(root, value ?? fallback);
}

export function packageRepository(packageMetadata) {
  const repository = packageMetadata?.repository;
  const value = typeof repository === "string" ? repository : repository?.url;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Package metadata must declare a repository URL");
  }
  return value.replace(/^git\+/, "").replace(/\.git$/, "");
}

export async function collectCurrentCandidate(
  options,
  { root = ROOT, read = readFile, git = (args) => gitValue(args, root) } = {},
) {
  const packageLockPath = candidateInputPath(root, options["package-lock"], "package-lock.json");
  const runtimeBundlePath = candidateInputPath(
    root,
    options["runtime-bundle"],
    join("config", "runtime-bundle.v1.json"),
  );
  const releaseManifestPath = candidateInputPath(root, required(options, "release-manifest"));
  const packageMetadata = JSON.parse(await read(join(root, "package.json"), "utf8"));
  const repository = packageRepository(packageMetadata);
  const detectedBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = detectedBranch === "HEAD" ? required(options, "branch") : detectedBranch;
  if (options.branch !== undefined && options.branch !== branch)
    throw new Error(`--branch ${options.branch} does not match checked-out branch ${branch}`);
  const commit = git(["rev-parse", "HEAD"]);
  const releaseManifestBytes = await read(releaseManifestPath);
  const releaseManifest = parseStrictJson(releaseManifestBytes.toString("utf8"));
  const customizationAssetManifest = JSON.parse(
    await read(join(root, "packages", "cli", "assets", "manifest.json"), "utf8"),
  );
  if (!/^[0-9a-f]{64}$/.test(customizationAssetManifest?.lock?.digest ?? "")) {
    throw new Error("Generated customization asset lock is missing or invalid");
  }
  assertReleaseManifest(releaseManifest, commit, repository);
  return {
    repository,
    branch,
    commit,
    packageLockHash: sha256(await read(packageLockPath)),
    releaseManifestHash: sha256(releaseManifestBytes),
    runtimeBundleHash: sha256(await read(runtimeBundlePath)),
    customizationBundleHash: customizationAssetManifest.lock.digest,
  };
}

function createSchemaErrors(validate) {
  return (value) => {
    if (validate(value)) return [];
    return (validate.errors ?? []).map(
      ({ instancePath, message }) => `${instancePath || "/"}: ${message ?? "is invalid"}`,
    );
  };
}

async function loadDependencies() {
  const [{ default: Ajv }, { default: addFormats }, contracts] = await Promise.all([
    import("ajv"),
    import("ajv-formats"),
    import("../../packages/contracts/dist/index.js"),
  ]);
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  return {
    scenarioIds: contracts.LIVE_QUALIFICATION_SCENARIO_IDS,
    qualificationSchemaErrors: createSchemaErrors(ajv.compile(contracts.LiveQualificationV1Schema)),
    evidenceManifestSchemaErrors: createSchemaErrors(ajv.compile(contracts.EvidenceManifestV1Schema)),
    hasValidLiveQualification: contracts.hasValidLiveQualification,
    secretFieldPattern: contracts.SECRET_FIELD_PATTERN,
    secretValuePattern: contracts.SECRET_VALUE_PATTERN,
  };
}

async function main() {
  const options = parseLiveQualificationArguments(process.argv.slice(2));
  if (options.command === "render") {
    const qualification = JSON.parse(await readFile(resolve(required(options, "file")), "utf8"));
    const dependencies = await loadDependencies();
    const schemaErrors = dependencies.qualificationSchemaErrors(qualification);
    const secrets = secretIssues(qualification, dependencies.secretFieldPattern, dependencies.secretValuePattern);
    if (schemaErrors.length > 0 || !dependencies.hasValidLiveQualification(qualification) || secrets.length > 0) {
      const detail = [...schemaErrors, ...secrets].join("; ") || "semantic failure";
      throw new Error(`Cannot render invalid live qualification: ${detail}`);
    }
    const rendered = renderLiveQualification(qualification);
    if (options.output) await writeRendered(resolve(options.output), rendered);
    else process.stdout.write(rendered);
    return;
  }
  if (options.command === "cli") {
    const contents = `${JSON.stringify(await collectCliSurfaceEvidence(options), null, 2)}\n`;
    if (options.output) await writeNewFiles([[resolve(options.output), contents]]);
    else process.stdout.write(contents);
    return;
  }
  if (options.command === "vscode") {
    const contents = `${JSON.stringify(await collectVscodeSurfaceEvidence(options), null, 2)}\n`;
    if (options.output) await writeNewFiles([[resolve(options.output), contents]]);
    else process.stdout.write(contents);
    return;
  }
  assertCleanGitStatus(gitValue(["status", "--porcelain"]));
  if (options.command === "checkpoint") {
    const previousCheckpoint =
      options.previous === undefined
        ? undefined
        : parseStrictJson(
            (
              await readBoundedRegularFile(resolve(options.previous), MAX_MANAGED_FILE_BYTES, "Previous checkpoint")
            ).toString("utf8"),
          );
    const contents = `${JSON.stringify(await collectGuidedCheckpoint(options, { previousCheckpoint }), null, 2)}\n`;
    if (options.output) await writeNewFiles([[resolve(options.output), contents]]);
    else process.stdout.write(contents);
    return;
  }
  if (options.command === "candidate") {
    const contents = `${JSON.stringify(await collectCurrentCandidate(options), null, 2)}\n`;
    if (options.output) await writeNewFiles([[resolve(options.output), contents]]);
    else process.stdout.write(contents);
    return;
  }
  if (options.command === "runtime") {
    const contents = `${JSON.stringify(await collectRuntimeEvidence(options), null, 2)}\n`;
    if (options.output) await writeNewFiles([[resolve(options.output), contents]]);
    else process.stdout.write(contents);
    return;
  }
  const dependencies = await loadDependencies();
  const evidenceManifestPath = resolve(required(options, "evidence-manifest"));
  if (options.command === "template") {
    const createdAt = required(options, "created-at");
    if (!Number.isFinite(Date.parse(createdAt))) throw new Error("--created-at must be an ISO date-time");
    const evidenceManifest = createEvidenceManifestTemplate({
      projectId: required(options, "project"),
      runId: required(options, "run"),
      createdAt,
    });
    const evidenceManifestBytes = `${JSON.stringify(evidenceManifest, null, 2)}\n`;
    const qualification = createLiveQualificationTemplate({
      scenarioIds: dependencies.scenarioIds,
      projectId: evidenceManifest.projectId,
      runId: evidenceManifest.runId,
      candidate: await collectCurrentCandidate(options),
      evidenceManifestHash: sha256(evidenceManifestBytes),
      createdAt,
      actor: required(options, "actor"),
      environment: required(options, "environment"),
      targetScope: required(options, "target-scope"),
      toolVersions: {
        apex: JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")).version,
        node: process.version,
      },
    });
    await writeNewFiles([
      [evidenceManifestPath, evidenceManifestBytes],
      [resolve(required(options, "output")), `${JSON.stringify(qualification, null, 2)}\n`],
    ]);
    return;
  }
  const qualification = await readJsonBytes(resolve(required(options, "file")));
  const evidenceManifest = await readJsonBytes(evidenceManifestPath);
  const evidencePayloads = await Promise.all(
    (options["evidence-file"] ?? []).map(async (path) => ({ path, bytes: await readFile(resolve(path)) })),
  );
  const candidate = await collectCurrentCandidate(options);
  const findings = [
    ...validateLiveQualification(
      qualification.value,
      evidenceManifest.value,
      {
        candidate,
        evidenceManifestHash: sha256(evidenceManifest.bytes),
      },
      dependencies,
    ),
    ...validateEvidencePayloads(evidenceManifest.value, evidencePayloads, {
      requireClientQualification: true,
      projectId: qualification.value.projectId,
      candidate,
    }),
  ].sort();
  if (findings.length > 0) {
    for (const finding of findings) process.stderr.write(`❌ ${finding}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("✅ Live qualification evidence is valid\n");
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`❌ ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
