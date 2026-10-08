import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatHumanResult } from "../cli.js";
import { copilotHome, detectHostKind, firstReleaseVersion, type HostEnvironment } from "../host-profile.js";
import { ApexService } from "../service.js";
import { APEX_VERSION } from "../version.js";
import { hostFixture, tempRoot, type HostFixtureKind } from "./helpers.js";

type Report = Awaited<ReturnType<ApexService["doctor"]>>;

const check = (report: Report, id: string) => {
  const found = report.checks.find((entry) => entry.id === id);
  assert.ok(found, `missing doctor check ${id}`);
  return found;
};

async function doctorOn(kind: HostFixtureKind, input: Parameters<typeof hostFixture>[1] = {}, initialize = false) {
  const fixture = await hostFixture(kind, input);
  const root = await tempRoot();
  const service = new ApexService(root, fixture);
  if (initialize) await service.initializeWorkspace({ clientId: "github-copilot-cli" });
  return { fixture, root, service, report: await service.doctor() };
}

const host = (platform: NodeJS.Platform, kernel: string): HostEnvironment => ({
  platform,
  release: kernel,
  env: {},
  homedir: "/home/user",
});

test("host detection follows the DECISION-033 host and client matrix", () => {
  assert.equal(detectHostKind(host("win32", "10.0.26200")), "windows");
  assert.equal(detectHostKind(host("darwin", "25.0.0")), "macos");
  assert.equal(detectHostKind(host("linux", "6.6.87.2-microsoft-standard-WSL2")), "wsl2");
  assert.equal(detectHostKind(host("linux", "5.10.16.3-microsoft-standard")), "wsl2");
  assert.equal(detectHostKind(host("linux", "4.4.0-26100-Microsoft")), "wsl1");
  assert.equal(detectHostKind(host("linux", "6.8.0-60-generic")), "linux");
  assert.equal(detectHostKind(host("freebsd", "14.1-RELEASE")), "unsupported");
  assert.equal(firstReleaseVersion("GitHub Copilot CLI 1.0.93."), "1.0.93");
  assert.equal(firstReleaseVersion("1.141.0"), "1.141.0");
  assert.equal(firstReleaseVersion("bubblewrap 0.11.0"), "0.11.0");
  assert.equal(firstReleaseVersion("0.10.0-next.5"), undefined);
  assert.equal(firstReleaseVersion("unparseable"), undefined);
  assert.equal(copilotHome(host(process.platform, "")), join("/home/user", ".copilot"));
  assert.equal(copilotHome({ ...host("linux", "6.8.0"), env: { COPILOT_HOME: "/srv/copilot" } }), "/srv/copilot");
});

test("Windows doctor requires VS Code 1.140 only when installed and the plugin in the Copilot CLI store", async () => {
  const ready = await doctorOn("windows", {
    tools: { git: "git version 2.51.0.windows.1", copilot: "GitHub Copilot CLI 1.0.93.", code: "1.141.0" },
  });
  for (const id of ["host", "git", "vscode", "copilot-cli", "copilot-plugin"])
    assert.equal(check(ready.report, id).ok, true, id);
  assert.match(check(ready.report, "host").value, /^windows: VS Code Copilot harness or GitHub Copilot app/u);
  assert.match(check(ready.report, "copilot-plugin").value, /@agentPlugins/u);
  assert.equal(
    ready.report.checks.some(({ id }) => id === "linux-sandbox-tools"),
    false,
  );
  assert.deepEqual(ready.fixture.calls, [
    ["code", "--version"],
    ["copilot", "--no-auto-update", "--version"],
  ]);

  const oldCode = await doctorOn("windows", {
    tools: { git: "git", copilot: "GitHub Copilot CLI 1.0.93.", code: "1.139.0" },
  });
  assert.equal(check(oldCode.report, "vscode").ok, false);
  assert.match(check(oldCode.report, "vscode").remedy ?? "", /1\.140\.0 or newer/u);

  // The GitHub Copilot app does not need VS Code or Copilot CLI; the plugin store is what both Windows clients read.
  const app = await doctorOn("windows", { tools: { git: "git" } });
  assert.equal(check(app.report, "vscode").ok, true);
  const cli = check(app.report, "copilot-cli");
  assert.deepEqual([cli.ok, cli.severity], [true, "warning"]);
  assert.match(cli.remedy ?? "", /winget install GitHub\.Copilot/u);

  const noPlugin = await doctorOn("windows", { plugin: false });
  const plugin = check(noPlugin.report, "copilot-plugin");
  assert.equal(plugin.ok, false);
  assert.match(plugin.remedy ?? "", /Close every VS Code window.*copilot plugin install apex@apex-plugins/u);
  assert.ok(noPlugin.report.remedies.includes(plugin.remedy!));
});

