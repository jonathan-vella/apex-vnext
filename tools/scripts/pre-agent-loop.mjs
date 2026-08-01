#!/usr/bin/env node
/**
 * Read-only admission and deterministic queue construction for pre-agent maintenance.
 *
 * @example
 * node tools/scripts/pre-agent-loop.mjs status
 * node tools/scripts/pre-agent-loop.mjs run --dry-run
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { contextHashDrift } from "./pre-agent-loop-hashes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_MANIFEST = "docs/vnext/pre-agent-loop/authorization.json";
const INVENTORY = "tools/registry/modernization-ownership.json";
const STATE_DIRECTORY = "docs/vnext/pre-agent-loop";
const CONTROLLER_STATE_PATHS = new Set([
  "docs/vnext/pre-agent-loop/checkpoints.jsonl",
  "docs/vnext/pre-agent-loop/completion-handoff.md",
  "docs/vnext/pre-agent-loop/findings.jsonl",
  "docs/vnext/pre-agent-loop/inventory.json",
  "docs/vnext/pre-agent-loop/measurements.json",
  "docs/vnext/pre-agent-loop/queue.json",
  "docs/vnext/pre-agent-loop/run.lock.json",
]);
const SECRET_PATTERN = /(api[_-]?key|password|secret|token)\s*[:=]\s*[^\s]+/iu;
const TASK_TOOLS = ["view", "glob", "rg", "apply_patch"];
const DENIED_TASK_TOOLS = ["ask_user", "task", "skill", "web_fetch", "session_store_sql", "apex", "github"];

function matchesPath(pathname, pattern) {
  const expression = `^${pattern
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replace(/\*\*/gu, ".*")
    .replace(/\*/gu, "[^/]*")}$`;
  return new RegExp(expression, "u").test(pathname);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function authorizationShapeErrors(authorization) {
  const errors = [];
  const required = [
    "authorization_id",
    "expires_at",
    "base_commit",
    "issues",
    "worktree",
    "branch",
    "upstream",
    "allowed_paths",
    "protected_paths",
    "allowed_commands",
    "denied_commands",
    "network",
    "launcher",
    "budgets",
    "checkpoint_policy",
    "stop_conditions",
    "skill_allowlist",
    "context_hashes",
  ];
  if (authorization === null || typeof authorization !== "object" || Array.isArray(authorization)) {
    return ["authorization must be an object"];
  }
  for (const field of required) {
    if (authorization[field] === undefined) errors.push(`authorization is missing ${field}`);
  }
  if (!Array.isArray(authorization.issues) || authorization.issues.length === 0)
    errors.push("authorization issues are invalid");
  for (const field of ["allowed_paths", "protected_paths", "allowed_commands"]) {
    if (!Array.isArray(authorization[field]) || authorization[field].length === 0) {
      errors.push(`authorization ${field} must not be empty`);
    }
  }
  if (authorization.network?.policy !== "deny" && authorization.network?.policy !== "allowlist") {
    errors.push("authorization network policy is invalid");
  }
  if (!Number.isInteger(authorization.launcher?.noninteractive?.timeout_seconds)) {
    errors.push("launcher noninteractive timeout is invalid");
  }
  if (!Number.isInteger(authorization.launcher?.noninteractive?.output_limit_bytes)) {
    errors.push("launcher noninteractive output limit is invalid");
  }
  return errors;
}

function gitValue(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export function parseArguments(args) {
  const [command, ...options] = args;
  if (!command || !["status", "run", "resume", "abort"].includes(command)) {
    throw new Error("Expected one of: status, run, resume, abort.");
  }

  let dryRun = false;
  let manifest = DEFAULT_MANIFEST;
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] === "--dry-run") {
      dryRun = true;
    } else if (options[index] === "--manifest") {
      manifest = options[index + 1];
      index += 1;
      if (!manifest) throw new Error("--manifest requires an existing authorization path.");
    } else {
      throw new Error("Unsupported controller option.");
    }
  }
  if (dryRun && command !== "run") throw new Error("--dry-run is only valid with run.");
  return { command, dryRun, manifest };
}

export function admissionErrors({ authorization, root, git = gitValue, now = new Date() }) {
  const errors = authorizationShapeErrors(authorization);
  if (errors.length > 0) return errors;

  if (Date.parse(authorization.expires_at) <= now.getTime()) errors.push("authorization has expired");
  if (authorization.branch === "main") errors.push("authorization branch cannot be main");
  if (authorization.upstream !== `origin/${authorization.branch}`)
    errors.push("authorization upstream must match branch");
  if (path.resolve(authorization.worktree) !== path.resolve(root))
    errors.push("authorization worktree does not match controller root");
  if (authorization.launcher.mcp !== "disabled") errors.push("launcher MCP must be disabled");
  if (!existsSync(authorization.launcher.binary)) errors.push("authorized Copilot binary is unavailable");
  if (contextHashDrift(authorization.context_hashes, root).length > 0) {
    errors.push("authorization context inputs have drifted");
  }

  try {
    if (git(["branch", "--show-current"], root) !== authorization.branch) {
      errors.push("checked out branch does not match authorization");
    }
    if (git(["config", "--get", `branch.${authorization.branch}.remote`], root) !== "origin") {
      errors.push("authorized branch remote is not origin");
    }
  } catch {
    errors.push("unable to verify authorized Git branch");
  }
  return errors;
}

export function probeLauncher(launcher, spawn = spawnSync) {
  const result = spawn(launcher.binary, ["version", "--no-auto-update"], {
    encoding: "utf8",
    input: "",
    maxBuffer: launcher.noninteractive.output_limit_bytes,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: launcher.noninteractive.timeout_seconds * 1000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error || result.status !== 0) return { ok: false, reason: "launcher version probe failed" };
  if (/install|bootstrap|sign[ -]?in|authenticate/iu.test(output)) {
    return { ok: false, reason: "launcher version probe requested setup" };
  }
  if (!/GitHub Copilot CLI\s+\S+/u.test(output)) return { ok: false, reason: "launcher version output is invalid" };
  return { ok: true, version: output.trim() };
}

export function buildTaskCommand({ authorization, item, prompt }) {
  const writablePaths = item.paths
    .filter((pathname) => !authorization.protected_paths.some((pattern) => matchesPath(pathname, pattern)))
    .map((pathname) => {
      const wildcard = pathname.search(/[*?[\]]/u);
      const boundedPath = wildcard === -1 ? pathname : pathname.slice(0, wildcard).replace(/\/$/u, "");
      return path.resolve(authorization.worktree, boundedPath || ".");
    });
  return [
    authorization.launcher.binary,
    "--prompt",
    prompt,
    "--output-format",
    "json",
    "--available-tools",
    TASK_TOOLS.join(","),
    "--no-ask-user",
    "--no-remote",
    "--no-remote-export",
    "--no-custom-instructions",
    "--no-bash-env",
    "--no-auto-update",
    "--disable-builtin-mcps",
    ...DENIED_TASK_TOOLS.flatMap((tool) => ["--deny-tool", tool]),
    ...writablePaths.flatMap((pathname) => ["--allow-tool", `write(${pathname})`]),
    "--add-dir",
    authorization.worktree,
  ];
}

export function buildDryRunQueue(ownership) {
  return ownership.surfaces.map((surface) => ({
    id: surface.id,
    classification: surface.classification,
    owner: surface.canonicalOwner,
    consumers: surface.consumers,
    paths: surface.sourceRefs,
    focused_checks: surface.proofCommands,
    rationale: surface.rationale,
    status: "pending",
  }));
}

export function parseJsonLines(output) {
  const lines = output.split(/\r?\n/u).filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new Error("task produced no structured output");
  try {
    return lines.map((line) => JSON.parse(line));
  } catch {
    throw new Error("task output is not valid JSONL");
  }
}

export function taskInvokedSkill(events) {
  return events.some((event) => {
    if (event.type === "session.skills_loaded") return false;
    if (!/(tool_call|tool\.execution)/u.test(event.type ?? "")) return false;
    const payload = JSON.stringify(event.data ?? event);
    return /"(?:name|toolName|tool_name)"\s*:\s*"skill"/iu.test(payload);
  });
}

export function changedPathErrors({ changedPaths, authorization, addedLines = [], binaryPaths = [] }) {
  const errors = [];
  if (changedPaths.length > authorization.budgets.files_per_slice) errors.push("slice exceeds file budget");
  for (const pathname of changedPaths) {
    if (authorization.protected_paths.some((pattern) => matchesPath(pathname, pattern))) {
      errors.push(`protected path changed: ${pathname}`);
    }
    if (!authorization.allowed_paths.some((pattern) => matchesPath(pathname, pattern))) {
      errors.push(`path outside authorization: ${pathname}`);
    }
  }
  for (const pathname of binaryPaths) errors.push(`binary path changed: ${pathname}`);
  if (addedLines.length > authorization.budgets.lines_per_slice) errors.push("slice exceeds line budget");
  if (addedLines.some((line) => SECRET_PATTERN.test(line))) errors.push("potential secret in changed content");
  return [...new Set(errors)];
}

export function inspectRun({ authorization, root, git, now }) {
  const errors = admissionErrors({ authorization, root, git, now });
  return {
    authorization_id: authorization.authorization_id,
    admitted: errors.length === 0,
    errors,
    queue: errors.length === 0 ? buildDryRunQueue(readJson(path.join(root, INVENTORY))) : [],
  };
}

function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporaryPath, filePath);
}

function initialInventory(queue) {
  return {
    version: 1,
    surfaces: queue.map((item) => ({
      id: item.id,
      owner: item.owner,
      consumers: item.consumers,
      classification: item.classification,
      disposition: "pending",
      proof: [],
      release_impact: "undetermined",
      rationale: item.rationale,
    })),
  };
}

export function initializeRun({ authorization, root, git, now = new Date() }) {
  const result = inspectRun({ authorization, root, git, now });
  if (!result.admitted) return result;

  const stateDirectory = path.join(root, STATE_DIRECTORY);
  const lockPath = path.join(stateDirectory, "run.lock.json");
  const queuePath = path.join(stateDirectory, "queue.json");
  if (existsSync(lockPath)) {
    return { ...result, admitted: false, errors: ["another pre-agent run already holds the lock"] };
  }

  mkdirSync(stateDirectory, { recursive: true });
  writeJsonAtomically(lockPath, {
    authorization_id: authorization.authorization_id,
    branch: authorization.branch,
    worktree: path.resolve(root),
    started_at: now.toISOString(),
  });
  writeJsonAtomically(queuePath, {
    authorization_id: authorization.authorization_id,
    state: "bootstrapped",
    items: result.queue,
  });
  writeJsonAtomically(path.join(stateDirectory, "inventory.json"), initialInventory(result.queue));
  writeJsonAtomically(path.join(stateDirectory, "measurements.json"), { version: 1, items: [] });
  return result;
}

function statePaths(root) {
  const stateDirectory = path.join(root, STATE_DIRECTORY);
  return {
    checkpointPath: path.join(stateDirectory, "checkpoints.jsonl"),
    completionPath: path.join(stateDirectory, "completion-handoff.md"),
    findingsPath: path.join(stateDirectory, "findings.jsonl"),
    inventoryPath: path.join(stateDirectory, "inventory.json"),
    lockPath: path.join(stateDirectory, "run.lock.json"),
    measurementsPath: path.join(stateDirectory, "measurements.json"),
    queuePath: path.join(stateDirectory, "queue.json"),
  };
}

function readOwnedLock(authorization, root) {
  const { lockPath } = statePaths(root);
  if (!existsSync(lockPath)) throw new Error("no pre-agent run lock exists");
  const lock = readJson(lockPath);
  if (
    lock.authorization_id !== authorization.authorization_id ||
    lock.branch !== authorization.branch ||
    lock.worktree !== path.resolve(root)
  ) {
    throw new Error("pre-agent run lock is not owned by this authorization");
  }
  return lock;
}

export function resumeRun({ authorization, root }) {
  readOwnedLock(authorization, root);
  const { queuePath } = statePaths(root);
  if (!existsSync(queuePath)) throw new Error("pre-agent run queue is missing");
  return readJson(queuePath);
}

export function abortRun({ authorization, root, now = new Date() }) {
  const lock = readOwnedLock(authorization, root);
  const { checkpointPath, lockPath } = statePaths(root);
  appendFileSync(
    checkpointPath,
    `${JSON.stringify({ authorization_id: lock.authorization_id, state: "aborted", at: now.toISOString() })}\n`,
  );
  unlinkSync(lockPath);
  return { state: "aborted" };
}

function checkpointRecord({ checkpointPath, record }) {
  const existing = existsSync(checkpointPath) ? readFileSync(checkpointPath, "utf8").trimEnd() : "";
  const previous = existing === "" ? null : existing.split(/\r?\n/u).at(-1);
  return {
    ...record,
    previous_record_sha256: previous === null ? null : createHash("sha256").update(previous).digest("hex"),
  };
}

export function stopRun({ authorization, root, reason, git = gitValue, now = new Date() }) {
  const paths = statePaths(root);
  if (!existsSync(paths.lockPath)) return { state: "stopped", evidence_published: false };
  const lock = readOwnedLock(authorization, root);
  const queue = existsSync(paths.queuePath) ? readJson(paths.queuePath) : { authorization_id: lock.authorization_id };
  queue.state = "stopped";
  queue.stop_reason = reason;
  writeJsonAtomically(paths.queuePath, queue);
  appendFileSync(
    paths.findingsPath,
    `${JSON.stringify({ authorization_id: lock.authorization_id, severity: "blocking", finding: reason, at: now.toISOString() })}\n`,
  );
  const checkpoint = checkpointRecord({
    checkpointPath: paths.checkpointPath,
    record: { authorization_id: lock.authorization_id, state: "stopped", reason, at: now.toISOString() },
  });
  appendFileSync(paths.checkpointPath, `${JSON.stringify(checkpoint)}\n`);
  unlinkSync(paths.lockPath);

  const evidencePaths = [paths.queuePath, paths.findingsPath, paths.checkpointPath].map((pathname) =>
    path.relative(root, pathname),
  );
  try {
    git(["add", "--", ...evidencePaths], root);
    git(["commit", "-m", "chore(tools): Record stopped pre-agent run"], root);
    git(["push", "origin", `HEAD:refs/heads/${authorization.branch}`], root);
    const localSha = git(["rev-parse", "HEAD"], root);
    const remoteSha = git(["ls-remote", "--heads", "origin", `refs/heads/${authorization.branch}`], root).split(
      /\s/u,
    )[0];
    if (remoteSha !== localSha) throw new Error("stopped checkpoint SHA mismatch");
    return { state: "stopped", evidence_published: true, sha: localSha };
  } catch {
    return { state: "stopped", evidence_published: false };
  }
}

function commandAllowed(command, authorization) {
  return (
    authorization.allowed_commands.some((prefix) => command.startsWith(prefix)) &&
    !authorization.denied_commands.some((prefix) => command.startsWith(prefix)) &&
    !/[;&|`$<>\n]/u.test(command)
  );
}

