# Dev Container Base Validation

## Status

This archive preserves the multi-architecture devcontainer workflow and verdict comparator retired by
`DECISION-009`. The maintainer excluded devcontainer CI from vNext release acceptance; keeping an active dispatch and
pull-request trigger contradicted that decision.

## Replacement Owners

- `.devcontainer/devcontainer.json` remains the local development configuration.
- `npm run validate:vscode` validates active VS Code and devcontainer settings.
- Required CI and exact-head qualification own release acceptance.

## Boundaries

- Do not dispatch or restore this workflow without a new explicit architecture decision.
- Frozen Phase 0A references remain historical evidence.
- Original paths and normalized-text hashes are recorded in `provenance.json`.

## Rollback

Restore all archived files to their original relative paths, restore the package command and validator/workflow contract
entries, update `DECISION-009`, and pass `npm run validate:all` before enabling a trigger.
