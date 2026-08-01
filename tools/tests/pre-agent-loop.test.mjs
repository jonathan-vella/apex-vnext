import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { admissionErrors, buildDryRunQueue, initializeRun, parseArguments } from "../scripts/pre-agent-loop.mjs";

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
        sourceRefs: ["config/fixture.json"],
        proofCommands: ["npm run validate:fixture"],
      },
    ],
  });
  assert.deepEqual(queue, [
    {
      id: "fixture",
      classification: "keep",
      paths: ["config/fixture.json"],
      focused_checks: ["npm run validate:fixture"],
    },
  ]);
});

test("admitted run writes an atomic lock and queue once", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "pre-agent-loop-"));
  const stateRoot = path.join(temporaryRoot, "docs/vnext/pre-agent-loop");
  const inventoryRoot = path.join(temporaryRoot, "tools/registry");
  const binaryPath = path.join(temporaryRoot, "copilot");
  try {
    symlinkSync(path.join(root, "tools/registry/modernization-ownership.json"), path.join(inventoryRoot, "ownership"));
  } catch {
    rmSync(temporaryRoot, { recursive: true, force: true });
    return;
  }
  rmSync(path.join(inventoryRoot, "ownership"));
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
