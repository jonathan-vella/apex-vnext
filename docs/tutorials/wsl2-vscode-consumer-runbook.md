# WSL2 And VS Code Consumer Runbook

> [Current Version](../../VERSION.md) | Install the published APEX preview in Ubuntu on WSL2
> and start a VS Code workspace.

This runbook installs the published preview from npm and creates one APEX workspace with the VS Code projection. It
creates local project state only; it does not deploy Azure resources.

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

## Install Node.js

Install Node.js 24 or later in Ubuntu. The Linux runtime is separate from any Node.js installation on Windows:

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
  --client github-copilot-vscode \
  --create-repo \
  --yes
```

The command installs the exact APEX CLI as a workspace dependency, creates `.apex` state, and writes the VS Code
projection. Do not edit `.apex` directly.

## Add Workloads To The Consumer

The `payments` value above creates the first workload project in this consumer repository. Add later workloads
without creating another consumer repository or reinstalling the VS Code projection:

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

## Start APEX In VS Code

Reload the VS Code window after bootstrap. Open GitHub Copilot Chat, select the workspace **APEX** agent, and provide
the initial workload requirements. The agent reads the kernel-owned workspace state; it does not grant deployment
approval or configure cloud resources on its own.

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

The VS Code projection also includes a pinned local Azure MCP Server. After signing in with `az login`, reload the VS
Code window and refresh the Copilot tool list to start it. Its tools use your Azure RBAC permissions and can include
mutating operations, so approve tool calls deliberately. APEX agents retain their explicit, read-only ARM pricing and
cost tool grants; the broader Azure MCP Server is not implicitly granted to them.

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
