# Complete The First Local Run

> [Current Version](../../VERSION.md) | Initialize APEX vNext and inspect deterministic state without Azure changes.

This tutorial uses the repository build and the fake provider boundary. It does not deploy infrastructure or grant
release authority.

This source-build tutorial is for local candidate evaluation. Normal consumers install released packages without a
devcontainer or source clone: the [Windows 11 first run](windows-11-first-run.md) for VS Code or the GitHub Copilot app,
and the [Copilot CLI on WSL2 runbook](wsl2-vscode-consumer-runbook.md) for Copilot CLI. No plugin release is published
yet, so this tutorial installs the plugin you build.
The fake provider is not evidence of either an ALZ-backed or standalone Azure deployment.

## Prerequisites

- Node.js 24.21.0 (LTS) or newer
- npm compatible with the selected Node release
- Git
- a clean directory outside the APEX source repository

## Pack The Runtime

From the APEX vNext repository:

```bash
npm ci
npm run pack:vnext
```

The command writes matching package tarballs and `release-manifest.json` under `dist/vnext-packages/`.

## Build The Agent Plugin Package

`plugin/package-manifest.json` drives a byte-reproducible Agent Plugins 1.0 build:

```bash
npm run build:plugin
npm run test:plugin
```

The build writes `dist/apex-plugin/` and its tree hash to `dist/apex-plugin.sha256`. The package holds `plugin.json`,
`mcp.json`, `skills/`, the APEX agent and hidden workers under `com.github.copilot/agents/`, the managed hooks under
`com.github.copilot/hooks/`, `assets/`, `native/`, and `mcp/apex.mjs`: one esbuild bundle of the MCP server and its
npm dependencies, about 3 MB. Clients start it with `node ${PLUGIN_ROOT}/mcp/apex.mjs`; it reads `assets/` next to
`mcp/` and needs no `node_modules`, `npm` or network.

`native/resvg-js/` holds the prebuilt `@resvg/resvg-js` binaries that render PNG diagrams, about 8.5 MB: `linux-x64`
(glibc, for the Copilot CLI on Linux and WSL2) and `win32-x64` (VS Code and the Copilot app on Windows), with their
MPL-2.0 `LICENSE` and a `manifest.json` naming each source tarball. The build takes them from the npm tarballs pinned
in `package-lock.json` and checks each tarball's lockfile integrity. Under `npm run` it reads the npm cache first, then
`node_modules/.cache/apex-plugin-native/`, and downloads from the lockfile URL only when neither has the tarball. The
bundle carries each binary's SHA-256 and loads a binary only when its hash matches. On other platforms, on musl Linux,
or when a binary is missing or altered, the plugin writes Python and SVG diagrams and the review `README.md` reports
PNG as unavailable.

### Install Smoke

`npm run test:plugin-install` builds the package, then installs it with the Copilot CLI (`copilot plugin install
<absolute path to dist/apex-plugin>`). It runs in a throwaway sandbox under the OS temp directory: `HOME` and
`COPILOT_HOME` point into it, so your own Copilot configuration is never read or changed, and the sandbox is deleted
afterwards (`--keep` keeps it). A local-path install needs no Copilot sign-in, token or secret. The CLI copies the
package verbatim to `$COPILOT_HOME/installed-plugins/_direct/apex-plugin/` and records it in `$COPILOT_HOME/config.json`.

The smoke checks that the installed tree hash equals `dist/apex-plugin.sha256` and that the agents, skills, managed
hooks and `mcp.json` are present. It then starts the installed server as `mcp.json` declares it, with
`${PLUGIN_ROOT}` set to the installed folder and only `PATH`, `PLUGIN_ROOT` and `HOME` in the environment. Over stdio it
sends `server/discover` (protocol `2026-07-28`), `tools/list`, and `tools/call status` for a temporary git workspace,
and compares the status with `apex status`. The `ci` job runs it on Linux after `npm install --global
@github/copilot@<exact version>`; `--cli-version` fails the smoke when a different CLI answers. Native Windows Copilot
CLI is unsupported, so the Windows lane does not run it. The CLI warns that direct (non-marketplace) installs are
deprecated.

### Managed Hooks

