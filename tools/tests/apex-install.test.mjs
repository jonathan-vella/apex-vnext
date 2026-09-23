import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { renderConsumerInstaller } from "../scripts/pack-vnext.mjs";

const script = resolve("tools/scripts/apex-install.sh");
const bash = (body) => {
  const home = mkdtempSync(join(tmpdir(), "apex-installer-"));
  try {
    return spawnSync("bash", ["-c", `source "$INSTALLER"; ${body}`], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, INSTALLER: script },
      timeout: 10_000,
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};

test("consumer installer parses without Node and refuses unconfirmed or invalid execution", () => {
  assert.equal(spawnSync("bash", ["-n", script]).status, 0);
  for (const args of ["--version latest", "--version 1.2.3 --install", "--version", "--unknown"]) {
    const result = bash(`require_host() { exit 91; }; install_plan() { exit 92; }; main ${args}`);
    assert.equal(result.status, 2, result.stderr);
  }
  const help = bash("require_host() { exit 91; }; main --help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /ready Ubuntu WSL2/);
  assert.doesNotMatch(readFileSync(script, "utf8"), /npm ci|packages\/cli\/package|gh auth|az login/);
});

test("consumer plan preserves compatible tools without invoking installers", () => {
  const result = bash(`require_host() { :; }; minimum_version() { printf '1.0.0'; };
    tool_version() { if [[ "$1" == apex ]]; then printf '1.2.3'; else printf '9.0.0'; fi; };
    command() { if [[ "$1" == -v ]]; then printf '/usr/bin/%s\\n' "$2"; else builtin command "$@"; fi; };
    install_plan() { exit 92; }; main --version 1.2.3 --plan`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal((result.stdout.match(/preserve/g) ?? []).length, 12);
  assert.doesNotMatch(result.stdout, /conflict|host-action/);
});

test("consumer plan blocks incompatible tools unless replacement is separately approved", () => {
  const prelude = `require_host() { :; }; minimum_version() { printf '2.0.0'; };
    tool_version() { if [[ "$1" == code ]]; then printf '9.0.0'; else printf '1.0.0'; fi; };
    command() { if [[ "$1" == -v ]]; then printf '/usr/bin/%s\\n' "$2"; else builtin command "$@"; fi; };
    install_plan() { printf 'APPROVED_ACTIONS %s\\n' "\${actions[*]}"; };`;
  const refused = bash(`${prelude} main --version 1.2.3 --install --yes`);
  assert.equal(refused.status, 1);
  assert.doesNotMatch(refused.stdout, /APPROVED_ACTIONS/);
  const accepted = bash(`${prelude} main --version 1.2.3 --install --yes --replace-incompatible`);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /APPROVED_ACTIONS git node npm gh copilot az bicep terraform pwsh azd apex/);
});

test("consumer installer rendering binds canonical versions and rejects malformed templates", () => {
  const template = readFileSync(script, "utf8");
  const toolchain = JSON.parse(readFileSync("config/toolchain.v1.json", "utf8")).compatibilitySet;
  const rendered = renderConsumerInstaller(template, toolchain);
  assert.doesNotMatch(rendered, /__APEX_/u);
  for (const value of [toolchain.node, toolchain.npm, toolchain.copilotCli, toolchain.minimumVscode])
    assert.ok(rendered.includes(value));
  assert.throws(() => renderConsumerInstaller(template, { ...toolchain, node: "latest; unsafe" }), /Invalid installer/);
  assert.throws(() => renderConsumerInstaller(`${template}\n__APEX_NODE_VERSION__`, toolchain), /occur once/);
  const result = bash("require_host() { exit 91; }; main --version 1.2.3 --install --yes");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /generated release installer/);
});

test("consumer installer refuses unapproved system changes and unowned local binaries", () => {
  const system = bash("system=false; sudo() { exit 91; }; system_packages git");
  assert.equal(system.status, 1);
  assert.match(system.stderr, /allow-system/);
  const owned = bash(`tool_root="$HOME/tools"; mkdir -p "$HOME/.local/bin" "$tool_root";
    printf 'user-owned' > "$HOME/.local/bin/node"; printf 'binary' > "$tool_root/node";
    if link_tool "$tool_root/node" node; then exit 91; fi; test "$(cat "$HOME/.local/bin/node")" = user-owned`);
  assert.equal(owned.status, 0, owned.stderr);
});

test("consumer checksum and archive checks reject corrupt downloads and traversal", () => {
  const checksum = bash(`printf 'content' > "$HOME/asset"; verify_download "$HOME/asset" '${"0".repeat(64)}'`);
  assert.notEqual(checksum.status, 0);
  const traversal = bash(`python3 - "$HOME/unsafe.zip" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as archive:
    archive.writestr('../outside', 'must not escape')
PY
    mkdir "$HOME/output"; if extract_archive "$HOME/unsafe.zip" "$HOME/output"; then exit 91; fi;
    test ! -e "$HOME/outside"`);
  assert.equal(traversal.status, 0, traversal.stderr);
  assert.match(traversal.stderr, /Unsafe archive path/);
});

test("consumer execution dispatches only planned actions and verifies installed versions", () => {
  const result =
    bash(`release=1.2.3; system=false; tool_root="$HOME/tools"; scratch="$HOME/scratch"; architecture=amd64; node_arch=x64;
    mkdir -p "$tool_root" "$scratch" "$HOME/.local/bin";
    actions=(node copilot bicep terraform pwsh azd apex);
    command() { if [[ "$1" == -v ]]; then return 0; else builtin command "$@"; fi; };
    install_node() { printf 'ACTION node\\n'; }; github_tool() { printf 'ACTION %s\\n' "$4"; };
    install_terraform() { printf 'ACTION terraform\\n'; }; npm() { printf 'ACTION npm\\n'; };
    link_tool() { printf 'LINK %s\\n' "$2"; }; install_bootstrap_launcher() { printf 'LINK apex-bootstrap\\n'; }; minimum_version() { printf '1.0.0'; };
    tool_version() { if [[ "$1" == apex ]]; then printf '1.2.3'; else printf '9.0.0'; fi; };
    install_plan`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    result.stdout.split("\n").filter((line) => line.startsWith("ACTION")),
    ["ACTION node", "ACTION copilot", "ACTION bicep", "ACTION terraform", "ACTION pwsh", "ACTION azd", "ACTION npm"],
  );
  assert.match(result.stdout, /LINK apex-bootstrap/);
  const failed = bash(`release=1.2.3; tool_root="$HOME/tools"; actions=(terraform); command() { return 0; };
    install_terraform() { :; }; tool_version() { printf 'invalid'; }; minimum_version() { printf '1.0.0'; }; install_plan`);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Post-install verification failed/);
});

