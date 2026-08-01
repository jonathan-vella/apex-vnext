import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  abortRun,
  admissionErrors,
  assertControllerStateUnchanged,
  buildDryRunQueue,
  buildTaskCommand,
  changedPathErrors,
  initializeRun,
  parseJsonLines,
  parseArguments,
  probeLauncher,
  runFocusedChecks,
  resumeRun,
  snapshotControllerState,
} from "../scripts/pre-agent-loop.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const authorization = JSON.parse(readFileSync(path.join(root, "docs/vnext/pre-agent-loop/authorization.json"), "utf8"));

const git = (args) => {
  if (args[0] === "branch") return authorization.branch;
  return "origin";
};

test("authorization accepts the dedicated branch without a pinned CLI version", () => {
  const errors = admissionErrors({
    authorization,
    root,
    git,
    now: new Date("2026-08-01T00:00:00Z"),
  });
  assert.deepEqual(errors, []);
});

test("authorization refuses expiry, main, mismatched upstream, and enabled MCP", () => {
  const invalid = structuredClone(authorization);
  invalid.expires_at = "2026-07-31T00:00:00Z";
  invalid.branch = "main";
  invalid.upstream = "origin/another-branch";
  invalid.launcher.mcp = "enabled";
  const errors = admissionErrors({
    authorization: invalid,
    root,
    git: () => "main",
    now: new Date("2026-08-01T00:00:00Z"),
  });
  assert.ok(errors.some((error) => error.includes("expired")));
  assert.ok(errors.some((error) => error.includes("cannot be main")));
  assert.ok(errors.some((error) => error.includes("upstream")));
  assert.ok(errors.some((error) => error.includes("MCP")));
});

test("authorization refuses context drift", () => {
  const invalid = structuredClone(authorization);
  invalid.context_hashes["AGENTS.md"] = "0".repeat(64);
  const errors = admissionErrors({
    authorization: invalid,
    root,
    git,
    now: new Date("2026-08-01T00:00:00Z"),
  });
  assert.ok(errors.some((error) => error.includes("context inputs have drifted")));
});

test("only status and dry-run execution are admitted by the initial command surface", () => {
  assert.deepEqual(parseArguments(["status"]), {
    command: "status",
    dryRun: false,
    manifest: "docs/vnext/pre-agent-loop/authorization.json",
  });
  assert.throws(() => parseArguments(["run", "--unsafe"]), /Unsupported controller option/);
  assert.throws(() => parseArguments(["status", "--dry-run"]), /only valid with run/);
});

test("dry-run queue preserves source paths and focused checks", () => {
  const queue = buildDryRunQueue({
    surfaces: [
      {
        id: "fixture",
        classification: "keep",
        canonicalOwner: "config/fixture.json",
        consumers: ["fixture consumer"],
        sourceRefs: ["config/fixture.json"],
        proofCommands: ["npm run validate:fixture"],
        rationale: "Fixture rationale.",
      },
    ],
  });
  assert.deepEqual(queue, [
    {
      id: "fixture",
      classification: "keep",
      owner: "config/fixture.json",
      consumers: ["fixture consumer"],
      paths: ["config/fixture.json"],
      focused_checks: ["npm run validate:fixture"],
      rationale: "Fixture rationale.",
      status: "pending",
    },
  ]);
});

test("changed path guard rejects protected, out-of-scope, binary, secret, and oversized slices", () => {
  const errors = changedPathErrors({
    authorization,
    changedPaths: ["docs/vnext/pre-agent-loop/authorization.json", "outside/file.txt"],
    addedLines: ["token=secret-value", ...Array.from({ length: authorization.budgets.lines_per_slice }, () => "line")],
    binaryPaths: ["tools/file.bin"],
  });
  assert.ok(errors.some((error) => error.includes("protected path")));
  assert.ok(errors.some((error) => error.includes("outside authorization")));
  assert.ok(errors.some((error) => error.includes("binary")));
  assert.ok(errors.some((error) => error.includes("line budget")));
  assert.ok(errors.some((error) => error.includes("secret")));
});

test("task mutation of controller state is rejected", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "pre-agent-loop-state-"));
  const stateRoot = path.join(temporaryRoot, "docs/vnext/pre-agent-loop");
  mkdirSync(stateRoot, { recursive: true });
  const queuePath = path.join(stateRoot, "queue.json");
  writeFileSync(queuePath, "{}\n");
  const before = snapshotControllerState(temporaryRoot);
  writeFileSync(queuePath, '{"changed":true}\n');
  assert.throws(() => assertControllerStateUnchanged(temporaryRoot, before), /task changed controller state/);
  rmSync(temporaryRoot, { recursive: true, force: true });
});

