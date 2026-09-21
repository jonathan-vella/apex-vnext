import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const script = resolve("tools/scripts/setup-wsl.sh");
const windowsScript = resolve("tools/scripts/setup-windows.ps1");

test("setup requires current CLI source and never installs the retired recall package", () => {
  const source = readFileSync(script, "utf8");
  assert.match(source, /packages\/cli\/package\.json/u);
  assert.doesNotMatch(source, /apex[-_]recall/u);
});

function bash(body, env = {}) {
  return spawnSync("bash", ["-c", `source "$SETUP_SCRIPT"; ${body}`], {
    encoding: "utf8",
    env: { ...process.env, SETUP_SCRIPT: script, ...env },
    timeout: 10_000,
  });
}

test("setup parses and help/plan do not invoke installers or login", () => {
  assert.equal(spawnSync("bash", ["-n", script]).status, 0);
  for (const mode of ["--help", "--plan"]) {
    const result = bash(
      'require_wsl() { exit 91; }; install_tools() { exit 92; }; login() { exit 93; }; main "$MODE"',
      {
        MODE: mode,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Windows|WSL2/);
  }
  assert.equal(bash("main --unknown").status, 2);
  assert.equal(bash("main --install extra").status, 2);
});

test("non-WSL and root environments are refused before installation", () => {
  const nonWsl = bash('uname() { printf "generic-linux\\n"; }; require_wsl');
  assert.notEqual(nonWsl.status, 0);
  assert.match(nonWsl.stderr, /WSL|Container/);
  const root = bash('uname() { printf "microsoft-standard-WSL2\\n"; }; id() { printf "0\\n"; }; require_wsl');
  assert.notEqual(root.status, 0);
});

test("login refuses noninteractive input without starting auth clients", () => {
  const result = bash("gh() { exit 91; }; az() { exit 92; }; copilot() { exit 93; }; login");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires a terminal/);
});

test("check mode routes without running installers or auth", () => {
  const result = bash(
    'require_wsl() { :; }; check_tools() { printf "checked\\n"; }; install_tools() { exit 92; }; login() { exit 93; }; main --check',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "checked");
});

test("GitHub binary selection verifies digest and permits repeated installation", (context) => {
  const root = mkdtempSync(join(tmpdir(), "apex-wsl-setup-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".local", "bin"), { recursive: true });
  mkdirSync(join(root, "tools"));
  mkdirSync(join(root, "scratch"));
  const content = "binary fixture, never execute\n";
  writeFileSync(join(root, "asset"), content);
  const metadata = {
    tag_name: "v1.2.3",
    assets: [
      {
        name: "tool-linux-x64",
        browser_download_url: "https://example.invalid/asset",
        digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      },
    ],
  };
  writeFileSync(join(root, "metadata"), JSON.stringify(metadata));
  const body =
    'scratch="$HOME/scratch"; tool_root="$HOME/tools"; architecture=amd64; download() { case "$1" in */releases/latest) cp "$HOME/metadata" "$2" ;; *) cp "$HOME/asset" "$2" ;; esac; }; github_tool example/tool "^tool-linux-x64$" tool tool';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = bash(body, { HOME: root });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(root, ".local", "bin", "tool"), "utf8"), content);
  }
  const installed = readlinkSync(join(root, ".local", "bin", "tool"));
  metadata.tag_name = "v2.0.0";
  metadata.assets[0].digest = `sha256:${"0".repeat(64)}`;
  writeFileSync(join(root, "metadata"), JSON.stringify(metadata));
  assert.notEqual(bash(body, { HOME: root }).status, 0);
  assert.equal(readlinkSync(join(root, ".local", "bin", "tool")), installed);
  metadata.assets[0].digest = null;
  writeFileSync(join(root, "metadata"), JSON.stringify(metadata));
  assert.match(bash(body, { HOME: root }).stderr, /unverified/);
  metadata.assets.push(metadata.assets[0]);
  writeFileSync(join(root, "metadata"), JSON.stringify(metadata));
  assert.match(bash(body, { HOME: root }).stderr, /unique stable/);
});

