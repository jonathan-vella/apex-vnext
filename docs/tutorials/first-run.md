# Complete The First Local Run

> [Current Version](../../VERSION.md) | Initialize APEX vNext and inspect deterministic state without Azure changes.

This tutorial uses the repository build and the fake provider boundary. It does not deploy infrastructure or grant
release authority.

This source-build tutorial is for local candidate evaluation. Normal consumers use the
[WSL2 consumer runbook](wsl2-vscode-consumer-runbook.md) and an available package without a devcontainer or source clone.
The fake provider is not evidence of either an ALZ-backed or standalone Azure deployment.

## Prerequisites

- Node.js 26.9.0 or newer
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

This installs the Copilot CLI projection. To select Terraform, replace `--iac bicep` with `--iac terraform`.

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

A new project normally needs requirements input. Start Copilot CLI with `copilot --agent apex` and ask the coordinator
to continue the project. It reads kernel state, names the specialist that owns the next step, and prints the
`/agent <name>` command and a scope prompt to paste after you switch.

Do not edit `.apex` directly or infer progress from chat history.

## Stop Safely

This tutorial creates local project state only. To remove managed client files while retaining audit state:

```bash
npx apex customizations uninstall --json
```

Delete the disposable consumer repository only when its local state is no longer needed.

## Related

- [Windows 11 first run](windows-11-first-run.md) - use the published-package onboarding flow on WSL2.
- [Manage installation](../how-to/manage-installation.md)
- [Run the workflow](../how-to/run-workflow.md)
- [CLI commands](../reference/cli.md)
