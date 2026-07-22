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
  -> VS Code and Copilot CLI governed workflow parity
  -> ARM MCP pricing replacement
  -> Mermaid and Python diagram migration
  -> bounded improvement operationalization
  -> bundle, validator, hook, and workflow simplification
  -> active guidance rewrite
  -> complete exact-head and both-client qualification
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
[MODERNIZATION-INVENTORY.md](MODERNIZATION-INVENTORY.md). Its machine-readable manifest is validated in the Node CI
graph so later slices cannot move ownership without updating consumers, proof, decisions, and removal gates.

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

1. Remove Astro MCP from active workspace configuration and reject its reintroduction.
2. Characterize the Terraform MCP registry-only tools and their active consumers.
3. Implement bounded Terraform Registry API lookup with deterministic fixtures, caching, and unavailable results.
4. Route installed provider schemas through native Terraform CLI and import guidance through official provider docs.
5. Update active Terraform instructions and skills, then remove Terraform MCP setup and configuration.
6. Remove Go from the devcontainer only if no independent active consumer remains.

**Exit gate:** Active nonhistorical sources contain no Astro or Terraform MCP dependency; Registry and native CLI tests
pass; Terraform state, saved-plan, apply, destroy, and Gate 4 behavior is unchanged.

## Milestone J: Supported Copilot Client Parity

**Outcome:** GitHub Copilot in VS Code and GitHub Copilot CLI drive the same kernel-governed APEX workflow.

**Requirements:** `REQ-DIST-001`, `REQ-STATE-001`, `REQ-CONTRACT-001`, `REQ-WORKFLOW-001`,
`REQ-CUSTOMIZATION-001`, `REQ-APPROVAL-001`, `REQ-SECURITY-001`, `REQ-DOCS-001`.

**Dependency-complete slices:**

1. Keep questions and `needs_input` kernel-owned; map VS Code to `vscode/askQuestions` and Copilot CLI to `ask_user`.
2. Record typed answers through APEX MCP instead of relying on client chat history.
3. Generate VS Code and Copilot CLI agent projections from `customizations/manifest.json`.
4. Add workspace-owned Copilot CLI MCP configuration with an explicit APEX tool allowlist.
5. Extend transactional customization install, update, rollback, uninstall, locks, and conflict handling to both clients.
6. Qualify agent, skill, instruction, model, question, hidden-worker, MCP, gate, restart, and cross-device behavior in both
   clients against equivalent typed outcomes.

**Exit gate:** Both pinned clients produce equivalent journal, task, artifact, gate, denial, resume, and transfer results.
GitHub Copilot cloud coding-agent sessions, Copilot code review, and `/delegate` are not implementation or release gates.

## Milestone K: ARM MCP Pricing Replacement

**Outcome:** Managed architecture pricing uses typed, attested Azure Resource Manager MCP evidence without exposing write
authority to agents.

**Requirements:** `REQ-ARCH-001`, `REQ-CAPABILITY-001`, `REQ-QUALITY-001`, `REQ-SECURITY-001`,
`REQ-DETERMINISM-001`, `REQ-DOCS-001`.

**Dependency-complete slices:**

1. Freeze a parity matrix for retail, meter-aware projection, bulk estimates, regional comparison, commitments,
   negotiated prices, ambiguity, uncertainty, throttling, and provenance.
2. Add versioned pricing-request and pricing-evidence contracts.
3. Implement a pinned-host ARM MCP client with exact Pricing and Cost Management read allowlists.
4. Reject deployment, cancellation, budget creation, unknown, renamed, and write tools before transport.
5. Add an operator collection and attestation path that keeps restricted raw evidence out of task context.
6. Run paired reliability, latency, security, semantic, determinism, and maintenance measurements at the declared pack
   threshold.
7. Archive and remove the custom pricing pack only after every replacement criterion passes.
8. Evaluate Resource Graph inventory, deployment observation, actual and forecast cost, and price-sheet retrieval as
   separately authorized read adapters.

**Exit gate:** The candidate is no worse than the current pack on declared metrics, typed arithmetic and meter semantics
pass, write-tool denial is proven, and no direct exploratory MCP output can satisfy an APEX gate.

