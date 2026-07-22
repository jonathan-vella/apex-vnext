## APEX vNext Decision Index

This index is append-only. Amend a decision with a new entry rather than rewriting its historical context. Add an ADR
when a decision has lasting architectural consequences that need alternatives and trade-off analysis.

## DECISION-001: Use Hybrid Project Governance

- **Date:** 2026-07-14
- **Owner:** `@jonathan-vella`
- **Context:** vNext needs durable intent across devices without duplicating granular work state in repository files.
- **Options:** Repository-only tracking; GitHub-only tracking; hybrid repository and GitHub tracking.
- **Choice:** PRD, roadmap, register, decisions, and checkpoints live in the repository. Issues own executable status. The
  GitHub Project is a view over issues and pull requests.
- **Rationale:** Stable governance benefits from reviewable version history, while assignment and daily state need GitHub
  workflow semantics.
- **Consequences:** `PROJECT.md` stays concise; issue checkpoints are mandatory before pausing; mutable status cannot have
  two owners.
- **ADR:** Not required; this is a delivery-governance choice.
- **Issue/PR:** [#536](https://github.com/jonathan-vella/apex/issues/536),
  [PR #548](https://github.com/jonathan-vella/apex/pull/548)

## DECISION-002: Use The Existing Integration Branch

- **Date:** 2026-07-14
- **Owner:** `@jonathan-vella`
- **Context:** Phase 0A deferred a long-lived vNext branch, but implementation now spans repository packages, configuration,
  customizations, tools, and documentation under draft PR #533.
- **Options:** Copy from a temporary repository at the end; work directly on one branch; use an integration branch with
  isolated issue worktrees.
- **Choice:** Keep `feat/apex-vnext-rewrite` as the durable integration branch. Execute slices on short-lived issue branches
  in isolated worktrees and target their pull requests to the integration branch.
- **Rationale:** This preserves history, continuously tests real repository integration, and avoids a second bulk migration
  that would invalidate exact-head evidence.
- **Consequences:** The Phase 0A branch-sequencing assumption is superseded, but its no-tag and no-cutover safety intent
  remains. PR #533 stays draft and `main` stays on v1.
- **ADR:** Not required; repository topology is captured by the project controls.
- **Issue/PR:** [#536](https://github.com/jonathan-vella/apex/issues/536),
  [PR #548](https://github.com/jonathan-vella/apex/pull/548)

## DECISION-003: Modernize Through Dependency-Complete Vertical Slices

- **Date:** 2026-07-14
- **Owner:** `@jonathan-vella`
- **Context:** Guidance, validators, scripts, workflows, hooks, generated metadata, packages, and documentation have
  cross-domain dependencies.
- **Options:** Rewrite by repository area; mass rewrite; inventory first and migrate one dependency-complete slice at a
  time.
- **Choice:** Inventory the whole ownership surface, then execute independently revertible vertical slices with
  characterization, migration, compatibility, validation, measurement, and documentation.
- **Rationale:** Cross-domain behavior and diagnostics must remain equivalent while duplicate ownership is retired.
- **Consequences:** Unrelated cleanup cannot be bundled into a slice; a worsened release gate requires revert or explicit
  acceptance with owner and expiry.
- **ADR:** Create ADRs only for consequential canonical-ownership decisions.
- **Issue/PR:** Destination issue `#11`.

## DECISION-004: Keep Improvement Observe-And-Propose Only

- **Date:** 2026-07-14
- **Owner:** `@jonathan-vella`
- **Context:** Recurring deterministic failures can inform improvements, but untrusted observations must not gain runtime
  or repository authority.
- **Options:** Autonomous self-modification; automated issue and pull-request creation; bounded observation and inert
  proposals with human decisions.
- **Choice:** Extend the existing quality and evidence lifecycle with schema-first observations, recurrence, proposals,
  and human decisions. Proposals remain inert.
- **Rationale:** This captures useful recurrence without creating prompt-injection, approval, deployment, or mutation
  paths.
- **Consequences:** MCP may submit bounded observations or read proposals, but cannot decide, apply, edit, create pull
  requests, approve gates, publish, or deploy. Automated issue creation needs a later decision.
- **ADR:** Required before implementing the improvement subsystem; compare the referenced upstream design and provenance.
- **Issue/PR:** Destination issue `#12`.

## DECISION-005: Keep VS Code As The Only First-Release Agent Runtime

- **Date:** 2026-07-14
- **Owner:** `@jonathan-vella`
- **Context:** The managed customization architecture and qualification plan target supported VS Code Copilot contracts.
- **Options:** Qualify multiple agent runtimes; support VS Code only for the first release.
- **Choice:** Remain VS Code-only for vNext.
- **Rationale:** Broad runtime support would multiply handoff, tool, model-tier, security, and qualification surfaces before
  the first release is proven.
- **Consequences:** GitHub Copilot CLI and other agent runtimes are out of scope. Runtime expansion requires a new decision
  and qualification plan.
- **ADR:** Not required until runtime expansion is proposed.
- **Issue/PR:** Destination issue `#9`.

## DECISION-006: Extend The Existing Bug Form For Regressions

- **Date:** 2026-07-14
- **Owner:** Repository maintainers
- **Context:** The existing bug form captures description and reproduction but not integration head, failed check, or
  regression test provenance.
- **Options:** Add a separate regression form; extend the existing form with optional vNext provenance fields.
- **Choice:** Extend the bug form and keep one defect intake path.
- **Rationale:** A second mutable defect intake would fragment triage while adding no distinct lifecycle.
- **Consequences:** Regression issues can bind head, check, expected behavior, and proof test without burdening ordinary
  bug reports.
- **ADR:** Not required.
- **Issue/PR:** [#536](https://github.com/jonathan-vella/apex/issues/536),
  [PR #548](https://github.com/jonathan-vella/apex/pull/548)

## DECISION-007: Treat The Historical Build Plan As Superseded Input

- **Date:** 2026-07-14
- **Owner:** Product governance
- **Context:** The historical build plan mixes locked requirements, phase sequencing, and status assumptions that no longer
  match the implemented repository.
- **Options:** Maintain both plans; delete the old plan; preserve it as historical input and move binding content into the
  PRD and roadmap.
- **Choice:** Preserve the old plan, mark it superseded, and use [PRD.md](PRD.md) and [ROADMAP.md](ROADMAP.md) as the
  active product and delivery authorities.
- **Rationale:** This retains design provenance without creating two mutable plans.
- **Consequences:** New scope changes require a decision and PRD update. Historical phase labels are traceability only.
- **ADR:** Not required.
- **Issue/PR:** [#536](https://github.com/jonathan-vella/apex/issues/536),
  [PR #548](https://github.com/jonathan-vella/apex/pull/548)

## DECISION-008: Extract vNext To A Dedicated Repository

- **Date:** 2026-07-16
- **Owner:** `@jonathan-vella`
- **Context:** The vNext runtime, qualification infrastructure, and release controls are independently testable, while
  the original APEX repository must retain its v1 `main` line.
- **Options:** Merge vNext into the original `main`; continue indefinitely on a rolling branch; create a dedicated
  repository with full history; create a dedicated repository from a qualified clean snapshot.
- **Choice:** Create private repository `jonathan-vella/apex-vnext` from source commit
  `60d96d5a46ff534069c58275cfd32cb8d4490971` as a clean snapshot. Use its `main` branch for vNext integration. Exclude
  the Astro site and maintain repository-native Markdown under `docs/`.
- **Rationale:** This keeps the original v1 line untouched, removes unrelated site coupling, and gives vNext a default
  branch that can host its dispatch-only qualification workflow without merging candidate runtime into the old repo.
- **Consequences:** Source SHAs are recorded as provenance rather than preserved as destination history. Live and final
  qualification must bind to destination commits. Open vNext issues move to the new repository, while old draft pull
  requests close unmerged with migration receipts.
- **ADR:** Not required; this is a repository and release-governance decision.
- **Issue/PR:** See [repository migration](../MIGRATION.md).

## DECISION-009: Do Not Run Devcontainer CI

- **Date:** 2026-07-16
- **Owner:** `@jonathan-vella`
- **Context:** The dedicated repository already has runtime, package, Markdown, IaC, and aggregate validation gates.
- **Options:** Require the multi-architecture devcontainer workflow; keep it advisory; disable it.
- **Choice:** Disable `validate-devcontainer-base.yml` in GitHub Actions and exclude devcontainer CI from migration and
  release acceptance.
- **Rationale:** The maintainer explicitly declined devcontainer CI for ongoing vNext work.
- **Consequences:** Agents must not dispatch, rerun, or treat this workflow as a gate. Re-enabling it requires another
  explicit maintainer decision. Local devcontainer configuration and non-CI validation remain available.
- **ADR:** Not required; this is a repository validation-policy decision.
- **Issue/PR:** Not applicable.

## DECISION-010: Keep Deployment Approval In APEX Gate 4

- **Date:** 2026-07-16
- **Owner:** `@jonathan-vella`
- **Context:** Required GitHub Environment reviewers are unavailable for the private destination repository on the
  current billing plan. More importantly, external reviewer protection is not a product requirement for APEX. The
  approved preview still needs one explicit human decision before a state-changing sandbox operation.
- **Options:** Upgrade GitHub solely for Environment reviewers; add a second manually dispatched apply workflow; let CI
  create its own approval; keep local APEX Gate 4 as the approval and use the Environment only for OIDC/configuration;
  remove deployment approval entirely.
- **Choice:** Keep local APEX Gate 4 as the sole human deployment approval. The maintainer reviews and approves the exact
  native preview locally before writer and provider authority transfer. The unprotected GitHub Environment scopes OIDC,
  variables, and secrets only and does not attest human review. CI imports the existing approval and cannot create or
  replace it.
- **Rationale:** This preserves exact-preview authorization and stale/substitution defenses without a paid GitHub
  control or a second approval workflow. It also keeps approval ownership inside the deterministic APEX runtime.
- **Consequences:** Approval evidence identifies the local actor rather than a GitHub reviewer. A single approved
  one-hop transfer may move the exact preview and approval to the intended CI recipient. Missing, stale, expired,
  changed-recipient, changed-preview, or second-hop authority fails closed. Real apply/destroy remains limited to the
  isolated non-production qualification sandbox until live evidence is accepted.
- **ADR:** [ADR-0002](../../agent-output/vnext-qualification/03-des-adr-0002-use-local-gate-4-before-ci-handoff.md).
- **Issue/PR:** Destination issue `#9`.

## DECISION-011: Use A Bounded Entra-Only Handoff Endpoint Session

- **Date:** 2026-07-17
- **Owner:** `@jonathan-vella`
- **Context:** The qualification runner's general internet IP was `78.133.3.226`, but Azure Storage diagnostics recorded
  OAuth Blob requests from non-deterministic Microsoft egress addresses `20.97.9.18` and `20.97.10.99`. A single-host
  Storage firewall rule therefore could not authorize this execution environment.
- **Options:** Broaden IP allowlisting to Microsoft egress ranges; move execution to a stable-egress runner; use a
  temporary private GitHub release asset; use a bounded Entra-only public endpoint session.
- **Choice:** Use a time-boxed public endpoint session for recipient-bound handoff bundles. Validate the at-rest
  `Disabled`/`Deny`/zero-IP-rule posture, retain Entra RBAC, shared-key disabled, anonymous Blob disabled, and
  recipient/candidate binding, then temporarily set public access `Enabled` and firewall default `Allow`. Cleanup restores
  `Deny`, then `Disabled`, removes the session-only policy tag, and verifies every final state.
- **Rationale:** This authorizes identities rather than unstable network egress, preserves platform encryption and
  least-privilege RBAC, and remains bounded and auditable without silently broadening to an unmaintainable IP range.
- **Consequences:** During the short transaction, the endpoint is network-reachable from public networks but accepts only
  authenticated, authorized Entra requests. Any cleanup failure is blocking. The exception expires after 24 hours and
  requires fresh review before another session.
- **ADR:** [ADR-0003](../../agent-output/vnext-qualification/03-des-adr-0003-use-bounded-entra-only-handoff-session.md).
- **Issue/PR:** Destination issue `#9`.

## DECISION-012: Support VS Code And GitHub Copilot CLI

- **Date:** 2026-07-21
- **Owner:** `@jonathan-vella`
- **Context:** DECISION-005 limited the first release to VS Code, but the release must now support the same governed APEX
  workflow from a terminal client.
- **Options:** Keep VS Code only; add prompt-only CLI content; support the full governed workflow in both clients; include
  GitHub Copilot cloud coding-agent sessions.
- **Choice:** Support GitHub Copilot in VS Code and GitHub Copilot CLI with equivalent typed workflow outcomes. Explicitly
  exclude GitHub Copilot cloud coding-agent sessions, Copilot code review as an APEX client, and other runtimes.
- **Rationale:** The kernel already owns state, questions, tasks, gates, and evidence independently of client UI. A
  client-adapter boundary can preserve those controls while allowing VS Code and terminal-native interaction.
- **Consequences:** This decision supersedes the first-release scope in DECISION-005. VS Code may use direct handoffs and
  `vscode/askQuestions`; Copilot CLI may use custom-agent delegation and `ask_user`. Both must record typed answers through
  APEX and pass client-specific discovery, MCP, resume, hidden-worker, model, and cross-device qualification. ARM MCP
  support in cloud coding-agent sessions is not a requirement and needs no fallback.
- **ADR:** Required before implementation if one canonical agent definition cannot generate both client projections
  without weakening tool or invocation boundaries.
- **Issue/PR:** Pending work-item creation.

## DECISION-013: Re-Baseline The 0.10.0 Release Candidate

- **Date:** 2026-07-21
- **Owner:** `@jonathan-vella`
- **Context:** The accepted client, MCP, diagram, improvement, packaging, automation, and guidance changes alter the
  release-relevant dependency and behavior boundary after prior exact-main qualification.
- **Options:** Ship the prior candidate and defer the changes; include only low-risk cleanup; require all approved changes
  before the first release.
- **Choice:** Treat every approved roadmap change as blocking for `0.10.0` and repeat complete qualification on one final
  exact candidate.
- **Rationale:** Shipping before the changes would immediately create two supported product baselines and make the old
  evidence appear to qualify behavior it never exercised.
- **Consequences:** Prior CI, package, security, and live cloud evidence remains historical characterization evidence but
  cannot authorize the revised candidate. Publication, tags, support dates, and cutover require a new explicit decision
  after deterministic, security, package, replacement-gate, and both-client qualification passes.
- **ADR:** Not required; this is a release-governance decision.
- **Issue/PR:** Pending work-item creation.

## DECISION-014: Use A Typed ARM MCP Adapter For Managed Pricing

- **Date:** 2026-07-21
- **Owner:** Capabilities and architecture
- **Context:** The custom Azure Pricing MCP duplicates pricing and cost-management capabilities now available from the
  Azure Resource Manager MCP server, but APEX requires deterministic evidence and strict authority boundaries.
- **Options:** Keep the custom server; let agents call ARM MCP directly; normalize ARM MCP output through an APEX-owned
  typed adapter; remove pricing without replacement.
- **Choice:** Replace managed pricing with an APEX-owned adapter that calls exact read-allowlisted ARM MCP Pricing and
  Cost Management tools and emits typed, attested evidence. Permit optional direct read-only ARM MCP use for exploration,
  but do not treat direct output as gate evidence.
- **Rationale:** The adapter preserves source provenance, scope, freshness, deterministic arithmetic, redaction, and
  fail-closed tool compatibility while reducing ownership of upstream Azure price and cost retrieval.
- **Consequences:** Deployment, cancellation, budget creation, unknown, renamed, and write tools are rejected before
  transport. The current pricing pack remains active until its declared reliability, latency, security, semantic parity,
  and maintenance gates pass. Broader Resource Graph, deployment-observation, forecast, and price-sheet uses require
  separate typed read adapters and qualification. ARM MCP never inherits Gate 4 or native IaC authority.
- **ADR:** Required before implementation because this changes a release capability and external trust boundary.
- **Issue/PR:** Pending work-item creation.

## DECISION-015: Retire Legacy MCP And Draw.io Surfaces Through Explicit Gates

- **Date:** 2026-07-21
- **Owner:** Capabilities and developer experience
- **Context:** Astro MCP has no active product consumer, Terraform MCP wraps registry lookup rather than Terraform
  lifecycle behavior, and Draw.io carries a large optional generation and validation surface.
- **Options:** Keep all servers; remove them immediately; retire each against an owned replacement and preservation gate.
- **Choice:** Remove Astro MCP directly; replace Terraform MCP registry lookup with deterministic Terraform Registry and
  native CLI owners; replace new Draw.io outputs with Mermaid and Python after measured diagram qualification.
- **Rationale:** The chosen owners are simpler and align with the actual behavior boundaries without conflating Azure MCP
  guidance with Terraform lifecycle semantics.
- **Consequences:** Microsoft Azure MCP may provide verified Azure and Terraform guidance but is not assumed to replace
  Terraform Registry or native CLI behavior. Terraform state, plans, imports, apply, destroy, and Gate 4 remain native.
  Mermaid owns inline diagrams; editable Python plus rendered outputs owns standalone architecture and charts. Historical
  Draw.io artifacts remain readable. Pricing and Draw.io source moves to a non-discoverable archive only after each
  replacement gate passes; failed gates leave the current pack active.
- **ADR:** Required for the diagram artifact-contract migration; not required for the isolated Astro removal.
- **Issue/PR:** Pending work-item creation.

## DECISION-016: Keep Npm As The Sole Distribution Authority

- **Date:** 2026-07-21
- **Owner:** Release engineering
- **Context:** The hve-squad/APM model demonstrates useful source/generated separation, composition manifests, locks, and
  versioned installation, while APEX already has a typed npm runtime and transactional customization lifecycle.
- **Options:** Replace npm with APM; add APM as a second path; keep the current bundle unchanged; borrow applicable
  packaging concepts within the npm lifecycle.
- **Choice:** Keep npm and `customizations/manifest.json` authoritative. Add explicit source-to-generated mappings,
  content locks, client projections, composition metadata, and deterministic manifests within the existing bundle.
- **Rationale:** This gains the useful packaging properties without splitting runtime, capability, update, rollback, and
  release ownership across package managers.
- **Consequences:** Do not add `apm.yml`, an APM lock, an APM runtime dependency, or a second install command. Generated
  CLI assets remain derived and must never be edited directly. The release SBOM covers APEX deliverables; generated IaC
  projects need an SBOM only when their own requirements request one.
- **ADR:** Not required unless future evidence proposes a second distribution authority.
- **Issue/PR:** Pending work-item creation.

## DECISION-017: Operationalize Bounded Improvement Without Promotion Authority

- **Date:** 2026-07-21
- **Owner:** Quality engineering
- **Context:** The contracts, store, CLI, MCP, policy, and safety proof from DECISION-004 are implemented, but normal APEX
  outcomes do not yet feed representative observation and proposal measurements.
- **Options:** Keep manual submission only; ingest structured APEX outcomes; promote accepted observations into guidance;
  allow autonomous mutation.
- **Choice:** Deterministically ingest allowlisted journal and evidence outcomes, then measure observation and recurrence
  precision, duplication, quarantine, proposal disposition, storage growth, and triage cost. Keep proposals inert and
  human decisions mandatory.
- **Rationale:** This adapts the useful recurrence model without introducing transcript injection, self-modification, or
  a second repository-change path.
- **Consequences:** Raw chat transcripts, model prose, Copilot Chronicle content, and OpenTelemetry content capture are
  not sources. The ClawHub `pskoett/self-improving-agent` page is downstream OpenClaw packaging of the upstream work
  cited by
  ADR-0004; its flat-file logs, direct `AGENTS.md` or skill promotion, extraction, and autonomous mutation are
  excluded.
  A noisy automatic adapter remains disabled without weakening manual observation.
- **ADR:** ADR-0004 remains authoritative; add a provenance amendment before implementation.
- **Issue/PR:** Pending work-item creation.

## DECISION-018: Consolidate Automation Conservatively

- **Date:** 2026-07-21
- **Owner:** Validation and release engineering
- **Context:** Package scripts, validators, hooks, and workflows contain duplicate orchestration, but required checks and
  exact-head release evidence depend on stable behavior and diagnostics.
- **Options:** Leave duplication; build a generic workflow framework; replace all commands at once; migrate measured,
  independently revertible ownership slices.
- **Choice:** Complete the existing validator dependency graph, make hooks thin consumers of canonical validators, and
  consolidate workflows only where characterization proves duplicate ownership.
- **Rationale:** A small machine-readable ownership graph reduces drift without introducing a general task engine or
  generated workflow system.
- **Consequences:** Required check names, triggers, permissions, action pins, diagnostics, artifact boundaries, and release
  authority remain stable. Serial hooks remain until representative Git-index race and timing evidence permits change.
  Every slice must reduce canonical owners without worsening CI, hook, context, coverage, or diagnostic baselines.
- **ADR:** Not required unless a slice changes a public command or hosted trust boundary.
- **Issue/PR:** Pending work-item creation.

## DECISION-019: Characterize Guidance And Automation Before Rewriting

- **Date:** 2026-07-22
- **Owner:** Developer experience and validation engineering
- **Context:** Agent guidance, Markdown rules, linting configuration, and workflow configuration affect both supported
  clients, generated bundles, local hooks, CI diagnostics, and release evidence. Existing ownership is distributed and
  includes known conflicts and a non-failing Markdown hook lookup defect.
- **Options:** Rewrite each area immediately; combine all four into one implementation; leave current duplication; first
  characterize the four boundaries, then implement independently revertible migrations.
- **Choice:** Make a four-surface characterization and ownership review a Milestone H prerequisite. Defer production
  consolidation to Milestone N and active guidance rewrites to Milestone O.
- **Rationale:** Effective behavior, consumers, and trust boundaries must be known before deduplication can prove that it
  preserves semantics rather than merely reducing file or command counts.
- **Consequences:** Issue #93 produces consumer maps, duplicate/conflict clusters, baselines, canonical-owner proposals,
  proof commands, and rollback/removal gates without changing active rules. Client projections and automation rewrites
  may not hard-code unresolved ownership. No universal task runner, generated workflow framework, or second guidance
  registry is introduced.
- **ADR:** Not required unless a later slice changes a hosted trust boundary or public command contract.
- **Issue/PR:** [#93](https://github.com/jonathan-vella/apex-vnext/issues/93).
