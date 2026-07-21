## APEX vNext Checkpoint

- **Updated:** 2026-07-21 UTC
- **Milestone:** H - release re-baseline and characterization
- **Repository:** `jonathan-vella/apex-vnext`
- **Default and integration branch:** `main`
- **Characterization base:** `1a1de02a3a17f496c713dd3c4e425c8df8d30d0e`
- **Release candidate:** None; all `0.10.0` release gates are reopened
- **Source repository:** `jonathan-vella/apex`
- **Frozen v1 source head:** `40d0f6147bbaf3e6a809ebd738bb6222509d9bd4`

## Current State

PR #88 merged the legacy-agent archive and established the current `main` characterization base. Runtime-managed APEX
agents and skills remain under `customizations/`, with `customizations/manifest.json` as their canonical manifest.

The product contract now targets GitHub Copilot in VS Code and GitHub Copilot CLI, typed Azure Resource Manager MCP
evidence, native Terraform lifecycle authority, Mermaid and Python diagrams, bounded improvement measurement, and an
npm-generated customization bundle. Astro, Azure Pricing, Terraform, and Draw.io MCP dependencies are selected for
retirement after their replacement gates pass.

These are approved requirements, not implementation claims. GitHub Copilot CLI is not installed in the current
development container, no client-parity qualification has run, and no ARM MCP version has been selected or qualified.

## Evidence State

| Evidence                                                                 | Disposition                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| PR #88 exact-head receipt for `8b3d9dbbb5beb8d6723c27da56cfd7144cb1cdf8` | Passing regression evidence for the archive change            |
| Prior exact candidate `25530c339410e9758ae34538427f24bddfd83e1d`         | Historical characterization for the earlier contract          |
| Prior VS Code, package, security, and live Azure results                 | Preserved in [FINAL-QUALIFICATION.md](FINAL-QUALIFICATION.md) |
| Copilot CLI and cross-client parity                                      | Pending                                                       |
| ARM MCP adapters and MCP retirements                                     | Pending                                                       |
| Diagram, improvement-measurement, and bundle changes                     | Pending                                                       |
| Final deterministic, client, package, security, and live qualification   | Reopened                                                      |

## Release Boundaries

- `0.10.0` remains unreleased, and no exact release candidate is selected.
- Historical receipts do not authorize the expanded contract or any release mutation.
- No npm publication, tag, support date, deployment, or cutover is authorized.
- Native Bicep and Terraform paths retain deployment authority; managed MCP integrations remain read-only and typed.
- Existing stashes and unrelated worktree state must not be removed as part of release cleanup.

## Immediate Sequence

1. Complete Milestone H characterization and bind the machine-readable ownership inventory to the current base.
2. Retire the selected MCP and Draw.io surfaces only after each replacement gate passes.
3. Prove equivalent typed outcomes and authority denials across VS Code and Copilot CLI.
4. Complete ARM pricing evidence, diagram routing, bounded improvement measurement, bundle generation, and guidance
   consolidation in roadmap order.
5. Select a new exact candidate only after those milestones pass, then rerun every affected release gate.

## Resume Pointer

1. Read [PRD.md](PRD.md), [ROADMAP.md](ROADMAP.md), and [REGISTER.md](REGISTER.md).
2. Verify the current `main` head, open pull requests, worktrees, and dirty files before selecting a slice.
3. Select the first dependency-ready Milestone H issue; future capabilities remain planned until evidence passes.
4. Treat [FINAL-QUALIFICATION.md](FINAL-QUALIFICATION.md) as historical evidence until a new candidate is declared.
