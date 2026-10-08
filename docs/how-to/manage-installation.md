# Manage Installation

> [Current Version](../../VERSION.md) | Install, update and reset APEX on each supported host and manage workspace files.

APEX has two parts on each machine:

- the `apex` plugin, which carries the APEX agent, its hidden workers, skills, managed hooks and MCP servers;
- the `@apexops/cli` npm package, whose `apex` command writes, updates and checks the workspace files.

Each plugin release bundles the `@apexops/cli` version published to npm with the same version number. Keep the
workspace CLI at the version of the installed plugin.

> [!IMPORTANT]
> **Release status.** No `apex` plugin release has been published yet. The
> [apex-plugins](https://github.com/jonathan-vella/apex-plugins) marketplace lists no plugins, so the plugin install
> commands on this page, and the install that a workspace's `.github/copilot/settings.json` requests, find nothing to
> install until the first release. The published `@apexops/cli@next` preview predates the plugin and still copies agents,
> skills and MCP configuration into the workspace. Until both are released, evaluate the current behavior with a
> [local candidate](#install-a-local-candidate). Live qualification of the three clients is still pending.

## Choose One Host Per Workspace

| Host                             | Platform                | Requirement            | Start APEX                                                |
| -------------------------------- | ----------------------- | ---------------------- | --------------------------------------------------------- |
| VS Code with the Copilot harness | Windows 11 25H2 or 24H2 | VS Code 1.140 or later | Set the session target to **Copilot**, then pick **APEX** |
| GitHub Copilot app               | Windows 11 25H2 or 24H2 | Project sandbox on     | Start a local session in the project with **APEX**        |
| GitHub Copilot CLI               | Linux or WSL2           | Bubblewrap for sandbox | Run `copilot --agent apex` in the workspace               |

Copilot CLI on native Windows and the VS Code **Local** harness are not supported. VS Code and the app on macOS or Linux
desktops are best effort and not qualified. Use one host per workspace: a run does not move between a Windows client
and Copilot CLI in WSL2.

Prepare Windows with [Prepare Windows 11](prepare-windows-11.md). It covers native Windows for VS Code and the app, and
WSL2 for Copilot CLI.

## Turn On Local Sandboxing

APEX assumes that the client's local sandboxing is on and does not check it. Turn it on before you start APEX and keep
outbound network access allowed. With the sandbox on, you can use the **Allow all** permission level; gate decisions
still come from you. If your Copilot license comes from an enterprise, managed settings can control these options.

- **VS Code.** Set `chat.agent.sandbox.enabled` to `on` (the default is `off`) and start a new Copilot session. Leave
  `chat.agent.sandbox.network.allowNetwork` at its default, `true`. On Windows, sandboxing needs the September 2026
  Windows security update, and VS Code marks Windows support as experimental. **Permissions** > **Sandboxing for
  terminal** in a session changes that session only.
- **GitHub Copilot app.** Sandboxing is a per-project setting and is off by default; APEX cannot turn it on for you. Open
  **Settings**, select the project under **Projects**, and turn on **Sandbox new sessions** under **Sandbox**. Leave
  **Outbound internet** on. The setting applies to new sessions. The app documents Windows 11 25H2 with update
  KB5124010 or later; on 24H2, check that the app reports the sandbox as available. If the app shows **Sandbox
  unavailable**, fix the reported problem and select **Retry sandbox**.
- **Copilot CLI.** In a session, run `/sandbox enable`, or set `sandbox.enabled` to `true` in
  `~/.copilot/settings.json`. On Linux and WSL2, first install Bubblewrap 0.5.0 or later, `slirp4netns` and the other
  namespace tools that `copilot help sandbox` lists; on Ubuntu, start with `sudo apt install bubblewrap slirp4netns`.
  WSL1 cannot run Bubblewrap.

## Install The Plugin

Install the plugin once per machine through one channel: the Copilot CLI plugin store in `~/.copilot`
(`%USERPROFILE%\.copilot` on Windows). Copilot CLI and the GitHub Copilot app install into that store, and VS Code reads
it. Do not also install APEX from the VS Code **Agent Plugins** marketplace view; VS Code would list two APEX entries
and enable only one. Windows and WSL2 keep separate stores, so install in the one your host uses.

### Windows: VS Code Or The App

On Windows, Copilot CLI only manages the plugin store; run APEX in VS Code or the app. Install it with
`winget install GitHub.Copilot` and sign in with `copilot login` if needed. Close every VS Code window, because VS Code
locks the installed plugin folder (see [Update The Plugin](#update-the-plugin)), then run in PowerShell:

```powershell
copilot plugin marketplace add jonathan-vella/apex-plugins
copilot plugin install apex@apex-plugins
copilot plugin list
```

Open VS Code, run **Developer: Restart Local Agent Host** from the Command Palette and start a new chat. In the
Extensions view, search `@agentPlugins` and check that exactly one `apex` entry is listed. In the app, start a new
session.

### Linux Or WSL2: Copilot CLI

```bash
copilot plugin marketplace add jonathan-vella/apex-plugins
copilot plugin install apex@apex-plugins
copilot plugin list
```

You can skip the explicit install. In a workspace that `apex init` set up, Copilot CLI installs the plugin that
`.github/copilot/settings.json` enables and activates it only in that repository. Trust the folder when Copilot asks.

## Initialize A Workspace

Install `@apexops/cli` at the plugin's version, then run `apex bootstrap` or `apex init` in the workspace. They write a
thin workspace projection:

- `.github/copilot/settings.json`, which enables `apex@apex-plugins` from the `jonathan-vella/apex-plugins`
  marketplace;
- `.github/copilot-instructions.md` and the `.github/instructions/` files, scoped with `applyTo`;
- the governance workflow, script and schema;
- `.apex/`, with the runtime, the managed-file lock and project state.

The workspace gets no copied agents, skills or `.mcp.json`; the plugin provides them. `github-copilot-cli` is the only
client value, whichever host you use. Do not edit `.apex` directly.

The [Windows 11 first run](../tutorials/windows-11-first-run.md) walks through a native Windows workspace, and the
[Copilot CLI on WSL2 runbook](../tutorials/wsl2-vscode-consumer-runbook.md) through a Linux one.

### Bootstrap A Workspace

Run `apex bootstrap` (or `apex-bootstrap` after machine installation) in an interactive terminal to start guided setup.
`apex bootstrap wizard` selects the same flow explicitly. Optionally supply a remote COE URL and exact commit, select
one or more listed workload numbers, and review each copy and workspace installation plan before confirming it.
Bootstrap does not ask for or invent a project ID, environment, workload target or IaC track. Each selected copy uses
a separate workspace; the APEX agent gathers details and creates the first project later. Enter `cancel` to stop;
completed copies and configured workspaces are retained. Declining a plan does not execute it.

The wizard can collect consumer-governance identity inputs and display the evidence-bound OIDC plan, or record that a
central reviewed baseline will be used. Target-bound baseline checks are deferred until a project and target exist;
bootstrap must not invent them to validate a baseline. For a reused approved identity, the wizard can show a
verified provisioning plan and separately ask to create only its missing exact federation and Reader assignment.
It does not create GitHub repositories or new Azure identities, dispatch collection, import central baselines
automatically, or adopt source decisions without review. It reports these
as pending rather than claiming complete onboarding. Interactive login and client health verification remain separate.
Automation must use the typed plan/import/bootstrap commands; the wizard rejects `--yes`, `--json` and non-TTY input.

Inspect local initialization prerequisites without changing files or running commands:

```bash
apex bootstrap plan --create-repo --json
```

This bounded preflight checks the local Git boundary, workspace APEX package version and existing APEX state. It returns
`ready`, `pending` or `blocked` for those checks, with the requested configuration and its hash. The hash is not an
execution approval. Matching initialized state can be reused when selected-project settings, managed files and runtime
locks pass local checks. Partial or conflicting state remains blocked and preserved. Machine prerequisites, client
health, remote COE, GitHub, OIDC and reviewed baseline
checks are explicitly unassessed. A local `ready` result is not complete onboarding or deployment readiness.

The agreed `apex-install` and `apex-bootstrap` guided first-run experiences, remote multi-archetype selection and confirmed
OIDC setup remain under implementation. Their acceptance contract is
[first-time onboarding](../vnext/PRD.md#req-onboarding-001-first-time-install-and-repository-bootstrap).

For a published package, use either a global CLI or a one-shot command at the plugin's version. Both routes install
the exact APEX CLI as a workspace `devDependency`, update the npm lockfile, and install the CLI projection.

```bash
npm install -g @apexops/cli@PLUGIN_VERSION
apex bootstrap --create-repo --yes
```

```bash
npx --yes @apexops/cli@PLUGIN_VERSION bootstrap --create-repo --yes
```

Omit `--create-repo` only when the workspace already has a `.git` boundary. Omitting `--project` leaves the workspace
without a project, selected run or workload defaults. `apex status` reports `needs_project`; `doctor` checks workspace
integrity without requiring Azure authentication, a backend or an IaC choice. Open the workspace APEX agent to gather
project details, including the `partner` or `customer` risk-owner role, and invoke `projectCreate`. Explicit
`apex init` or `project create` remains available for automation that already knows those details. Use
`--file onboarding.json --yes` for validated noninteractive workspace settings.

Repeating `bootstrap --yes` for matching, intact workspace setup returns `resumed: true`, without
reinstalling packages, rewriting managed files or creating another run. Explicitly supplied settings must match the
selected project and client; incompatible packages, manual managed-file edits or damaged state block the rerun.
This only reuses completed local initialization. It does not yet resume interrupted COE, GitHub or OIDC provisioning,
change the selected run, adopt conflicting files or repair partial state automatically.

### Install The CLI On Linux Or WSL2

Candidate packaging generates a standalone `apex-install.sh` alongside the tarballs. Its digest is recorded in
`release-manifest.json` and the provenance statement. Obtain that script and its expected digest from the approved
release channel and verify it before execution. This source template is not directly executable as an installer:
packaging substitutes the canonical Node, npm, Copilot CLI and minimum VS Code versions.

From an Ubuntu terminal, including Ubuntu on WSL2, review the plan for an exact available APEX package version:

```bash
bash apex-install.sh --version RELEASE_VERSION --plan
bash apex-install.sh --version RELEASE_VERSION --install --yes
```

The generated script runs without Node or an APEX source checkout. It checks Git, Node/npm, GitHub CLI, Copilot CLI,
Azure CLI, Bicep, Terraform, PowerShell, azd, the VS Code host command and APEX. Compatible tools are preserved. It pins
Node/npm/Copilot to the packaged toolchain minimums and retrieves other missing binary tools from official stable
releases with SHA-256 verification and safe archive extraction. APEX comes from the configured npm registry at the exact
requested version. A missing/unpublished package or unsupported Ubuntu package repository fails rather than completing.

Ubuntu package and Azure CLI repository changes require the separate `--allow-system` flag and existing noninteractive
sudo authorization. Run `sudo -v` yourself when instructed; never supply a password through an agent. Incompatible tools
require `--replace-incompatible`, which permits user-local shadowing, not removal of existing installations. Unowned files
in the install destinations block replacement. The installer does not edit shell profiles: add `~/.local/bin` to PATH in
future terminals. Successful APEX installation also provides `apex-bootstrap`, a launcher for `apex bootstrap`.

The installer does not install Windows, WSL or the APEX plugin, and does not sign in to any account. No login, repo
initialization, GitHub mutation, Azure identity/role change or deployment is executed by the installer. Concurrent
installs are blocked by an install lock; inspect a stale lock after interruption before removing it. Completed
compatible steps are retained for reruns. Current proof consists of offline safety tests and generated
package/provenance checks, not a successful clean-machine installation or complete first-run acceptance. A native
Windows installer is not available yet.

## Update APEX

Update the plugin first, then the workspace CLI and files, so both stay at the same version.

### Update The Plugin

Clients pick up a plugin update only when its version changes.

On Windows, VS Code holds the installed plugin folder open. While any VS Code window is open, `copilot plugin update`,
`copilot plugin install`, `copilot plugin uninstall` and the app's update fail with `Access is denied. (os error 5)`,
and the old version stays installed. Restarting the app does not release the lock, and neither does a reboot if VS Code
reopens at sign-in.

1. Close every VS Code window.
2. In PowerShell, run `copilot plugin update apex@apex-plugins`.
3. Open VS Code, run **Developer: Restart Local Agent Host** and start a new chat.

Running chats keep the plugin list they started with, and **Developer: Reload Window** does not restart the Agent Host.

On Linux or WSL2, run `copilot plugin update apex@apex-plugins` and start a new Copilot CLI session.

### Update Workspace Files

Install the CLI version that matches the plugin, then update the workspace:

```bash
npm install --save-dev --save-exact @apexops/cli@PLUGIN_VERSION
npx apex version --json
npx apex update --json
npx apex doctor --json
```

APEX performs a three-way update against recorded managed hashes. It reports conflicts and preserves modified files
rather than replacing them silently. Updates install an immutable runtime generation for future projects. Existing runs
remain pinned to their original generation and continue without deleting `.apex` or restarting intake. Updating APEX
does not migrate persisted contracts, reconcile consumer design changes or approve an infrastructure operation.

Use `--customizations-source /absolute/path` only to test a deliberate local source bundle. Later updates of that
selection require the same source.

A workspace created before the plugin still has copied agents, skills and `.mcp.json`. `doctor` reports each one as
`plugin-owned:<path>`. Run `apex update`, or `apex doctor --fix --yes`, once: it removes the copies you did not edit
and installs `.github/copilot/settings.json`. Edited copies stay in place and are listed under `conflicts`; move or
delete them so they do not shadow the plugin.

A workspace that still selects the retired VS Code projection fails `init` and `update` with `APEX_VALIDATION` and
reason `CLIENT_PROJECTION_RETIRED`. Run `npx apex init --client github-copilot-cli --json` there to remove unchanged
retired files and install the CLI projection; projects and runs are kept. Edited retired files stop the switch with
`APEX_CONFLICT` and are listed; move them and run the command again.

## Reset APEX

### Restart The VS Code Agent Host

VS Code runs Copilot harness sessions in the Agent Host, one shared process that outlives individual windows. After
the plugin is installed, updated or removed, or when the APEX agent or its MCP tools go missing, run **Developer:
Restart Local Agent Host** and start a new chat.

### Reinstall The Plugin

On Windows:

1. In VS Code, search `@agentPlugins` in the Extensions view and uninstall any APEX entry that did not come from the
   Copilot CLI store.
2. Close every VS Code window. This PowerShell command must print nothing:

   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Select-Object ProcessId, CommandLine
   ```

3. Run `copilot plugin uninstall apex@apex-plugins`, then `copilot plugin install apex@apex-plugins`.
4. Open VS Code, run **Developer: Restart Local Agent Host** and start a new chat.

On Linux or WSL2, run `copilot plugin uninstall apex@apex-plugins`, then `copilot plugin install apex@apex-plugins`,
and start a new session.

### Roll Back Workspace Files

```bash
npx apex customizations rollback --json
npx apex doctor --json
```

Rollback restores the prior managed bundle and removes unedited files only the current bundle installed; it reports
edited ones as conflicts. It does not downgrade persisted contracts, project journals, or deployment evidence. Restore
package and `.apex` state from a matching checkpoint if a package rollback is required.

### Uninstall Or Reinstall Workspace Files

```bash
npx apex customizations uninstall --json
npx apex customizations reinstall --json
```

Uninstall removes unchanged managed files and preserves conflicts, unrelated files, project state, and history. Reinstall
uses the recorded client selection unless a custom source is supplied.

### Remove APEX From A Machine

1. In each workspace, run `npx apex customizations uninstall --json`. Otherwise Copilot CLI installs the plugin again
   when you open that workspace, because its `.github/copilot/settings.json` enables it.
2. On Windows, close every VS Code window.
3. Run `copilot plugin uninstall apex@apex-plugins` and `copilot plugin marketplace remove apex-plugins`.

Removing the plugin does not delete `.apex/` project state or history.

## Troubleshoot

| Symptom                                                                   | Fix                                                                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Access is denied. (os error 5)` from `copilot plugin` on Windows         | Close every VS Code window and run the command again                                                      |
| APEX agent or its MCP tools missing in VS Code after a plugin change      | Run **Developer: Restart Local Agent Host** and start a new chat; then [reinstall](#reinstall-the-plugin) |
| Two `apex` entries under `@agentPlugins`                                  | Uninstall the copy that did not come from the Copilot CLI store                                           |
| **MCP: List Servers** shows the APEX server failing with `${PLUGIN_ROOT}` | That list does not run Copilot harness sessions; check `agenthost.log` under `%APPDATA%\Code\logs`        |
| `copilot plugin install apex@apex-plugins` finds no plugin                | No release is published yet; see the release status above                                                 |
| `doctor` reports `plugin-owned:<path>`                                    | Run `apex update`, then move or delete edited copies it lists                                             |
| The client reports the sandbox as unavailable                             | Install the Windows update it names, or Bubblewrap and `slirp4netns` on Linux and WSL2                    |

## Install A Local Candidate

This maintainer path builds the CLI packages and the plugin from a source checkout. Consumers install released packages
and do not need a source checkout.

Build and install every tarball from the same release manifest:

```bash
npm ci
npm run pack:vnext
cd /path/to/consumer
npm install --ignore-scripts --no-audit --no-fund \
  /path/to/apex-vnext/dist/vnext-packages/*.tgz
npx apex version --json
npx apex init --project demo --risk-owner partner --target local --json
```

Build the plugin from the same checkout and install it directly from its folder:

```bash
npm run build:plugin
copilot plugin install /path/to/apex-vnext/dist/apex-plugin
```

Copilot CLI warns that direct installs are deprecated. Remove the direct install with `copilot plugin uninstall apex`
before you install a marketplace release, so that only one copy is installed. The
[first local run](../tutorials/first-run.md) describes the build and the install smoke test.

For an approved registry release, follow [Publish npm Packages](publish-npm.md) before using the published bootstrap
route.

## Manage Capability Packs

```bash
npx apex capability list --json
```

The shipped capability-pack registry is currently empty. Do not install a retired pack or infer availability from
retained lifecycle commands. Governance uses reviewed baseline import, not local discovery or capability-pack execution;
follow the [governance baseline requirements](../vnext/PRD.md#req-gov-001-governance-and-policy).

## Related

- [Prepare Windows 11](prepare-windows-11.md) - prepare native Windows or WSL2 for your host.
- [Windows 11 first run](../tutorials/windows-11-first-run.md) - start APEX in VS Code or the app.
- [Copilot CLI on WSL2 runbook](../tutorials/wsl2-vscode-consumer-runbook.md) - start APEX in Copilot CLI.
- [Complete the first local run](../tutorials/first-run.md)
- [Client support](../reference/client-support.md)
- [Client projections](../explanation/client-projections.md)
