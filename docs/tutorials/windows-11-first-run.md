# Windows 11 First Run

> [Current Version](../../VERSION.md) | Create an Azure-ready APEX workspace from Windows 11 with WSL2 and Ubuntu.

Complete [Prepare Windows 11](../how-to/prepare-windows-11.md) before starting. This tutorial creates local APEX state
and prepares a selected Azure subscription; it does not deploy Azure resources.

No Docker or devcontainer is required. Before workload planning, distinguish an ALZ-backed subscription with supplied
platform resources from a standalone lab/demo. Both profiles obey Azure Policy; the full profile and COE adaptation
experience is [planned work](../explanation/workflow-and-gates.md#planned-coe-reuse-and-change), not an extra init flag.

## Install The Published Preview

Install the published preview from npm. Use the explicit `next` dist-tag rather than an unqualified package version:

```bash
npm install --global @apexops/cli@next
apex version --json
```

For the complete WSL2 and VS Code consumer route, follow the
[WSL2 and VS Code consumer runbook](wsl2-vscode-consumer-runbook.md).

## Create A Workspace

In Ubuntu WSL, create one consumer repository inside your Linux home directory. The repository can hold multiple
workloads; its folder name identifies the consumer, not a single workload:

```bash
mkdir -p ~/src/contoso-platform
cd ~/src/contoso-platform
apex bootstrap --project payments --create-repo --yes
```

## Choose Where To Run APEX

The workspace receives one Copilot CLI projection, and both hosts use the same kernel-owned `.apex` state.

| Host                    | How to start                                                       | Use it when                        |
| ----------------------- | ------------------------------------------------------------------ | ---------------------------------- |
| Copilot CLI             | Run `copilot --agent apex` in the workspace terminal               | You work in a terminal, and on WSL |
| VS Code Copilot harness | Start a chat with the session target set to Copilot; pick **APEX** | You prefer VS Code, outside WSL    |

Over WSL, VS Code `1.139.0` with Copilot Chat `0.67.0` does not apply a picked agent yet, so use Copilot CLI there.

## Initialize The Workspace

From the workspace terminal, initialize the projection directly. This example selects Bicep:

```bash
npx apex init \
  --project payments \
  --name "Payments platform" \
  --environment dev \
  --target "resource-group:payments-dev" \
  --iac bicep \
  --json
```

For Terraform, replace `--iac bicep` with `--iac terraform`. The initialized workspace contains the CLI projection and
`.mcp.json`.

Start Copilot CLI in the same directory with `copilot --agent apex` and continue the project. Ask APEX what is next at
any point; it names the owning agent and prints `/agent <name>` with a scope prompt to paste after you switch.

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

Confirm the identity has the least-privilege access required for the requested operation and supplied-resource usage.
The displayed direct assignments are not a complete effective-access check. Subscription Owner is not a universal
consumer requirement; resolve missing access with the platform owner rather than changing the landing-zone foundation.

## Continue Safely

Use the visible APEX coordinator to capture requirements. APEX will not deploy resources from this tutorial. Preview,
approval, and deployment are separate governed steps.

## Related

- [Prepare Windows 11](../how-to/prepare-windows-11.md) - install and verify the operating-system prerequisites.
- [Run the workflow](../how-to/run-workflow.md) - progress a selected project through its tasks and gates.
- [Operate a project](../how-to/operate-project.md) - create previews and perform explicitly approved operations.
