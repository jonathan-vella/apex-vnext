<a id="top"></a>

# Changelog

All notable changes to **APEX vNext** are documented in this file.

Release history is available through the repository's **Releases** tab. The
current repository version is recorded in [VERSION.md](VERSION.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Rebaseline product requirements, roadmap and supporting documentation around COE archetype reuse, conversational
  adaptation, ALZ-backed and standalone lab profiles, rich output quality and WSL2 without a devcontainer.
- Keep input efficiency simple and DRY without a token-baseline project; defer Agent Plugins and APEX MCP distribution
  decisions until feature completion. Document planned behavior and executable-control alignment separately from
  implemented commands, existing safety checks and historical qualification evidence.

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
