# vNext Qualification Narrative Evidence

## Status

This archive preserves the superseded qualification project index, ADR-0001, rendered governance narrative, and repeated challenger sidecars. They are not runtime contracts.

The active qualification inputs remain:

- `agent-output/vnext-qualification/04-governance-constraints.json`
- `agent-output/vnext-qualification/sku-manifest.json`
- `agent-output/vnext-qualification/sku-manifest.md`

Current product decisions live under `docs/vnext/adrs/` and `docs/vnext/DECISIONS.md`.

## Replacement Owners

- Typed governance and SKU contracts own live qualification input.
- vNext contract tests and exact-head qualification own acceptance evidence.
- `docs/vnext/adrs/` owns retained architectural decisions.

## Rollback

Restore only the required artifact to its original path and restore any validator consumer intentionally removed with it. Run `npm run qualify:vnext` and `npm run validate:all` before treating restored evidence as current.