export function runFocusedChecks({ commands, authorization, root, spawn = spawnSync }) {
  const results = [];
  for (const command of commands) {
    if (!commandAllowed(command, authorization)) throw new Error(`focused command is not authorized: ${command}`);
    const [executable, ...args] = command.split(/\s+/u);
    const result = spawn(executable, args, { cwd: root, encoding: "utf8", stdio: "pipe" });
    results.push({ command, status: result.status });
    if (result.error || result.status !== 0) throw new Error(`focused check failed: ${command}`);
  }
  return results;
}

export function collectGitChanges(root, git = gitValue) {
  const status = git(["status", "--porcelain=v1", "-z"], root);
  const changedPaths = status
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3).split(" -> ").at(-1))
    .filter((pathname) => !CONTROLLER_STATE_PATHS.has(pathname));
  const diff = git(["diff", "--no-ext-diff", "--unified=0", "--", ...changedPaths], root);
  const addedLines = diff
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
  for (const pathname of changedPaths) {
    const absolutePath = path.join(root, pathname);
    if (!existsSync(absolutePath) || !status.includes(`?? ${pathname}`)) continue;
    const content = readFileSync(absolutePath);
    if (!content.subarray(0, 8192).includes(0)) addedLines.push(...content.toString("utf8").split(/\r?\n/u));
  }
  const binaryPaths = changedPaths.filter((pathname) => {
    const absolutePath = path.join(root, pathname);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) return false;
    return readFileSync(absolutePath).subarray(0, 8192).includes(0);
  });
  return { changedPaths, addedLines, binaryPaths };
}

