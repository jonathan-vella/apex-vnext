<a id="top"></a>

# Changelog

All notable changes to **APEX vNext** are documented in this file.

Release history is available through the repository's **Releases** tab. The
current repository version is recorded in [VERSION.md](VERSION.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `apex doctor` checks the client prerequisites of its host. On native Windows it requires VS Code 1.140 or later
  only when `code` is installed and the `apex` plugin in the Copilot CLI store; on Linux and WSL2 it requires Copilot
  CLI and no longer runs or fails on `code`, so an old Windows VS Code shim on WSL2 PATH passes. New `host`, `git`,
  `copilot-cli`, `copilot-plugin`, `linux-sandbox-tools` and `plugin-settings` checks are read-only; advisory checks
  pass with `severity: "warning"`. The Linux installer accepts Ubuntu on Linux or WSL2, rejects WSL1, installs
  Bubblewrap and `slirp4netns`, and no longer checks VS Code.
- The APEX MCP server, from the plugin or `apex mcp serve`, now requires the workspace runtime lock
  (`cliVersion` in `.apex/apex.lock.json`) to name its exact `@apexops/cli` version. Every tool except `status` fails
  closed with `APEX_RUNTIME_MISMATCH` and a remediation (`apex update` for an older workspace, the matching plugin or
  CLI version for a newer one); `status` returns a read-only `runtime_mismatch` result. Uninitialized workspaces are
  unchanged.
- `npm run validate:skills` now validates the shipped skills in `customizations/.github/skills/` as well as the
  repository authoring skills, requires every shipped skill to declare `user-invocable`, keeps skills loaded by the
  APEX agent, its workers or `apex-next` routing model-loadable, and records pre-existing errors in a shrink-only
  baseline (`tools/registry/skill-validation-baseline.json`). Stale allowlist and baseline entries, and entries
  missing from the baseline at the merge base, now fail.
- `apex init` writes a thin workspace projection: `.github/copilot/settings.json` enabling `apex@apex-plugins`,
  instructions, the governance workflow and scripts, and `.apex/`. Agents, skills and MCP servers come from the
  `apex` plugin; `apex update` and `apex doctor --fix --yes` retire unedited workspace copies and report edited ones.
  The ARM MCP server is now the plugin's `apex-azure-pricing` server, and a managed hook denies its write tools.
- Rebaseline product requirements, roadmap and supporting documentation around COE archetype reuse, conversational
  adaptation, ALZ-backed and standalone lab profiles, rich output quality and WSL2 without a devcontainer.
- Keep input efficiency simple and DRY without a token-baseline project. Document planned behavior and
  executable-control alignment separately from implemented commands, existing safety checks and historical
  qualification evidence.

### Fixed

- A CLI command waiting for interactive input no longer holds the workspace lock, so MCP calls in the same workspace
  no longer fail with `APEX_CONFLICT` while `apex bootstrap` waits at a question. The command takes the lock again
  before it continues and fails with `APEX_STALE` if the workspace changed during the wait, so an answer is never
  applied to state it was not given against. Other waits, such as provider and Azure CLI processes, still hold the
  lock.
- The MCP repeat guard binds staged and generated files by content instead of by stat signature. A result is stored
  only if those files still hold their content from the start of the call, changed only by the call's own writes, so an
  edit while a call runs, or one that keeps a file's size and modification time, is never answered from a result
  computed on other content.

### Security

- Raise the dependency overrides for `fast-uri` (4.2.1, used by the shipped contract validator), `ip-address`,
  `basic-ftp`, `katex`, and markdownlint-cli2's `js-yaml` and `smol-toml` to patched releases. `braces` has no patched
  release yet and stays a development-only advisory.

## [0.10.0-next.5] — Preview

### Changed

- Architecture now requires a typed qualitative assessment of all five Azure Well-Architected pillars and an explicit
  Reviewer criterion receipt for each pillar. The Gate 2 package includes derived Python, SVG, and PNG views for
  Architecture, WAF status, priced cost breakdown, and cost uncertainty while retaining authoritative evidence tables.
- Architecture assumes regional service/SKU availability and sufficient quota; regional, zonal, deployment, restore,
  failover, and capacity checks are optional documentation rather than APEX validations or review findings. Explicit
  partial pricing is accepted documentation, and out-of-scope findings can be dismissed without revising Architecture.
- Interactive authoring agents can recover externalized task context through one bounded MCP reader; Architecture now
  receives exact output templates while APEX derives decision-manifest identity, artifact hashes, must-requirement
  traceability, and cost/SKU bindings. Partial estimates record missing retail meters explicitly while synthetic
  unpriced cost placeholders remain rejected.
- Requirements review can acknowledge business-owned obligations with a responsible role, allowing Azure architects
  to document GDPR, retention, workload-volume, and product-policy gaps without inventing rationale or expiry dates.
- Requirements now uses three adaptive panels with confirmed recommendations, workload-specific scale prompts,
  non-binding service candidates, and no duplicate IaC question. Pending four-round intake remains replayable.
- Requirements, Architecture, Plan, and Reviewer use stage-specific completion operations. Review findings return as a
  conversational decision panel; revision creates fresh stage evidence and permitted risk acceptance remains time-bound.
- Human `status` and `doctor` output is concise by default, with full detail under `--verbose` or `--json`.
- Runtime updates preserve immutable generations: existing runs stay pinned while future projects use the latest bundle.
- Published `@apexops/*` packages now include package-specific READMEs with installation, usage, and documentation
  links, verified as part of the release-tarball contract.

## [0.10.0-next.4] — Preview

### Changed

- Requirements now invokes the Reviewer task automatically in VS Code after accepted requirements are submitted.
- Gates 1 through 3 can be explicitly approved or rejected in chat; APEX records the local OS username as actor.
  Gate 4 remains recipient-bound and CLI-only.
- Planner completion is now atomic: APEX derives the canonical implementation-intent hash before binding and submitting
  the complete plan bundle.

## [0.10.0-next.3] — Preview

### Changed

- Requirements intake now asks retained-service constraints only for migration, modernization, and extension scenarios.
  Availability, backup, and disaster-recovery capabilities use selectable options, while exact RTO/RPO targets remain a
  distinct numeric decision.

## [0.10.0-next.2] — Preview

### Changed

- Restored reviewable, kernel-derived workflow packages across Requirements, Architecture, Planner, Operations,
  Reviewer, Validator, and the coordinator dashboard. Generated documents preserve human review without becoming a
  second authority source; all gate decisions remain explicit terminal ceremonies.

## [0.10.0-next.1] — Preview

### Fixed

- Packaged the APEX Azure MCP launcher as a release-tarball contract and defaulted its .NET child process to invariant
  globalization when ICU is unavailable. Consumers can override `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT` when their
  environment provides ICU.
