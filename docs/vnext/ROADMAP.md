## APEX vNext Roadmap

This roadmap orders outcomes and dependencies. GitHub Issues own executable status; this file does not track daily work.
The historical phase plan is retained for traceability, but current delivery follows dependency-complete workstreams.

## Dependency Order

```text
Project controls
  -> exact-head stabilization
  -> release-control completion
  -> live qualification preparation
  -> modernization inventory and baselines
  -> dependency-complete modernization slices
  -> bounded improvement proof of concept
  -> candidate re-baseline and replacement characterization
  -> independent legacy MCP retirement
  -> ARM MCP pricing replacement
  -> Mermaid and Python diagram migration
  -> bounded improvement operationalization
  -> bundle, validator, hook, and workflow simplification
   -> skill and instruction migration, optimization, and active guidance rewrite
   -> VS Code and Copilot CLI governed workflow implementation mechanics
   -> pre-agent repository optimization gate
   -> terminal full validation and managed-agent qualification
  -> maintainer cutover decision
```

No downstream milestone can satisfy an upstream release gate through documentation alone.

## Milestone A: Project Controls

**Outcome:** Product intent, decisions, risks, dependencies, checkpoints, and work status have one durable owner.

**Requirements:** All requirement families through governance and lifecycle management.

**Deliverables:**

- Project hub, checkpoint, PRD, roadmap, register, and decision index.
- Reconciled mapping from the historical plan and frozen Phase 0A evidence.
- vNext work-item intake and regression provenance in the existing bug form.
- Minimal GitHub taxonomy, milestone, issues, and `APEX vNext` planning view.
- Repository-only control validation with no mutable GitHub-state dependency.

**Exit gate:** Documents and issue forms validate; every active concern links to one authoritative issue; PR #533 remains
draft; the exact integration head and failed checks are recorded.

**Historical traceability:** Governance completion plan Phase 1; build plan Phase 0A evidence and project decisions.

## Milestone B: Exact-Head Stabilization

**Outcome:** The integration head is green before feature expansion.

**Requirements:** `REQ-SECURITY-001`, `REQ-DETERMINISM-001`, `REQ-DOCS-001`.

**Dependency-complete slices:**

1. Remove the polynomial-ReDoS path and add a bounded regression test.
2. Build required vNext packages before CI lint resolves generated imports.
3. Correct vNext documentation links and add link regression coverage.
4. Make package clean-install tests terminate children on timeout and diagnose the blocked install.
5. Re-run required checks on the exact updated integration head.

**Exit gate:** Every current product failure has a reproducer and fix; external failures have an owner and evidence; all
required checks pass on the exact head.

**Historical traceability:** Governance completion plan Phase 2; build plan Phase 0B feasibility and Phase 10 release
control prerequisites.

## Milestone C: Release-Control Completion

**Outcome:** Deterministic behavior already present in the runtime is connected to complete release evidence.

**Requirements:** `REQ-DIST-001`, `REQ-STATE-001`, `REQ-CONTRACT-001`, `REQ-WORKFLOW-001`, `REQ-QUALITY-001`,
`REQ-CAPABILITY-001`, `REQ-DETERMINISM-001`.

**Dependency-complete slices:**

1. Resolve every workflow validator ID to an executable registry implementation.
2. Reconcile the declared lessons quality output with a persisted contract or explicit replacement.
3. Verify grants, no-self-approval, no-model-deploy, bundle drift, pack digests, metadata, hashes, and inventories.
4. Produce scorecard measurements from mutation, fault, restart, context, cache, and dual-track tests.
5. Enforce sample thresholds and split automated qualification from final release qualification.
6. Prove byte-reproducible tarballs, release manifest, SBOM, provenance, clean install, and package dry run.
7. Exercise capability-pack install, status, verify, update, rollback, uninstall, and absent-pack behavior.
8. Pin and reuse CI build outputs without weakening checks or changing required check names.

**Exit gate:** Automated qualification is reproducible and green; all remaining unavailable evidence is explicitly manual
or live and has a prepared procedure.

