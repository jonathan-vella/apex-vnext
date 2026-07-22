# Modernization Ownership Inventory

This inventory freezes repository ownership surfaces before consolidation. The machine-readable source is
[`modernization-ownership.json`](../../tools/registry/modernization-ownership.json), bound to candidate
`1a1de02a3a17f496c713dd3c4e425c8df8d30d0e`. Existing registries remain canonical; this inventory references them and
does not copy their entries. New owners below are planned migration targets and do not claim implemented behavior.

## Classification Rules

- `keep`: one clear owner and adequate proof already exist.
- `consolidate`: retain behavior while replacing duplicate ownership with a generated or shared view.
- `rewrite`: the current owner is explicit, but its implementation has a proven structural limitation.
- `retire`: retain until the stated removal gate succeeds, then archive or remove.
- `investigate`: preserve the surface until consumers and replacement proof are complete.

No classification authorizes implementation by itself. Milestones I through O apply each change as an independently
revertible slice with characterization tests and baseline comparison.

The [guidance and automation review contract](GUIDANCE-AUTOMATION-REVIEW.md) defines the required Milestone H
characterization for agent guidance, Markdown, linting, and workflows. PR #94 completed those consumer maps and behavior
baselines before the related ownership entries move.

## Guidance And Invocation

| Surface                        | Class       | Canonical owner         | Decision                               |
| ------------------------------ | ----------- | ----------------------- | -------------------------------------- |
| `workspace-operating-frame`    | keep        | `AGENTS.md`             | Existing split remains authoritative   |
| `scoped-instruction-discovery` | consolidate | instruction frontmatter | `OWN-001`                              |
| `user-documentation`           | keep        | `docs/`                 | User guidance remains separate         |
| `managed-agent-manifest`       | keep        | customization manifest  | Roles, models, and invocation edges    |
| `model-catalog`                | keep        | model catalog           | Definitions plus generated assignments |
| `skill-discovery`              | consolidate | skill frontmatter       | `OWN-001`                              |
| `workflow-dag`                 | keep        | workflow graph          | Machine-readable workflow owner        |
| `managed-consumer-guidance`    | consolidate | managed instructions    | `OWN-017`                              |

## Runtime And Validation

| Surface                         | Class       | Canonical owner                   | Decision                   |
| ------------------------------- | ----------- | --------------------------------- | -------------------------- |
| `runtime-manifests`             | keep        | versioned config manifests        | Existing runtime boundary  |
| `workspace-package-boundaries`  | keep        | workspace package manifests       | Executable ownership units |
| `schema-libraries`              | investigate | contracts plus repository schemas | `OWN-005`                  |
| `customization-distribution`    | rewrite     | customization manifest            | `OWN-006`                  |
| `workflow-validator-ownership`  | keep        | kernel ownership table            | Runtime authorization map  |
| `repository-validator-graph`    | consolidate | validator graph registry          | `OWN-002`                  |
| `language-validator-boundaries` | keep        | language-native tools             | Preserve native parsing    |
| `artifact-template-validation`  | consolidate | artifact templates                | `OWN-004`                  |

## Re-Baselined Product Surfaces

| Surface                         | Class       | Planned canonical owner          | Decision  |
| ------------------------------- | ----------- | -------------------------------- | --------- |
| `copilot-client-projections`    | rewrite     | customization manifest           | `OWN-011` |
| `mcp-portfolio`                 | investigate | APEX MCP descriptor              | `OWN-012` |
| `pricing-evidence`              | rewrite     | versioned evidence contracts     | `OWN-013` |
| `diagram-routing`               | rewrite     | Mermaid and Python skills        | `OWN-014` |
| `improvement-outcome-ingestion` | rewrite     | improvement policy and contracts | `OWN-015` |
| `client-bundle-generation`      | rewrite     | CLI asset preparation            | `OWN-016` |

These rows identify migration targets only. Current VS Code projections, MCP servers, pricing pack, Draw.io paths,
manual improvement submission, and single-client bundle remain active until their individual replacement gates pass.

## Automation And Generation

| Surface                    | Class   | Canonical owner             | Decision                    |
| -------------------------- | ------- | --------------------------- | --------------------------- |
| `precommit-hooks`          | rewrite | `lefthook.yml`              | `OWN-003`                   |
| `github-required-checks`   | keep    | branch protection/workflows | Hosted execution boundary   |
| `maintenance-workflows`    | keep    | scheduled workflows         | Freshness and hygiene owner |
| `model-catalog-generation` | keep    | model catalog generator     | Derived assignments         |
| `entity-count-generation`  | keep    | count manifest              | Derived entity counts       |
| `avm-index-generation`     | keep    | AVM index refresher         | Generated module cache      |
| `freshness-generation`     | keep    | source freshness registry   | Drift metadata              |

## Compatibility And Diagnostics

| Surface                        | Class       | Canonical owner        | Decision  |
| ------------------------------ | ----------- | ---------------------- | --------- |
| `v1-compatibility-matrix`      | retire      | v1 behavior matrix     | `OWN-007` |
| `public-command-compatibility` | investigate | CLI command surface    | `OWN-010` |
| `validator-diagnostics`        | consolidate | shared reporter        | `OWN-008` |
| `workflow-telemetry`           | investigate | workflow baseline tool | `OWN-009` |
| `debug-log-profiling`          | investigate | local debug profiler   | `OWN-009` |

