# APEX vNext Migration Backlog

Ordered backlog for [apex-agent-plugins-migration.md](./exec-plans/apex-agent-plugins-migration.md). Each item maps
to a tracked GitHub issue in `jonathan-vella/apex-vnext`.

| Order | Phase | Issue | Deliverable | Gate |
|---|---|---|---|---|
| 1 | **Step 0** | `#559` | Host-Feasibility Spike (minimal Agent Plugin 1.0.0 on VS Code, Copilot CLI, Copilot App) | All required host behaviors verified; blockers stop Phase 0 |
| 2 | **Phase 0** | `#560` | Runtime prep, 1:1 `apex-recall` parity & closure inventory, `APEX_PLUGIN_ROOT` vs `workspaceRoot` split, A/B rule decoupling, diagram gate decision | `apex-recall` passes brownfield gated transitions |
| 3 | **Phase 1** | `#561` | Refactor ~15 runtime `.mjs` scripts for in-process bundling, replace bash-only helpers, `realpath`-aware containment | Existing unit tests pass from any cwd + symlink/Windows tests pass |
| 4 | **Phase 2** | `#562` | Build `apex-mcp` (`@modelcontextprotocol/server` v2, ~8 tools) + `launch-azure-mcp.mjs` (`@azure/mcp@3.0.0`, read-only namespace allowlist) | MCP protocol + brownfield tests pass on Linux & Windows CI |
| 5 | **Phase 3** | `#563` | Assemble Agent Plugins 1.0.0 (`apex-core`, `apex-diagrams`, `apex-rfi-rfp`), migrate agents/skills/7 rules, add `build-plugin` + `validate:plugins` | Built plugin payload passes schema, closure, and least-privilege checks |
| 6 | **Phase 4** | `#564` | Cross-surface & cross-OS full-lifecycle verification matrix (VS Code, Copilot CLI, Copilot App; Windows/WSL2/Linux/macOS; `microsoft/azure-skills` coexistence) | Every required matrix cell passes on built release candidate |
| 7 | **Phase 5** | `#565` | Publish to `jonathan-vella/apex-plugins`, immutable tags / SHA pinning, Windows/WSL2 operational runbook & docs | Clean install verified from `jonathan-vella/apex-plugins` |
