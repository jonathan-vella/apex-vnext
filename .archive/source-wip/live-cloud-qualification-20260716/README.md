# Source Live Cloud Qualification WIP Archive

This branch preserves the dirty source worktree that existed before the old APEX vNext branches were removed.
It is an archive only and must not be merged into `main` without a fresh behavior review.

## Source Identity

| Field            | Value                                                                |
| ---------------- | -------------------------------------------------------------------- |
| Repository       | `jonathan-vella/apex`                                                |
| Branch           | `feat/vnext-live-cloud-qualification`                                |
| Base commit      | `117c8b84458c25be11add709e84ad365acfeffbe`                           |
| Captured         | 2026-07-16 UTC                                                       |
| Destination base | `jonathan-vella/apex-vnext@86fb94514665337a0d9e6a6e6cae6a4c2d0aa7c7` |

## Review Verdict

The snapshot is mixed historical WIP. Current `apex-vnext/main` contains the completed live workflow, handoff launcher,
security validators, qualification IaC, reviewed governance artifacts, and later repository migration fixes. The source
snapshot includes earlier contract, CLI, writer-transfer, documentation, and qualification-artifact work. Preserve it
for audit and selective comparison; do not apply it wholesale over the destination.

The separate `04-governance-constraints.preview.md` is retained as historical generated evidence. Astro documentation
under the archived untracked tree is historical because the destination uses repository-native Markdown under `docs/`.

A full secret scan of the source worktree and this archive reported no leaks before publication.

## Contents

- `tracked.patch` is a binary-safe full-index patch of tracked working-tree changes relative to the source base commit.
- `untracked/` contains every untracked, non-ignored source file with its original relative path.
- `source-status.txt` records the source branch, base commit, tracked changes, and untracked paths.
- `tracked-diff-stat.txt` summarizes the tracked patch.
- `SHA256SUMS` binds every archive payload except itself.

## Restore

Restore into a clone containing source commit `117c8b84458c25be11add709e84ad365acfeffbe`:

```bash
git switch --detach 117c8b84458c25be11add709e84ad365acfeffbe
git switch -c recovery/live-cloud-qualification-wip
git apply --binary /path/to/tracked.patch
cp -a /path/to/untracked/. ./
sha256sum --check /path/to/SHA256SUMS
```

Review all restored changes and run current validation before committing. Do not use the historical cloud configuration
or security-exception timestamps for a live run.