export function snapshotControllerState(root) {
  return Object.fromEntries(
    [...CONTROLLER_STATE_PATHS].map((pathname) => {
      const absolutePath = path.join(root, pathname);
      return [pathname, existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : null];
    }),
  );
}

export function assertControllerStateUnchanged(root, before) {
  const after = snapshotControllerState(root);
  for (const [pathname, content] of Object.entries(before)) {
    if (after[pathname] !== content) throw new Error(`task changed controller state: ${pathname}`);
  }
}

export function taskPrompt(item) {
  if (item.prompt) return item.prompt;
  return [
    `Process repository inventory item ${item.id}.`,
    `Classification: ${item.classification}.`,
    `Allowed paths: ${item.paths.join(", ")}.`,
    "Inspect the current implementation and make the smallest justified improvement within those paths.",
    "Do not invoke skills and do not read any SKILL.md file.",
    "Do not use Git, do not modify any other path, and do not run aggregate validation.",
    "If no change is justified, leave files unchanged and report that conclusion.",
  ].join("\n");
}

export function launchTask({ authorization, item, spawn = spawnSync }) {
  const [binary, ...args] = buildTaskCommand({ authorization, item, prompt: taskPrompt(item) });
  const neutralDirectory = mkdtempSync(path.join(tmpdir(), "apex-pre-agent-task-"));
  const copilotHome = path.join(neutralDirectory, "copilot-home");
  mkdirSync(copilotHome);
  try {
    const result = spawn(binary, args, {
      cwd: neutralDirectory,
      encoding: "utf8",
      env: { ...process.env, COPILOT_HOME: copilotHome },
      input: "",
      maxBuffer: authorization.launcher.noninteractive.output_limit_bytes,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: authorization.launcher.noninteractive.timeout_seconds * 1000 * 20,
    });
    if (result.error || result.status !== 0) throw new Error("bounded task failed");
    const events = parseJsonLines(result.stdout ?? "");
    const serialized = JSON.stringify(events);
    if (/mcp_server|mcp\.tools|github-mcp-server/iu.test(serialized)) throw new Error("bounded task loaded MCP");
    if (taskInvokedSkill(events)) throw new Error("bounded task invoked a skill");
    return events;
  } finally {
    rmSync(neutralDirectory, { recursive: true, force: true });
  }
}

