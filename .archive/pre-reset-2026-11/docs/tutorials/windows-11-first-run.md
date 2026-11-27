# Windows 11 First Run

> [Current Version](../../VERSION.md) | Create an Azure-ready APEX workspace on native Windows 11 for VS Code or the app.

This tutorial creates local APEX state on native Windows 11 and prepares a selected Azure subscription; it does not
deploy Azure resources. It uses VS Code with the Copilot harness or the GitHub Copilot app. For Copilot CLI, follow the
[Copilot CLI on WSL2 runbook](wsl2-vscode-consumer-runbook.md) instead.

No WSL, Docker or devcontainer is required. Before workload planning, distinguish an ALZ-backed subscription with
supplied platform resources from a standalone lab/demo. Both profiles obey Azure Policy; the full profile and COE
adaptation experience is [planned work](../explanation/workflow-and-gates.md#planned-coe-reuse-and-change), not an extra
init flag.

> [!IMPORTANT]
> The plugin and bundled CLI ship preview `0.11.0-next.6` (`apex@apex-plugins`).
> These steps describe the published flow. For source changes, use a
> [local candidate](../how-to/manage-installation.md#install-a-local-candidate) and the
> [human-run qualification kit](../how-to/qualify-live-clients.md).

## Before You Start

Complete the native Windows steps in [Prepare Windows 11](../how-to/prepare-windows-11.md):

- VS Code 1.140 or later, or the GitHub Copilot app, signed in with a Copilot-enabled account;
- Git, Node.js 24.21.0 (LTS) or later, Copilot CLI, Azure CLI and Bicep or Terraform;
- the `apex@apex-plugins` plugin installed once through the Copilot CLI store.

## Create A Workspace

In PowerShell, create a consumer repository and run the bundled onboarding script from the installed plugin. The
repository can hold multiple workloads; its folder name identifies the consumer, not a single workload:

```powershell
New-Item -ItemType Directory -Force C:\src\contoso-platform | Out-Null
Set-Location C:\src\contoso-platform
& "$HOME\.copilot\installed-plugins\apex-plugins\apex\scripts\onboard.ps1" --project payments --risk-owner partner --target local --create-repo --yes
node .apex\bin\apex.mjs version --json
```

Onboarding writes the thin `.apex/bin/apex.mjs` launcher and the workspace projection:
`.github/copilot/settings.json`, which enables the `apex` plugin, plus the instructions, the governance workflow and
`.apex/`. Do not edit `.apex` directly.

To set the project details yourself, initialize the workspace directly. This example selects Bicep; for Terraform,
replace `--iac bicep` with `--iac terraform`:

```powershell
node .apex\bin\apex.mjs init --project payments --risk-owner partner --name "Payments platform" `
  --environment dev --target local --iac bicep --json
```

## Start APEX

In VS Code:

1. Open the workspace folder with `code .` and trust it when VS Code asks.
2. If you installed or updated the plugin while VS Code was open, run **Developer: Restart Local Agent Host**.
3. Open a new chat, set the session target to **Copilot** and pick **APEX** in the Agent picker.

In the GitHub Copilot app, add `C:\src\contoso-platform` as a project and start a new local session with the **APEX** agent.

Ask APEX what is next at any point. It reads kernel state, continues in the same APEX agent and delegates only to its
hidden workers.

## Verify The Workspace

In the workspace, run:

```powershell
node .apex\bin\apex.mjs setup --json
node .apex\bin\apex.mjs doctor --json
node .apex\bin\apex.mjs status --json
node .apex\bin\apex.mjs task next --json
```

The initialization command installs one client projection and creates the first project and run.

## Confirm Azure Readiness

Before requesting a real preview, verify the selected subscription and chosen IaC tool:

```powershell
az account show --output table
$userId = az ad signed-in-user show --query id --output tsv
$subscriptionId = az account show --query id --output tsv
az role assignment list --assignee $userId --scope "/subscriptions/$subscriptionId" `
  --query "[].roleDefinitionName" --output tsv
```

For Bicep, run `bicep --version`. For Terraform, run `terraform version`.

Confirm the identity has the least-privilege access required for the requested operation and supplied-resource usage.
The displayed direct assignments are not a complete effective-access check. Subscription Owner is not a universal
consumer requirement; resolve missing access with the platform owner rather than changing the landing-zone foundation.

## Continue Safely

Use the `APEX` agent to capture requirements. APEX will not deploy resources from this tutorial. Preview, approval, and
deployment are separate governed steps.

## Related

- [Prepare Windows 11](../how-to/prepare-windows-11.md) - install and verify the operating-system prerequisites.
- [Manage installation](../how-to/manage-installation.md) - update, reset or remove the plugin and workspace files.
- [Run the workflow](../how-to/run-workflow.md) - progress a selected project through its tasks and gates.
- [Operate a project](../how-to/operate-project.md) - create previews and perform explicitly approved operations.