test("Copilot CLI on WSL2 passes doctor with an old Windows VS Code shim on PATH (#436)", async () => {
  const { fixture, report } = await doctorOn(
    "wsl2",
    {
      tools: {
        git: "git version 2.51.0",
        copilot: "GitHub Copilot CLI 1.0.93.",
        bwrap: "bubblewrap 0.11.0",
        slirp4netns: "slirp4netns version 1.2.1",
        code: "1.120.0",
      },
    },
    true,
  );
  const vscode = check(report, "vscode");
  assert.deepEqual([vscode.ok, vscode.severity], [true, undefined]);
  assert.match(vscode.value, /skipped: the Copilot CLI host does not use VS Code/u);
  assert.equal(
    fixture.calls.some(([executable]) => executable === "code"),
    false,
  );
  assert.equal(check(report, "plugin-settings").ok, true);
  assert.equal(report.healthy, true, JSON.stringify(report.checks.filter(({ ok }) => !ok)));
  assert.match(report.nextAction, /first project/u);
});

test("Copilot CLI hosts require Copilot CLI and report sandbox tools and a missing plugin as warnings", async () => {
  for (const kind of ["linux", "wsl2"] as const) {
    const missing = await doctorOn(kind, { tools: { git: "git" } });
    const cli = check(missing.report, "copilot-cli");
    assert.equal(cli.ok, false, kind);
    assert.match(cli.remedy ?? "", /npm install -g @github\/copilot/u);
    const sandbox = check(missing.report, "linux-sandbox-tools");
    assert.deepEqual([sandbox.ok, sandbox.severity], [true, "warning"]);
    assert.match(sandbox.value, /missing bwrap, slirp4netns/u);
    assert.match(sandbox.remedy ?? "", /sudo apt install bubblewrap slirp4netns/u);
    assert.equal(check(missing.report, "git").ok, true);
    assert.equal(check(missing.report, "vscode").value, "not needed: the Copilot CLI host does not use VS Code");
  }
  const old = await doctorOn("linux", { tools: { git: "git", copilot: "GitHub Copilot CLI 1.0.20." } });
  assert.equal(check(old.report, "copilot-cli").ok, false);
  assert.match(check(old.report, "copilot-cli").remedy ?? "", /copilot update/u);
  const unreadable = await doctorOn("linux", { tools: { git: "git", copilot: "no version here" } });
  assert.equal(check(unreadable.report, "copilot-cli").value, "version unavailable from copilot --version");

  const noPlugin = await doctorOn("wsl2", { plugin: false }, true);
  const plugin = check(noPlugin.report, "copilot-plugin");
  assert.deepEqual([plugin.ok, plugin.severity], [true, "warning"]);
  assert.match(plugin.remedy ?? "", /trust it/u);
  assert.equal(noPlugin.report.healthy, true);
  assert.equal(noPlugin.report.remedies.includes(plugin.remedy!), false);

  const noGit = await doctorOn("linux", { tools: { copilot: "GitHub Copilot CLI 1.0.93." } });
  assert.equal(check(noGit.report, "git").ok, false);
  assert.match(check(noGit.report, "git").remedy ?? "", /sudo apt install git/u);
});

test("doctor rejects WSL1 and reports macOS as best effort", async () => {
  const wsl1 = check((await doctorOn("wsl1")).report, "host");
  assert.equal(wsl1.ok, false);
  assert.match(wsl1.remedy ?? "", /wsl --set-version/u);
  const macos = await doctorOn("macos", { tools: { git: "git", copilot: "1.0.93", code: "1.141.0" } });
  assert.deepEqual([check(macos.report, "host").ok, check(macos.report, "host").severity], [true, "warning"]);
  assert.equal(check(macos.report, "vscode").ok, true);
});

test("doctor reads the Copilot CLI plugin store without trusting malformed or ambiguous records", async () => {
  const entry = { name: "apex", marketplace: "apex-plugins", version: APEX_VERSION, enabled: true };
  const value = async (plugin: Parameters<typeof hostFixture>[1]) =>
    check((await doctorOn("windows", plugin)).report, "copilot-plugin");
  const duplicate = await value({ plugin: [entry, { ...entry, marketplace: undefined }] });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.value, /^2 apex plugins installed/u);
  const disabled = await value({ plugin: { ...entry, enabled: false } });
  assert.deepEqual([disabled.ok, disabled.value], [false, `apex@apex-plugins ${APEX_VERSION} disabled`]);
  const stale = await value({ plugin: { ...entry, version: "0.0.1" } });
  assert.equal(stale.ok, false);
  assert.match(stale.remedy ?? "", /copilot plugin update apex@apex-plugins.*@apexops\/cli@0\.0\.1/u);
  const direct = await value({ plugin: { ...entry, marketplace: undefined } });
  assert.equal(direct.ok, true);
  assert.match(direct.value, /^apex@direct /u);
  const other = await value({ plugin: { ...entry, name: "other" } });
  assert.equal(other.ok, false);
  for (const configText of ["{not json", "[]", '{"installedPlugins":{}}']) {
    const invalid = await value({ configText });
    assert.equal(invalid.ok, false, configText);
    assert.match(invalid.value, /^unreadable Copilot CLI configuration/u);
  }
  const empty = await value({ configText: "// managed\n{}\n" });
  assert.match(empty.value, /^not installed/u);
});