The plugin ships `com.github.copilot/hooks/hooks.json` and one dependency-free Node script, `apex-hook.mjs`. The
`preToolUse` entry matches the `task` tool and the tools of the plugin's `apex-azure-pricing` server. Its `bash` command
runs `node "${PLUGIN_ROOT}/com.github.copilot/hooks/..."` and its `powershell` command (Windows PowerShell 5.1 or
PowerShell 7) runs the same script from `$env:PLUGIN_ROOT`, so paths with spaces stay one argument. The client writes
the hook payload to stdin; the script denies a `task` call whose `agent_type` names the user-facing APEX agent
(`apex:apex`, `APEX`) with `permissionDecision: "deny"` and a reason. It also denies every `apex-azure-pricing` tool
except the read-only pricing and cost tools, because a plugin cannot give a remote MCP server a tool allowlist and the
server's toolsets include writes such as `create_budget`. Copilot CLI names these tools `apex-azure-pricing-<tool>`; the
script also reads the `/`, `:`, `mcp__<server>__` and `mcp_<server>_` forms and denies names on that server it cannot
read. `build-plugin.mjs` embeds the read allowlist from `managedPolicy.candidateReadAllowlist` in
`tools/registry/arm-mcp-cost-pricing.v1.json`; an unbuilt script allows no pricing tool. Hidden workers such as
`apex:apex-codegen`, built-in agents and every other tool get no output, so the normal permission flow applies.

The script always exits 0, because Copilot denies a `preToolUse` call when a command hook exits non-zero. Input it
cannot parse is allowed (fail open), unless a raw-text scan still reads a `task` call that targets APEX or a call to the
pricing server that is not a read tool, which it denies (fail closed for those rules). A missing script is allowed with
a warning on stderr. A missing `node` makes the command fail, so the client denies the matched calls only. Hook timeouts
always fail open in Copilot. The hook guards against agent mistakes; kernel authorization stays the security boundary.

## Create A Consumer Repository

```bash
mkdir apex-consumer
cd apex-consumer
git init
npm init --yes
npm install --ignore-scripts --no-audit --no-fund \
  /path/to/apex-vnext/dist/vnext-packages/*.tgz
npx apex version --json
```

Install the complete package set from one qualified build. Do not mix tarballs from different commits.

## Initialize A Project

```bash
npx apex init \
  --project demo \
  --risk-owner partner \
  --name "Demo workload" \
  --environment dev \
  --target local \
  --iac bicep \
  --json
```

This writes `.github/copilot/settings.json`, the instructions, the governance workflow and scripts, and `.apex/`. The
settings file enables the `apex` plugin from the `apex-plugins` marketplace, which carries the APEX agent, skills and MCP
servers; trust the folder when Copilot asks. To select Terraform, replace `--iac bicep` with `--iac terraform`.

The marketplace has no release yet, so install the plugin you built, once per machine:

```bash
copilot plugin install /path/to/apex-vnext/dist/apex-plugin
copilot plugin list
```

Copilot CLI warns that direct installs are deprecated. Run `copilot plugin uninstall apex` before you install a
marketplace release. In VS Code on Windows, run **Developer: Restart Local Agent Host** after the install;
[Manage installation](../how-to/manage-installation.md) covers update and reset for each host.

## Check Readiness

```bash
npx apex setup --json
npx apex doctor --json
npx apex status --json
npx apex capability list --json
```

`setup` and `doctor` should report local prerequisites and managed-file state. Do not use `setup --live` for this local
tutorial because it checks Azure CLI authentication.

## Inspect The First Workflow Result

```bash
npx apex task next --json
```

A new project normally needs requirements input. Start Copilot CLI with `copilot --agent apex` and ask APEX to
continue the project. It reads kernel state, loads the same-agent stage skill for the next step, and stops at the next
gate or user-owned question.

Do not edit `.apex` directly or infer progress from chat history.

## Stop Safely

This tutorial creates local project state only. To remove managed client files while retaining audit state:

```bash
npx apex customizations uninstall --json
```

Delete the disposable consumer repository only when its local state is no longer needed.

## Related

- [Windows 11 first run](windows-11-first-run.md) - start APEX in VS Code or the app on native Windows.
- [Copilot CLI on WSL2 runbook](wsl2-vscode-consumer-runbook.md) - start APEX in Copilot CLI.
- [Manage installation](../how-to/manage-installation.md)
- [Run the workflow](../how-to/run-workflow.md)
- [CLI commands](../reference/cli.md)
