# Original APEX Compatibility Utilities

## Status

This archive preserves advisory subagent validation, fleet scorecard tooling, challenger telemetry, an orphan networking
schema, the legacy quality report, and an unwired pricing alias test. None is an active APEX vNext runtime contract.

## Replacement Owners

- `packages/contracts/` owns typed vNext quality, review, networking, and pricing contracts.
- `packages/cli/` and exact-head qualification own executable product acceptance.
- `.github/hooks/tool-guardian/` remains the active state-changing tool hook.
- Active challenger and managed handoff validators remain in place.

## Boundaries

- Frozen `docs/vnext/phase-0a/**` references remain historical and must not be edited.
- The legacy subagent file-contract golden scenario remains active until the Phase 0A freeze is formally released.
- Do not restore generated scorecards or telemetry as release gates.

## Rollback

Restore only a required artifact to its original relative path, restore its explicit package/editor consumer, and prove
that the vNext contract owner is insufficient before running `npm run validate:all`.
