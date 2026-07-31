## APEX vNext Checkpoint

- **Updated:** 2026-07-29 UTC
- **Milestone:** L - Mermaid and Python diagram migration
- **Repository:** `jonathan-vella/apex-vnext`
- **Default and integration branch:** `main`
- **Characterization base:** `b27d17350870a0ed3d5411346701cbb2eb6a4d4b`
- **Active issue:** [#173](https://github.com/jonathan-vella/apex-vnext/issues/173) - active diagram consumer migration
- **Working branch:** `feat/173-diagram-consumers`
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
PR #128 adds a strict Copilot CLI JSONL adapter and hardens normalized sample validation against forged identity,
partial cache evidence, unsafe totals, mixed fixture/live groups, and content-capture ambiguity. PR #132 adds the VS Code
source adapter with exact-byte provenance. PR #133 makes the version-bound stratified matrix immutable. Issue #126
completes all 12 live normal/retry cells across simple-neutral, standard-Bicep, and standard-Terraform scenarios for both
supported clients. The final aggregate reports `coverage.complete: true` and 12 unique sample IDs; aggregation accepted
12 distinct exact-byte source digests. A tracked content-free receipt preserves those identifiers and the aggregate
digest. Required input/output/chat-call counters are measured; unavailable cache counters remain report-only and no
comparative improvement claim is made.
PR #135 closes issue #126 with a content-free, validator-pinned context receipt. Issue #136 removes Astro MCP from
workspace discovery and adds a negative mutation gate without changing the remaining MCP integrations.
PR #137 closes issue #136. Issue #138 binds the installed Terraform MCP registry-only tool schemas, active consumers,
replacement owners, lifecycle denials, and the unpinned-clone provenance gap without removing the dependency.
PR #139 closes issue #138. Issue #140 implements the bounded public Registry client with deterministic fixtures,
explicit unavailable results, bounded caching/pagination/transport, and no lifecycle or arbitrary-URL surface.
PR #141 closes issue #140. PR #142 refreshes the AVM module index and version cache. PR #144 adds the user-scoped Azure
Artifacts PAT fallback captured from preserved local work. Issue #145 implements bounded native installed-provider
schema inspection and version-pinned official documentation routing before active Terraform MCP consumer migration.
PR #146 closes issue #145. Issue #147 migrates the characterized consumers, removes Terraform MCP discovery and setup,
archives the original evidence, rejects active reintroduction, and removes Go after its independent-consumer audit.
PR #148 closes issue #147 and completes Milestone I. Issue #150 adds versioned kernel-owned input requests and typed,
exact-state answer recording through APEX MCP; client-specific question mechanics and live outcome parity remain pending.
PR #151 closes issue #150. Issue #152 generates client-valid VS Code and Copilot CLI agents from one semantic role graph
and installs exactly one selected projection through the shared transactional lifecycle under ADR-0005.
PR #153 closes issue #152. Issue #154 adds deterministic normalized client outcomes, per-scenario comparisons, and a
proof-complete matrix aggregate that extends the existing live-qualification authority without granting release authority.
PR #155 closes issue #154. Issue #156 promotes VS Code `1.130.0` and Copilot Chat `0.58.0` from the completed content-free
context receipt into the exact canonical toolchain selection; paired live execution remains pending.
PR #158 closes issue #156. Issue #162 freezes normalized pricing replacement semantics and strict request/evidence
contracts before any ARM MCP adapter or transport is implemented.
PR #163 closes issue #162. PR #167 characterized the separate Azure MCP Server under an incorrect ARM MCP assumption.
Issue #169 removes that unrelated surface from Milestone K and binds the actual ARM MCP endpoint and toolsets. Issue #164
switches the implementation from a custom adapter to direct supported-client MCP access and retires the Python pack.
PR #171 closes issue #164. Issue #168 generalizes the existing Draw.io golden expectations into format-neutral semantics
and freezes Mermaid/Python routing before active consumer migration.
PR #172 closes issue #168. Issue #173 migrates active Step 3, Step 4, and Step 7 emitters, templates, validators, and
benchmarks to Python source plus PNG/SVG outputs. Draw.io remains historical evidence only. Issue #175 plans
the managed custom-agent
frontmatter and projection refresh against the current official `target` and environment-specific field contracts.
Issue #177 implements the first bounded slice: manifest-owned supported targets, explicit generated targets, and
fail-closed source, schema, generator, and projection validation without changing visibility or delegation semantics.
Issue #179 characterizes hidden-worker controls. The observed CLI accepted direct selection for every tested variant;
workers disabled for model invocation were absent from the `task` catalog, while task-callable workers remained directly
selectable. The CLI binary hash and installed VS Code version did not match the selected evidence inputs, so issue #180
must resolve the architecture before paired qualification. Issue #180 selects the fail-closed ADR-0006 boundary:
autonomous workers are omitted from the CLI projection until an exact supported client can enforce both controls.

The product contract now targets GitHub Copilot in VS Code and GitHub Copilot CLI, direct read-only Azure Resource
Manager MCP access, native Terraform lifecycle authority, Mermaid and Python diagrams, bounded improvement measurement,
and an npm-generated customization bundle. Astro, Terraform, custom Azure Pricing MCP, and Draw.io dependencies are
retired from active surfaces.

These are approved requirements, not live-parity claims. Live qualification uses the latest stable supported clients
and binds the observed version set to each candidate. The completed exact-version context matrix remains historical
usage evidence, not a live version pin or full client-parity qualification. Direct ARM MCP discovery still requires
paired live client qualification.

## Evidence State

| Evidence                                                                 | Disposition                                                             |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| PR #88 exact-head receipt for `8b3d9dbbb5beb8d6723c27da56cfd7144cb1cdf8` | Passing regression evidence for the archive change                      |
| Prior exact candidate `25530c339410e9758ae34538427f24bddfd83e1d`         | Historical characterization for the earlier contract                    |
| Prior VS Code, package, security, and live Azure results                 | Preserved in [FINAL-QUALIFICATION.md](FINAL-QUALIFICATION.md)           |
| Historical exact-version VS Code, Copilot Chat, and CLI context matrix   | Representative context baseline complete                                |
| Guidance, Markdown, lint, hook, and workflow ownership                   | Milestone N complete; Milestone O context baseline captured             |
| ARM MCP access and MCP retirements                                       | Direct access configured; custom pricing and Draw.io retired            |
| Bundle composition mappings, aggregate lock, and client projections      | Target-aware generation implemented; live client proof remains pending  |
| Hidden-worker visibility and delegation                                  | CLI workers omitted fail-closed under ADR-0006; qualification blocked   |
| Normalized client outcome contracts, corpus, and deterministic harness   | Implemented; exact-candidate paired live execution remains pending      |
| Pricing parity contracts and ARM MCP Cost/Pricing documentation          | Direct authority configured; paired live client checks remain pending   |
| Diagram semantics and improvement-measurement changes                    | Consumers migrated; rendering qualification and improvement remain open |
| Final deterministic, client, package, security, and live qualification   | Reopened                                                                |

## Release Boundaries

- `0.10.0` remains unreleased, and no exact release candidate is selected.
- Historical receipts do not authorize the expanded contract or any release mutation.
- No npm publication, tag, support date, deployment, or cutover is authorized.
- Native Bicep and Terraform paths retain deployment authority; managed MCP integrations remain read-only and typed.
- Existing stashes and unrelated worktree state must not be removed as part of release cleanup.

## Immediate Sequence

1. Return to issue #161 when interactive paired client execution and trusted receipt export are available.
2. Run direct ARM MCP discovery and representative read calls in both supported interactive clients.
3. Requalify ADR-0006's omitted-worker boundary on the exact selected clients before paired qualification.
4. Select a new exact candidate only after those milestones pass, then rerun every affected release gate.

## Resume Pointer

1. Read [PRD.md](PRD.md), [ROADMAP.md](ROADMAP.md), and [REGISTER.md](REGISTER.md).
2. Verify the current `main` head, open pull requests, worktrees, and dirty files before selecting a slice.
3. Resume Milestone J live qualification, then continue the roadmap in dependency order.
4. Treat [FINAL-QUALIFICATION.md](FINAL-QUALIFICATION.md) as historical evidence until a new candidate is declared.
