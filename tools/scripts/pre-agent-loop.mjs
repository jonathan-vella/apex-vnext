#!/usr/bin/env node
/**
 * Read-only admission and deterministic queue construction for pre-agent maintenance.
 *
 * @example
 * node tools/scripts/pre-agent-loop.mjs status
 * node tools/scripts/pre-agent-loop.mjs run --dry-run
 */

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { contextHashDrift } from "./pre-agent-loop-hashes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_MANIFEST = "docs/vnext/pre-agent-loop/authorization.json";
const INVENTORY = "tools/registry/modernization-ownership.json";
const STATE_DIRECTORY = "docs/vnext/pre-agent-loop";

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

export function buildDryRunQueue(ownership) {
  return ownership.surfaces.map((surface) => ({
    id: surface.id,
    classification: surface.classification,
    paths: surface.sourceRefs,
    focused_checks: surface.proofCommands,
  }));
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
  return result;
}

function statePaths(root) {
  const stateDirectory = path.join(root, STATE_DIRECTORY);
  return {
    checkpointPath: path.join(stateDirectory, "checkpoints.jsonl"),
    lockPath: path.join(stateDirectory, "run.lock.json"),
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

function main() {
  const { command, dryRun, manifest } = parseArguments(process.argv.slice(2));
  const manifestPath = path.resolve(ROOT, manifest);
  const authorization = readJson(manifestPath);
  const result = inspectRun({ authorization, root: ROOT });
  const output =
    command === "resume"
      ? resumeRun({ authorization, root: ROOT })
      : command === "abort"
        ? abortRun({ authorization, root: ROOT })
        : command === "run" && !dryRun
          ? (() => {
              const probe = probeLauncher(authorization.launcher);
              if (!probe.ok) throw new Error(probe.reason);
              return initializeRun({ authorization, root: ROOT });
            })()
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
