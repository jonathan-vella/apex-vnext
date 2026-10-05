import assert from "node:assert/strict";
import { dirname } from "node:path";
import test from "node:test";
import { planLaunch, resolveExecutable } from "../executable-resolution.js";
import { ProcessRunner, ProcessRunnerError } from "../process-runner.js";

const windowsFiles = new Set([
  "c:\\program files\\microsoft sdks\\azure\\cli2\\wbin\\az.cmd",
  "c:\\program files\\nodejs\\npm.cmd",
  "c:\\program files\\nodejs\\node.exe",
  "c:\\tools\\terraform.exe",
]);
const windows = {
  platform: "win32" as const,
  env: {
    Path: 'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin;C:\\Program Files\\nodejs;"C:\\Tools"',
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
  },
  isExecutableFile: (path: string) => windowsFiles.has(path.toLowerCase()),
};

test("Windows resolution applies PATHEXT, a mixed-case Path key and quoted PATH entries", () => {
  assert.equal(
    resolveExecutable("az", windows)?.toLowerCase(),
    "c:\\program files\\microsoft sdks\\azure\\cli2\\wbin\\az.cmd",
  );
  assert.equal(resolveExecutable("npm", windows)?.toLowerCase(), "c:\\program files\\nodejs\\npm.cmd");
  assert.equal(resolveExecutable("terraform", windows)?.toLowerCase(), "c:\\tools\\terraform.exe");
  assert.equal(resolveExecutable("node.exe", windows)?.toLowerCase(), "c:\\program files\\nodejs\\node.exe");
  assert.equal(resolveExecutable("C:\\Tools\\terraform", windows)?.toLowerCase(), "c:\\tools\\terraform.exe");
  assert.equal(resolveExecutable("bicep", windows), undefined);
  assert.equal(
    resolveExecutable("az", { ...windows, env: { ...windows.env, PATHEXT: undefined } })?.toLowerCase(),
    "c:\\program files\\microsoft sdks\\azure\\cli2\\wbin\\az.cmd",
  );
});

test("Windows command scripts run through cmd.exe with one validated command line", () => {
  const plan = planLaunch(
    "az",
    ["account", "get-access-token", "--resource", "https://management.azure.com/"],
    windows,
  );
  assert.equal(plan.command, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(plan.windowsVerbatimArguments, true);
  assert.deepEqual(plan.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(
    plan.args[3]!.toLowerCase(),
    '""c:\\program files\\microsoft sdks\\azure\\cli2\\wbin\\az.cmd" account get-access-token --resource https://management.azure.com/"',
  );
  assert.match(planLaunch("npm", ["install", "a b", "x&y", ""], windows).args[3]!, / "a b" "x&y" """$/u);
  for (const unsafe of ['say "hi"', "%PATH%", "!x!", "line\nbreak"]) {
    assert.throws(() => planLaunch("npm", ["run", unsafe], windows), /cannot be passed safely/u);
  }
});

test("Windows executables and unresolved names launch directly without a shell", () => {
  assert.deepEqual(planLaunch("terraform", ["version", "-json"], windows), {
    command: "C:\\Tools\\terraform.exe",
    args: ["version", "-json"],
    windowsVerbatimArguments: false,
  });
  assert.deepEqual(planLaunch("missing-tool", ["--version"], windows), {
    command: "missing-tool",
    args: ["--version"],
    windowsVerbatimArguments: false,
  });
});

test("POSIX resolution finds executables on PATH and skips non-executable files", () => {
  const env = { PATH: `/nonexistent:${dirname(process.execPath)}` };
  assert.equal(resolveExecutable("node", { platform: "linux", env }), process.execPath.replace(/\/[^/]+$/u, "/node"));
  assert.equal(resolveExecutable(process.execPath, { platform: "linux", env: {} }), process.execPath);
  assert.equal(resolveExecutable("definitely-not-a-real-apex-tool", { platform: "linux", env }), undefined);
  assert.deepEqual(planLaunch("node", ["-v"], { platform: "linux", env }).args, ["-v"]);
});

test("process runner resolves bare names from the request environment and reports unsafe arguments", async () => {
  const runner = new ProcessRunner();
  const result = await runner.run({
    executable: "node",
    args: ["-e", "console.log('resolved')"],
    env: { ...process.env, PATH: dirname(process.execPath) },
    timeoutMs: 5_000,
    maxOutputBytes: 1_024,
  });
  assert.equal(result.stdout.trim(), "resolved");
  await assert.rejects(
    runner.run({
      executable: "definitely-not-a-real-apex-tool",
      args: [],
      env: { PATH: "/nonexistent" },
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
    }),
    (error: unknown) => error instanceof ProcessRunnerError && error.code === "PROCESS_SPAWN_ERROR",
  );
});
