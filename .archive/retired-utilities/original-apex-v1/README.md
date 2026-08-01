# Original APEX Utilities

## Status

This archive preserves template-era setup, smoke verification, HTML export, SKU alias promotion, and legacy agent-validator tests that are not part of APEX vNext execution. Original paths are retained below this directory.

## Replacement Owners

- `packages/cli/` owns `apex init`, update, setup, and lifecycle qualification.
- `tools/scripts/live-qualification.mjs` and vNext tests own runtime acceptance.
- `packages/capabilities/` and active pricing validators own typed pricing evidence.
- `docs/vnext/` owns current product documentation.

## Boundaries

- Do not restore root `npm run init`, `npm run setup`, smoke, or HTML-export aliases.
- Do not make archived legacy-agent tests part of active validation.
- Qualification governance and SKU artifacts remain active and are not covered by this retirement.

## Rollback

Restore the minimum file set to its original relative paths, restore explicit package commands and tests, document why the vNext owner is insufficient, then run `npm run validate:all`.