**Historical traceability:** Build plan foundation through packaging phases; governance completion plan Phase 2.

## Milestone D: Live Qualification

**Outcome:** User-owned and cloud-backed behaviors are proven against the exact candidate dependency hashes.

**Requirements:** `REQ-CUSTOMIZATION-001`, `REQ-BICEP-001`, `REQ-TERRAFORM-001`, `REQ-APPROVAL-001`,
`REQ-OPS-001`, `REQ-DOCS-001`.

**Scenarios:**

- Fresh supported VS Code discovery, direct handoffs, questions, hidden workers, and MCP startup.
- Restart and cross-device resume with one-writer and transfer enforcement.
- Local exact-preview Gate 4 approval, GitHub OIDC, and local-to-CI ownership transfer.
- Bicep deployment-stack preview, apply, inventory, diagnosis, destroy, and recovery.
- Terraform backend, protected exact plan, approval, apply, inventory, diagnosis, destroy, and recovery.
- Promotion to a linked environment with Gate 4 refresh.

The manual workflow, bound local handoff launcher, bootstrap resources, and structural mutation tests are implemented.
Historical Bicep and recipient-bound encrypted Terraform apply/destroy proof is recorded in destination issues `#9` and
`#10`. The GitHub Environment scopes OIDC and configuration but is not an approval authority; the exact preview is
approved locally through APEX Gate 4 before CI handoff. Each ceremony still binds checkout, workflow, packages, state,
preview, and evidence to one exact `main` commit.

**Exit gate:** Historical Bicep and Terraform ceremonies passed. DECISION-013 requires final live qualification to repeat
after the last release-relevant dependency change; the prior runs characterize behavior but do not qualify the revised
candidate.

**Historical traceability:** Build plan platform spikes, dual-track proof, deployment, and qualification phases.

## Milestone E: Modernization Inventory

**Outcome:** Every repository guidance, validation, hook, workflow, generation, and compatibility surface has an owner,
consumer map, classification, proof test, and removal gate before consolidation begins.

**Requirements:** `REQ-DETERMINISM-001`, `REQ-CUSTOMIZATION-001`, `REQ-DOCS-001`.

**Inventory scope:**

- Instructions and `applyTo` intersections, skills and consumers, root and scoped `AGENTS.md` files.
- Repository-authoring guidance versus shipped consumer guidance.
- Scripts, libraries, package commands, generated files, workflows, actions, hooks, and event triggers.
- Lint and validator ownership across JavaScript, Markdown, JSON/YAML, Python, IaC, and custom rules.
- Required check names, context bytes, dependency edges, diagnostics, hook time, CI critical path, and drift frequency.

**Exit gate:** Every item is classified `keep`, `consolidate`, `rewrite`, `retire`, or `investigate`; unresolved ownership
choices are decisions; characterization and mutation tests protect selected boundaries.

The candidate-bound inventory and baseline gaps are recorded in
the [completed maintenance archive](../../.archive/retired-automation/pre-agent-loop-v1/README.md). Its machine-readable
manifest was validated during the bounded run so later slices could not move ownership without updating consumers,
proof, decisions, and removal gates.

**Historical traceability:** Governance completion plan Phase 3.

## Milestone F: Modernization Slices

**Outcome:** Duplicate ownership is removed without changing behavior, diagnostics, release gates, or public commands.

**Requirements:** `REQ-DETERMINISM-001`, `REQ-CUSTOMIZATION-001`, `REQ-DOCS-001`.

Each issue follows characterize, decide owner, test, migrate, retain compatibility where needed, validate, measure,
document, and retire. The ordered slices are:

1. Validation command graph.
2. Generated metadata sources.
3. Repository and consumer guidance.
4. Skills, agents, invocation graph, and context budgets.
5. Hook authority versus convenience.
6. Scripts, workflows, permissions, pins, and compatibility aliases.

**Exit gate:** Each slice is independently revertible and does not worsen CI time, hook time, context size, duplication,
test coverage, diagnostics, or a release gate unless an owner accepts the regression with an expiry.

