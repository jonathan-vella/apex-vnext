# Retired Devcontainer Utilities

## Status

This archive preserves the original APEX bootstrap, recurring updater, broad Python dependency bundle, and retired
compatibility validator. These files are provenance only and must not be restored to active devcontainer paths.

The retired setup installed optional capability runtimes and authoring tools globally, duplicated package installation,
mutated dependencies on every start, and assumed tooling beyond the vNext runtime contract.

## Replacement Owners

- `.devcontainer/devcontainer.json` owns portable features, named volumes, lifecycle commands, and editor extensions.
- `.devcontainer/post-create.sh` owns deterministic vNext repository bootstrap and required tool checks.
- `tools/scripts/validate-vscode-config.mjs` owns the cross-platform devcontainer and exact extension contract.
- `config/toolchain.v1.json` owns optional capability-pack runtimes resolved outside the core devcontainer.

## Rollback

Restore only a required capability to its owning vNext package or configuration contract. Do not restore the archived
bootstrap, updater, root Python bundle, or compatibility validator as active files.