function publishCheckpoint({ authorization, item, root, git = gitValue, now = new Date() }) {
  const paths = statePaths(root);
  const evidencePaths = [paths.queuePath, paths.inventoryPath, paths.measurementsPath].map((pathname) =>
    path.relative(root, pathname),
  );
  git(["add", "--", ...item.paths, ...evidencePaths], root);
  git(["commit", "-m", `chore(tools): Process ${item.id}`], root);
  const localSha = git(["rev-parse", "HEAD"], root);
  git(["push", "origin", `HEAD:refs/heads/${authorization.branch}`], root);
  const remoteSha = git(["ls-remote", "--heads", "origin", `refs/heads/${authorization.branch}`], root).split(/\s/u)[0];
  if (remoteSha !== localSha) throw new Error("published checkpoint SHA mismatch");
  appendFileSync(
    paths.checkpointPath,
    `${JSON.stringify({ authorization_id: authorization.authorization_id, item: item.id, state: "accepted", sha: localSha, at: now.toISOString() })}\n`,
  );
  git(["add", "--", path.relative(root, paths.checkpointPath)], root);
  git(["commit", "-m", `chore(tools): Record ${item.id} checkpoint`], root);
  git(["push", "origin", `HEAD:refs/heads/${authorization.branch}`], root);
  const checkpointSha = git(["rev-parse", "HEAD"], root);
  const checkpointRemote = git(["ls-remote", "--heads", "origin", `refs/heads/${authorization.branch}`], root).split(
    /\s/u,
  )[0];
  if (checkpointRemote !== checkpointSha) throw new Error("checkpoint evidence SHA mismatch");
  return localSha;
}

