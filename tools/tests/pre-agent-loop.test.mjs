import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  collectGitChanges,
  focusedCheckPlan,
  initializeRun,
  launchTask,
  matchesPath,
  parseJsonLines,
  parseArguments,
  processNextItem,
  probeLauncher,
  runFocusedChecks,
  runQueueGuarded,
  resumeRun,
  snapshotControllerState,
  taskInvokedSkill,
  taskLoadedMcp,
  taskPrompt,
} from "../scripts/pre-agent-loop.mjs";
import { contextHashDrift } from "../scripts/pre-agent-loop-hashes.mjs";

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

test("path matching treats question marks as literals", () => {
  assert.equal(matchesPath("docs/file?.md", "docs/file?.md"), true);
  assert.equal(matchesPath("docs/file1.md", "docs/file?.md"), false);
});

test("skill inventory hashing uses the caller-provided root", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "pre-agent-loop-hash-"));
  const skillDirectory = path.join(temporaryRoot, ".github/skills/fixture");
  mkdirSync(skillDirectory, { recursive: true });
  writeFileSync(path.join(skillDirectory, "SKILL.md"), "---\nname: fixture\ndescription: fixture\n---\n");
  const metadata = ".github/skills/fixture/SKILL.md\nname: fixture\ndescription: fixture";
  const expected = createHash("sha256").update(metadata).digest("hex");
  assert.deepEqual(contextHashDrift({ "skill-metadata-inventory": expected }, temporaryRoot), []);
  rmSync(temporaryRoot, { recursive: true, force: true });
});

