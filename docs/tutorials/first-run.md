# Complete The First Local Run

> [Current Version](../../VERSION.md) | Initialize APEX vNext and inspect deterministic state without Azure changes.

This tutorial uses the repository build and the fake provider boundary. It does not deploy infrastructure or grant
release authority.

## Prerequisites

- Node.js 24 or newer
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

For VS Code:

```bash
npx apex init \
  --project demo \
  --name "Demo workload" \
  --environment dev \
  --target local \
  --iac bicep \
  --client github-copilot-vscode \
  --json
```

For Copilot CLI, replace the client value with `github-copilot-cli`. To select Terraform, replace `--iac bicep` with
`--iac terraform`.

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

A new project normally needs requirements input. In a supported Copilot client, select the visible APEX coordinator and
ask it to continue the project. The coordinator reads kernel state and hands interactive decisions to the appropriate
specialist.

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