function writeCompletion({ authorization, root, queue, git = gitValue, now = new Date() }) {
  const paths = statePaths(root);
  const tree = git(["rev-parse", "HEAD^{tree}"], root);
  const content = `## Pre-Agent Loop Completion\n\n- Authorization: \`${authorization.authorization_id}\`\n- Branch: \`${authorization.branch}\`\n- Upstream: \`${authorization.upstream}\`\n- Tree before handoff: \`${tree}\`\n- Completed items: ${queue.items.length}\n- Completed at: ${now.toISOString()}\n\nNo final validation or managed-agent qualification was run.\n`;
  writeFileSync(paths.completionPath, content);
  unlinkSync(paths.lockPath);
  queue.state = "completed";
  writeJsonAtomically(paths.queuePath, queue);
  git(["add", "--", path.relative(root, paths.completionPath), path.relative(root, paths.queuePath)], root);
  git(["commit", "-m", "chore(tools): Complete pre-agent loop"], root);
  git(["push", "origin", `HEAD:refs/heads/${authorization.branch}`], root);
  const localSha = git(["rev-parse", "HEAD"], root);
  const remoteSha = git(["ls-remote", "--heads", "origin", `refs/heads/${authorization.branch}`], root).split(/\s/u)[0];
  if (remoteSha !== localSha) throw new Error("completion handoff SHA mismatch");
}

