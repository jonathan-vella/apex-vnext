# APEX Migration to Agent Plugins 1.0 + `apex-mcp` + `apex-azure-mcp`

## Status

- **State**: Active (Pre-Phase 0 Host-Feasibility Spike required before implementation)
- **Owner**: Jonathan Vella ([@jonathan-vella](https://github.com/jonathan-vella)) with GitHub Copilot
- **Created**: 2026-11-27
- **Updated**: 2026-11-27 (incorporated rubber-duck review findings — 10 blocking, 5 non-blocking)
- **Scope**: Package APEX as modular **Agent Plugins 1.0.0** plugins (`apex-core`, `apex-diagrams`, `apex-rfi-rfp`)
  with a bundled **`apex-mcp`** server and collision-free **`apex-azure-mcp`** server, supporting **VS Code**,
  **GitHub Copilot CLI**, and **GitHub Copilot App** across **Windows (native + WSL2), Linux, and macOS**.
- **Research Reference**: Session research report `how-i-can-migrate-apex-to-agent-plugins-maybe-crea.md` (18 verified
  citations across repo audit and official GitHub, VS Code, Agent Plugins, MCP, Node.js, and Python docs).

## Cutting-Edge Stable Baseline (Zero Legacy, Zero Deprecated, Zero Previews)

Every dependency, schema, runtime, and convention in this plan targets the **latest stable GA release** as of 2026-11-27:

| Layer | Target (Latest Stable GA) | Explicitly Excluded |
|---|---|---|
| **Plugin Standard** | **Agent Plugins 1.0.0** (`https://agent-plugins.org/schemas/1.0.0/{plugin,mcp}.schema.json`) | Agent Plugins 1.1.0 (working draft), legacy un-schema'd `plugin.json`, `.plugin/`, `.claude-plugin/`, root `.mcp.json` / `hooks.json` |
| **MCP Protocol** | **MCP 2026-07-28** (`stdio` local, `streamable-http` remote) | Deprecated `sse` transport, deprecated `roots/list`, deprecated `sampling` |
| **MCP TypeScript SDK** | **`@modelcontextprotocol/server` v2.x** (`2.3.1+`, implements 2026-07-28) | Legacy `@modelcontextprotocol/sdk` v1.x (maintenance-only) |
| **Node.js Runtime** | **Node.js 26 LTS "Lithium"** (`>=26.13.1`, Active LTS through Apr 2029) | Node 27 (alpha/preview; LTS Oct 2027), `node:sqlite` (RC in Node 26 LTS), Node 22 |
| **Python Runtime** | **Python 3.15** (`>=3.15.0`, GA Oct 9, 2026 — UTF-8 default on Windows, stable stdlib `sqlite3` FTS5) | Downgrading `apex-recall` to 3.11; experimental JIT opt-in |
| **Azure MCP Server** | **`@azure/mcp@3.0.0`** (GA Oct 12, 2026) | `@azure/mcp@4.0.0-beta.*` (preview) |
| **Copilot Extensions** | `com.github.copilot/{agents,rules}` (hooks deferred in v1) | Local-only `agents: [...]` allowlist (Local harness deprecated Feb 2027), `handoffs:`, retired `infer:`, `argument-hint:` |

## Key Architectural Decisions

1. **Package Current APEX First (Lessons from `jonathan-vella/apex-vnext`):**
   - Keep APEX's existing multi-agent workflow (`01-Orchestrator` through `08-As-Built`, read-only
     `challenger-review-subagent`), existing `apex-recall`, and existing `.mjs` validators. Do **not** rewrite into a
     single-agent architecture or a multi-package TypeScript kernel monorepo.
   - Distribute **only** as an Agent Plugin (`apex-core@apex-plugins`) — no workspace `.apex/bin/` shims and no
     parallel npm package publish matrix.
   - Omit heavy hook-policing machinery in v1 (`challenger-review-subagent` already restricts `tools: [read, search]`).
2. **Host-Feasibility Spike First (Step 0 Gate):**
   - Validate cross-host agent delegation, negative tool permissions, `ask_user`, `user-invocable: false`,
     `com.github.copilot/rules/`, GUI `PATH`, and sandboxed operation on VS Code, Copilot CLI, and Copilot App
     **before** Phase 0. Unsupported required behavior blocks release (never papered over with README footnotes).
3. **Clear Split Between Bundled Assets and Host Prerequisites:**
   - **Bundled in plugin (`${PLUGIN_ROOT}`):** `server/dist/*.mjs`, `server/python/` source (`apex_recall` +
     `discover.py`), `server/data/`, `server/schemas/`.
   - **Host prerequisites (verified by `apex_health`):** Node.js 26 LTS (`>=26.13.1`), Python 3.15 (`>=3.15.0` with
     `sqlite3` FTS5), and Azure CLI (`az`).
4. **Modular Marketplace & Explicit Diagram Gate (`jonathan-vella/apex-plugins`):**
   - Agent Plugins 1.0.0 has **no plugin-to-plugin `dependencies` field**. Keep all coupled workflow components in
     **`apex-core`**, and split only optional add-ons (`apex-diagrams`, `apex-rfi-rfp`).
   - Because `05-iac-planner` and `standalone-assessment` currently require diagrams/charts, either keep diagram
     capability in `apex-core` or make diagram-dependent steps explicitly conditional with an actionable install
     prerequisite gate when `apex-diagrams` is absent.
   - Reuse `jonathan-vella/apex-plugins` and its `build-plugin` → `smoke-plugin-install` → `publish-plugin` pipeline
     (including CRLF→LF asset normalization).
5. **Coarse-Grained `apex-mcp` (~8 Action-Routed Tools) with Per-Agent Least Privilege:**
   - Built on `@modelcontextprotocol/server` v2 + Node 26 LTS (`server/dist/index.mjs`, offline-capable).
   - Imports runtime `.mjs` validators/renderers in-process, ports `validate_question_batching.py` (267 LOC) to
     TypeScript, serves bundled AVM/deprecation/workflow-graph data, and bridges bundled Python 3.15 `apex-recall`
     (with 1:1 command parity including `policy-source`, `check-gate`, and `recover-state`) + `discover.py`.
   - **Never grant `apex-mcp/*` to read-only subagents** (`challenger-review-subagent` keeps `tools: [read, search]`);
     grant only required tools per agent and verify actual denial on all three hosts.
   - Establish authorized workspace boundaries using **`realpath`-aware ancestor checks** (never raw lexical
     `path.resolve` on model-supplied input) and test symlinks and Windows drive/case boundaries.
6. **Three-Store Storage Contract & Per-Worktree Isolation:**
   - **Canonical project state:** `<workspace>/agent-output/<project>/_meta/00-session-state.json` (preserving layout
     v2 `_meta/`). Use **explicit per-worktree isolation** (do **not** share one SQLite cache across worktrees via
     `git-common-dir`, which causes `indexer.py` reindex thrashing).
   - **Derived FTS5 cache:** `${PLUGIN_DATA}/recall/<worktree-realpath-hash>.db` (schema-versioned, auto-rebuilt on
     mismatch). Never write inside `${PLUGIN_ROOT}`.
   - **Private governance evidence:** Preserve the existing `XDG_STATE_HOME` / user-home private store
     (`policy_source.py:54`) separately from the repository and `${PLUGIN_DATA}`, keeping existing permissions,
     scope bindings, and upgrade continuity.
7. **Collision-Free, Read-Only `apex-azure-mcp` (Exact Version Pin):**
   - Declared under `"apex-azure-mcp"` in `apex-core/mcp.json` with `--mode namespace --read-only --namespace
     <allowlist>` (~40 APEX namespaces, after verifying every required Azure MCP command works under `--read-only`).
   - Note: `--read-only` scopes MCP queries only; `07b`/`07t` deployments continue to run via `azd`/`terraform` shell
     commands under existing human approval gates.
   - Launched via `"command": "node", "args": ["${PLUGIN_ROOT}/server/dist/launch-azure-mcp.mjs"]`: verifies exact
     version `3.0.0` before reusing any binary on `PATH` or `${PLUGIN_DATA}/bin/`, else runs
     `npx -y @azure/mcp@3.0.0 server start ...` (with `shell: process.platform === "win32"` and corporate
     `NPM_CONFIG_REGISTRY` / `.npmrc` support).
8. **Strict Runtime vs. Repo-Dev Separation:**
   - Ship **only the 7 narrow-glob A-class runtime rules** in `com.github.copilot/rules/`; keep the 19 B-class APEX
     repo-dev instructions (`**/*.py`, `**/*.json`, `**/*.sh`, `**/*.ps1`, etc.) out of the plugin.
   - Trace the **full transitive runtime closure** (agents, rules, skills, references, templates, schemas, scripts) and
     test the **built plugin payload**, not just source.
9. **Non-Goals (Explicit Boundaries):**
   - Full interactive APEX workflows target **VS Code, GitHub Copilot CLI, and GitHub Copilot App** (not Copilot Cloud
     Agent, which lacks local `az login`, `ask_user`, and `powershell` hooks).
   - No committed rewrite of `apex-recall` (8.3k LOC) into TypeScript; revisit only if measured evidence justifies it.

---

## Target Directory Structure

```text
.github/plugin/marketplace.json            # Exposes apex-core, apex-diagrams, apex-rfi-rfp
plugins/
├── apex-core/
│   ├── plugin.json                        # Agent Plugins 1.0.0 ($schema)
│   ├── mcp.json                           # apex-mcp + apex-azure-mcp (Node launchers)
│   ├── skills/                            # Runtime apex-* skills (excl. diagrams & rfi-rfp)
│   ├── com.github.copilot/
│   │   ├── agents/                        # 14 mains + 7 subagents (per-agent tool grants)
│   │   └── rules/                         # 7 narrow-glob A-class runtime *.instructions.md
│   └── server/
│       ├── dist/
│       │   ├── index.mjs                  # Single-file ESM apex-mcp (@modelcontextprotocol/server v2)
│       │   └── launch-azure-mcp.mjs       # Cross-OS pinned @azure/mcp@3.0.0 launcher
│       ├── data/                          # avm-module-index.json, azure-deprecations.json, workflow-graph.json
│       ├── schemas/                       # Runtime JSON schemas (or inlined in dist/index.mjs)
│       └── python/                        # Bundled Python source: apex_recall + discover.py (host Python 3.15)
├── apex-diagrams/
│   ├── plugin.json                        # Optional Graphviz/CairoSVG/matplotlib pack
│   └── skills/apex-python-diagrams/
└── apex-rfi-rfp/
    ├── plugin.json                        # Optional RFI/RFP/BAFO pursuit pack
    └── skills/apex-rfi-rfp/
```

---

## Execution Phases

### Step 0: Host-Feasibility Spike (Mandatory Gate Before Phase 0)

Goal: Empirically verify every undocumented cross-host behavior on a tiny throwaway Agent Plugin 1.0.0 **before**
refactoring APEX.

- [ ] **S0.1 Build a minimal spike plugin** (`plugin.json` 1.0.0, `mcp.json` with a 2-tool `echo`/`write_probe` Node
  stdio server, 1 coordinator agent, 1 hidden read-only leaf agent with `user-invocable: false` and `tools: [read,
  search]`, 1 `com.github.copilot/rules/probe.instructions.md` with `applyTo: "**/*.bicep"`).
- [ ] **S0.2 Run the spike across VS Code (Win/Linux), Copilot CLI (Linux/WSL2), and Copilot App (Win/macOS/Linux):**
  - Confirm named specialist delegation (`task`) works without Local-only `agents: [...]`.
  - **Negative permission test:** Confirm the read-only leaf agent is **actually denied** `write_probe` and file writes
    (not silently granted `*`).
  - Confirm `ask_user` works with explicit `tools: [..., ask_user]` (and record whether omitting `tools` is unsafe).
  - Confirm `user-invocable: false` hides the leaf from the agent picker on all three hosts.
  - Confirm `com.github.copilot/rules/*.instructions.md` auto-attaches on `.bicep` glob match.
  - Confirm GUI `PATH` resolves `node` (v26 LTS) and `python` (3.15 + `sqlite3` FTS5) on native Windows.
  - **Qualify local sandboxing:** Test whether sandboxed sessions allow `apex-mcp` stdio + workspace access; document
    only narrow, verified exceptions rather than recommending blanket sandbox-off.

**Exit Gate:** All required host capabilities are verified. Any unsupported required behavior blocks Phase 0 until an
approved architectural adjustment is recorded.

---

### Phase 0: Runtime Prep, Parity Inventory & Decoupling (In-Repo, Non-Breaking)

Goal: Inventory the full runtime closure, separate workspace paths from plugin assets in `apex-recall`, and align
runtime baselines without breaking existing CI or workflows.

- [ ] **0.1 Inventory runtime pins across CI, devcontainer, and lockfiles:** Audit `.github/workflows/` (e.g.,
  `consumer-template-checks.yml:17` currently on Node 24), `.devcontainer/`, `package.json`, `pyproject.toml`,
  `tools/apex-recall/pyproject.toml`, and `tools/registry/tool-version-pins.json` before raising minimums to Node 26
  LTS (`>=26.13.1`) and Python 3.15 (`>=3.15.0`).
- [ ] **0.2 Complete 1:1 `apex-recall` & runtime closure inventory:**
  - Document every `apex-recall` subcommand, flag, error code, and recovery/authorization contract (explicitly
    including `policy-source`, `check-gate`, and `recover-state`).
  - Trace the full transitive runtime closure across agents, rules (e.g., `sku-manifest.instructions.md:213`), skills,
    references (e.g., `standalone-assessment.md:81`), templates, schemas, and scripts.
  - Inventory every Azure MCP command APEX uses and verify compatibility with `--read-only`.
- [ ] **0.3 Separate `workspaceRoot` from `pluginAssetsRoot` inside `apex-recall`:**
  - Update `complete_step.py:140`, `risk_gate.py:110`, `assessment.py:50`, `practical.py`, and `policy_source.py` so
    immutable validators, schemas, and `workflow-graph.json` resolve from `APEX_PLUGIN_ROOT` (falling back to repo
    root), while mutable artifacts resolve from `workspaceRoot` (preserving `_meta/00-session-state.json`).
  - Explicitly document and preserve `policy_source.py:54`'s private-evidence store (`XDG_STATE_HOME` / user home).
- [ ] **0.4 Decouple runtime instructions from repo-dev instructions:**
  - Verify the 7 A-class runtime rules (`azure-artifacts`, `azure-yaml`, `governance-discovery`,
    `iac-bicep-best-practices`, `iac-plan-best-practices`, `iac-terraform-best-practices`, `sku-manifest`).
  - Move or inline runtime-referenced sections from B-class files (`agent-operating-frame`, `lesson-collection`,
    `agent-authoring#no-direct-markdownlint-on-agent-output-rule`) and `instructions/references/*` so runtime
    agents/skills never link to B-class repo-dev files.
- [ ] **0.5 Resolve optional `apex-diagrams` contract:**
  - Decide whether to keep `apex-python-diagrams` in `apex-core` OR update `05-iac-planner.agent.md:217` and
    `standalone-assessment.md:79` so diagram/chart steps explicitly detect missing `apex-diagrams` and stop with an
    actionable install prerequisite.
- [ ] **0.6 Fix hardcoded repo-depth and cwd paths in skill scripts:**
  - Replace `Path(__file__).resolve().parents[4]` in
    `.github/skills/apex-rfi-rfp/scripts/audit_pursuit_skus_and_rates.py:54` with an explicit CLI arg / env fallback
    (`APEX_DATA_DIR`).
  - Replace cwd-relative `Path(".github/data/alz-corp-policy-baseline.json.gz")` default in
    `.github/skills/apex-azure-governance-discovery/scripts/generate_alz_baseline.py:36` with an explicit output path
    parameter.
- [ ] **0.7 Audit `apex-recall` `--json` parity & `.gitattributes`:**
  - Verify all 16 `tools/apex-recall/src/apex_recall/commands/*.py` modules emit clean JSON with `--json` and log only
    to `stderr`.
  - Update existing `.gitattributes` for LF normalization on plugin scripts/bundles **without** weakening existing
    artifact-hash rules (`.gitattributes:83`).

**Exit Gate:** `npm run validate:all` and `pytest` pass on existing repo, and `apex-recall` passes gated transition
tests against a brownfield workspace containing zero APEX repo files.

---

### Phase 1: Refactor Runtime `.mjs` Modules for In-Process Bundling

Goal: Make all ~15 runtime Node scripts cleanly importable in-process without `import.meta.url` repo-root assumptions
or child-process spawns.

- [ ] **1.1 Inject `workspaceRoot` and schema loaders** into the audited runtime scripts:
  - `tools/scripts/validate-challenger-findings.mjs` (remove `process.cwd()` defaults in `runValidator`)
  - `tools/scripts/evaluate-risk-authorization.mjs` (replace line 10 `new URL("../schemas/...", import.meta.url)` with
    injected/inlined schema)
  - `tools/scripts/record-review.mjs` (pass `root` explicitly everywhere)
  - `tools/scripts/cost-estimate.mjs` (replace `import.meta.url` `ROOT`/`RENDERER` at lines 42–43 and remove
    `spawnSync` by importing `renderManifest` directly from `render-sku-manifest-md.mjs`)
  - `tools/scripts/requirements-discovery.mjs` (keep pure exports)
  - `tools/scripts/render-sku-manifest-md.mjs` (inject root rather than `import.meta.url` at line 36)
  - `tools/scripts/derive-sku-allowlist.mjs` (refactor CLI-only body into exported pure function; remove
    `process.exit` from library path)
  - `tools/scripts/validate-iac-handoff.mjs` (add `root` parameter to replace hardcoded `ROOT` at lines 110, 155, 182;
    inject schema)
  - Remaining runtime scripts: `assessment-cost.mjs`, `assessment-action-register.mjs`,
    `validate-challenge-findings-decisions.mjs`, `check-h2-order.mjs`, `validate-iac-contract*.mjs`,
    `validate-policy-property-map.mjs`.
- [ ] **1.2 Replace bash-only runtime helpers:**
  - Replace `tools/scripts/format-bicep-tree.sh` with a cross-platform Node helper (`format-bicep-tree.mjs` calling
    `bicep format`).
  - Audit `apex-azure-deploy/scripts/run-sql.sh` and `apex-azure-diagnostics/scripts/*.sh` to ensure paired PowerShell
    (`.ps1`) or cross-platform Node equivalents exist.
- [ ] **1.3 Verify `realpath`-aware Windows/POSIX containment:** Implement real-path-aware ancestor checks and safe
  new-path creation (never rely on lexical `path.resolve` alone); normalize artifact-recorded paths to POSIX `/` and
  test symlinks, Windows drive/case boundaries, and cross-workspace requests.

**Exit Gate:** Existing Node unit tests + CLI invocations continue passing identically when invoked from any working
directory.

---

### Phase 2: Build `apex-mcp` (`@modelcontextprotocol/server` v2) & `launch-azure-mcp.mjs`

Goal: Build a fast, offline-capable, cross-OS MCP server package under `tools/mcp-servers/apex-mcp/`.

- [ ] **2.1 Scaffold `tools/mcp-servers/apex-mcp/`:**
  - TypeScript + `@modelcontextprotocol/server` (`^2.3.1`, MCP 2026-07-28) + `zod` + `esbuild`
    (`--bundle --platform=node --format=esm --target=node26`).
  - Zero stdout logging (stderr-only structured logger).
  - Never use deprecated MCP `sse`, `roots/list` (as primary), or `sampling`.
- [ ] **2.2 Implement the ~8 coarse-grained, action-routed MCP tools** (all workspace tools enforce `realpath`-aware
  workspace containment):
  1. `apex_session` (`action: init | show | handoff | checkpoint | start_step | complete_step | transition | decide |
     finding | review_audit | policy_source | check_gate | recover_state | search | sessions | files | reindex |
     assessment`) — bridges bundled Python 3.15 `apex-recall` with `APEX_PLUGIN_ROOT`, uses **per-worktree
     isolation** (`${PLUGIN_DATA}/recall/<worktree-realpath-hash>.db`, preserving `_meta/00-session-state.json` and
     the separate `XDG_STATE_HOME` private governance store), and supports brownfield repos without APEX root files.
  2. `apex_review` (`action: preflight | record | validate | validate_decisions | evaluate_risk`) — in-process `.mjs`
     validators.
  3. `apex_requirements` (`action: discovery_form | validate_question_form`) — in-process `requirements-discovery.mjs`
     and TypeScript port of `tools/scripts/validate_question_batching.py` (267 LOC).
  4. `apex_cost` (`action: preflight | publish | assessment_cost | action_register | render_sku_manifest |
     derive_sku_allowlist`) — in-process `.mjs` modules.
  5. `apex_iac` (`action: validate_handoff | validate_contract | validate_policy_map | check_h2_order | format_bicep`)
     — in-process `.mjs` modules (replaces `lefthook.yml` runtime gates for adopter repos).
  6. `apex_catalog` (`action: avm_lookup | deprecations_check | workflow_graph`) — reads `${PLUGIN_ROOT}/server/data/`
     (in-memory cached).
  7. `apex_governance` (`action: discover | validate_snapshot | render`) — gated subprocess wrapper around bundled
     `discover.py` (parses line-1 JSON status; respects private-evidence paths and `az` auth).
  8. `apex_health` — cross-OS/WSL2 diagnostic reporting OS, WSL2 detection, `node` 26 LTS version, `python` 3.15 +
     `sqlite3` FTS5 availability, `az` CLI login/tenant status, verified `azmcp` version (`3.0.0`), `workspaceRoot`,
     `PLUGIN_ROOT`, `PLUGIN_DATA`, and private-evidence store status.
- [ ] **2.3 Build `launch-azure-mcp.mjs` (`apex-azure-mcp`):**
  - Resolves in order: (1) cached pinned `@azure/mcp@3.0.0` in `${PLUGIN_DATA}/bin/` or an `azmcp` on `PATH` **whose
    reported version matches `3.0.0`** (never silently run an unpinned version), (2) `npx -y @azure/mcp@3.0.0 server
    start` with `--mode namespace --read-only --namespace <allowlist>` (reusing `apex-vnext`'s ~40-namespace
    allowlist), `shell: process.platform === "win32"`, and inherited `NPM_CONFIG_REGISTRY` / `.npmrc`.
  - Pipes stdio transparently with zero extra stdout bytes.
- [ ] **2.4 Add MCP contract & integration tests:**
  - Test stdio JSON-RPC initialize + `tools/list` + every tool action against a temporary brownfield workspace (no APEX
    `package.json` or `AGENTS.md`).
  - Test `${PLUGIN_DATA}` cache schema-version bump auto-rebuild.

**Exit Gate:** `server/dist/index.mjs` and `server/dist/launch-azure-mcp.mjs` pass automated MCP protocol tests on both
Linux and Windows CI runners.

---

### Phase 3: Assemble Agent Plugins 1.0.0 & Marketplace Payload

Goal: Package APEX into clean, valid Agent Plugins 1.0.0 directories and `.github/plugin/marketplace.json`.

- [ ] **3.1 Create manifests:**
  - `.github/plugin/marketplace.json` (`name: "apex"`, exposing `apex-core`, `apex-diagrams`, `apex-rfi-rfp`).
  - `plugins/apex-core/plugin.json` (`$schema: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` — closed
    field set only).
  - `plugins/apex-core/mcp.json` (`$schema: https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`, declaring
    `apex-mcp` and `apex-azure-mcp`; do **not** declare env keys literally named `PLUGIN_ROOT` or `PLUGIN_DATA`).
  - `plugins/apex-diagrams/plugin.json` and `plugins/apex-rfi-rfp/plugin.json`.
- [ ] **3.2 Migrate & clean agents (`plugins/apex-core/com.github.copilot/agents/`):**
  - Replace `"azure-mcp/*"` → `"apex-azure-mcp/*"` on Azure-using agents only, and grant **per-agent `apex-mcp`
    tools** (never grant `apex-mcp/*` to read-only `challenger-review-subagent`, which stays `tools: [read, search]`).
  - Strip Local-only/deprecated frontmatter (`agents: [...]`, `handoffs:`, `infer:`, `argument-hint:`); preserve
    `user-invocable` and `disable-model-invocation`.
  - Replace bare `apex-recall`, `node tools/scripts/...`, and `python3 tools/scripts/...` instructions with `apex-mcp`
    tool calls.
  - Replace broken `../skills/...` relative links (shifted by `com.github.copilot/agents/` depth) with native skill
    names and `apex_catalog` tool calls.
  - Remove VS Code-only harness prose ("Run in the VS Code Copilot harness") and verify every agent stays under the
    **30,000-character** prompt limit.
- [ ] **3.3 Migrate rules (`plugins/apex-core/com.github.copilot/rules/`):**
  - Copy **only the 7 A-class runtime `*.instructions.md`** files (`azure-artifacts`, `azure-yaml`,
    `governance-discovery`, `iac-bicep-best-practices`, `iac-plan-best-practices`, `iac-terraform-best-practices`,
    `sku-manifest`).
- [ ] **3.4 Migrate skills (`plugins/apex-core/skills/`, `apex-diagrams/skills/`, `apex-rfi-rfp/skills/`):**
  - Verify every immediate child directory of `skills/` has a valid `SKILL.md` with plain kebab-case `name` matching
    its directory name.
  - Update skill bodies referencing `.github/data/`, `tools/schemas/`, or `tools/scripts/` to use `apex-mcp` tools.
- [ ] **3.5 Defer hooks in v1 (keep optional):**
  - Omit `com.github.copilot/hooks/hooks.json` in v1 (unlike `apex-vnext`, APEX's read-only
    `challenger-review-subagent` needs no `preToolUse` policing). If hooks are added later, use `version: 1` with
    `apex-vnext`'s PowerShell `[System.IO.Path]::Combine([string]$env:PLUGIN_ROOT, ...)` idiom and degrade cleanly
    when enterprise `allowManagedHooksOnly` disables plugin hooks.
- [ ] **3.6 Add CI build, smoke & publish pipeline (reusing `apex-vnext` patterns):**
  - Adapt `build-plugin.mjs` (including CRLF→LF asset normalization), `smoke-plugin-install.mjs`, and
    `publish-plugin.mjs` targeting `jonathan-vella/apex-plugins` (excluding `agent-output/`, `tools/tests/`,
    `.devcontainer/`).
  - Add `npm run validate:plugins` to validate the **built plugin payload** (not just source): Agent Plugins 1.0.0
    schemas (`plugin.json`, `mcp.json`, `marketplace.json`), semver sync, `<30,000` char agent prompts, zero B-class
    globs or legacy fields, zero broken transitive references, and verified read-only tool grants on
    `challenger-review-subagent`.

**Exit Gate:** `npm run build:plugins && npm run validate:plugins` passes cleanly on the built payload in CI.

---

### Phase 4: Cross-Surface & Cross-OS Full-Lifecycle Verification Matrix (Release Gate)

Goal: Verify the **built plugin payload** across the full lifecycle on all supported hosts and OSes. Unsupported
required behavior **blocks release** (never downgraded to a README note).

| Test Case | VS Code (Win / Linux / macOS) | Copilot CLI (Win / Linux / macOS) | Copilot App (Win / WSL2 / macOS / Linux AppImage) |
|---|---|---|---|
| **Install & discovery** (`marketplace add` + `install apex-core@apex-plugins` + VS Code auto-discovery of `~/.copilot/installed-plugins/`) | [ ] | [ ] | [ ] |
| **MCP startup & `apex_health`** (`apex-mcp` + exact `@azure/mcp@3.0.0`, Python 3.15 + FTS5, zero `npx.cmd` error on Windows, GUI `PATH`) | [ ] | [ ] | [ ] |
| **Coexistence with `microsoft/azure-skills`** (zero server-name collision; APEX agents bind strictly to `apex-azure-mcp/*`) | [ ] | [ ] | [ ] |
| **Negative permission & containment tests** (`challenger-review-subagent` denied write tools; symlink/drive/cross-workspace escapes rejected) | [ ] | [ ] | [ ] |
| **Brownfield repo + per-worktree isolation** (`_meta/00-session-state.json`, per-worktree `${PLUGIN_DATA}` cache, concurrent worktree safety) | [ ] | [ ] | [ ] |
| **Full-lifecycle fixture run** (Step 1 → Step 2 → `policy-source` private store → stale/failed review → risk authorization → `check-gate`/`recover-state` → Step 4 IaC → approved deployment routing) | [ ] | [ ] | [ ] |
| **Optional `apex-diagrams` gate** (verifies clean prerequisite stop when `apex-diagrams` is absent, and normal render when installed) | [ ] | [ ] | [ ] |
| **Corporate proxy / offline & sandbox qualification** (`apex-mcp` starts offline; `launch-azure-mcp.mjs` respects `NPM_CONFIG_REGISTRY` and verified `3.0.0` binary; sandbox behavior qualified) | [ ] | [ ] | [ ] |

**Exit Gate:** Every required matrix cell passes on the built release candidate. Live Azure write deployments remain
separately gated behind human preview approval.

---

### Phase 5: Distribution, Versioning & Operational Runbook

- [ ] **5.1 Release publishing:** Publish slim `plugins/` payloads to the existing `jonathan-vella/apex-plugins`
  marketplace repo via `publish-plugin.mjs` so `~/.copilot/installed-plugins/` clones stay small.
- [ ] **5.2 Reproducible enterprise pinning:** Publish immutable Git tags (`v1.0.0`) and document SHA-pinned
  `marketplace.json` / `.github/copilot/settings.json` recipes for enterprise teams.
- [ ] **5.3 Documentation & Windows/WSL2 operational runbook (from `apex-vnext`):** Update `README.md` and
  `apex-docs` with:
  - Host prerequisites (Node.js 26 LTS `>=26.13.1`, Python 3.15 `>=3.15.0` with `sqlite3` FTS5, `az` CLI) vs.
    plugin-bundled components.
  - Single-store install rule: install once via Copilot CLI into `~/.copilot` (`%USERPROFILE%\.copilot`); do **not**
    also install via VS Code's Agent Plugins marketplace view (causes duplicate entries).
  - Windows update/uninstall procedure: close all VS Code windows first (file locks on
    `~/.copilot/installed-plugins/`), then run **Developer: Restart Local Agent Host** after reopening.
  - Sandboxing guidance: document verified sandboxed operation from Step 0 / Phase 4, listing only narrow,
    evidence-backed exceptions rather than a blanket sandbox-off default.
  - One-host-per-workspace rule: Windows native and WSL2 maintain separate plugin stores and auth sessions.

---

### Future Option (Uncommitted)

- **Pure-Node `apex-recall`:** Do **not** commit to rewriting `apex-recall` (8.3k LOC) or `discover.py` in TypeScript.
  Revisit only if measured user friction or compatibility evidence justifies the cost (and not before Node.js 27 LTS
  in October 2027, when `node:sqlite` is stable in an LTS line).