## Baseline Evidence

### Context

Static context-budget validation passes for frozen-artifact consumers. Dynamic workflow telemetry is a gap: the current
candidate contains no measured telemetry records. No context-size or token-savings claim is permitted until automatic,
representative samples exist.

### CI

Current-base `main` CI run `29838483672` passed on
`1a1de02a3a17f496c713dd3c4e425c8df8d30d0e` in 128 seconds. Earlier successful runs remain historical timing samples,
not a directly comparable post-modernization baseline. Required check names and command ownership remain in workflow
files and package scripts.

### Hooks

Hook validation and characterization tests pass. Hook timing remains a gap because no benchmark currently exercises
representative staged documentation, code, workflow, and artifact changes. Serial execution remains required while
multiple `stage_fixed` commands can race on the Git index.

PR #96 repaired the characterized pre-commit Markdown failure path: the hook now invokes the repository-owned lint
command, preserves diagnostics, and propagates a nonzero result with executable regression coverage. Serial execution
remains unchanged; representative hook timing and Git-index coordination remain later gates.

The `markdown-policy-enforcement` cluster records the split between audience-specific authoring guidance and the shared
executable lint contract. `OWN-018` keeps those guidance audiences separate while requiring hooks, editor integration,
and hosted checks to consume repository-owned commands with equivalent diagnostics and failure propagation.

The `exact-head-release-qualification` surface remains separate from `github-required-checks`: deterministic pull-request
checks protect integration, while exact-head qualification emits candidate-bound release evidence without merge,
publication, deployment, tag, or cutover authority.

Issue #103 adds a read-only hosted workflow contract over the existing owners. It freezes names, triggers, paths,
permissions, concurrency, action versions, external-runtime visibility, artifacts, and exact-head denial boundaries;
workflow YAML and branch protection remain authoritative and unchanged.

### Dependencies

The candidate lockfile SHA-256 is `5727e5fd6353b31b347cffaf6c537a5c0a6be20ce2460d66125d09b118f8b525`. Workspace
package manifests and TypeScript project references own package boundaries; exact package counts remain derived rather
than copied into this document.

### Diagnostics

Shared JSON and AJV diagnostic-library tests pass. Reporter adoption remains partial across registered validator
commands, so output compatibility snapshots are required before each family migrates.

### Drift

Recent changes include the legacy-agent archive and managed-discovery boundary. Existing model, entity-count,
source-freshness, orphan-content, and glob-audit checks remain the drift gates. This inventory adds ownership drift
validation without replacing those specialized checks.

## Ownership Decisions

- `OWN-001`: keep skill and instruction frontmatter canonical; generate audit views.
- `OWN-002`: keep validator metadata in the schema-backed repository graph and package scripts as executable projections.
- `OWN-003`: retain serial hooks until Git index coordination and representative benchmarks pass.
- `OWN-004`: derive artifact heading metadata from canonical templates.
- `OWN-005`: defer schema-library consolidation until source and consumer provenance is mapped.
- `OWN-006`: keep npm and the customization manifest authoritative while extending the transactional client lifecycle.
- `OWN-007`: retire the active v1 matrix only after issue #13 accepts cutover; archive it afterward.
- `OWN-008`: migrate validator diagnostics to the shared reporter by characterized family.
- `OWN-009`: keep telemetry advisory until automatic, representative, privacy-safe samples exist.
- `OWN-010`: retain public compatibility aliases until consumers and replacement guidance are known.
- `OWN-011`: generate VS Code and Copilot CLI projections from one customization manifest and compare typed outcomes.
- `OWN-012`: inventory and retire MCP integrations only through per-server replacement gates and a typed descriptor.
- `OWN-013`: make versioned normalized evidence contracts authoritative for managed pricing; keep raw data restricted.
- `OWN-014`: route new inline diagrams to Mermaid and standalone diagrams to editable Python sources.
- `OWN-015`: feed only allowlisted structured outcomes into the existing inert improvement lifecycle.
- `OWN-016`: keep npm and CLI asset preparation as the only bundle-generation path, with client locks and provenance.
- `OWN-017`: consolidate shipped consumer guidance in managed instructions generated consistently for both clients.

Issue #99 owns the metadata-only first bundle slice for `OWN-006` and `OWN-016`: source-to-generated mappings,
composition provenance, per-file source metadata, and an aggregate content lock. Client projections and lifecycle
extensions remain separate work; npm stays the sole package and installation authority.

## Removal And Change Gates

Every surface has a specific gate in the machine-readable manifest. The common rule is stricter than "no references":
replacement behavior, consumers, diagnostics, required checks, and baseline impact must be proven before ownership moves
or a surface is removed. Open and deferred decisions are roadmap inputs, not permission to bundle refactors.

## Next Slice Order

Complete Milestone H characterization first. Then proceed in roadmap order through MCP retirement, client parity, ARM
pricing, diagram migration, improvement measurement, bundle and automation simplification, and active guidance rewrite.
Each slice compares its affected baseline, updates this inventory, and remains independently revertible.