test("consumer GitHub binary install verifies the release digest before publishing its link", () => {
  const fixture = `scratch="$HOME/scratch"; tool_root="$HOME/tools"; mkdir -p "$scratch" "$tool_root" "$HOME/.local/bin";
    printf 'verified fixture' > "$HOME/asset";
    digest="$(sha256sum "$HOME/asset")"; digest="\${digest%% *}";
    jq -n --arg digest "sha256:$digest" '{assets:[{name:"bicep-linux-x64",browser_download_url:"https://github.com/Azure/bicep/releases/download/v1.0.0/bicep-linux-x64",digest:$digest}]}' > "$HOME/metadata";
    download() { case "$1" in */releases/latest) cp "$HOME/metadata" "$2" ;; *) cp "$HOME/asset" "$2" ;; esac; };`;
  const result = bash(`${fixture} github_tool Azure/bicep '^bicep-linux-x64$' bicep bicep;
    test "$(cat "$HOME/.local/bin/bicep")" = 'verified fixture';
    previous="$(readlink "$HOME/.local/bin/bicep")";
    printf 'corrupted' > "$HOME/asset";
    if (github_tool Azure/bicep '^bicep-linux-x64$' bicep bicep); then exit 91; fi;
    test "$(readlink "$HOME/.local/bin/bicep")" = "$previous"`);
  assert.equal(result.status, 0, result.stderr);
});

test("consumer archive extraction supports safe internal Node links and rejects escaping links", () => {
  const result = bash(`python3 - "$HOME" <<'PY'
import io, pathlib, sys, tarfile
root = pathlib.Path(sys.argv[1])
for name, target in [('safe', 'node'), ('unsafe', '../../outside')]:
    with tarfile.open(root / (name + '.tar'), 'w') as archive:
        entry = tarfile.TarInfo('bin/node'); entry.size = 4
        archive.addfile(entry, io.BytesIO(b'node'))
        link = tarfile.TarInfo('bin/npm'); link.type = tarfile.SYMTYPE; link.linkname = target
        archive.addfile(link)
PY
    mkdir "$HOME/safe" "$HOME/unsafe";
    extract_archive "$HOME/safe.tar" "$HOME/safe";
    test "$(cat "$HOME/safe/bin/npm")" = node;
    if extract_archive "$HOME/unsafe.tar" "$HOME/unsafe"; then exit 91; fi`);
  assert.equal(result.status, 0, result.stderr);
});

