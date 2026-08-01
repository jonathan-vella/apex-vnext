# Retired npm Script Utilities

## Status

This archive preserves zero-consumer utilities, completed pre-commit benchmark evidence, and dead compatibility tests
removed during the root npm script audit. They are not active package commands or validation dependencies.

Mode-specific npm wrappers whose underlying implementation remains actively consumed are not archived here; only the
redundant package entry point is removed.

## Replacement Owners

- Canonical commands in `package.json` own supported contributor workflows.
- `tools/registry/repository-validator-graph.json` owns active validation composition.
- Required CI and exact-head qualification own merge and release evidence.

## Rollback

Restore the minimum file set to its original relative paths, restore explicit package/graph consumers, and run
`npm run validate:all`. Do not restore historical benchmark evidence as an active release gate.
