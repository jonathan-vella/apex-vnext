# Manage Installation

> [Current Version](../../VERSION.md) | Install, update, roll back, reinstall, or remove managed APEX vNext files.

## Install A Local Candidate

This is a maintainer/local-candidate path, not the intended normal consumer prerequisite. Consumers use Windows via
WSL2 without Docker or a devcontainer and install an available approved package. They do not need a source checkout.

Build and install every tarball from the same release manifest:

```bash
npm ci
npm run pack:vnext
cd /path/to/consumer
npm install --ignore-scripts --no-audit --no-fund \
  /path/to/apex-vnext/dist/vnext-packages/*.tgz
npx apex version --json
```

Initialize exactly one client projection with `apex init --client github-copilot-vscode` or
`--client github-copilot-cli`.

For an approved registry release, follow [Publish npm Packages](publish-npm.md) before using the published bootstrap
route.

## Bootstrap A Workspace

Inspect local initialization prerequisites without changing files or running commands:

```bash
apex bootstrap plan --project payments --client github-copilot-vscode --create-repo --json
```

This bounded preflight checks the local Git boundary, workspace APEX package version and existing APEX state. It returns
`ready`, `pending` or `blocked` for those checks, with the requested configuration and its hash. The hash is not an
execution approval. Existing state is preserved and reported as requiring resume/repair inspection; this command does
not yet implement automatic resume. Machine prerequisites, client health, remote COE, GitHub, OIDC and reviewed baseline
checks are explicitly unassessed. A local `ready` result is not complete onboarding or deployment readiness.

The agreed `apex-install` and `apex-bootstrap` guided first-run experiences, including both clients in one repository,
remote multi-archetype selection and confirmed OIDC setup, remain under implementation. Their acceptance contract is
[first-time onboarding](../vnext/PRD.md#req-onboarding-001-first-time-install-and-repository-bootstrap).

For a published package, use either a global CLI or a one-shot command. These routes are unavailable until
`@apexops/cli` is published to your approved npm registry. Both routes install the exact APEX CLI as a workspace
`devDependency`, update the npm lockfile, and create one selected client projection.

```bash
npm install -g @apexops/cli
apex bootstrap --project payments --client github-copilot-vscode --create-repo --yes
```

```bash
npx --yes @apexops/cli bootstrap --project payments --client github-copilot-cli --create-repo --yes
```

Omit `--create-repo` only when the workspace already has a `.git` boundary. When `--project` is omitted, APEX derives a
valid project ID from the workspace folder. Use `--file onboarding.json --yes` to provide the same settings as a
validated onboarding file.

## Install The VS Code Bootstrap Agent

The optional VS Code profile agent appears before a workspace APEX projection exists. It only guides and launches the
same bootstrap command; it does not own MCP configuration, `.apex` state, approvals, or deployment.

```bash
apex profile install --client github-copilot-vscode --yes
```

In VS Code, select **APEX Bootstrap**, complete its questions, reload the window, and then select the workspace
**APEX** agent. Manage the profile agent explicitly:

```bash
apex profile status --client github-copilot-vscode
apex profile update --client github-copilot-vscode --yes
apex profile uninstall --client github-copilot-vscode --yes
```

The release-blocking end-user lifecycle scenarios are listed in the
[VS Code installation lifecycle matrix](../vnext/CLIENT-QUALIFICATION.md#vs-code-installation-lifecycle). Run them in
a clean supported profile before claiming live VS Code support.

## Update Managed Files

```bash
npx apex version --json
npx apex update --json
npx apex doctor --json
```

APEX performs a three-way update against recorded managed hashes. It reports conflicts and preserves modified files
rather than replacing them silently. Updates install an immutable runtime generation for future projects. Existing runs
remain pinned to their original generation and continue without deleting `.apex` or restarting intake.

Use `--customizations-source /absolute/path` only to test a deliberate local source bundle. Later updates of that
selection require the same source.

## Roll Back Managed Files

```bash
npx apex customizations rollback --json
npx apex doctor --json
```

Rollback restores the prior managed bundle. It does not downgrade persisted contracts, project journals, or deployment
evidence. Restore package and `.apex` state from a matching checkpoint if a package rollback is required.

## Uninstall Or Reinstall

```bash
npx apex customizations uninstall --json
npx apex customizations reinstall --json
```

Uninstall removes unchanged managed files and preserves conflicts, unrelated files, project state, and history. Reinstall
uses the recorded client selection unless a custom source is supplied.

## Manage Capability Packs

```bash
npx apex capability list --json
```

The shipped capability-pack registry is currently empty. Do not install a retired pack or infer availability from
retained lifecycle commands. Governance uses reviewed baseline import, not local discovery or capability-pack execution;
follow the [governance baseline requirements](../vnext/PRD.md#req-gov-001-governance-and-policy).

## Final Distribution Decision

npm remains the current runtime delivery mechanism. Agent Plugins and easy APEX MCP redistribution are evaluated
[at the end of feature delivery](../vnext/ROADMAP.md#phase-6-distribution-last). No plugin installation command is promised
yet. The eventual path must cover both clients, the correct workspace, authentication, runtime dependencies, version
compatibility and safe update/upgrade/rollback/uninstall without a second updater managing the same files.

Plugin removal must not accidentally remove consumer project state. Updating APEX does not automatically migrate
persisted contracts, reconcile consumer design changes, or approve an infrastructure operation.

## Related

- [Prepare Windows 11](prepare-windows-11.md) - install WSL2, Azure, and Copilot prerequisites.
- [WSL2 and VS Code consumer runbook](../tutorials/wsl2-vscode-consumer-runbook.md) - install the published preview.
- [Windows 11 first run](../tutorials/windows-11-first-run.md) - bootstrap an Azure-ready workspace.
- [Complete the first local run](../tutorials/first-run.md)
- [Client support](../reference/client-support.md)
- [Client projections](../explanation/client-projections.md)
