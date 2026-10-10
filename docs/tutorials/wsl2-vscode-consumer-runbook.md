# Copilot CLI On WSL2 Runbook

> [Current Version](../../VERSION.md) | Install APEX in Ubuntu on WSL2 and start it in GitHub Copilot CLI.

This runbook creates one APEX workspace in Ubuntu on WSL2 and runs APEX in GitHub Copilot CLI. On an Ubuntu machine
without WSL, skip the WSL installation step and run the same Ubuntu commands. It creates local project state only; it
does not deploy Azure resources.

In WSL2, Copilot CLI is the only supported APEX host. VS Code and the GitHub Copilot app run APEX on native Windows; see
the [Windows 11 first run](windows-11-first-run.md). Use one host per workspace: a run does not move between a Windows
client and Copilot CLI in WSL2. Docker, a devcontainer and the APEX source repository are not required.

> [!IMPORTANT]
> The plugin and CLI ship preview `0.11.0-next.2`; live qualification is still pending. That release predates #431.
> These steps describe the published flow. For source changes, use a
> [local candidate](../how-to/manage-installation.md#install-a-local-candidate) and the
> [human-run qualification kit](../how-to/qualify-live-clients.md); do not mix same-version source and registry bytes.

## Prepare Ubuntu

Follow the WSL2 steps in [Prepare Windows 11](../how-to/prepare-windows-11.md#prepare-wsl2-for-copilot-cli). On
Ubuntu without WSL, start at [Install Node.js And npm](../how-to/prepare-windows-11.md#install-nodejs-and-npm):

- Ubuntu on WSL2, with workspaces in the Linux filesystem, such as `~/src`, rather than under `/mnt/c`;
- Node.js 24.21.0 (LTS) or later, installed in Ubuntu and separate from any Node.js installation on Windows;
- GitHub Copilot CLI, signed in, with Bubblewrap and `slirp4netns` for its local sandbox.

Then turn on the Copilot CLI sandbox with `/sandbox enable` in a session. APEX assumes it is on and does not check it.

## Install The Plugin

Install the plugin once in this Ubuntu environment:

```bash
copilot plugin marketplace add jonathan-vella/apex-plugins
copilot plugin install apex@apex-plugins
copilot plugin list
```

A workspace that `apex init` set up also asks Copilot CLI to install the plugin, through its
`.github/copilot/settings.json`, so you can skip this step and trust the workspace folder when Copilot asks.

## Create The Workspace

Create one consumer repository in Ubuntu. This repository can hold multiple APEX workloads; choose a name for the
consumer or business entity, not the first workload. Bootstrap the APEX CLI at the plugin's version and create a Git
repository boundary:

```bash
mkdir -p ~/src/contoso-platform
cd ~/src/contoso-platform
npx --yes @apexops/cli@PLUGIN_VERSION bootstrap \
  --project payments \
  --risk-owner partner \
  --target local \
  --create-repo \
  --yes
```

The command installs the exact APEX CLI as a workspace dependency, creates `.apex` state, and writes the thin
workspace projection with `.github/copilot/settings.json`, which enables the `apex` plugin. Do not edit `.apex`
directly.

## Add Workloads To The Consumer

The `payments` value above creates the first workload project in this consumer repository. To add a workload, ask the
workspace **APEX** agent to create it. For example:

```text
Create a Terraform project named data-platform for dev, targeting local.
```

The agent uses `ask_user` to collect the project ID, display name,
environment, and IaC tool. It creates and selects a local initial run through the APEX MCP server. Later workflow
stages determine the Azure target scope before a real preview or deployment.

For the remaining project lifecycle actions, use direct prompts:

```text
List my projects.
Resume the payments project.
Delete the data-platform project.
```

APEX lists projects without questions. It asks you to select a project only when a resume or delete request does
not name one, and it asks for explicit confirmation before deleting. It refuses to delete the only remaining
project in a consumer workspace.

The equivalent deterministic CLI fallback is:

```bash
npx apex project create \
  --project data-platform \
  --risk-owner partner \
  --name "Data platform" \
  --environment dev \
  --target local \
  --iac terraform \
  --json

npx apex project list --json
npx apex project use --project payments --json
```

APEX stores workload state and artifacts by project and run under `.apex/projects/<project>/runs/<run>/`.
Code generation is staged in a run-bound `.apex/work/<run>/<task>/code/` directory, and accepted artifacts are
content-bound to that run. The current preview does not materialize the legacy `agent-output/<workload>/`,
`infra/bicep/<workload>/`, or `infra/terraform/<workload>/` directory convention automatically.

## Start APEX

For COE reuse, the target experience is to identify a COE repository, select one archetype, then ask APEX for changes.
That independent import/adaptation flow and explicit ALZ/lab profiles are [planned requirements](../vnext/PRD.md), not
features implied by copying `.apex` state. Do not copy source credentials, Terraform state/plans or approvals. Current
stage review packages are described in [Run the workflow](../how-to/run-workflow.md); their layout is not a portable
execution-state contract.

In the workspace terminal, run `copilot --agent apex` and provide the initial workload requirements. Ask APEX what is
next at any point; it reads kernel state, continues in the same APEX agent and delegates only to its hidden workers.
The agents read the kernel-owned workspace state; they do not grant deployment approval or configure cloud resources on
their own.

Verify the workspace before continuing:

```bash
npx apex version --json
npx apex setup --json
npx apex doctor --json
npx apex status --json
npx apex task next --json
```

## Add Azure Tooling When Needed

The initial local workflow does not require Azure credentials. Before an Azure-ready workflow, follow
[Prepare Windows 11](../how-to/prepare-windows-11.md#install-azure-tooling-on-ubuntu) to install Azure CLI and select
either Bicep or Terraform.
Authenticate only to the intended subscription and confirm the required role before requesting a real deployment
preview.

APEX agents use only their explicit read-only ARM pricing and cost tools from the plugin's `apex-azure-pricing`
server.

## Update Or Remove APEX

Update the plugin, then the workspace CLI and files, so both stay at the same version:

```bash
copilot plugin update apex@apex-plugins
npm install --save-dev --save-exact @apexops/cli@PLUGIN_VERSION
npx apex update --json
npx apex doctor --json
```

Start a new Copilot CLI session after a plugin update.

To remove managed client files while retaining project history and local state, run:

```bash
npx apex customizations uninstall --json
```

[Manage installation](../how-to/manage-installation.md) covers rollback, reinstall and removing the plugin.

## Related

- [Prepare Windows 11](../how-to/prepare-windows-11.md) - install Azure and IaC prerequisites for Azure-ready work.
- [Manage installation](../how-to/manage-installation.md) - update, roll back, reinstall, or remove APEX.
- [Run the workflow](../how-to/run-workflow.md) - continue the kernel-governed project workflow.
- [Client support](../reference/client-support.md) - understand supported client boundaries.