test("launcher probe accepts only noninteractive version output", () => {
  const launcher = authorization.launcher;
  const success = () => ({ status: 0, stdout: "GitHub Copilot CLI 1.0.77\n", stderr: "" });
  const prompt = () => ({ status: 0, stdout: "Install GitHub Copilot CLI?\n", stderr: "" });
  const failure = () => ({ status: 1, stdout: "", stderr: "failed" });
  assert.equal(probeLauncher(launcher, success).ok, true);
  assert.deepEqual(probeLauncher(launcher, prompt), { ok: false, reason: "launcher version probe requested setup" });
  assert.deepEqual(probeLauncher(launcher, failure), { ok: false, reason: "launcher version probe failed" });
});

test("structured task output requires valid JSONL", () => {
  assert.deepEqual(parseJsonLines('{"type":"start"}\n{"type":"result"}\n'), [{ type: "start" }, { type: "result" }]);
  assert.throws(() => parseJsonLines(""), /no structured output/);
  assert.throws(() => parseJsonLines("not-json"), /not valid JSONL/);
});

test("focused checks require authorization and a successful exit", () => {
  const success = () => ({ status: 0 });
  const failure = () => ({ status: 1 });
  assert.deepEqual(runFocusedChecks({ commands: ["npm run lint:json"], authorization, root, spawn: success }), [
    { command: "npm run lint:json", status: 0 },
  ]);
  assert.throws(
    () => runFocusedChecks({ commands: ["npm run validate:all"], authorization, root, spawn: success }),
    /not authorized/,
  );
  assert.throws(
    () => runFocusedChecks({ commands: ["npm run lint:json"], authorization, root, spawn: failure }),
    /focused check failed/,
  );
});

test("task command grants characterized file tools without Git or interactive capabilities", () => {
  const command = buildTaskCommand({
    authorization,
    item: { paths: ["tools/scripts/pre-agent-loop.mjs"] },
    prompt: "Inspect the bounded item.",
  });
  assert.ok(command.includes("view,glob,rg,apply_patch"));
  assert.ok(command.includes("--no-ask-user"));
  assert.ok(command.includes("--no-remote"));
  assert.ok(command.includes("--no-custom-instructions"));
  assert.ok(command.includes("--deny-tool"));
  assert.equal(
    command.some((part) => /shell\(git|allow-all|yolo/iu.test(part)),
    false,
  );
});

test("admitted run writes an atomic lock and queue once", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "pre-agent-loop-"));
  const stateRoot = path.join(temporaryRoot, "docs/vnext/pre-agent-loop");
  const inventoryRoot = path.join(temporaryRoot, "tools/registry");
  const binaryPath = path.join(temporaryRoot, "copilot");
  mkdirSync(inventoryRoot, { recursive: true });
  symlinkSync(
    path.join(root, "tools/registry/modernization-ownership.json"),
    path.join(inventoryRoot, "modernization-ownership.json"),
  );
  symlinkSync(authorization.launcher.binary, binaryPath);
  const fixture = structuredClone(authorization);
  fixture.worktree = temporaryRoot;
  fixture.launcher.binary = binaryPath;
  fixture.context_hashes = {};
  const result = initializeRun({
    authorization: fixture,
    root: temporaryRoot,
    git,
    now: new Date("2026-08-01T00:00:00Z"),
  });
  assert.equal(result.admitted, true);
  assert.equal(existsSync(path.join(stateRoot, "run.lock.json")), true);
  assert.equal(existsSync(path.join(stateRoot, "queue.json")), true);
  assert.equal(initializeRun({ authorization: fixture, root: temporaryRoot, git }).admitted, false);
  rmSync(temporaryRoot, { recursive: true, force: true });
});

test("resume reads only its owned lock and abort records then releases it", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "pre-agent-loop-"));
  const inventoryRoot = path.join(temporaryRoot, "tools/registry");
  const binaryPath = path.join(temporaryRoot, "copilot");
  mkdirSync(inventoryRoot, { recursive: true });
  symlinkSync(
    path.join(root, "tools/registry/modernization-ownership.json"),
    path.join(inventoryRoot, "modernization-ownership.json"),
  );
  symlinkSync(authorization.launcher.binary, binaryPath);
  const fixture = structuredClone(authorization);
  fixture.worktree = temporaryRoot;
  fixture.launcher.binary = binaryPath;
  fixture.context_hashes = {};
  initializeRun({ authorization: fixture, root: temporaryRoot, git });
  assert.equal(resumeRun({ authorization: fixture, root: temporaryRoot }).state, "bootstrapped");
  assert.deepEqual(abortRun({ authorization: fixture, root: temporaryRoot }), { state: "aborted" });
  assert.throws(() => resumeRun({ authorization: fixture, root: temporaryRoot }), /no pre-agent run lock/);
  assert.match(
    readFileSync(path.join(temporaryRoot, "docs/vnext/pre-agent-loop/checkpoints.jsonl"), "utf8"),
    /aborted/,
  );
  rmSync(temporaryRoot, { recursive: true, force: true });
});
