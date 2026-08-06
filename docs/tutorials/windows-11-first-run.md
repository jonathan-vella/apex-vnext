# Windows 11 First Run

> [Current Version](../../VERSION.md) | Create an Azure-ready APEX workspace from Windows 11 with WSL2 and Ubuntu.

Complete [Prepare Windows 11](../how-to/prepare-windows-11.md) before starting. This tutorial creates local APEX state
and prepares a selected Azure subscription; it does not deploy Azure resources.

## Build The Preview Candidate

APEX is not yet published to the public npm registry. Build matching package tarballs from the APEX source repository:

```bash
mkdir -p ~/src
cd ~/src
git clone https://github.com/jonathan-vella/apex-vnext.git
cd apex-vnext
npm ci
npm run pack:vnext
```

The package set is written under `dist/vnext-packages/`. Do not mix tarballs from different builds.

## Create A Workspace

In Ubuntu WSL, create a separate local workspace inside your Linux home directory:

```bash
mkdir -p ~/src/apex-payments
cd ~/src/apex-payments
git init
npm init --yes
npm install --ignore-scripts --no-audit --no-fund \
  ~/src/apex-vnext/dist/vnext-packages/*.tgz
npx apex version --json
```

> [!NOTE]
> The global `npm install -g @apex/cli`, one-shot `npx @apex/cli`, and VS Code profile bootstrap paths require a
> published APEX package. They are not available for this local preview candidate.

## Choose A Client

Select one client projection for this workspace. Both clients use the same kernel-owned `.apex` state.

| Client      | Client value            | Use it when                                                        |
| ----------- | ----------------------- | ------------------------------------------------------------------ |
| VS Code     | `github-copilot-vscode` | You want the VS Code agent picker and VS Code-only worker support. |
| Copilot CLI | `github-copilot-cli`    | You want terminal-based Copilot interaction.                       |

## Initialize With VS Code

Open the workspace from WSL:

```bash
code .
```

In VS Code:

1. Confirm the folder is trusted and that GitHub Copilot Chat is signed in.
2. In the integrated WSL terminal, initialize the workspace:

   ```bash
   npx apex init \
     --project payments \
     --name "Payments platform" \
     --environment dev \
     --target "resource-group:payments-dev" \
     --iac bicep \
     --client github-copilot-vscode \
     --json
   ```

3. Reload the VS Code window.
4. Select the workspace **APEX** agent and continue with requirements.

The initialized workspace contains the VS Code projection and MCP configuration. Do not install the profile bootstrap
agent for a local candidate because its version-pinned `npx` command requires a published package.

## Bootstrap With Copilot CLI

From the workspace terminal, initialize the VS Code or Copilot CLI projection directly. This example selects Bicep:

```bash
npx apex init \
  --project payments \
  --name "Payments platform" \
  --environment dev \
  --target "resource-group:payments-dev" \
  --iac bicep \
  --client github-copilot-cli \
  --json
```

For Terraform, replace `--iac bicep` with `--iac terraform`.

Start Copilot CLI in the same directory, select the APEX agent, and continue the project. Copilot CLI does not include
VS Code-only autonomous workers.

## Verify The Workspace

After either bootstrap route, run:

```bash
npx apex setup --json
npx apex doctor --json
npx apex status --json
npx apex task next --json
```

The initialization command installs one client projection and creates the first project/run. Do not edit `.apex`
directly.

## Confirm Azure Readiness

Before requesting a real preview, verify the selected subscription and chosen IaC tool:

```bash
az account show --output table
az role assignment list \
  --assignee "$(az ad signed-in-user show --query id --output tsv)" \
  --scope "/subscriptions/$(az account show --query id --output tsv)" \
  --query "[].roleDefinitionName" \
  --output tsv
```

For Bicep:

```bash
az bicep version
```

For Terraform:

```bash
terraform version
```

Confirm the output includes **Owner** for the selected subscription before starting Azure-ready work.

## Continue Safely

Use the visible APEX coordinator to capture requirements. APEX will not deploy resources from this tutorial. Preview,
approval, and deployment are separate governed steps.

## Related

- [Prepare Windows 11](../how-to/prepare-windows-11.md) - install and verify the operating-system prerequisites.
- [Run the workflow](../how-to/run-workflow.md) - progress a selected project through its tasks and gates.
- [Operate a project](../how-to/operate-project.md) - create previews and perform explicitly approved operations.
