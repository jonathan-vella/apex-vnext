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

- [Complete the first local run](../tutorials/first-run.md)
- [Client support](../reference/client-support.md)
- [Client projections](../explanation/client-projections.md)
