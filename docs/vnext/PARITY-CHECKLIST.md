# APEX Parity Checklist And Launch Scope

This document defines the minimum functional floor that `apex-vnext` must satisfy at preview launch relative to
upstream `jonathan-vella/apex`, along with the always-loaded context budget and single-artifact upgrade contract
established in
[DECISION-040](DECISIONS.md#decision-040-launch-scope-reset-single-plugin-artifact-static-context-budget-and-tiered-client-acceptance).

## Core Value Proposition Over Upstream `jonathan-vella/apex`

| Dimension                  | Upstream `jonathan-vella/apex`                                 | `apex-vnext` launch target                                                                                       |
| -------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Distribution & upgrade** | Copy ~450 files (`.github/`, `.vscode/`, scripts)              | Single Agent Plugin (`apex@apex-plugins`) bundling MCP + CLI (`cli/apex.mjs`) plus thin `.apex/bin/apex.mjs`     |
| **Always-loaded context**  | Multiple specialist definitions + workspace instructions + MCP | 1 foreground `APEX` agent, 31 role-scoped MCP tools without wire `outputSchema`, static budget `<= 70.5 KB`      |
| **State & gates**          | Markdown files (`01-requirements.md`..`07-*.md`) in chat       | Hash-linked kernel journal, captured `rubber-duck` reviews, human Gate 1 & Gate 4, automatic lab Gates 2 & 3     |
| **IaC validation**         | `bicep build` + `bicep lint` + AVM-first / native Bicep        | `bicep build` + `bicep lint` + general Bicep resource/module parity + storage hardening + policy-property checks |

## Six-Stage Functional Parity Map

| Stage | Upstream `jonathan-vella/apex` stage                   | `apex-vnext` mechanism                                                                                                         | Client qualification IDs                 | Launch status                                                            |
| ----- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------ |
| 1     | **Requirements** (`01-requirements.md`, Gate 1)        | Adaptive `ask_user` intake (`recordInput`), `requirementsComplete`, captured `rubber-duck` review, human Gate 1 (`gateDecide`) | `CLIENT-003`, `CLIENT-023`, `CLIENT-031` | Implemented; deterministic tests pass; live WSL2 E2E pending (`CP-20`)   |
| 2     | **Architecture & Cost** (`02-architecture-assessment`) | Governance import (`governanceImport`), `apex-azure/pricing` (`pricing_get`), `architectureComplete`, WAF diagram, Gate 2      | `CLIENT-018`, `CLIENT-033`, `CLIENT-035` | Implemented; deterministic tests pass; live WSL2 E2E pending (`CP-20`)   |
| 3     | **Design Artifacts** (`03-des-*` diagrams & ADRs)      | Rendered architecture, WAF, dependency, runtime diagrams (`.py`/`.svg`/`.png`) and ADRs from accepted kernel state             | `CLIENT-019`, `CLIENT-029`               | Implemented; deterministic tests pass; live WSL2 E2E pending (`CP-20`)   |
| 4     | **Planning & Governance** (`04-governance`, `04-plan`) | Policy-to-component mapping, `planComplete` with kernel-derived intent hash, captured `rubber-duck` review, automatic Gate 3   | `CLIENT-005`, `CLIENT-006`, `CLIENT-031` | Implemented; deterministic tests pass; live WSL2 E2E pending (`CP-20`)   |
| 5     | **IaC Generation & Validation** (`05-implementation`)  | Hidden `APEX CodeGen` (`generateIac`/`stageFile`) and `APEX Validator` (`validateTask`/`completeTask`) for native + AVM Bicep  | `CLIENT-032`, `CLIENT-035`, `CLIENT-039` | Implemented (`CP-33`); general Bicep + AVM modules unlocked              |
| 6     | **Preview, Gate 4 & Deploy** (`06-deployment`, `07-*`) | `node .apex/bin/apex.mjs preview`, terminal human Gate 4 (`node .apex/bin/apex.mjs gate decide`), `azd` Bicep deploy/destroy   | `CLIENT-006`, `CLIENT-031`, `CLIENT-039` | Implemented (`CP-26`, `CP-35`); live WSL2 E2E pending (`CP-20`, `CP-30`) |

> **IaC track launch boundary:** Bicep (native resources and AVM `module` deployments) is supported end-to-end through
> preview, Gate 4, apply, inventory, and destroy via the `azd` executor. Terraform remains **design, generation, and
> validation only** at preview launch; live Terraform apply/destroy qualification is deferred post-launch (`#517`).

## Static Context Budget (`config/context-budget.v1.json`)

Enforced in CI by `npm run validate:context-budget` (`tools/scripts/context-budget.mjs`):

| Surface                        | Source                                                                                       | Current UTF-8 bytes (LF)  | Max byte cap |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------- | ------------ |
| MCP `tools/list` wire payload  | `packages/cli/src/test/fixtures/mcp-tools-list.json` (31 tools, wire `outputSchema` omitted) | `27,505`                  | `28,000`     |
| Primary `APEX` agent           | `customizations/.github/agents/apex.agent.md`                                                | `11,497`                  | `12,500`     |
| Skill frontmatter catalog      | `customizations/.github/skills/*/SKILL.md` (`---` frontmatter blocks)                        | `16,269`                  | `17,000`     |
| Managed workspace instructions | `customizations/.github/copilot-instructions.md` + `customizations/.github/instructions/*`   | `12,584`                  | `13,000`     |
| **Total always-loaded**        | All four surfaces combined                                                                   | **`67,855`** (~16.9k tok) | **`70,500`** |

Server-side response validation (`MCP_OUTPUT_SCHEMAS` + `outputSchema.safeParse`) remains active on every MCP tool call.

## Tiered Client Qualification For Preview Launch

| Tier                     | Client / Host                         | Required launch verification                                                                                                                                             |
| ------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Primary full E2E**     | GitHub Copilot CLI on WSL2 Ubuntu     | Plugin install, workspace bootstrap/init, Requirements -> Gate 1 -> Architecture (`apex-azure/pricing`) -> Plan -> Bicep CodeGen/Validate -> Preview -> Gate 4 -> Deploy |
| **Smoke verification**   | GitHub Copilot app on Windows 11      | Plugin discovery from shared store, `APEX` agent selection, `apex/status` MCP connectivity, worktree writer lease, and first intake prompt                               |
| **Smoke verification**   | VS Code Copilot harness on Windows 11 | Single `@agentPlugins` entry, `APEX` agent selection, `apex/status` MCP connectivity, and first intake prompt                                                            |
| **Deferred post-launch** | Full 4-client E2E matrix & sandboxing | Full multi-stage E2E across all Windows/Linux clients, per-commit hash re-freezing, CI-owned production (`CP-28`/`CP-29`), and local sandboxing                          |
