## Guidance And Automation Characterization

This record completes the issue
[#93](https://github.com/jonathan-vella/apex-vnext/issues/93) review against candidate
`b27d17350870a0ed3d5411346701cbb2eb6a4d4b`. It records current behavior and later change gates only. No active
instruction, skill, lint rule, hook, package command, or GitHub workflow changes are authorized here.

The machine-readable owner, classification, proof command, and removal gate for each cluster remain in
[`modernization-ownership.json`](../../tools/registry/modernization-ownership.json). This record explains the consumer
and trust-boundary distinctions behind those entries.

## Outcome

- Keep repository operating guidance separate from shipped managed guidance.
- Keep instruction and skill frontmatter authoritative for discovery; generate views instead of creating another registry.
- Keep audience-specific Markdown authoring guidance separate from executable lint policy.
- Make npm scripts the reusable validation contract; hooks and workflows remain environment-specific consumers.
- Keep required integration checks, optional path-scoped checks, and exact-head release qualification independently
  visible because they have different trust and evidence boundaries.
- Defer all consolidation and repair work to Milestones N and O.

## Agent Guidance And Discovery

| Cluster                        | Current owner and consumers                                                                                                                                                                              | Disposition                                                                                                           | Later proof and gate                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace-operating-frame`    | Root `AGENTS.md` owns contributor-wide setup, validation, workflow, and security facts; `.github/copilot-instructions.md` owns VS Code Copilot routing. Contributors and repository agents consume both. | Keep the audience split. Do not make editor routing the repository operating authority.                               | `npm run validate:instruction-checks`; replacement must cover every operating and security boundary.                                              |
| `scoped-instruction-discovery` | Each `.github/instructions/*.instructions.md` file owns its `applyTo` scope. Copilot discovery and repository validators consume that frontmatter.                                                       | Consolidate only into a generated scope view under `OWN-001`; instruction frontmatter remains editable authority.     | `npm run validate:instruction-checks` and `npm run lint:glob-audit`; generated bindings must match discovery metadata.                            |
| `skill-discovery`              | Each `.github/skills/*/SKILL.md` owns discovery metadata and loading directives. Agents and skill validators consume it.                                                                                 | Generate a consumer view under `OWN-001`; do not hand-maintain a second skill inventory.                              | `npm run validate:skills` and `npm run lint:orphaned-content`; preserve active, orphan, and reference-canary diagnostics.                         |
| `managed-agent-manifest`       | `customizations/manifest.json` owns managed roles and invocation edges; managed agent frontmatter owns executable role definitions.                                                                      | Keep. The manifest and frontmatter have related but non-duplicate responsibilities.                                   | `npm run validate:model-consistency` and `npm run validate:agents`; preserve roles, models, tool grants, hidden workers, and invocation edges.    |
| `managed-consumer-guidance`    | `customizations/.github/copilot-instructions.md`, managed agents, and managed skills define shipped client behavior. VS Code, Copilot CLI, and generated bundles consume it.                             | Consolidate after client mechanics stabilize under `OWN-017`; do not copy repository-authoring rules into the bundle. | `npm run validate:instruction-checks` and `npm run validate:vnext`; both clients must discover equivalent kernel, authority, and MCP trust rules. |

The active source set is broad enough that total file count is not a useful optimization target. At the characterized
candidate, repository and managed guidance Markdown/JSON occupies `3793215` bytes. Milestone O must measure actual
both-client context loading before claiming that a file rewrite reduces context.

## Markdown Guidance And Enforcement

| Cluster                         | Current owner and consumers                                                                                                                                                                 | Disposition                                                                                           | Later proof and gate                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Human documentation             | `.github/instructions/markdown-docs.instructions.md` owns `docs/**` audience and presentation rules. Documentation authors and reviewers consume it.                                        | Keep separate from prompts, agents, skills, and generated artifacts.                                  | `npm run validate:docs`; preserve links, freshness, and user-facing structure.                                             |
| Cross-cutting Markdown guidance | `.github/instructions/markdown.instructions.md` owns shared authoring rules for its declared `applyTo` paths.                                                                               | Keep shared syntax guidance, but reconcile diagram routing in Milestone O.                            | `npm run validate:instruction-checks` and `npm run lint:md`; preserve scope and semantic rules.                            |
| `markdown-policy-enforcement`   | `.markdownlint-cli2.jsonc` owns executable markdownlint rules and exclusions; `package.json` owns `lint:md` and `validate:docs`; lefthook, editor integration, and `docs.yml` consume them. | Consolidate consumers on npm-owned commands under `OWN-018`; retain audience-specific prose guidance. | Direct, hook, editor, and hosted checks must preserve scope, diagnostics, exclusions, and nonzero tool failures.           |
| Artifact Markdown               | Azure artifact templates and `validate-artifacts.mjs` own generated artifact H2 contracts. `agent-output/**` is deliberately excluded from global markdownlint.                             | Keep the separate structural contract; derive repeated heading metadata under `OWN-004`.              | `npm run validate:artifacts` and `npm run check:h2-order`; generated metadata must remain byte-stable.                     |
| Diagram routing                 | Mermaid owns new inline diagrams, Python owns new standalone diagrams, and Draw.io remains historical and transitional.                                                                     | Rewrite active routing under `OWN-014` only after format-neutral qualification.                       | `npm run validate:skills` and `npm run lint:drawio`; preserve historical Draw.io readability until replacement gates pass. |

The apparent Markdown duplication is therefore partly intentional. Human docs, managed prompts and agents, generated
artifacts, templates, and frozen evidence have different consumers. Consolidation is valid only where multiple editable
sources claim the same executable rule.

## Linting And Hook Ownership

| Cluster                         | Current owner and consumers                                                                                                                        | Disposition                                                                                                                       | Later proof and gate                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `repository-validator-graph`    | `package.json` owns reusable command names; CI, pre-push checks, contributors, and release qualification consume them.                             | Generate dependency views under `OWN-002`; retain externally consumed aliases until usage is proven absent.                       | `npm run validate:_node-ci`; preserve prerequisites, parallel-safety constraints, diagnostics, and required check names. |
| `language-validator-boundaries` | Markdownlint, Prettier, ESLint, Ruff, Terraform, and Bicep own language parsing; npm scripts bind them into repository commands.                   | Keep language-native validation. Do not replace it with generic string checks.                                                    | `npm run validate:all`; replacements must retain equivalent parsing and failures.                                        |
| `validator-diagnostics`         | Shared reporter adoption is partial across `tools/scripts/validate-*.mjs`; local and CI consumers observe mixed output contracts.                  | Consolidate by validator family under `OWN-008`, after output and exit snapshots exist.                                           | `npm run test:lib-json` and `npm run test:lib-ajv`; retain severity, path, summary, and machine-readable findings.       |
| `precommit-hooks`               | `lefthook.yml` owns staged-file selection and re-staging; npm scripts own validator behavior. Contributors consume hook diagnostics before commit. | Repair fail-closed behavior before any parallelization; retain serial `stage_fixed` execution until index coordination is proven. | `npm run validate:hooks` and `npm run test:hooks`; preserve staged-file semantics and direct-command parity.             |

### Markdown Hook Defect

At the characterized candidate, a direct missing `markdownlint-cli2` invocation exits `127`. The current hook wrapper
captures the same lookup error in `RESULT`, pipes it through a filtering command followed by `|| true`, and exits `0`.
This reproduces the reported false-success hook summary.

Milestone N must first add a regression test in `tools/tests/test-hooks.sh` that removes the executable from the hook
`PATH` and requires a nonzero result. The repair must invoke the repository-owned command without package installation,
preserve staged-file filtering and diagnostics, and fail closed. Hook timing and index-lock benchmarking follow that
repair; they are not prerequisites for restoring correct failure propagation.

## Hosted Workflow Ownership

| Cluster                                     | Current owner and consumers                                                                                                                                                                           | Disposition                                                                                                        | Later proof and gate                                                                                                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github-required-checks`                    | GitHub branch protection owns required contexts; `ci.yml` owns deterministic hosted execution; npm scripts own reusable commands. Pull requests and `main` protection consume the resulting statuses. | Keep check names and hosted visibility stable. Consolidate setup only after hosted parity evidence exists.         | `npm run validate:_node-ci`, docs validation, and external Python tests; preserve strict protection, least privilege, triggers, and independent failures.                                             |
| Path-scoped documentation and branch checks | `docs.yml` owns the `Markdown docs` check for documentation paths; `branch-enforcement.yml` owns naming and file-scope checks.                                                                        | Keep separate because path scope and policy diagnostics differ from deterministic CI.                              | Hosted pull-request evidence must prove path filters cannot bypass required enforcement.                                                                                                              |
| `exact-head-release-qualification`          | `release-candidate-qualification.yml` checks out the exact head without persisted credentials and uploads candidate-bound evidence. Release reviewers consume it.                                     | Keep separate from required CI because it has a longer evidence-producing trust boundary and no release authority. | `npm run qualify:vnext-release` and `npm run test:vnext-pack`; preserve checksums, artifacts, retention, exact-head binding, and denial of merge, publication, deployment, tag, or cutover authority. |
| Maintenance automation                      | Weekly maintenance and branch maintenance own scheduled freshness and hygiene.                                                                                                                        | Keep network-dependent and scheduled checks out of deterministic pull-request CI.                                  | Preserve each maintenance task, least privilege, issue behavior, and schedule before consolidation.                                                                                                   |

GitHub branch protection at characterization time is strict and requires `ci`,
`External Python tests (apex-recall + azure-pricing MCP)`, and the `Analyze (actions)`,
`Analyze (javascript-typescript)`, and `Analyze (python)` CodeQL contexts. PR #92 additionally passed independently
visible documentation, branch-enforcement, CodeQL summary, and exact-head qualification checks.

Current-main CI run
[`29898484667`](https://github.com/jonathan-vella/apex-vnext/actions/runs/29898484667) passed at `b27d173` in
`122` seconds. PR #92's exact-head qualification lane completed in `6m21s`. These are characterization samples, not
performance budgets; later workflow changes need same-head hosted comparisons.

## Baselines And Gaps

| Domain       | Status   | Evidence or blocking owner                                                                                                              |
| ------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Context      | Gap      | Static guidance size is captured; Milestone O owns representative VS Code and Copilot CLI token/cache samples.                          |
| CI           | Captured | Current-main duration, strict required contexts, PR check names, permissions, and exact-head lane are recorded above.                   |
| Hooks        | Gap      | The fail-open defect is reproduced; Milestone N owns the regression test, repair, then representative timing and index-lock benchmarks. |
| Dependencies | Captured | The registry retains the lockfile hash and workspace package boundaries from the rebaseline.                                            |
| Diagnostics  | Gap      | Shared reporter tests pass, but family-level output and exit snapshots remain a Milestone N prerequisite.                               |
| Drift        | Captured | Existing freshness, entity-count, model-catalog, instruction, skill, and orphan-content validators remain the drift gates.              |

## Change And Removal Gates

1. Client projection may begin only from the managed manifest and managed guidance owners; both supported clients must
   pass normalized discovery, workflow, and authority tests before old projections change.
2. Markdown hook repair must land as an independently revertible Milestone N slice with a missing-executable regression
   test and direct-command parity.
3. Validator graph or diagnostic consolidation must proceed by family, preserving public commands, output snapshots,
   exit codes, and parallel-safety constraints.
4. Workflow setup may be shared only after same-head hosted runs preserve required names, triggers, permissions, pins,
   artifacts, caches, path behavior, and independent failure visibility.
5. Active guidance rewrite occurs after implementation owners stabilize. Repository guidance and shipped consumer
   guidance remain separate unless both audiences and trust boundaries are demonstrably identical.
6. No compatibility alias, Draw.io path, workflow, instruction, skill, or validator wrapper retires without its registry
   removal gate and rollback path passing.

## Characterization Verdict

Issue #93's four review surfaces have current and proposed owners, consumers, classifications, proof commands, security
boundaries, and change/removal gates. The identified gaps have named Milestone N or O owners. The review changes no
active behavior and does not authorize merge, publication, deployment, release, tag creation, or cutover.