test("Terraform installation keeps a versioned rollback target", (context) => {
  const root = mkdtempSync(join(tmpdir(), "apex-terraform-setup-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of [".local/bin", "tools", "scratch", "archive"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(join(root, "archive", "terraform"), "terraform fixture\n", { mode: 0o755 });
  const archive = join(root, "terraform.zip");
  assert.equal(
    spawnSync("python3", ["-m", "zipfile", "-c", archive, "terraform"], { cwd: join(root, "archive") }).status,
    0,
  );
  const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
  const body = `scratch="$HOME/scratch"; tool_root="$HOME/tools"; architecture=amd64;
    download() { case "$1" in */v1/check/terraform) printf '{"current_version":"1.16.3"}' > "$2" ;; *SHA256SUMS) printf '${digest}  terraform_1.16.3_linux_amd64.zip\\n' > "$2" ;; *) cp "$HOME/terraform.zip" "$2" ;; esac; };
    install_terraform`;
  const result = bash(body, { HOME: root });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readlinkSync(join(root, ".local", "bin", "terraform")),
    join(root, "tools", "terraform-v1.16.3", "terraform"),
  );
});

for (const architecture of ["amd64", "arm64"]) {
  test(`azd ${architecture} archive installs its platform-named binary as azd`, (context) => {
    const root = mkdtempSync(join(tmpdir(), "apex-azd-setup-"));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    for (const directory of [".local/bin", "tools", "scratch", "archive"]) {
      mkdirSync(join(root, directory), { recursive: true });
    }
    const executable = `azd-linux-${architecture}`;
    const content = "azd fixture, never execute\n";
    writeFileSync(join(root, "archive", executable), content);
    writeFileSync(join(root, "archive", "NOTICE.txt"), "Notice\n");
    const archive = join(root, "asset.tar.gz");
    assert.equal(spawnSync("tar", ["-czf", archive, "-C", join(root, "archive"), executable, "NOTICE.txt"]).status, 0);
    writeFileSync(
      join(root, "metadata"),
      JSON.stringify({
        tag_name: "azure-dev-cli_1.34.0",
        assets: [
          {
            name: `${executable}.tar.gz`,
            browser_download_url: "https://example.invalid/asset",
            digest: `sha256:${createHash("sha256").update(readFileSync(archive)).digest("hex")}`,
          },
        ],
      }),
    );
    const invocation = readFileSync(script, "utf8")
      .split("\n")
      .find((line) => line.trim().startsWith("github_tool Azure/azure-dev "));
    assert.ok(invocation, "Use the production azd mapping in this regression test");
    const body = `scratch="$HOME/scratch"; tool_root="$HOME/tools"; architecture="$TEST_ARCH";
      download() { case "$1" in */releases/latest) cp "$HOME/metadata" "$2" ;; *) cp "$HOME/asset.tar.gz" "$2" ;; esac; };
      ${invocation}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = bash(body, { HOME: root, TEST_ARCH: architecture });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(join(root, ".local/bin/azd"), "utf8"), content);
      assert.equal(
        readlinkSync(join(root, ".local/bin/azd")),
        join(root, "tools/azd-azure-dev-cli_1.34.0", executable),
      );
    }
  });
}

test("PowerShell entry point parses without running Windows setup", (context) => {
  const result = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      "$tokens = $null; $issues = $null; [System.Management.Automation.Language.Parser]::ParseFile($env:WINDOWS_SETUP, [ref]$tokens, [ref]$issues) > $null; if ($issues.Count) { $issues | Out-String | Write-Error; exit 1 }",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, WINDOWS_SETUP: windowsScript },
      timeout: 10_000,
    },
  );
  if (result.error?.code === "ENOENT") return context.skip("PowerShell parser is not installed");
  assert.equal(result.status, 0, result.stderr);
});
