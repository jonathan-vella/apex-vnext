# GitHub Actions Workflows

> High-level reference for every workflow in `.github/workflows/`.
> For implementation details and individual triggers, open the YAML file directly.

## At a glance

| Workflow                                                                     | Trigger                                        | Purpose                                                                                                | Side effects                                                                                          |
| ---------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| [`ci.yml`](ci.yml)                                                           | PR + push to `main`                            | Required code check: formatting, Node validators, hook tests, deterministic vNext qualification, and the Windows package tests, which run as parallel shards. Docs-only PRs (only `docs/` or the root README, CONTRIBUTING, CONTRIBUTORS or SECURITY files) skip qualification, the plugin install smoke and the Windows shards. | None — fails the PR on regression.                                                                    |
| [`branch-enforcement.yml`](branch-enforcement.yml)                           | PR to `main`                                   | Runs canonical branch naming and strict file-scope policy so PRs stay reviewable.                      | None — fails the PR on violation.                                                                     |
| [`docs.yml`](docs.yml)                                                       | PR + push to `main` (Markdown)                 | Validate documentation links and freshness; required CI owns Markdown lint.                            | None - fails on documentation regression.                                                             |
| [`governance-policy-baseline.yml`](governance-policy-baseline.yml)           | Weekly Mon 05:00 UTC + manual                  | Refresh `.github/data/governance-policy-baseline.json` from a live subscription.                       | Opens a PR (manual review + merge required) when baseline drifts.                                     |
| [`release-candidate-qualification.yml`](release-candidate-qualification.yml) | Release-relevant PR/push + manual              | Run the release-unique exact-head scorecard after required CI proves validators, tests, and packaging. | Uploads a compact evidence bundle; cannot deploy, merge, publish, tag, or authorize cutover.          |
| [`vnext-live-qualification.yml`](vnext-live-qualification.yml)               | Manual only; default-branch bootstrap required | Import a locally approved exact Bicep or Terraform preview and run sandbox apply/destroy.              | Opens a bounded backend session and mutates qualification resources after local APEX Gate 4 approval. |
| [`weekly-maintenance.yml`](weekly-maintenance.yml)                           | Weekly Mon 06:00 UTC + manual                  | Consolidated data-refresh + audit umbrella — see [Weekly Maintenance](#weekly-maintenance) below.      | Opens PRs (refresh jobs, manual merge) + GitHub issues (audit jobs).                                  |

Devcontainer CI and obsolete long-lived branch maintenance are retired. Ordinary feature integration uses reviewed
pull requests and the required CI checks. Native Windows client support is covered by the
`windows-2025 package tests` CI job; no retired workflow is an execution authority.

## Windows package test shards

`ci.yml` runs the kernel, capabilities, CLI and plugin package tests on `windows-2025` as parallel
`windows-2025 shard (<suite>)` jobs, so a pull request waits for the slowest shard rather than for all suites in
sequence:

- `core` runs the kernel and capabilities tests and the plugin package tests whole.
- `cli-<i>-of-8` runs the one-eighth of every CLI test file selected by `APEX_TEST_SHARD=<i>/8`. Every CLI test file
  declares its tests, suites and `before` hooks through `packages/cli/src/test/test-shard.ts`, which registers a test only
  when its position in the file modulo the shard total matches and skips a suite's setup in shards that select none of
  its tests. A few CLI test files hold most of the runtime and run their tests in sequence, so
  splitting by file (`node --test --test-shard`) would leave one shard as slow as the old single job. The shards
  therefore cover every test exactly once, and `test-shard.test.ts` fails if a CLI test file bypasses the helper.
  Without `APEX_TEST_SHARD`, for example locally, every test runs.

Every shard points `TEMP`, `TMP` and `TMPDIR` at `RUNNER_TEMP`. The tests create many temporary workspaces and git
repositories, and the runner's default temporary directory is on the slower C: drive while `RUNNER_TEMP` and the
workspace are on D:. Repeated A/B runs of the same shard measured about 40% less test time. Defender real-time
protection is already off on the image and both drives are already excluded, so no exclusion is added.

The `windows-2025 package tests` job aggregates the shards and keeps the status-check name stable. It always runs and
passes only for a docs-only change (the shards are skipped) or when the scope job and every shard succeeded, so a failed
or cancelled shard fails it. The required `ci` job still has no `needs` or `if`, and
`tools/scripts/validate-github-workflows.mjs` enforces the shard matrix and the aggregate rule.

## Updating Action Pins

Keep third-party Actions pinned to full commit SHAs, with release comments for readability. Dependabot already proposes
weekly updates through [the repository configuration](../dependabot.yml); review the upstream release and commit before
accepting its changes. Shared Node and Python setup actions keep their dependency pins in one place.

For a pin-only update:

1. Review the proposed SHA and release comment in the workflow or shared action YAML.
2. Update that Action's `release` and `sha` entry in
   [the approved-pin registry](../../tools/registry/github-workflow-contract.json), keeping its consumers consistent.
3. Run `npm run validate:github-workflows`, `npm run test:github-workflows`, and
   `npm run validate:vnext-live-workflow` before submitting the PR for review.

Do not regenerate workflow hashes for an Action revision change. Job and shared-action digests bind parsed YAML
structure, replacing only full SHAs in executable `uses` references with a stable marker. Exact approved SHAs are
checked separately, so mutable tags and unapproved revisions still fail. Release comments are documentation, not
authorization. Permissions, triggers, commands, conditions, inputs, artifact paths, and approval controls remain bound;
changes to those require their own reviewed contract update. Nothing is auto-merged.

## Weekly Maintenance

`weekly-maintenance.yml` is the umbrella workflow for low-frequency
maintenance tasks. It folds in the retired `azure-deprecation-tracker.yml`
(Aug 2025), the legacy grep-based AVM version check (replaced by the
PR-driven `refresh-avm-module-index` job), and the standalone weekly
link-check cron (folded May 2026).

| Job                        | What it does                                                                                                                             | Output                                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refresh-avm-module-index` | Fetches canonical AVM module indexes (Bicep + Terraform), pre-warms the per-module version cache used by `validate:avm-versions:freeze`. | PR (manual merge) updating `.github/data/avm-bicep-modules.csv`, `.github/data/avm-terraform-modules.csv`, `.github/data/avm-module-index.json`, `tools/scripts/_data/avm-module-cache.json`. |
| `track-deprecations`       | Pulls Azure Updates RSS for deprecation notices; merges with the curated `KNOWN_DEPRECATIONS` allowlist.                                 | PR (manual merge) updating `.github/data/azure-deprecations.json`.                                                                                                                            |
| `docs-freshness`           | Runs `npm run audit:quarterly` (glob-audit + orphan-content + docs-freshness).                                                           | Opens or updates a GitHub issue on regression.                                                                                                                                                |
| `link-check`               | Runs `lint:links` against root Markdown and `docs/**` as a scheduled safety net.                                                         | Fails the workflow run on broken links.                                                                                                                                                       |

AVM version checks audit current Bicep/Terraform source only. Freeze mode remains fail closed on unavailable
registry/cache evidence; neither this maintenance job nor its cache is deployment approval or Gate 4 evidence.

### Permissions model

The workflow declares minimal top-level permissions
(`contents: read`, `issues: write`) and elevates per-job for the two
PR-creating refresh jobs (`contents: write`, `pull-requests: write`).
This keeps the blast radius small if any other job is later added.

### Manual dispatch inputs

- `create_issue` — set `false` to suppress GitHub-issue creation in the
  audit jobs (`docs-freshness`).

## Adding a new workflow

1. Place the YAML under `.github/workflows/`.
2. Add a row to the **At a glance** table above. Keep it terse — one
   line, link the filename, name the trigger + purpose + side effect.
3. Prefer per-job `permissions:` blocks over wide top-level grants.
4. Use the [`./.github/actions/setup-node-repo`](../actions/setup-node-repo/action.yml)
   composite action for the standard checkout + Node + `npm ci` prelude.
   Override `fetch-depth`, `submodules`, `ref`, or `install-deps` via
   `with:` only when the defaults don't fit.
5. Stagger weekly crons across the Monday 05:00–09:00 UTC window so
   no two big jobs fight for the runner pool. See [Weekly cron schedule](#weekly-cron-schedule)
   below.
6. Do **not** add `gh pr merge --auto` / `enable-auto-merge` steps —
   GitHub Free private repos do not support auto-merge. Open the PR
   and let a human merge it after review.

## Weekly cron schedule

The weekly cron window is staggered so concurrent runs do not queue
behind each other on the free-tier runner pool. All times UTC.

| Day    | UTC   | Workflow                         |
| ------ | ----- | -------------------------------- |
| Monday | 05:00 | `governance-policy-baseline.yml` |
| Monday | 06:00 | `weekly-maintenance.yml`         |

## See also

- [`AGENTS.md`](../../AGENTS.md) — repository conventions, build commands, code style.
- [`copilot-instructions.md`](../copilot-instructions.md) — agent orchestration policies.
- [`tools/scripts/`](../../tools/scripts) — every validator and refresh script referenced above.