**Historical traceability:** Governance completion plan Phase 4.

## Milestone G: Bounded Improvement

**Outcome:** APEX can observe deterministic evidence and propose improvements without gaining mutation authority.

**Requirements:** `REQ-IMPROVE-001`, `REQ-QUALITY-001`, `REQ-SECURITY-001`.

**Dependency-complete slices:**

1. Record an ADR comparing the referenced upstream design after license and exact-source verification.
2. Define observation, recurrence, proposal, human-decision, and improvement-policy contracts.
3. Implement redacted bounded observation and deterministic recurrence across distinct runs.
4. Add trusted CLI read, observe, scan, proposal, and human-decision operations.
5. Prove prompt-injection inertness, authorization boundaries, retention, deletion, deduplication, and rejection.
6. Run observe-and-propose mode during modernization and evaluate precision and triage outcomes.

**Exit gate:** Proposals remain inert; no MCP or proposal path can decide, apply, edit, approve, deploy, publish, or inject
context. Automated issue creation requires a later explicit decision.

**Historical traceability:** Governance completion plan Phase 5.

## Pre-Agent Testing Repository Optimization Gate

**Outcome:** The complete repository implementation and guidance surface is reviewed, simplified where proven safe,
and accepted before managed-agent behavior can influence qualification results.

**Requirements:** `REQ-DETERMINISM-001`, `REQ-GUIDANCE-001`, `REQ-MAINTAINABILITY-001`,
`REQ-OPTIMIZATION-001`, `REQ-QUALITY-001`, `REQ-SECURITY-001`.

**Scope:**

| Surface       | Required review                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| npm scripts   | Root and workspace command graph, aliases, duplicate wrappers, startup and CI cost, failure propagation, and unused commands.            |
| Instructions  | Repository and managed sources, `applyTo` intersections, precedence, contradictions, duplication, context cost, and retirement.          |
| Skills        | Repository and managed catalogs, consumers, capability parity, routing, progressive disclosure, duplication, gaps, and retirement.       |
| Package files | Every workspace manifest, lockfile, export map, dependency boundary, build configuration, generated projection, and published-file list. |
| Workflows     | GitHub Actions, local hooks, runtime workflow manifests, shared actions, permissions, triggers, caches, duplication, and obsolete paths. |
| Root files    | Every regular and hidden configuration file at repository root, with owner, consumers, purpose, overlap, freshness, and disposition.     |

**Review dimensions:**

- Correctness: find errors, unreachable paths, stale assumptions, missing consumers, inconsistent diagnostics, and
  unsafe defaults.
- Coherence: find gaps, contradictions, conflicting authority, duplicated facts, and source/generated drift.
- Performance: measure command startup, build and validation duration, hook and CI critical paths, package size,
  loaded context, cache behavior, and unnecessary work.
- Simplification: consolidate shared behavior, reduce editable owners and duplication, improve boundaries, and reduce lines
  only when tests prove equivalent behavior and clearer ownership.
- Retirement: remove or archive unused files, commands, dependencies, guidance, and workflows only after consumer search,
  negative reintroduction tests, provenance capture, and rollback planning.

**Required evidence:**

1. Produce a machine-readable path inventory covering every scoped file with owner, consumers, classification,
   findings, disposition, proof, and release impact.
2. Capture pre-change baselines for behavior, diagnostics, timing, package composition, context, and relevant security
   boundaries.
3. Apply changes as independently revertible slices and record accepted deferrals with owner, rationale, expiry, and
   release impact.
4. Re-run focused deterministic checks after each slice; reserve full repository validation for terminal verification.
5. Generate a completion receipt that binds the reviewed tree hash, unresolved findings, measurements, and verdict.

**Autonomous execution design:**

1. A deterministic Node.js controller owns queue selection, Git state, command execution, policy enforcement,
   checkpoints, and stop decisions. The model never controls the outer loop.