test("doctor checks that workspace settings enable the plugin", async () => {
  const { root, service, report } = await doctorOn("linux", {}, true);
  assert.equal(check(report, "plugin-settings").value, ".github/copilot/settings.json enables apex@apex-plugins");
  const path = join(root, ".github", "copilot", "settings.json");
  const settings = JSON.parse(await readFile(path, "utf8")) as { enabledPlugins: Record<string, boolean> };
  settings.enabledPlugins["apex@apex-plugins"] = false;
  await writeFile(path, JSON.stringify(settings));
  const disabled = check(await service.doctor(), "plugin-settings");
  assert.equal(disabled.ok, false);
  assert.match(disabled.remedy ?? "", /doctor --fix --yes/u);
});

test("human doctor output lists the first warning without failing setup", () => {
  assert.equal(
    formatHumanResult(["doctor"], {
      healthy: true,
      checks: [
        { ok: true },
        { ok: true, severity: "warning", value: "missing bwrap", remedy: "Install bubblewrap" },
        { ok: true, severity: "warning", value: "not installed" },
      ],
      remedies: [],
      nextAction: "No action required",
    }),
    "Status: Ready (3/3 checks ready)\nNext: No action required\nWarning: Install bubblewrap (+1 more)",
  );
});

async function writeExecutables(directory: string, tools: Record<string, string>, marker: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const [name, output] of Object.entries(tools)) {
    if (process.platform === "win32") {
      await writeFile(join(directory, `${name}.cmd`), `@echo off\r\necho ran>>"${marker}"\r\necho ${output}\r\n`);
    } else {
      const script = join(directory, name);
      await writeFile(script, `#!/bin/sh\necho ran >> '${marker}'\necho '${output}'\n`);
      await chmod(script, 0o755);
    }
  }
}

async function realHost(kernel: string, tools: Record<string, string>) {
  const sandbox = await tempRoot();
  const bin = join(sandbox, "bin");
  const store = join(sandbox, "copilot-home");
  const marker = join(sandbox, "ran.log");
  await writeExecutables(bin, tools, marker);
  await mkdir(store);
  await writeFile(
    join(store, "config.json"),
    `// This file is managed automatically.\n${JSON.stringify({
      installedPlugins: [{ name: "apex", marketplace: "apex-plugins", version: APEX_VERSION, enabled: true }],
    })}\n`,
  );
  const env: NodeJS.ProcessEnv = { ...process.env, COPILOT_HOME: store };
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
  env.PATH = bin;
  const service = new ApexService(await tempRoot(), {
    hostEnvironment: { platform: process.platform, release: kernel, env, homedir: sandbox },
  });
  return { report: await service.doctor(), marker, store };
}

test(
  "native Windows doctor resolves and runs .cmd shims for VS Code and Copilot CLI",
  { skip: process.platform !== "win32" && "Windows-only executable resolution" },
  async () => {
    const tools = { git: "git version 2.51.0.windows.1", copilot: "GitHub Copilot CLI 1.0.93." };
    const old = await realHost(release(), { ...tools, code: "1.139.0" });
    assert.equal(check(old.report, "host").value.startsWith("windows:"), true);
    assert.deepEqual([check(old.report, "vscode").ok, check(old.report, "vscode").value], [false, "1.139.0"]);
    assert.equal(check(old.report, "git").ok, true);
    assert.deepEqual(
      [check(old.report, "copilot-cli").ok, check(old.report, "copilot-cli").severity],
      [true, undefined],
    );
    assert.match(check(old.report, "copilot-cli").value, /^1\.0\.93; manages the plugin store only/u);
    assert.equal(check(old.report, "copilot-plugin").ok, true);
    assert.ok(check(old.report, "copilot-plugin").value.includes(`enabled in ${old.store};`));
    const current = await realHost(release(), { ...tools, code: "1.141.0" });
    assert.deepEqual([check(current.report, "vscode").ok, check(current.report, "vscode").value], [true, "1.141.0"]);
  },
);

test(
  "WSL2 doctor never runs the code shim and runs the real Copilot CLI version probe",
  { skip: process.platform !== "linux" && "Linux-only executable resolution" },
  async () => {
    const { report, marker } = await realHost("6.6.87.2-microsoft-standard-WSL2", {
      git: "git version 2.51.0",
      copilot: "GitHub Copilot CLI 1.0.93.",
      bwrap: "bubblewrap 0.11.0",
      slirp4netns: "slirp4netns version 1.2.1",
      code: "1.120.0",
    });
    assert.equal(check(report, "vscode").value, "skipped: the Copilot CLI host does not use VS Code");
    assert.deepEqual([check(report, "copilot-cli").ok, check(report, "copilot-cli").value], [true, "1.0.93"]);
    assert.equal(check(report, "linux-sandbox-tools").severity, undefined);
    assert.equal(check(report, "copilot-plugin").ok, true);
    // Only the Copilot CLI probe ran; the VS Code shim, git and the sandbox tools were resolved, not executed.
    assert.equal((await readFile(marker, "utf8")).trim().split(/\s+/u).length, 1);
  },
);
