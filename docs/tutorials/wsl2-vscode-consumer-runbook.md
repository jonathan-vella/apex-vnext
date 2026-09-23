# WSL2 And VS Code Consumer Runbook

> [Current Version](../../VERSION.md) | Install the published APEX preview in Ubuntu on WSL2
> and start APEX in Copilot CLI or VS Code.

This runbook installs the published preview from npm and creates one APEX workspace with the Copilot CLI projection,
which standalone Copilot CLI and the VS Code Copilot harness both run. It creates local project state only; it does not
deploy Azure resources.

Docker, a devcontainer and the APEX source repository are not required. npm is the current route; plugin and APEX MCP
redistribution work comes at the end of the [roadmap](../vnext/ROADMAP.md#phase-6-distribution-last).

## Prepare Windows And Ubuntu

Open PowerShell as an administrator and install Ubuntu on WSL2 when it is not already installed:

```powershell
wsl --install -d Ubuntu
```

Restart Windows when prompted. Open **Ubuntu**, create your Linux user, then install the base tools:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl git
```

Keep APEX workspaces in the Linux filesystem, such as `~/src`, rather than under `/mnt/c`.

## Install VS Code And Copilot

Install VS Code on Windows:

```powershell
winget install Microsoft.VisualStudioCode
```

In VS Code, install **WSL**, **GitHub Copilot**, and **GitHub Copilot Chat**. Sign in to the GitHub account that has a
Copilot entitlement.

From Ubuntu, verify that the VS Code command opens a WSL window:

```bash
code --version
```

If the command is unavailable, open VS Code on Windows, install the WSL extension, then run **WSL: Connect to WSL**
from the Command Palette before retrying.

Install and authenticate GitHub Copilot CLI in Ubuntu as described in
[Prepare Windows 11](../how-to/prepare-windows-11.md#verify-readiness). APEX agents run in Copilot CLI.

## Install Node.js

Install Node.js 26.9.0 or later in Ubuntu. The Linux runtime is separate from any Node.js installation on Windows:

```bash
NVM_VERSION=v0.40.1
NVM_INSTALL_SHA256=abdb525ee9f5b48b34d8ed9fc67c6013fb0f659712e401ecd88ab989b3af8f53
curl --fail --silent --show-error --location \
  "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" \
  --output /tmp/nvm-install.sh
printf '%s  %s\n' "$NVM_INSTALL_SHA256" /tmp/nvm-install.sh | sha256sum --check --status
bash /tmp/nvm-install.sh
rm /tmp/nvm-install.sh
source ~/.bashrc
nvm install 24
nvm use 24
node --version
npm --version
```

## Create The Workspace

Create one consumer repository in Ubuntu and open it in the WSL-connected VS Code window. This repository can hold
multiple APEX workloads; choose a name for the consumer or business entity, not the first workload:

```bash
mkdir -p ~/src/contoso-platform
cd ~/src/contoso-platform
code .
```

Trust the folder when VS Code asks. In its integrated WSL terminal, bootstrap the published preview and create a Git
repository boundary:

```bash
npx --yes @apexops/cli@next bootstrap \
  --project payments \
  --create-repo \
  --yes
```

The command installs the exact APEX CLI as a workspace dependency, creates `.apex` state, and writes the Copilot
CLI projection and `.mcp.json`. Do not edit `.apex` directly.

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
next at any point; it names the owning agent and prints `/agent <name>` with a scope prompt to paste after you switch.
The agents read the kernel-owned workspace state; they do not grant deployment approval or configure cloud resources on
their own.

In VS Code, start a chat with the session target set to Copilot and pick **APEX** in the Agent picker. Over WSL, VS Code
`1.139.0` with Copilot Chat `0.67.0` does not apply a picked agent yet, so use Copilot CLI there.

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
[Prepare Windows 11](../how-to/prepare-windows-11.md) to install Azure CLI and select either Bicep or Terraform.
Authenticate only to the intended subscription and confirm the required role before requesting a real deployment
preview.

APEX agents use only their explicit read-only ARM pricing and cost tools from the workspace `.mcp.json`.

## Update Or Remove APEX

From the workspace terminal, inspect the installed preview and managed files:

```bash
npx apex version --json
npx apex update --json
npx apex doctor --json
```

To remove managed client files while retaining project history and local state, run:

```bash
npx apex customizations uninstall --json
```

## Related

- [Prepare Windows 11](../how-to/prepare-windows-11.md) - install Azure and IaC prerequisites for Azure-ready work.
- [Manage installation](../how-to/manage-installation.md) - update, roll back, reinstall, or remove managed files.
- [Run the workflow](../how-to/run-workflow.md) - continue the kernel-governed project workflow.
- [Client support](../reference/client-support.md) - understand supported client boundaries.