2. A human creates a run authorization bound to the base commit, issue, allowed paths, protected paths, command allowlist,
   network policy, file and line budgets, iteration and wall-clock limits, expiry, and permitted local-commit behavior.
3. The controller requires a clean dedicated worktree and branch, builds the complete inventory, captures baselines, and
   derives a dependency-ordered queue. It never edits the user's primary worktree.
4. Each queue item starts a fresh non-interactive Copilot CLI task with JSONL output, an isolated Copilot home and neutral
   working directory, no `ask_user`, no remote control, no built-in MCP servers, no GitHub mutation tools, and only the
   paths and tools required by that item.
5. After each task, the controller rejects scope escape, protected-file changes, generated-source inversion, unexpected
   binaries, excessive churn, secrets, and a dirty state not attributable to the current item.
6. The controller runs only focused format, compile, lint, unit, mutation, or behavior checks selected from the ownership
   graph. A failed check permits one bounded repair task, then stops for human input.
7. Accepted slices receive a local commit, measurement delta, inventory update, finding disposition, and hash-linked
   checkpoint. The next task receives state artifacts, not prior chat history.
8. The loop stops on ambiguity, missing ownership, conflicting sources of truth, critical or high security findings,
   repeated failure, budget exhaustion, expired authorization, no ready work, or completion.
9. The controller cannot push, create or merge pull requests, create issues, approve, release, publish, deploy, run
   managed-agent scenarios, or execute the full validation suite.
10. Completion emits an immutable handoff containing the exact tree hash, local commits, findings, deferrals,
    measurements, focused-check results, and commands required by terminal verification.

**Blocking rule:** Characterization, focused unit, integration, and mutation checks needed by a remediation slice may
run. No full repository validation, managed-agent scenario test, model comparison, paired-client agent execution, or live
agent qualification may begin inside the autonomous loop. Milestone J implementation mechanics may proceed, but its
agent-testing slice remains blocked until the completion receipt is accepted for terminal verification.

