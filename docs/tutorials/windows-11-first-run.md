# Windows 11 First Run

> [Current Version](../../VERSION.md) | Create an Azure-ready APEX workspace from Windows 11 with WSL2 and Ubuntu.

Complete [Prepare Windows 11](../how-to/prepare-windows-11.md) before starting. This tutorial creates local APEX state
and prepares a selected Azure subscription; it does not deploy Azure resources.

## Create A Workspace

In Ubuntu WSL, create a workspace inside your Linux home directory:

```bash
mkdir -p ~/src/apex-payments
cd ~/src/apex-payments
```

Choose an installation route.

### Global CLI

Install APEX once for repeated use:

```bash
npm install -g @apex/cli
apex version --json
```

### One-Shot npm Command

Use this when you do not want a global APEX installation:

```bash
npx --yes @apex/cli version --json
```

For a private registry, complete the npm registry setup in [Prepare Windows 11](../how-to/prepare-windows-11.md) first.

## Choose A Client

Select one client projection for this workspace. Both clients use the same kernel-owned `.apex` state.

| Client      | Client value            | Use it when                                                        |
| ----------- | ----------------------- | ------------------------------------------------------------------ |
| VS Code     | `github-copilot-vscode` | You want the VS Code agent picker and VS Code-only worker support. |
| Copilot CLI | `github-copilot-cli`    | You want terminal-based Copilot interaction.                       |

## Bootstrap With VS Code

Install the optional profile bootstrap agent once:

```bash
apex profile install --client github-copilot-vscode --yes
```

Open the workspace from WSL:

```bash
code .
```

In VS Code:

1. Confirm the folder is trusted and that GitHub Copilot Chat is signed in.
2. Open Copilot Chat and select **APEX Bootstrap** from the agent picker.
3. Provide the project name, environment, Azure target, and either Bicep or Terraform when asked.
4. Explicitly approve Git initialization if the folder is not already a repository.
5. Reload the VS Code window when prompted.
6. Select the workspace **APEX** agent and continue with requirements.

The profile agent runs the same bootstrap command shown below. It does not manage `.apex`, workspace agents, or MCP
configuration directly.

## Bootstrap With Copilot CLI

From the workspace terminal, initialize the VS Code or Copilot CLI projection directly. This example selects Bicep:

```bash
apex bootstrap \
  --project payments \
  --name "Payments platform" \
  --environment dev \
  --target "resource-group:payments-dev" \
  --iac bicep \
  --client github-copilot-cli \
  --create-repo \
  --yes
```

For Terraform, replace `--iac bicep` with `--iac terraform`. If a Git repository already exists, omit `--create-repo`.

Start Copilot CLI in the same directory, select the APEX agent, and continue the project. Copilot CLI does not include
VS Code-only autonomous workers.

## Verify The Workspace

After either bootstrap route, run:

```bash
apex setup --json
apex doctor --json
apex status --json
apex task next --json
```

The bootstrap command records the exact APEX runtime in workspace `devDependencies`, updates the npm lockfile, installs
one client projection, and creates the first project/run. Do not edit `.apex` directly.

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
