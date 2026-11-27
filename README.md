# APEX vNext — Agent Plugins 1.0.0 Migration

Clean workspace for packaging current APEX into modular **Agent Plugins 1.0.0** plugins (`apex-core`, `apex-diagrams`,
`apex-rfi-rfp`) with a bundled **`apex-mcp`** server and collision-free **`apex-azure-mcp`** server across **VS Code**,
**GitHub Copilot CLI**, and **GitHub Copilot App** (Windows native + WSL2, Linux, macOS).

## Repository Layout

- `docs/PRD.md` — Product Requirements Document (goals, scope, non-goals, GA stack constraints).
- `docs/BACKLOG.md` — Ordered backlog mapped to GitHub issues (`#559`–`#565`, Step 0 → Phase 5).
- `docs/exec-plans/apex-agent-plugins-migration.md` — Full technical execution plan.
- `apex-legacy/` — Clean reference snapshot of current APEX source (excluding `agent-output/` and `infra/`) to pull
  files from deliberately as each phase executes.
- `.archive/pre-reset-2026-11/` — Previous `apex-vnext` experiment preserved for reference (reusable patterns:
  `--mode namespace --read-only` Azure MCP allowlist, `build-plugin` / `smoke-plugin-install` / `publish-plugin`
  scripts, Windows install runbook).

## Guiding Principles

1. **Package current APEX first** — keep the existing multi-agent workflow, `apex-recall`, and `.mjs` validators; do
   not rewrite into a single-agent kernel monorepo.
2. **Cutting-edge stable GA only** — Agent Plugins 1.0.0, MCP 2026-07-28 + `@modelcontextprotocol/server` v2, Node.js
   26 LTS (`>=26.13.1`), Python 3.15 (`>=3.15.0`), `@azure/mcp@3.0.0`. Zero legacy, zero deprecated, zero previews.
3. **Prove host behavior first** — start with **Step 0 (`#559` — Host-Feasibility Spike)** before migrating source.