## Milestone L: Mermaid And Python Diagram Migration

**Outcome:** New diagrams use source-controlled Mermaid or Python without losing semantic or visual quality.

**Requirements:** `REQ-QUALITY-001`, `REQ-CAPABILITY-001`, `REQ-DETERMINISM-001`, `REQ-DOCS-001`.

**Dependency-complete slices:**

1. Route inline flow, sequence, state, ER, and compact documentation diagrams to Mermaid.
2. Route standalone architecture, network, dependency, runtime, as-built, WAF, cost, and compliance outputs to Python.
3. Generalize existing golden scenarios into format-neutral node, edge, zone, label, legend, and accessibility manifests.
4. Update artifact contracts, templates, prompts, workflow manifests, validators, benchmarks, and Markdown consumers.
5. Qualify editable source, deterministic rendering, semantic coverage, nonblank output, dimensions, clipping, overlap,
   labels, latency, security, and maintenance at the declared pack threshold.
6. Archive and remove Draw.io MCP, skill, assets, tests, and setup only after every replacement criterion passes.

**Exit gate:** No new workflow emits `.drawio`; Python replacements pass the measured gate; historical Draw.io artifacts
remain readable and need no conversion.

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

**Requirements:** `REQ-DIST-001`, `REQ-QUALITY-001`, `REQ-SECURITY-001`, `REQ-DETERMINISM-001`, `REQ-DOCS-001`.

**Dependency-complete slices:**

1. Add source-to-generated mappings, client projections, composition metadata, content locks, and deterministic manifests
   to the npm bundle; do not add APM or a second installer.
2. Apply the characterized linting owner map by validator family; preserve focused commands, diagnostics, exit codes,
   language-native parsing, and externally consumed aliases until proven unused.
3. Repair the Markdown pre-commit lookup so missing executables fail closed and match direct repository lint behavior.
4. Make lefthook a thin consumer of canonical validators; retain serial execution until Git-index evidence permits
   change.
5. Consolidate workflow setup and responsibility only where characterization proves duplicate ownership while keeping
   required check names, triggers, permissions, pins, artifacts, and independent external-runtime visibility stable.
6. Archive obsolete scripts and workflows with provenance instead of retaining successful no-op compatibility paths.

**Exit gate:** Canonical owners and duplicate definitions decrease; required checks, permissions, triggers, pins,
diagnostics, artifacts, coverage, and exact-head behavior remain stable; CI, hook, and context baselines do not regress.

## Milestone O: Active Guidance Rewrite

**Outcome:** Repository and managed guidance describe the implemented two-client system and point to canonical owners.

**Requirements:** `REQ-CUSTOMIZATION-001`, `REQ-CAPABILITY-001`, `REQ-DETERMINISM-001`,
`REQ-MAINTAINABILITY-001`, `REQ-DOCS-001`.

**Dependency-complete slices:**

1. Apply the characterized owner map: stable repository facts in root guidance, path-specific rules in scoped
   instructions, detailed procedures in skills, executable role data in agent frontmatter/manifest, and consumer
   behavior in managed guidance.
2. Reconcile Markdown guidance for human docs, prompts/agents, generated artifacts, templates, and historical evidence;
   route new diagrams to Mermaid/Python without invalidating historical Draw.io readability.
3. Rewrite `.github/copilot-instructions.md` around supported clients, cloud-agent exclusion, kernel and Gate 4 authority,
   MCP distinctions, source/generated boundaries, validation ownership, and release controls.
4. Rewrite root `AGENTS.md` for common setup, build, validation, and client qualification; keep scoped `AGENTS.md` files
   limited to directory-specific IaC rules.
5. Update managed instructions, agents, skills, prompts, templates, guides, workflow documentation, changelog, and
   provenance only after their implementation owners stabilize.
6. Regenerate packaged assets only from canonical sources and validate effective instruction/skill discovery, context
   budgets, and semantic rule presence in both clients.

**Exit gate:** Active guidance contains no obsolete MCP, Draw.io, VS Code-only, APM-adoption, or per-IaC SBOM claim;
generated assets match canonical sources; both clients discover the intended instructions without conflict.

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
