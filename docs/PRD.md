# Product Requirements Document (PRD): APEX Agent Plugins 1.0.0

**Date**: 2026-11-27
**Owner**: Jonathan Vella (`@jonathan-vella`)
**Execution Plan**: [apex-agent-plugins-migration.md](./exec-plans/apex-agent-plugins-migration.md)
**Backlog**: [BACKLOG.md](./BACKLOG.md)

## 1. Problem Statement

Current APEX (`apex-legacy/`) is tightly coupled to cloning a repository template and running in VS Code inside a
Linux devcontainer. Agents rely on repo-root paths (`.github/data/`, `tools/scripts/`, `tools/schemas/`), bare
`apex-recall` shell invocations, bash-only scripts, and `lefthook.yml` git hooks.

A prior rewrite attempt (`.archive/pre-reset-2026-11/`) replaced APEX's multi-agent architecture and `apex-recall`
with a 6-package TypeScript kernel monorepo, adding high complexity and diverging from how APEX works.

## 2. Product Goal

Deliver **current APEX** as a standard **Agent Plugins 1.0.0** distribution published via `jonathan-vella/apex-plugins`
so users can run APEX in any greenfield or brownfield repository across:

- **VS Code** (Copilot harness) — Windows, Linux, macOS
- **GitHub Copilot CLI** — Linux, WSL2, macOS
- **GitHub Copilot App** — Windows (native + WSL2), macOS, Linux AppImage

Without cloning a template repo, without a devcontainer, and without rewriting APEX's core multi-agent workflow.

## 3. Hard Constraints (Cutting-Edge Stable GA Only)

Zero legacy formats, zero deprecated APIs, zero preview/beta dependencies (baseline verified 2026-11-27):

| Component | Required GA Baseline | Excluded |
|---|---|---|
| Plugin format | Agent Plugins **1.0.0** (`plugin.schema.json`, `mcp.schema.json`) | 1.1.0 draft, `.plugin/`, `.claude-plugin/`, root `.mcp.json` / `hooks.json` |
| MCP protocol & SDK | **MCP 2026-07-28** + **`@modelcontextprotocol/server` v2.x** (`2.3.1+`) | `@modelcontextprotocol/sdk` v1.x, `sse`, `roots/list`, `sampling` |
| Node.js | **Node.js 26 LTS** (`>=26.13.1`) | Node 27 alpha, `node:sqlite` RC, Node 22 |
| Python | **Python 3.15** (`>=3.15.0`, Windows UTF-8 default, stdlib `sqlite3` FTS5) | Downgrading to 3.11; experimental JIT |
| Azure MCP | **`@azure/mcp@3.0.0`** (GA) | `@azure/mcp@4.0.0-beta.*` |
| Agent frontmatter | `com.github.copilot/{agents,rules}` | Local-only `agents: [...]`, `handoffs:`, retired `infer:`, `argument-hint:` |

## 4. Functional Requirements

1. **Modular Marketplace (`jonathan-vella/apex-plugins`):**
   - `apex-core`: Self-contained APEX workflow (14 main agents, 7 subagents, runtime skills, 7 narrow-glob A-class
     runtime rules, `apex-mcp`, `apex-azure-mcp`).
   - `apex-diagrams`: Optional Python/Graphviz/CairoSVG pack (with an explicit conditional gate in `apex-core` if
     split, or retained in `apex-core` if mandatory).
   - `apex-rfi-rfp`: Optional bid/pursuit pack.
2. **Bundled `apex-mcp` Server (`server/dist/index.mjs`):**
   - Coarse-grained (~8 action-routed tools): `apex_session`, `apex_review`, `apex_requirements`, `apex_cost`,
     `apex_iac`, `apex_catalog`, `apex_governance`, `apex_health`.
   - Imports runtime `.mjs` validators/renderers in-process; ports `validate_question_batching.py` to TypeScript;
     serves bundled AVM/deprecation/workflow-graph data; bridges bundled Python 3.15 `apex-recall` (full 1:1 command
     parity including `policy-source`, `check-gate`, `recover-state`) and `discover.py`.
   - Enforces `realpath`-aware workspace containment on all workspace-scoped tools.
3. **Collision-Free `apex-azure-mcp` (`server/dist/launch-azure-mcp.mjs`):**
   - Registered under `"apex-azure-mcp"` (zero collision with `microsoft/azure-skills` or workspace `.mcp.json`).
   - Runs `@azure/mcp@3.0.0` with `--mode namespace --read-only --namespace <allowlist>`, verifying exact version
     `3.0.0` before reusing any local `azmcp` binary, and respecting corporate npm registries (`NPM_CONFIG_REGISTRY` /
     `.npmrc`) and Windows spawning.
4. **Three-Store Storage Contract:**
   - Canonical state: `<workspace>/agent-output/<project>/_meta/00-session-state.json` (per-worktree isolation).
   - Derived FTS5 cache: `${PLUGIN_DATA}/recall/<worktree-realpath-hash>.db` (schema-versioned; never write to
     `${PLUGIN_ROOT}`).
   - Private governance evidence: preserved in `XDG_STATE_HOME` / user home (`policy_source.py:54`).
5. **Security & Least Privilege:**
   - Per-agent MCP tool grants: read-only `challenger-review-subagent` keeps `tools: [read, search]` and is never
     granted `apex-mcp/*`.
   - Shell deployment gates (`azd`/`terraform` in `07b`/`07t`) preserve explicit human preview approval.

## 5. Non-Goals

- Replacing APEX's multi-agent architecture with a single foreground agent.
- Rewriting `apex-recall` (8.3k LOC) in TypeScript (uncommitted future option only if measured evidence justifies it).
- Shipping workspace `.apex/bin/` shims or a multi-package npm distribution.
- Supporting Copilot Cloud Agent for full interactive workflows.
- Shipping heavy `hooks.json` policing in v1.

## 6. Success Criteria

- **Step 0 Spike passes** across VS Code, Copilot CLI, and Copilot App (delegation, negative read-only denial,
  `ask_user`, `user-invocable: false`, `rules/`, GUI `PATH`, sandbox qualification).
- **Full-lifecycle fixture tests pass** on the built plugin payload across Windows, Linux/WSL2, and macOS (Step 1 →
  Step 2 → `policy-source` → stale/failed review → risk authorization → `check-gate`/`recover-state` → Step 4 IaC →
  approved deployment routing).
- **Zero collisions** when installed alongside `microsoft/azure-skills`.
- **Clean brownfield adoption** in a repo with zero APEX files.
