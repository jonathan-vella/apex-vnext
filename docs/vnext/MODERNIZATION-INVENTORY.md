# Modernization Ownership Inventory

This inventory freezes repository ownership surfaces before consolidation. The machine-readable source is
[`modernization-ownership.json`](../../tools/registry/modernization-ownership.json), bound to candidate
`c447f744e3bee97f8919b36ea285f0f5aaa3e42e`. Existing registries remain canonical; this inventory references them and
does not copy their entries.

## Classification Rules

- `keep`: one clear owner and adequate proof already exist.
- `consolidate`: retain behavior while replacing duplicate ownership with a generated or shared view.
- `rewrite`: the current owner is explicit, but its implementation has a proven structural limitation.
- `retire`: retain until the stated removal gate succeeds, then archive or remove.
- `investigate`: preserve the surface until consumers and replacement proof are complete.

No classification authorizes implementation in this issue. Milestone F applies each change as an independently
revertible slice with characterization tests and baseline comparison.

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

## Runtime And Validation

| Surface                         | Class       | Canonical owner                   | Decision                   |
| ------------------------------- | ----------- | --------------------------------- | -------------------------- |
| `runtime-manifests`             | keep        | versioned config manifests        | Existing runtime boundary  |
| `workspace-package-boundaries`  | keep        | workspace package manifests       | Executable ownership units |
| `schema-libraries`              | investigate | contracts plus repository schemas | `OWN-005`                  |
| `customization-distribution`    | investigate | customization manifest            | `OWN-006`                  |
| `workflow-validator-ownership`  | keep        | kernel ownership table            | Runtime authorization map  |
| `repository-validator-graph`    | consolidate | package scripts                   | `OWN-002`                  |
| `language-validator-boundaries` | keep        | language-native tools             | Preserve native parsing    |
| `artifact-template-validation`  | consolidate | artifact templates                | `OWN-004`                  |

## Automation And Generation

| Surface                    | Class   | Canonical owner           | Decision                    |
| -------------------------- | ------- | ------------------------- | --------------------------- |
| `precommit-hooks`          | rewrite | `lefthook.yml`            | `OWN-003`                   |
| `github-required-checks`   | keep    | CI workflow               | Hosted execution boundary   |
| `maintenance-workflows`    | keep    | scheduled workflows       | Freshness and hygiene owner |
| `model-catalog-generation` | keep    | model catalog generator   | Derived assignments         |
| `entity-count-generation`  | keep    | count manifest            | Derived entity counts       |
| `avm-index-generation`     | keep    | AVM index refresher       | Generated module cache      |
| `freshness-generation`     | keep    | source freshness registry | Drift metadata              |

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

Recent successful `main` CI runs span 143 to 209 seconds, with a 165-second median. Candidate run `29585231105`
completed in 152 seconds. Required check names and command ownership remain in workflow files and package scripts.

### Hooks

Hook validation and characterization tests pass. Hook timing remains a gap because no benchmark currently exercises
representative staged documentation, code, workflow, and artifact changes. Serial execution remains required while
multiple `stage_fixed` commands can race on the Git index.

### Dependencies

The candidate lockfile SHA-256 is `45b3eae971a59165a9374de580140ab92f5e55f1ba6136dce27ebd4c133c597d`. Workspace
package manifests and TypeScript project references own package boundaries; exact package counts remain derived rather
than copied into this document.

### Diagnostics

Shared JSON and AJV diagnostic-library tests pass. Reporter adoption remains partial across registered validator
commands, so output compatibility snapshots are required before each family migrates.

### Drift

Recent changes concentrate in skills, tooling, packages, documentation, instructions, agents, and workflows. Existing
model, entity-count, source-freshness, orphan-content, and glob-audit checks remain the drift gates. This inventory adds
ownership drift validation without replacing those specialized checks.

## Ownership Decisions

- `OWN-001`: keep skill and instruction frontmatter canonical; generate audit views.
- `OWN-002`: consolidate validator orchestration through an explicit generated dependency graph.
- `OWN-003`: retain serial hooks until Git index coordination and representative benchmarks pass.
- `OWN-004`: derive artifact heading metadata from canonical templates.
- `OWN-005`: defer schema-library consolidation until source and consumer provenance is mapped.
- `OWN-006`: preserve customization boundaries until source-to-install lifecycle proof exists.
- `OWN-007`: retire the active v1 matrix only after issue #13 accepts cutover; archive it afterward.
- `OWN-008`: migrate validator diagnostics to the shared reporter by characterized family.
- `OWN-009`: keep telemetry advisory until automatic, representative, privacy-safe samples exist.
- `OWN-010`: retain public compatibility aliases until consumers and replacement guidance are known.

## Removal And Change Gates

Every surface has a specific gate in the machine-readable manifest. The common rule is stricter than "no references":
replacement behavior, consumers, diagnostics, required checks, and baseline impact must be proven before ownership moves
or a surface is removed. Open and deferred decisions are inputs to Milestone F, not permission to bundle refactors.

## Next Slice Order

Milestone F proceeds in roadmap order: validator command graph, generated metadata, guidance, invocation/context,
hooks, then scripts and workflows. Each slice compares its affected baseline, updates this inventory, and remains
independently revertible.
