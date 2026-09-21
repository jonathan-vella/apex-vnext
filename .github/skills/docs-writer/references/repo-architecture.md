<!-- ref:repo-architecture-v1 -->

# Repository Architecture Reference

## Current Authorities

Use the existing sources below rather than maintaining another agent, model, skill or file-count inventory here.
Paths are repository-relative.

| Concern                                                        | Owner                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Build commands, package responsibilities and safety boundaries | `AGENTS.md`                                                            |
| Product scope and output quality                               | `docs/vnext/PRD.md`                                                    |
| Delivery order and recommendation dispositions                 | `docs/vnext/ROADMAP.md`                                                |
| Implemented versus planned status                              | `docs/vnext/PROJECT.md`                                                |
| Runtime architecture                                           | `docs/explanation/runtime-architecture.md`                             |
| Human gates, reviews and lifecycle                             | `config/workflow.v1.json`, `docs/explanation/workflow-and-gates.md`    |
| Agent roles, clients and shipped files                         | `customizations/manifest.json`                                         |
| Current models and client toolchain                            | `config/toolchain.v1.json`                                             |
| Artifact schemas                                               | `packages/contracts/src/`, generated `packages/contracts/schemas/`     |
| Artifact rendering and template bindings                       | `packages/renderers/`, `customizations/.github/skills/apex-artifacts/` |
| Guidance consumers and migration dispositions                  | `tools/registry/guidance-migration.v1.json`                            |
| Entity counts                                                  | `tools/registry/count-manifest.json`                                   |
| Documentation navigation and inventory                         | `docs/README.md`, `docs/vnext/documentation-inventory.v1.json`         |
| CLI and MCP public operations                                  | `docs/reference/cli.md`, `docs/reference/mcp.md`                       |

## Discovery And Ownership

Managed agents, skills and instructions originate in `customizations/`; package tooling generates client projections.
Repository-maintenance skills remain under `.github/skills/`. Read relevant `SKILL.md` files on demand and load their
references only when needed. `.vscode/settings.json` controls discovery in this source workspace.

State transitions, gates and evidence belong to the deterministic runtime, not Markdown guidance. Keep audience-specific
documentation but link volatile facts to their authoritative owners. Preserve all required reviews and approval checks.

## Host And Historical Content

Windows development uses Ubuntu WSL2 through `tools/scripts/setup-windows.ps1` and `tools/scripts/setup-wsl.sh`.
Current source and contracts own product behavior. Optional historical storage is not an active dependency.
`.apex/` may contain live project state and must not be treated as repository cleanup material.