test("Git porcelain parsing preserves path prefixes and excludes controller state", () => {
  const fixtureGit = (args) => {
    if (args[0] === "status") return " M docs/vnext/pre-agent-loop/queue.json\0?? README.md";
    return "";
  };
  const changes = collectGitChanges(root, fixtureGit);
  assert.deepEqual(changes.changedPaths, ["README.md"]);
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

test("skill availability metadata is allowed while actual skill execution is denied", () => {
  assert.equal(
    taskInvokedSkill([{ type: "session.skills_loaded", data: { skills: ["customize-cloud-agent"] } }]),
    false,
  );
  assert.equal(taskInvokedSkill([{ type: "tool.execution_start", data: { toolName: "skill" } }]), true);
  assert.equal(
    taskInvokedSkill([{ type: "tool.execution_start", data: { toolName: "view", path: ".github/skills/x/SKILL.md" } }]),
    false,
  );
});

test("MCP prose is allowed while MCP lifecycle and tool events are denied", () => {
  assert.equal(
    taskLoadedMcp([{ type: "assistant.message", data: { content: "Review MCP runtime manifests." } }]),
    false,
  );
  assert.equal(
    taskLoadedMcp([{ type: "tool.execution_start", data: { toolName: "rg", arguments: { query: "MCP manifests" } } }]),
    false,
  );
  assert.equal(taskLoadedMcp([{ type: "session.mcp_server_status_changed", data: { serverName: "github" } }]), true);
  assert.equal(taskLoadedMcp([{ type: "tool.execution_start", data: { toolName: "github-mcp/status" } }]), true);
});

test("queue item prompt explicitly prohibits skill invocation and skill-file reads", () => {
  const prompt = taskPrompt({ id: "fixture", classification: "keep", paths: ["README.md"] });
  assert.match(prompt, /Do not invoke skills/);
  assert.match(prompt, /do not read any SKILL\.md/);
});

test("task launcher uses a neutral directory and rejects MCP events", () => {
  let observedCwd;
  let observedHome;
  let observedTimeout;
  const success = (_binary, _args, options) => {
    observedCwd = options.cwd;
    observedHome = options.env.COPILOT_HOME;
    observedTimeout = options.timeout;
    return { status: 0, stdout: '{"type":"assistant.message"}\n', stderr: "" };
  };
  const mcp = () => ({
    status: 0,
    stdout: '{"type":"session.mcp_server_status_changed","data":{"serverName":"github-mcp-server"}}\n',
    stderr: "",
  });
  const item = { paths: ["docs/vnext/pre-agent-loop/authorization.json"], prompt: "Read only." };
  assert.equal(launchTask({ authorization, item, spawn: success }).length, 1);
  assert.notEqual(observedCwd, authorization.worktree);
  assert.ok(observedHome.startsWith(observedCwd));
  assert.equal(observedTimeout, authorization.launcher.noninteractive.task_timeout_seconds * 1000);
  assert.throws(() => launchTask({ authorization, item, spawn: mcp }), /loaded MCP/);
});

test("task launcher retries one empty response but never accepts repeated empty output", () => {
  const item = { paths: ["docs/vnext/pre-agent-loop/authorization.json"], prompt: "Read only." };
  let attempts = 0;
  const transient = () => {
    attempts += 1;
    return attempts === 1
      ? { status: 0, stdout: "", stderr: "" }
      : { status: 0, stdout: '{"type":"result"}\n', stderr: "" };
  };
  assert.equal(launchTask({ authorization, item, spawn: transient }).length, 1);
  assert.equal(attempts, 2);
  assert.throws(
    () => launchTask({ authorization, item, spawn: () => ({ status: 0, stdout: "", stderr: "" }) }),
    /no structured output/,
  );
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

test("terminal validation and release qualification remain reserved", () => {
  assert.deepEqual(focusedCheckPlan(["npm run lint:json", "npm run validate:all", "npm run qualify:vnext-release"]), {
    executable: ["npm run lint:json"],
    reserved: ["npm run validate:all", "npm run qualify:vnext-release"],
  });
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
  assert.ok(command.includes("--disable-builtin-mcps"));
  assert.ok(command.includes("--deny-tool"));
  const addDirectories = command
    .map((part, index) => (part === "--add-dir" ? command[index + 1] : null))
    .filter(Boolean);
  assert.deepEqual(addDirectories, [path.join(authorization.worktree, "tools/scripts")]);
  assert.equal(addDirectories.includes(authorization.worktree), false);
  for (const server of ["github-mcp-server", "github", "azure-resource-manager-mcp", "apex"]) {
    assert.ok(command.some((part, index) => part === "--disable-mcp-server" && command[index + 1] === server));
  }
  assert.equal(
    command.some((part) => /shell\(git|allow-all|yolo/iu.test(part)),
    false,
  );
});

test("task command bounds glob patterns to their containing directories", () => {
  const command = buildTaskCommand({
    authorization,
    item: {
      paths: ["packages/contracts/schemas/pricing-*-v1.schema.json", "customizations/.github/agents/*.agent.md"],
    },
    prompt: "Inspect the bounded item.",
  });
  const addDirectories = command
    .map((part, index) => (part === "--add-dir" ? command[index + 1] : null))
    .filter(Boolean);
  assert.deepEqual(addDirectories, [
    path.join(authorization.worktree, "packages/contracts/schemas"),
    path.join(authorization.worktree, "customizations/.github/agents"),
  ]);
  assert.equal(
    addDirectories.every((pathname) => existsSync(pathname)),
    true,
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
  assert.equal(resumeRun({ authorization: fixture, root: temporaryRoot, git }).state, "bootstrapped");
  assert.deepEqual(abortRun({ authorization: fixture, root: temporaryRoot }), { state: "aborted" });
  assert.throws(() => resumeRun({ authorization: fixture, root: temporaryRoot, git }), /no pre-agent run lock/);
  assert.match(
    readFileSync(path.join(temporaryRoot, "docs/vnext/pre-agent-loop/checkpoints.jsonl"), "utf8"),
    /aborted/,
  );
  rmSync(temporaryRoot, { recursive: true, force: true });
});

test("one queue item completes through launch, checks, evidence, and checkpoint publication", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "pre-agent-loop-item-"));
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
  const sha = "a".repeat(40);
  const gitCalls = [];
  const git = (args) => {
    gitCalls.push(args);
    if (args[0] === "branch") return fixture.branch;
    if (args[0] === "config") return "origin";
    if (args[0] === "status" || args[0] === "diff") return "";
    if (args[0] === "rev-parse") return sha;
    if (args[0] === "ls-remote") return `${sha}\trefs/heads/${fixture.branch}`;
    return "";
  };
  const spawn = (_binary, args) =>
    args.includes("--output-format")
      ? { status: 0, stdout: '{"type":"result"}\n', stderr: "" }
      : { status: 0, stdout: "", stderr: "" };
  initializeRun({ authorization: fixture, root: temporaryRoot, git });
  const result = processNextItem({ authorization: fixture, root: temporaryRoot, git, spawn });
  assert.equal(result.state, "accepted");
  assert.ok(gitCalls.some((args) => args[0] === "commit"));
  assert.ok(gitCalls.some((args) => args[0] === "push"));
  const inventory = JSON.parse(
    readFileSync(path.join(temporaryRoot, "docs/vnext/pre-agent-loop/inventory.json"), "utf8"),
  );
  assert.equal(inventory.surfaces[0].disposition, "verified-no-change");
  rmSync(temporaryRoot, { recursive: true, force: true });
});

test("an exhausted queue publishes completion and releases its lock", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "pre-agent-loop-complete-"));
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
  const sha = "b".repeat(40);
  const git = (args) => {
    if (args[0] === "branch") return fixture.branch;
    if (args[0] === "config") return "origin";
    if (args[0] === "rev-parse") return sha;
    if (args[0] === "ls-remote") return `${sha}\trefs/heads/${fixture.branch}`;
    return "";
  };
  initializeRun({ authorization: fixture, root: temporaryRoot, git });
  const queuePath = path.join(temporaryRoot, "docs/vnext/pre-agent-loop/queue.json");
  const queue = JSON.parse(readFileSync(queuePath, "utf8"));
  for (const item of queue.items) item.status = "accepted";
  writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`);
  assert.deepEqual(processNextItem({ authorization: fixture, root: temporaryRoot, git }), { state: "completed" });
  assert.equal(existsSync(path.join(temporaryRoot, "docs/vnext/pre-agent-loop/run.lock.json")), false);
  assert.equal(existsSync(path.join(temporaryRoot, "docs/vnext/pre-agent-loop/completion-handoff.md")), true);
  rmSync(temporaryRoot, { recursive: true, force: true });
});

test("queue failure records stopped evidence, publishes it, and releases the lock", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "pre-agent-loop-stopped-"));
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
  const sha = "c".repeat(40);
  const gitCalls = [];
  const fixtureGit = (args) => {
    gitCalls.push(args);
    if (args[0] === "branch") return fixture.branch;
    if (args[0] === "config") return "origin";
    if (args[0] === "rev-parse") return sha;
    if (args[0] === "ls-remote") return `${sha}\trefs/heads/${fixture.branch}`;
    return "";
  };
  const skillSpawn = () => ({
    status: 0,
    stdout: '{"type":"tool.execution_start","data":{"toolName":"skill"}}\n',
    stderr: "",
  });
  initializeRun({ authorization: fixture, root: temporaryRoot, git: fixtureGit });
  assert.throws(
    () => runQueueGuarded({ authorization: fixture, root: temporaryRoot, git: fixtureGit, spawn: skillSpawn }),
    /invoked a skill/,
  );
  const stateRoot = path.join(temporaryRoot, "docs/vnext/pre-agent-loop");
  assert.equal(existsSync(path.join(stateRoot, "run.lock.json")), false);
  assert.equal(JSON.parse(readFileSync(path.join(stateRoot, "queue.json"), "utf8")).state, "stopped");
  assert.match(readFileSync(path.join(stateRoot, "findings.jsonl"), "utf8"), /invoked a skill/);
  assert.match(readFileSync(path.join(stateRoot, "checkpoints.jsonl"), "utf8"), /previous_record_sha256/);
  assert.ok(gitCalls.some((args) => args[0] === "push"));
  assert.equal(resumeRun({ authorization: fixture, root: temporaryRoot, git: fixtureGit }).state, "running");
  assert.equal(existsSync(path.join(stateRoot, "run.lock.json")), true);
  abortRun({ authorization: fixture, root: temporaryRoot });
  rmSync(temporaryRoot, { recursive: true, force: true });
});