export function processNextItem({ authorization, root, spawn = spawnSync, git = gitValue, now = new Date() }) {
  readOwnedLock(authorization, root);
  const paths = statePaths(root);
  const queue = readJson(paths.queuePath);
  const item = queue.items.find(({ status }) => status === "pending");
  if (!item) {
    writeCompletion({ authorization, root, queue, git, now });
    return { state: "completed" };
  }
  const controllerState = snapshotControllerState(root);
  launchTask({ authorization, item, spawn });
  assertControllerStateUnchanged(root, controllerState);
  const changes = collectGitChanges(root, git);
  const errors = changedPathErrors({ authorization, ...changes });
  const itemScopeErrors = changes.changedPaths
    .filter((pathname) => !item.paths.some((pattern) => matchesPath(pathname, pattern)))
    .map((pathname) => `path outside queue item: ${pathname}`);
  if (errors.length > 0 || itemScopeErrors.length > 0) throw new Error([...errors, ...itemScopeErrors].join("; "));
  const checks = runFocusedChecks({ commands: item.focused_checks, authorization, root, spawn });
  item.status = "accepted";
  const inventory = readJson(paths.inventoryPath);
  const surface = inventory.surfaces.find(({ id }) => id === item.id);
  surface.disposition = changes.changedPaths.length === 0 ? "verified-no-change" : "improved";
  surface.proof = checks;
  surface.release_impact = changes.changedPaths.length === 0 ? "none" : "pending-review";
  writeJsonAtomically(paths.queuePath, queue);
  writeJsonAtomically(paths.inventoryPath, inventory);
  const measurements = readJson(paths.measurementsPath);
  measurements.items.push({ id: item.id, files_changed: changes.changedPaths.length, checks });
  writeJsonAtomically(paths.measurementsPath, measurements);
  const sha = publishCheckpoint({ authorization, item, root, git, now });
  return { state: "accepted", item: item.id, sha };
}

export function runQueue({ authorization, root, spawn = spawnSync, git = gitValue, now = () => new Date() }) {
  const results = [];
  for (let count = 0; count <= authorization.budgets.queue_items; count += 1) {
    const result = processNextItem({ authorization, root, spawn, git, now: now() });
    results.push(result);
    if (result.state === "completed") return results;
  }
  throw new Error("queue item budget exhausted");
}

export function runQueueGuarded(options) {
  try {
    return runQueue(options);
  } catch (error) {
    stopRun({
      authorization: options.authorization,
      root: options.root,
      reason: error.message,
      git: options.git,
      now: options.now?.() ?? new Date(),
    });
    throw error;
  }
}

function statusRun({ authorization, root }) {
  const paths = statePaths(root);
  if (!existsSync(paths.queuePath)) return inspectRun({ authorization, root });
  const queue = readJson(paths.queuePath);
  return {
    authorization_id: authorization.authorization_id,
    admitted: admissionErrors({ authorization, root }).length === 0,
    state: existsSync(paths.lockPath) ? "running" : queue.state === "completed" ? "completed" : "idle",
    queue,
  };
}

function main() {
  const { command, dryRun, manifest } = parseArguments(process.argv.slice(2));
  const manifestPath = path.resolve(ROOT, manifest);
  const authorization = readJson(manifestPath);
  const result = inspectRun({ authorization, root: ROOT });
  const output =
    command === "resume"
      ? { state: "running", results: runQueueGuarded({ authorization, root: ROOT }) }
      : command === "abort"
        ? abortRun({ authorization, root: ROOT })
        : command === "run" && !dryRun
          ? (() => {
              const probe = probeLauncher(authorization.launcher);
              if (!probe.ok) throw new Error(probe.reason);
              const initialized = initializeRun({ authorization, root: ROOT });
              if (!initialized.admitted) return initialized;
              return { state: "running", results: runQueueGuarded({ authorization, root: ROOT }) };
            })()
          : command === "status"
            ? statusRun({ authorization, root: ROOT })
            : result;
  console.log(JSON.stringify({ command, dry_run: dryRun, ...output }, null, 2));
  process.exitCode = output.admitted === false ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  }
}
