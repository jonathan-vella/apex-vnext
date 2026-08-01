#!/usr/bin/env node
/**
 * Read-only admission and deterministic queue construction for pre-agent maintenance.
 *
 * @example
 * node tools/scripts/pre-agent-loop.mjs status
 * node tools/scripts/pre-agent-loop.mjs run --dry-run
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { contextHashDrift } from "./pre-agent-loop-hashes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_MANIFEST = "docs/vnext/pre-agent-loop/authorization.json";
const INVENTORY = "tools/registry/modernization-ownership.json";

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

function main() {
  const { command, dryRun, manifest } = parseArguments(process.argv.slice(2));
  if (command === "resume" || command === "abort")
    throw new Error(`${command} is not available before state handling lands.`);
  const manifestPath = path.resolve(ROOT, manifest);
  const result = inspectRun({
    authorization: readJson(manifestPath),
    root: ROOT,
  });
  if (command === "run" && !dryRun) throw new Error("Only run --dry-run is available before task execution lands.");
  console.log(JSON.stringify({ command, dry_run: dryRun, ...result }, null, 2));
  process.exitCode = result.admitted ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  }
}
