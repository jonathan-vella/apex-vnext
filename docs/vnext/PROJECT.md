## APEX vNext Checkpoint

- **Updated:** 2026-07-22 UTC
- **Milestone:** O - active guidance rewrite
- **Repository:** `jonathan-vella/apex-vnext`
- **Default and integration branch:** `main`
- **Characterization base:** `b27d17350870a0ed3d5411346701cbb2eb6a4d4b`
- **Active issue:** [#126](https://github.com/jonathan-vella/apex-vnext/issues/126) - live two-client context/cache samples
- **Working branch:** `feat/126-live-client-context`
- **Release candidate:** None; all `0.10.0` release gates are reopened
- **Source repository:** `jonathan-vella/apex`
- **Frozen v1 source head:** `40d0f6147bbaf3e6a809ebd738bb6222509d9bd4`

## Current State

PR #90 merged the `0.10.0` re-baseline. PR #92 pinned the supported Copilot CLI and merged the client qualification
contract. PR #94 completed the guidance and automation characterization without changing active behavior.
PR #96 repaired the Markdown pre-commit failure path with executable regression coverage. Runtime-managed APEX agents
and skills remain under `customizations/`, with `customizations/manifest.json` as their canonical manifest. PR #98 added
the schema-backed repository validator graph while retaining package scripts as executable projections. PR #102 added
the deterministic npm bundle composition lock and source/generated provenance without changing installation behavior.
PR #104 added the read-only hosted workflow contract without changing workflow YAML.
PR #106 delegated public validation aliases to canonical npm scripts without removing compatibility names.
PR #108 extracted the shared Python validation bootstrap while preserving required and exact-head hosted boundaries.
PR #110 archived obsolete workflow synchronization with provenance and a durable retirement regression.
PR #112 generated deterministic VS Code and Copilot CLI projections from the npm-owned customization bundle.
PR #114 reduced pre-commit index writers and retained serial execution for the two genuine generators.
PR #116 derived runtime and compact artifact heading metadata from canonical templates.
PR #118 standardized text and JSON diagnostics for the registry and hosted-workflow contract validator family.
Issue #119 closes Milestone N with representative pre-commit hook selection, exit, and timing parity evidence.
PR #125 completes issue #121 with a privacy-safe normalized context/cache sample contract and deterministic aggregate.
Issue #126 owns representative live sampling; no improvement claim is authorized until both supported clients provide
the required evidence. Copilot CLI `1.0.73` is checksum-verified, operator-authenticated, and live-characterized through
a local content-disabled JSONL export; VS Code `0.58.0` export and representative matrix coverage remain pending.

The product contract now targets GitHub Copilot in VS Code and GitHub Copilot CLI, typed Azure Resource Manager MCP
evidence, native Terraform lifecycle authority, Mermaid and Python diagrams, bounded improvement measurement, and an
npm-generated customization bundle. Astro, Azure Pricing, Terraform, and Draw.io MCP dependencies are selected for
retirement after their replacement gates pass.

These are approved requirements, not implementation claims. Copilot CLI `1.0.73` is selected and installed in the
container user path after its official Linux x64 artifact passed the published SHA-256 check and version command. One
bounded live telemetry sample is characterization, not client-parity qualification. No ARM MCP version has been selected
or qualified.

## Evidence State

| Evidence                                                                 | Disposition                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| PR #88 exact-head receipt for `8b3d9dbbb5beb8d6723c27da56cfd7144cb1cdf8` | Passing regression evidence for the archive change            |
| Prior exact candidate `25530c339410e9758ae34538427f24bddfd83e1d`         | Historical characterization for the earlier contract          |
| Prior VS Code, package, security, and live Azure results                 | Preserved in [FINAL-QUALIFICATION.md](FINAL-QUALIFICATION.md) |
| Copilot CLI `1.0.73` and cross-client matrix                             | CLI source characterized; representative matrix pending       |
| Guidance, Markdown, lint, hook, and workflow ownership                   | Milestone N complete; dynamic context sampling remains in O   |
| ARM MCP adapters and MCP retirements                                     | Pending                                                       |
| Bundle composition mappings, aggregate lock, and client projections      | Implemented; live client qualification remains pending        |
| Diagram and improvement-measurement changes                              | Pending                                                       |
| Final deterministic, client, package, security, and live qualification   | Reopened                                                      |

## Release Boundaries

- `0.10.0` remains unreleased, and no exact release candidate is selected.
- Historical receipts do not authorize the expanded contract or any release mutation.
- No npm publication, tag, support date, deployment, or cutover is authorized.
- Native Bicep and Terraform paths retain deployment authority; managed MCP integrations remain read-only and typed.
- Existing stashes and unrelated worktree state must not be removed as part of release cleanup.

## Immediate Sequence

1. Flush and normalize the content-disabled VS Code `0.58.0` local export under issue #126.
2. Expand the bounded sample corpus across representative tiers, tracks, retries, and cache states.
3. Retire the selected MCP and Draw.io surfaces only after each replacement gate passes.
4. Prove equivalent typed outcomes and authority denials across VS Code and Copilot CLI.
5. Complete ARM pricing evidence, diagram routing, bounded improvement measurement, bundle generation, and guidance
   consolidation in roadmap order.
6. Select a new exact candidate only after those milestones pass, then rerun every affected release gate.

## Resume Pointer

1. Read [PRD.md](PRD.md), [ROADMAP.md](ROADMAP.md), and [REGISTER.md](REGISTER.md).
2. Verify the current `main` head, open pull requests, worktrees, and dirty files before selecting a slice.
3. Start Milestone O from the active-guidance owner map; keep each implementation independently revertible.
4. Treat [FINAL-QUALIFICATION.md](FINAL-QUALIFICATION.md) as historical evidence until a new candidate is declared.
