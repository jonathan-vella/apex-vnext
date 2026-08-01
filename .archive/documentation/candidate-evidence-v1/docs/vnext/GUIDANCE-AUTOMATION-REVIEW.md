## Guidance And Automation Review Contract

This document defines the Milestone H characterization gate for repository guidance, linting, and workflow ownership.
It authorizes inventory and analysis only. Consolidation, rewrite, retirement, and behavior changes remain separate,
independently revertible work in Milestones N and O.

Issue [#93](https://github.com/jonathan-vella/apex-vnext/issues/93) owns this gate.

The completed review evidence is recorded in
[GUIDANCE-AUTOMATION-CHARACTERIZATION.md](GUIDANCE-AUTOMATION-CHARACTERIZATION.md); structured classifications and
removal gates remain in the modernization ownership registry.

## Objectives

- Identify the effective behavior and all consumers before changing an owner.
- Distinguish source rules, generated projections, executable enforcement, convenience wrappers, and documentation.
- Find duplicate, conflicting, stale, unreachable, or unowned rules without assuming duplication should always be merged.
- Propose one canonical owner per concern and retain path-specific rules only where behavior actually differs.
- Bind every proposed consolidation or removal to characterization evidence, rollback, and an executable proof gate.
- Reduce context, commands, and workflow duplication without weakening diagnostics, security, or release controls.

## Review Boundaries

| Surface                               | Characterize                                                                                                                                                                   | Preserve during review                                                                                         | Later implementation owner                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Agent-related skills and instructions | Active files, frontmatter, `applyTo`, discovery, imports, agent and skill consumers, repeated authority/model/tool rules, context bytes, and VS Code/Copilot CLI applicability | Managed role graph, hidden-worker boundaries, model tiers, tool grants, kernel authority, and client discovery | Milestone O guidance rewrite and the client-projection slice               |
| Markdown guidance                     | Human docs, prompts and agents, generated artifacts, templates, diagram routing, Markdown instructions, formatter config, markdownlint rules, exclusions, and link checks      | Audience-specific contracts, frozen evidence, artifact heading order, diagnostics, and historical readability  | Milestone O guidance rewrite plus template/validator slices in Milestone N |
| Linting configuration                 | Rule-to-command-to-hook-to-CI graph, aliases, inputs, diagnostics, exit codes, caches, generated checks, and editor integration                                                | Language-native parsing, focused commands, machine-readable findings, hook failure propagation, and CI parity  | Milestone N validator and hook simplification                              |
| Workflow configuration                | Required check names, events, path filters, permissions, action pins, concurrency, shared setup, artifacts, caches, external runtimes, and exact-head semantics                | Hosted trust boundaries, independent failures, least privilege, immutable pins, and release-authority denial   | Milestone N workflow simplification                                        |

## Required Outputs

Issue #93 must produce a review record containing, for every surface and duplicate cluster:

- current canonical owner and all editable or generated copies;
- active consumers in repository tooling, managed bundles, VS Code, Copilot CLI, hooks, and GitHub Actions;
- classification as `keep`, `consolidate`, `rewrite`, `retire`, or `investigate`;
- conflict or duplication description, including why apparently similar rules may remain separate;
- effective behavior snapshot, diagnostics, exit status, performance/context baseline, and security boundary;
- proposed canonical owner, migration order, compatibility impact, rollback, proof command, and removal gate;
- explicit disposition for stale references, compatibility aliases, generated files, and historical evidence.

The machine-readable ownership registry remains the structured owner of classifications and gates. This document defines
what the characterization must prove; it does not duplicate the registry entries.

## Known Questions To Resolve

### Agent Guidance

- Which rules belong in root `AGENTS.md`, repository Copilot instructions, scoped instructions, managed instructions,
  skills, or agent frontmatter?
- Which instructions are repository-authoring rules versus shipped consumer behavior?
- Can VS Code and Copilot CLI consume one source without client-specific semantics being flattened?
- Which model, tool, handoff, subagent, and authority rules are duplicated rather than generated or referenced?
- Which skills and instructions are active, orphaned, shadowed, or loaded into context without a consumer?

### Markdown

- Reconcile Draw.io guidance retained in active Markdown instructions with the approved Mermaid/Python migration.
- Separate human documentation, prompt and agent Markdown, generated artifact templates, and frozen historical evidence.
- Identify duplicated line-length, heading, link, frontmatter, diagram, callout, and code-fence rules.
- Decide whether formatter, markdownlint, custom validators, and templates each own distinct behavior or duplicate it.
- Preserve artifact H2 contracts and historical diagram readability while changing new-output guidance.

### Linting

- Map every lint and validation command to its implementation, package alias, hook, workflow job, and documented entry.
- Characterize diagnostics and exit codes before removing wrappers or merging commands.
- Resolve the pre-commit Markdown command lookup that reports `markdownlint-cli2: No such file or directory` while the
  hook still reports success; the repaired path must fail closed and match direct repository lint behavior.
- Identify checks that mutate the index, generate files, require network access, or are unsafe to parallelize.
- Keep deterministic CI separate from scheduled freshness and network-dependent validation.

### Workflows

- Record the exact protected-branch check names and the commands that satisfy each one.
- Identify duplicated setup, dependency installation, build, cache, artifact, and matrix behavior.
- Preserve independent visibility for external Python, CodeQL, docs, branch enforcement, and release qualification.
- Verify path filters cannot skip required enforcement and shared abstractions do not broaden permissions.
- Keep exact-head qualification, artifact checksums, and denial of merge, publication, deployment, tag, and cutover
  authority unchanged.

## Decision Rules

- Prefer deletion when a rule is stale, unreachable, or generated elsewhere and no consumer requires compatibility.
- Prefer consolidation when multiple editable sources own the same behavior and one can generate or reference the rest.
- Prefer separate owners when audiences, trust boundaries, execution environments, or failure semantics differ.
- Rewrite only after characterization proves the current owner cannot safely express the required contract.
- Retire compatibility aliases only after usage inventory, replacement guidance, and a dated removal gate exist.
- Do not introduce a universal task runner, generic workflow framework, generated GitHub Actions YAML, or a second
  guidance registry.

## Characterization Gate

Milestone H cannot complete until:

1. All four surfaces have complete consumer and ownership maps.
2. Duplicate and conflict clusters have explicit dispositions and proof commands.
3. Required check names, diagnostics, exits, permissions, triggers, pins, artifacts, context bytes, hook time, and CI time
   have captured baselines or blocking gap owners.
4. The Markdown hook lookup defect has a reproducer and a named Milestone N repair slice.
5. The modernization registry and project register link every proposed ownership move to a rollback/removal gate.
6. No implementation, generated bundle, active instruction, lint rule, hook, or workflow changes are mixed into the
   characterization issue.

## Implementation Sequence

After the characterization gate passes:

1. Complete client-neutral source and generated-bundle ownership needed by supported client projections.
2. Simplify validator ownership and diagnostics by characterized family.
3. Make hooks thin consumers of canonical validators and fix fail-closed behavior before considering parallelism.
4. Consolidate workflow setup only where measured duplication exists and hosted behavior remains equivalent.
5. Rewrite active repository and managed guidance from the final implemented owners.
6. Re-run context, hook, CI, diagnostics, discovery, packaging, and both-client qualification before retiring old paths.
