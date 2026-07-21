---
title: "Install the vNext Preview"
description: "Pack and install a clean local APEX vNext release, then initialize managed customizations."
---

Install the preview from locally built npm tarballs when testing the current repository source. The release manifest
records each package filename, dependency set, byte size, and SHA-256 digest.

## Build the Workspace Release

From the APEX repository root:

```bash
npm ci
npm run pack:vnext
```

The pack script builds the vNext workspaces, checks generated schemas, recreates `dist/vnext-packages/`, and writes
`release-manifest.json`. Keep all generated runtime tarballs together; the CLI package depends on the matching
contracts, kernel, capabilities, and renderers packages.

## Install into a Clean Repository

Create a consumer repository outside the APEX source tree, then install every tarball in one npm operation:

```bash
mkdir apex-vnext-consumer
cd apex-vnext-consumer
git init
npm init --yes
npm install --ignore-scripts --no-audit --no-fund \
  /path/to/apex-vnext/dist/vnext-packages/*.tgz
npx apex version --json
```

Use the versions and digests in `release-manifest.json`; do not copy an exact release version into scripts or prose.
For a package-registry candidate, publish the same qualified package set to the approved registry and install the CLI
from that release channel. Registry publication is a release operation, not required for local preview qualification.

## Initialize Managed Customizations

Initialize one project and one environment-scoped run:

```bash
npx apex init --project demo --name "Demo workload" \
  --environment dev --target local --iac bicep --json
```

By default, `apex init` installs the customization bundle embedded in the CLI. It materializes workspace agents and
skills under `.github/`, writes `.vscode/mcp.json`, creates the `.apex` runtime and project state, and records managed
file hashes in `.apex/customizations.lock.json`.

Use `--customizations-source /absolute/path` only when testing a deliberate local bundle override. The same flag on
`apex update` performs a three-way managed-file update. A modified managed file is never silently replaced; resolve the
reported conflict or restore the recorded base before retrying.

## Upgrade And Roll Back

Commit the workspace and authoritative `.apex/` project state before changing versions. Upgrade the CLI to one exact
approved version, verify the installed bundle, and then apply its transactional managed-file update:

```bash
npm install --save-exact @apex/cli@<approved-version>
npx apex version --json
npx apex update --json
npx apex doctor --json
```

The CLI declares exact versions of the matching contracts, kernel, capabilities, and renderers packages. Do not mix
runtime package versions or install from a floating release channel.

To reject an update, first restore the previously recorded customization bundle while the current CLI is available,
then reinstall the complete prior approved package version and verify it:

```bash
npx apex customizations rollback --json
npm install --save-exact @apex/cli@<previous-approved-version>
npx apex version --json
npx apex doctor --json
```

Rollback restores only the prior managed bundle. It does not rewrite project journals or deployment evidence. If an
older runtime rejects a newer persisted contract, restore the repository and `.apex/` state from the checkpoint created
by that older release. Never force a contract downgrade. The first vNext release has no vNext package predecessor, and
v1 sessions or artifacts cannot be resumed in vNext.

Capability packs have an independent transactional lifecycle:

```bash
npx apex capability update --pack <pack-id> --yes --json
npx apex capability rollback --pack <pack-id> --yes --json
npx apex capability uninstall --pack <pack-id> --yes --json
```

## Uninstall

Remove managed workspace files before removing the CLI. Modified managed files are reported as conflicts and preserved;
project journals and runtime evidence remain available for audit.

```bash
npx apex customizations uninstall --json
npm uninstall @apex/cli
```

Review retained `.apex/` state explicitly. Delete or archive it only under the repository's evidence-retention policy.

## Verify Discovery

1. Run `npx apex doctor --json` and address actionable checks.
2. Open the consumer repository in a supported VS Code release.
3. Confirm the visible `APEX` agent and its interactive specialists are available.
4. Confirm the workspace MCP server starts from `.vscode/mcp.json`.
5. Ask `APEX` for status and verify that it reads kernel state rather than inferring progress from chat.

Continue with the [workflow](workflow.md) or run the full [qualification checklist](testing.md).

## Related

- [Workflow](workflow.md) — start a governed project after installation
- [Qualification](testing.md) — verify the exact package set
- [Security](security.md) — review local state and credential boundaries
