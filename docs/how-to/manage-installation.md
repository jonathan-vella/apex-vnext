# Manage Installation

> [Current Version](../../VERSION.md) | Install, update, roll back, reinstall, or remove managed APEX vNext files.

## Install A Local Candidate

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

For a published package, use either a global CLI or a one-shot command. These routes are unavailable until
`@apex/cli` is published to your approved npm registry. Both routes install the exact APEX CLI as a workspace
`devDependency`, update the npm lockfile, and create one selected client projection.

```bash
npm install -g @apex/cli
apex bootstrap --project payments --client github-copilot-vscode --create-repo --yes
```

```bash
npx --yes @apex/cli bootstrap --project payments --client github-copilot-cli --create-repo --yes
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
rather than replacing them silently.

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
npx apex capability status --pack azure-governance-discovery --json
npx apex capability install --pack azure-governance-discovery --yes --json
npx apex capability verify --pack azure-governance-discovery --json
```

Optional packs have independent update, rollback, and uninstall commands. Core APEX remains usable when an unrelated
optional pack is absent; workflows that require the missing pack block explicitly.

## Related

- [Prepare Windows 11](prepare-windows-11.md) - install WSL2, Azure, and Copilot prerequisites.
- [Windows 11 first run](../tutorials/windows-11-first-run.md) - bootstrap an Azure-ready workspace.
- [Complete the first local run](../tutorials/first-run.md)
- [Client support](../reference/client-support.md)
- [Client projections](../explanation/client-projections.md)