Issue [#220](https://github.com/jonathan-vella/apex-vnext/issues/220) owns the repository-wide gate. Issue
[#219](https://github.com/jonathan-vella/apex-vnext/issues/219) supplies its required skill and instruction migration
workstream. Issue [#222](https://github.com/jonathan-vella/apex-vnext/issues/222) owns the bounded local controller and
must pass its safety proof before autonomous remediation begins.

**Exit gate:** Every scoped path has a disposition; no critical or high unresolved correctness, security, contradiction,
or ownership finding remains; accepted deferrals are explicit; performance regressions are within approved tolerances;
focused slice checks pass; and the candidate-bound completion receipt is ready for terminal verification.

## Milestone H: Candidate Re-Baseline And Characterization

**Outcome:** The approved `0.10.0` scope has current decisions, requirements, owners, baselines, and removal gates before
release-relevant implementation resumes.

**Requirements:** All requirements in [PRD.md](PRD.md), with emphasis on `REQ-CUSTOMIZATION-001`,
`REQ-CAPABILITY-001`, `REQ-DETERMINISM-001`, `REQ-MAINTAINABILITY-001`, `REQ-DOCS-001`, and `REQ-IMPROVE-001`.

**Dependency-complete slices:**

1. Record DECISION-012 through DECISION-018 and revise all project-control documents.
2. Mark prior exact-main and live evidence as historical characterization rather than current release proof.
3. Pin a supported Copilot CLI version and define per-client qualification scenarios.
4. Complete the [guidance and automation review](GUIDANCE-AUTOMATION-REVIEW.md) for agent skills/instructions,
   Markdown, linting, and workflows before implementing client projections or automation consolidation.
5. Capture active MCP tools, pricing semantics, diagram scenarios, bundle contents, validators, hooks, workflows,
   diagnostics, timings, and context baselines.
6. Bind every removal or ownership move to a machine-readable replacement and rollback gate.

**Exit gate:** Project controls validate; every new requirement has an implementation owner, dependency, risk, proof
method, and removal gate; the four guidance/automation consumer maps and behavior baselines are complete; frozen Phase
0A evidence and existing archives remain byte-stable.

## Milestone I: Independent Legacy MCP Retirement

**Outcome:** Unneeded MCP dependencies are removed without changing Azure or Terraform lifecycle authority.

**Requirements:** `REQ-CAPABILITY-001`, `REQ-TERRAFORM-001`, `REQ-DETERMINISM-001`, `REQ-DOCS-001`.

**Dependency-complete slices:**

1. Remove Astro MCP from active workspace configuration and reject its reintroduction. Issue #136 owns this completed
   independent slice.
2. Characterize the Terraform MCP registry-only tools and their active consumers. Issue #138 owns this completed
   characterization slice; replacement and retirement remain pending.
3. Implement bounded Terraform Registry API lookup with deterministic fixtures, caching, and unavailable results. Issue
   #140 owns this completed implementation slice; consumer migration remains pending.
4. Route installed provider schemas through native Terraform CLI and import guidance through official provider docs.
   Issue #145 owns this completed bounded implementation slice.
5. Update active Terraform instructions and skills, then remove Terraform MCP setup and configuration. Issue #147 owns
   this completed migration and retirement slice.
6. Remove Go from the devcontainer only if no independent active consumer remains. Issue #147 completed that audit and
   removal with a negative reintroduction gate.

**Exit gate:** Active nonhistorical sources contain no Astro or Terraform MCP dependency; Registry and native CLI tests
pass; Terraform state, saved-plan, apply, destroy, and Gate 4 behavior is unchanged.

## Milestone J: Supported Copilot Client Parity

**Outcome:** GitHub Copilot in VS Code and GitHub Copilot CLI drive the same kernel-governed APEX workflow.

**Requirements:** `REQ-DIST-001`, `REQ-STATE-001`, `REQ-CONTRACT-001`, `REQ-WORKFLOW-001`,
`REQ-CUSTOMIZATION-001`, `REQ-APPROVAL-001`, `REQ-OPTIMIZATION-001`, `REQ-SECURITY-001`, `REQ-DOCS-001`.

**Entry gate:** Managed-agent and paired-client scenario execution cannot begin until the
[Pre-Agent Testing Repository Optimization Gate](#pre-agent-testing-repository-optimization-gate) passes on the same
candidate tree. Implementation and deterministic non-agent tests may proceed before that receipt.

**Dependency-complete slices:**

1. Keep questions and `needs_input` kernel-owned; map VS Code to `vscode/askQuestions` and Copilot CLI to `ask_user`.
   Issue #150 completes the shared kernel request boundary; issue #152 completes client-specific projection mapping.
2. Record typed answers through APEX MCP instead of relying on client chat history. Issue #150 completes the versioned,
   exact-head and writer-epoch-bound recording contract.
3. Generate VS Code and Copilot CLI agent projections from `customizations/manifest.json`. Issue #152 implements
   client-valid rendering and explicit selected-client transactional materialization under ADR-0005.
4. Add workspace-owned Copilot CLI MCP configuration with an explicit APEX tool allowlist.
5. Extend transactional customization install, update, rollback, uninstall, locks, and conflict handling to both clients.
   Issue #152 implements the shared selected-client lifecycle; live consumption remains part of slice 6.
6. Qualify agent, skill, instruction, model, question, hidden-worker, MCP, gate, restart, and cross-device behavior in both
   clients against equivalent typed outcomes. Issue #154 implements the deterministic corpus, normalized contracts,
   strict collector, pair comparator, proof-complete aggregate, and live evidence-manifest binding. Issue #156 selects
   exact VS Code/Copilot Chat versions from the completed context receipt. Paired live execution remains open.

**Exit gate:** Both pinned clients produce equivalent journal, task, artifact, gate, denial, resume, and transfer results.
GitHub Copilot cloud coding-agent sessions, Copilot code review, and `/delegate` are not implementation or release gates.

## Milestone K: ARM MCP Pricing Replacement

**Outcome:** Every managed agent queries Microsoft ARM MCP directly for read-only Cost Management and Pricing without a
custom server or adapter.

**Requirements:** `REQ-ARCH-001`, `REQ-CAPABILITY-001`, `REQ-QUALITY-001`, `REQ-SECURITY-001`,
`REQ-DETERMINISM-001`, `REQ-DOCS-001`.

**Dependency-complete slices:**

1. Freeze a parity matrix for retail, meter-aware projection, bulk estimates, regional comparison, commitments,
   negotiated prices, ambiguity, uncertainty, throttling, and provenance. Issue #162 implements this registry and its
   mutation-tested validator.
2. Add versioned pricing-request and pricing-evidence contracts. Issue #162 implements strict content-free schemas,
   request/evidence identity binding, typed arithmetic, expiry, provenance, and non-gate dispositions.
3. Configure the managed endpoint `https://mcp.management.azure.com` with the `CostManagement,Pricing` toolsets in both
   supported client projections.
4. Grant every managed agent explicit read-only ARM MCP tools. Exclude deployment, cancellation, resource mutation,
   budget creation, pricesheet operations, unknown, and renamed tools.
5. Remove the custom pricing pack from runtime assets, CI, dependency updates, hooks, and active discovery.
6. Keep APEX pricing request/evidence contracts as gate-validation boundaries without owning MCP transport.
7. Qualify direct OAuth discovery and representative read calls in both supported interactive clients.

**Exit gate:** Both supported interactive clients discover the allowlisted ARM MCP reads, excluded tools remain
unavailable to managed agents, typed arithmetic and meter semantics pass, and no MCP call can approve or deploy.

## Milestone L: Mermaid And Python Diagram Migration

**Outcome:** New diagrams use source-controlled Mermaid or Python without losing semantic or visual quality.

**Requirements:** `REQ-QUALITY-001`, `REQ-CAPABILITY-001`, `REQ-DETERMINISM-001`, `REQ-DOCS-001`.

**Dependency-complete slices:**

1. Route inline flow, sequence, state, ER, and compact documentation diagrams to Mermaid. Issue #168 freezes this route;
   issue #173 migrates active consumers.
2. Route standalone architecture, network, dependency, runtime, as-built, WAF, cost, and compliance outputs to Python.
   Issue #168 freezes this route; issue #173 migrates active consumers.
3. Generalize existing golden scenarios into format-neutral node, edge, zone, label, legend, and accessibility manifests.
   Issue #168 implements explicit semantic coverage and reconciles three contradictory legacy fields: G3 routing, G5
   management-group count, and G6 resource bounds.
4. Update artifact contracts, templates, prompts, workflow manifests, validators, benchmarks, and Markdown consumers.
   Issue #173 migrates these active surfaces and adds fail-closed consumer drift validation.
5. Qualify editable source, deterministic rendering, semantic coverage, nonblank output, dimensions, clipping, overlap,
   labels, latency, security, and maintenance at the declared pack threshold.
6. Remove Draw.io MCP, skill, assets, tests, and setup from active surfaces. Preserve frozen phase-0 evidence and Git
   history; dedicated golden fixtures retire with the toolchain.

**Exit gate:** No active workflow emits `.drawio`; Python/Mermaid routing passes semantic validation; historical Draw.io
artifacts remain readable and need no conversion.

## Milestone M: Bounded Improvement Operationalization

**Outcome:** Approved structured APEX outcomes feed useful inert proposals without transcript or mutation authority.

**Requirements:** `REQ-IMPROVE-001`, `REQ-QUALITY-001`, `REQ-SECURITY-001`, `REQ-DETERMINISM-001`.

**Dependency-complete slices:**

1. Amend ADR-0004 provenance for the downstream ClawHub packaging while retaining exact-source clean-room ownership.
2. Map allowlisted journal and evidence outcomes to stable category, severity, statement, and evidence-reference fields.
3. Make ingestion opt-in, deterministic, idempotent, restart-safe, redacted, quarantined, retained, and deletable.
4. Exclude transcripts, model prose, Chronicle content, and OpenTelemetry content capture.
5. Measure observation precision, duplication, quarantine, recurrence precision, proposal dispositions, storage, and triage
   time across representative modernization and qualification runs.

**Exit gate:** Accepted precision and privacy thresholds are met while proposals remain inert and human-decided. A noisy
automatic adapter remains disabled without weakening manual observation or the existing safety proof.

## Milestone N: Bundle And Automation Simplification

**Outcome:** One npm-owned bundle and one characterized validation graph replace duplicate orchestration without a new
framework.

**Status:** Complete. Issue #119 records representative hook-selection, exit, and timing parity against `b27d173`; the
dynamic two-client context and cache samples remain explicitly assigned to Milestone O.

**Requirements:** `REQ-DIST-001`, `REQ-QUALITY-001`, `REQ-SECURITY-001`, `REQ-DETERMINISM-001`, `REQ-DOCS-001`.

**Dependency-complete slices:**

1. Add source-to-generated mappings, client projections, composition metadata, content locks, and deterministic manifests
   to the npm bundle; do not add APM or a second installer.
2. Apply the characterized linting owner map by validator family; preserve focused commands, diagnostics, exit codes,
   language-native parsing, and externally consumed aliases until proven unused.
3. Repair the Markdown pre-commit lookup so missing executables fail closed and match direct repository lint behavior.
4. Keep lefthook a thin consumer of canonical validators; permit parallel execution only while structural tests prove
   there is one Git-index writer.
5. Consolidate workflow setup and responsibility only where characterization proves duplicate ownership while keeping
   required check names, triggers, permissions, pins, artifacts, and independent external-runtime visibility stable.
6. Archive obsolete scripts and workflows with provenance instead of retaining successful no-op compatibility paths.

**Exit gate:** Canonical owners and duplicate definitions decrease; required checks, permissions, triggers, pins,
diagnostics, artifacts, coverage, and exact-head behavior remain stable; CI, hook, and context baselines do not regress.

## Milestone O: Skill And Instruction Migration And Active Guidance Rewrite

**Outcome:** Repository and managed guidance preserve required domain capability, describe the implemented two-client
system, minimize measured context, and point to canonical owners.

**Requirements:** `REQ-CUSTOMIZATION-001`, `REQ-CAPABILITY-001`, `REQ-DETERMINISM-001`,
`REQ-GUIDANCE-001`, `REQ-MAINTAINABILITY-001`, `REQ-DOCS-001`.

**Dependency-complete slices:**

1. Apply the characterized owner map: stable repository facts in root guidance, path-specific rules in scoped
   instructions, detailed procedures in skills, executable role data in agent frontmatter/manifest, and consumer
   behavior in managed guidance.
2. Reconcile Markdown guidance for human docs, prompts/agents, generated artifacts, templates, and historical evidence;
   route new diagrams to Mermaid/Python while keeping historical Draw.io artifacts readable.
3. Rewrite `.github/copilot-instructions.md` around supported clients, cloud-agent exclusion, kernel and Gate 4 authority,
   MCP distinctions, source/generated boundaries, validation ownership, and release controls.
4. Rewrite root `AGENTS.md` for common setup, build, validation, and client qualification; keep scoped `AGENTS.md` files
   limited to directory-specific IaC rules.
5. Update managed instructions, agents, skills, prompts, templates, guides, workflow documentation, changelog, and
   provenance only after their implementation owners stabilize.
6. Regenerate packaged assets only from canonical sources and validate effective instruction/skill discovery, context
   budgets, and semantic rule presence in both clients.
7. Implement issue #175's managed custom-agent contract refresh: keep shared source roles cross-client, emit explicit
   `target` values in selected-client projections, reject retired or unsupported fields, characterize hidden-worker
   invocation, and prove prompt/tool, discovery, and delegation boundaries in both supported clients.
8. Inventory every active v1 skill and instruction with its consumers, domain behaviors, target owner, disposition,
   replacement proof, rollback or removal gate, and both-client scenario coverage.
9. Preserve domain knowledge through focused managed skills, scoped instructions, on-demand references, typed evidence,
   or executable capability owners. Keep role skills as routers rather than pretending concise workflow prose replaces
   Azure, WAF, ADR, IaC pattern, validation, deployment, and diagnostic expertise.
10. Strengthen schemas and validators where required behavior must be deterministic; do not leave safety, traceability,
    or approval-critical rules solely in model guidance.
11. Optimize migrated guidance only after parity passes by removing duplicate authority, sharing references, tightening
    discovery descriptions, and measuring loaded context and cache behavior in both supported clients.
12. Add positive scenarios for every retained capability cluster and negative discovery tests for every retired source;
    block release when a source has neither qualified replacement evidence nor an approved retirement decision.

Issue [#219](https://github.com/jonathan-vella/apex-vnext/issues/219) owns the skill and instruction migration,
replacement proof, and measured optimization workstream.

Issue #179 found that observed Copilot CLI `1.0.73` behavior cannot make a custom-agent worker both non-selectable and
explicitly `task`-callable. Issue #180 must resolve that contract gap before Milestone O or paired qualification can
complete. ADR-0006 resolves the implementation boundary by omitting autonomous workers from the CLI projection;
worker-dependent CLI scenarios remain unavailable until an exact supported client proves independent controls.

**Exit gate:** Active guidance contains no obsolete MCP, Draw.io, VS Code-only, APM-adoption, or per-IaC SBOM claim;
every active v1 skill and instruction has a proven replacement or approved retirement; retained domain scenarios pass in
both clients; measured optimization does not reduce semantic coverage; generated assets match canonical sources; both
clients discover the intended instructions, skills, and agents without conflict.

## Terminal Agent Testing And Validation

**Outcome:** The immutable optimization completion tree receives all deferred full validation and managed-agent
qualification as the final technical activity before the maintainer cutover decision.

**Entry gate:** The issue #220 completion receipt is accepted, all autonomous-loop processes are stopped, and the exact
tree hash is frozen. No uncommitted or generated drift is present.

**Order:**

1. Review the autonomous-loop commits, measurements, findings, and accepted deferrals without changing the tree.
2. Run the full repository, security, package, provenance, and clean-install validation suite on the frozen tree.
3. Run managed-agent scenarios, model comparisons, paired-client execution, live qualification, and cross-device
   evidence collection on that same tree.
4. Bind all results to the tree hash and produce the final qualification verdict.
5. Treat any file, dependency, configuration, or generated-output change as invalidating the terminal results; return
   the delta through the bounded optimization loop and restart this terminal stage.

**Exit gate:** Full deterministic validation and managed-agent qualification pass on one unchanged tree, or release is
blocked with findings returned to the repository optimization queue.

## Milestone P: Final Qualification And Cutover Decision

**Outcome:** One exact revised candidate has complete deterministic, replacement, security, package, live, and
both-client evidence, rollback ownership, and an explicit release decision.

**Requirements:** All requirements in [PRD.md](PRD.md).

**Final gate:**

- Run full repository validation, native CodeQL, dependency review, and independent security review.
- Qualify deterministic packages, release manifest, APEX-level SBOM, provenance, clean install, capability packs,
  customization update, rollback, and uninstall.
- Prove each retired surface is absent from active discovery, packaging, setup, validation, and guidance only after its
  replacement gate passes.
- Repeat VS Code and Copilot CLI manual qualification, cross-device transfer, and final Bicep and Terraform ceremonies
  after the last release-relevant hash change.
- Recalculate scorecard measurements and account for every requirement, metric, risk, limitation, evidence hash, and
  rollback owner.
- Complete v1 critical-fix sync, documentation audit, trusted-publisher setup, tag and support-date proposals.
- Obtain new explicit maintainer authorization before tags, publication, support dates, or cutover.

**Historical traceability:** Build plan release and cutover phases; governance completion plan Phase 6; DECISION-013.
