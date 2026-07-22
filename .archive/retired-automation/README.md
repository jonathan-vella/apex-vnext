## Retired Automation

This directory preserves source that is no longer discoverable or executable through active repository tooling.
Archived files are provenance records, not supported commands.

## Workflow Synchronization

- **Archived source:** `sync-workflows.mjs`
- **Original path:** `tools/scripts/sync-workflows.mjs`
- **Original command:** `npm run sync:workflows`
- **Introduced by:** `946c72c5c7785e16ded06b4dc26dbf189b194677`
- **Archived from:** `d27951a575347d05ca3c36aa3f9b7ae87117bf9d`
- **SHA-256:** `e1111eb1f9a60e4273c1302a9af8666a555f7b5c6f079451ecaa37f50ec4cffa`
- **Retirement issue:** [#109](https://github.com/jonathan-vella/apex-vnext/issues/109)

### Rationale

The command copied workflow files from `jonathan-vella/apex@main`, which was useful for the prior accelerator model but
conflicts with this standalone repository's owned workflow contracts. Active workflow names, jobs, triggers, permissions,
actions, artifacts, and exact-head behavior are now validated by `tools/registry/github-workflow-contract.json`.

Repository search found no active consumer beyond the package command and the script's own help text. Removing the active
entrypoint reduces network-dependent workflow ownership without changing any current workflow file.

### Replacement Owner

- `.github/workflows/**` remains the executable hosted owner.
- `tools/registry/github-workflow-contract.json` records the offline expected contract.
- `npm run validate:github-workflows` validates repository workflow drift.
- Live branch protection remains hosted evidence and is not replaced by the offline contract.

### Rollback

1. Move `sync-workflows.mjs` back to `tools/scripts/sync-workflows.mjs` without changing its bytes.
2. Restore `"sync:workflows": "node tools/scripts/sync-workflows.mjs"` in `package.json`.
3. Run `npm run validate:github-workflows`, `npm run validate:all`, and hosted pull-request checks.
4. Record why upstream workflow copying is again compatible with standalone repository ownership.