test("bootstrap launcher binds an existing APEX outside the installer directory and preserves arguments", () => {
  const result = bash(`tool_root="$HOME/tools"; mkdir -p "$tool_root" "$HOME/external bin" "$HOME/.local/bin";
    printf '%s\\n' '#!/usr/bin/env bash' 'printf "ARG <%s>\\n" "$@"' > "$HOME/external bin/apex";
    chmod u+x "$HOME/external bin/apex"; export PATH="$HOME/external bin:$PATH";
    install_bootstrap_launcher; install_bootstrap_launcher;
    "$HOME/.local/bin/apex-bootstrap" --project 'name with spaces' --yes;
    printf 'manual edit\\n' > "$tool_root/apex-bootstrap";
    if install_bootstrap_launcher; then exit 91; fi;
    test "$(cat "$tool_root/apex-bootstrap")" = 'manual edit'`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ARG <bootstrap>\nARG <--project>\nARG <name with spaces>\nARG <--yes>/u);
  assert.match(result.stderr, /preserve it for review/u);
});

test("consumer installer lock blocks concurrent execution and completed runs release it", () => {
  const prelude = `require_host() { :; }; minimum_version() { printf '1.0.0'; };
    plan() { actions=(); blocked=0; }; install_plan() { printf 'EXECUTED\\n'; };`;
  const blocked = bash(`${prelude} mkdir -p "$HOME/.local/share/apex-install/install.lock";
    main --version 1.2.3 --install --yes`);
  assert.equal(blocked.status, 1);
  assert.doesNotMatch(blocked.stdout, /EXECUTED/);
  const rerun = bash(`${prelude} (main --version 1.2.3 --install --yes);
    test ! -e "$HOME/.local/share/apex-install/install.lock";
    (main --version 1.2.3 --install --yes)`);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.equal((rerun.stdout.match(/EXECUTED/g) ?? []).length, 2);
});

test("consumer package installs use fresh prefixes and cannot publish after npm failure", () => {
  const result = bash(`release=1.2.3; tool_root="$HOME/tools"; actions=(apex); mkdir -p "$tool_root/apex-1.2.3";
    printf 'preserve' > "$tool_root/apex-1.2.3/user-file";
    command() { return 0; }; npm() { printf 'PREFIX %s\\n' "$4"; return 7; };
    link_tool() { printf 'UNEXPECTED_LINK\\n'; }; if install_plan; then exit 91; fi;
    test "$(cat "$tool_root/apex-1.2.3/user-file")" = preserve`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PREFIX .*apex-1\.2\.3\.[A-Za-z0-9]+/u);
  assert.doesNotMatch(result.stdout, /UNEXPECTED_LINK/u);
});

test("consumer dispatch stops after a failed helper even under conditional invocation", () => {
  const result = bash(`release=1.2.3; actions=(bicep apex); node_arch=x64;
    command() { return 0; }; github_tool() { return 7; }; npm() { printf 'UNEXPECTED_NPM\\n'; };
    tool_version() { printf '9.0.0'; }; if install_plan; then exit 91; fi`);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /UNEXPECTED_NPM|verified/u);
});

test("consumer Node installation preserves a compatible npm and host actions cannot be overridden", () => {
  const result = bash(`tool_root="$HOME/tools"; scratch="$HOME/scratch"; node_arch=x64; actions=(node);
    mkdir -p "$tool_root" "$scratch"; minimum_version() { printf '1.0.0'; };
    download() { printf '${"a".repeat(64)}  node-v1.0.0-linux-x64.tar.xz\\n' > "$2"; };
    verify_download() { :; }; extract_archive() { :; }; link_tool() { printf 'LINK %s\\n' "$2"; };
    install_node`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "LINK node");
  const host = bash(`require_host() { :; }; minimum_version() { printf '1.0.0'; };
    command() { if [[ "$1" == -v && "$2" == code ]]; then return 1; elif [[ "$1" == -v ]]; then printf '/usr/bin/%s\\n' "$2"; else builtin command "$@"; fi; };
    tool_version() { if [[ "$1" == apex ]]; then printf '1.2.3'; else printf '9.0.0'; fi; };
    install_plan() { exit 91; }; main --version 1.2.3 --install --yes --replace-incompatible`);
  assert.equal(host.status, 1);
  assert.match(host.stdout, /host-action/);
});
