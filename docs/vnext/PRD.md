# APEX vNext Product Requirements

APEX vNext is a workload platform factory for a Center of Excellence (COE) and its consumers. It turns reusable
engineering intent into governed Azure workload infrastructure, code, and useful design and operational documentation.
It sits between an existing platform landing zone and separately developed application code, and also supports
standalone single-subscription labs and demos from day one.

The existing TypeScript runtime, npm CLI, and managed Copilot clients are foundations, not reasons to expand the product.
This document defines the target contract; [PROJECT.md](PROJECT.md) distinguishes implemented behavior from remaining
work. Updating this plan does not implement new commands or authorize live operations.

## Goals

- Preserve existing APEX output quality while reducing input-token demand through reuse.
- Complete the workload lifecycle in standalone GitHub Copilot CLI and the VS Code Copilot harness from one CLI-format
  agent projection.
- Support Windows through WSL2 without Docker or a devcontainer requirement.
- Make installation, everyday use, updates, upgrades, rollback, and eventual distribution straightforward.
- Reuse one COE archetype per consumer project, then adapt only what changes.
- Keep one authoritative location per fact, reuse existing contracts and parameters, and avoid parallel frameworks.
- Preserve durable state, human gates, Azure Policy precedence, security, and equivalent Bicep/Terraform outcomes.

Input efficiency is a design goal. No token baseline, comparative benchmark, new telemetry framework, or claimed
percentage reduction is required now. Existing correctness and safety checks remain in force.

## Users

- Platform engineers who gather requirements, design Azure platforms, generate IaC, and operate deployments.
- Reviewers and approvers who need bounded, traceable decisions and exact deployment previews.
- Repository maintainers who package, qualify, release, support, and roll back APEX.
- Security and governance owners who require least privilege, policy traceability, and evidence retention.
- COE authors who maintain documented, coded workload archetypes and consumers who adapt independent copies.
- Application teams who receive provisioned services, deployment guidance, and operational handoff material.

## Workload Boundary

Both profiles are first-release requirements within one workflow, not separate engines. Record the profile explicitly;
do not infer it from subscription count or an environment name such as `dev`.

| Profile             | Supplied foundation                                       | APEX responsibility                                                  |
| ------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| ALZ-backed workload | Subscription, networking, identity, monitoring and policy | Application services using supplied references by default            |
| Standalone lab/demo | One subscription; no landing zone assumed                 | Workload and required supporting networking, identity and monitoring |

For non-lab work, missing platform inputs require clarification, not permission to create replacements. Any departure
from the supplied-resource default must be explicit and policy-compliant. Shared platform resources must not be
modified or deleted as if workload-owned. Labs do not build an ALZ platform or waive security, policy, cost visibility,
ownership, or deployment approval. No ALZ does not imply that no Azure Policy is assigned.

APEX does not develop application code or deploy foundation landing zones. It provisions the workload into the assigned
subscription so the application team can deploy its existing code.

## Functional Requirements

### REQ-DIST-001: Distribution And Installation

Keep the existing npm `apex` CLI and kernel usable during implementation. Init, update, rollback, and uninstall must
detect local edits, preserve unrelated files and project state, and retain exact runtime/customization compatibility.
Use one canonical customization source and existing package tooling rather than a second editable distribution tree.

Agent Plugins evaluation and implementation belong at the end of feature delivery, together with easy redistribution
of the APEX MCP server and its dependencies. Evaluate npm-only, plugin plus npm runtime, and bundled runtime delivery
against actual standalone Copilot CLI and VS Code Copilot harness lifecycle behavior on WSL2. No option is selected
here. Cover
workspace binding, authentication, prerequisites, version pinning, updates, upgrades, rollback, uninstall, duplicate
discovery, and preservation of active runs. Avoid competing updaters or a hosted service unless separately approved.
Final package and client qualification follows any distribution change.

### REQ-ONBOARDING-001: First-Time Install And Repository Bootstrap

Provide `apex-install` and `apex-bootstrap` terminal entry points with guided Copilot entry points using the same
deterministic implementation. These are setup operations, not another infrastructure workflow or source of approval.

`apex-install` starts from working WSL2 Ubuntu without assuming Node, npm or APEX exists. Detect missing or incompatible
prerequisites for both supported clients and both IaC tracks, show one installation plan, and obtain confirmation before
installing prerequisites and APEX. Preserve compatible installations; require separate confirmation for incompatible
replacement or privileged actions. Authentication remains interactive with credentials outside model-visible inputs.
Verify installed versions and report remaining host or account prerequisites. Native Windows/WSL installation remains
outside this scope; guide users when the required host setup is absent. No source checkout or devcontainer is required.

`apex-bootstrap` configures new, existing or cloned repositories and installs the single Copilot CLI projection used by
standalone CLI and the VS Code Copilot harness. Inspect existing state before proposing changes. Ask whether to copy
from a COE and request its remote
repository URL during setup. Permit one or more selected archetypes from that remote, pinned to exact commits, as
independent workloads in separate folders with separate project state. Do not compose their infrastructure automatically.
Show differences and obtain confirmation before adopting organization defaults or reusable decisions. Existing choices,
manual files and unrelated content remain protected; Azure Policy and mandatory security constraints stay authoritative.

Bootstrap configures the repository, runtime, clients and governance prerequisites without requiring or inventing a
project ID, project environment, workload target or IaC choice. A configured workspace with zero projects is a valid
ready-to-start state. Only after setup does the APEX coordinator gather workload details and create the first project
through the kernel-owned project operation. Empty-workspace status and health checks must not require a selected run.

After confirming repository identity and workload choices, configure APEX and the selected clients. When no usable
GitHub remote exists, offer repository creation and a reviewed push, showing owner, visibility and exact changes.
Default new repositories to private. Never force-push or include unrelated changes implicitly.

For consumer-owned policy discovery, preview the exact GitHub environment, variables, workflow, Azure identity,
federation and read-only role assignments. Reuse an approved identity or offer creation of a dedicated one after explicit
confirmation. Keep discovery permissions separate from deployment permissions and use no client secret. Missing rights
produce actionable administrator steps, not privilege escalation or a false success. Enable and dispatch collection only
after approval; successful setup includes repository/client health checks and the first policy-baseline review PR.
That PR means governance review is pending, not deployment readiness. Baseline review, merge and acceptance remain human
and kernel-controlled. Do not automatically merge the baseline or grant workflow gates.

When an existing central collector is selected, verify and import its current reviewed baseline, including target
coverage and freshness, instead of duplicating the collector or identity. Missing or stale evidence leaves governance
pending. All setup paths report explicit ready, pending or blocked outcomes and resume completed steps without duplicate
imports, repositories, identities or role assignments. Preserve partial progress and evidence; do not claim success while
required actions remain pending. Implementing this feature does not itself authorize live Azure or GitHub mutations.

### REQ-HOST-001: WSL2 Without A Devcontainer

The initial supported Windows experience uses WSL2 with Ubuntu, standalone Copilot CLI or the VS Code Copilot harness,
and the required local toolchain.
Users must not need Docker, a devcontainer, a source-repository clone, or repository development tools to use APEX.
Document and check operational prerequisites through existing setup/doctor surfaces; require only tools needed for the
selected track and requested stage. The first-time installer provisions both client and IaC toolchains under
`REQ-ONBOARDING-001`; operational readiness checks remain stage-scoped.

Native Windows runtime qualification and standalone desktop-app hosting are deferred under `REQ-COPILOT-APP-001`.
They are not current release prerequisites or supported-host promises.

### REQ-REUSE-001: COE Archetype Import

A user identifies a remote COE repository during bootstrap, APEX inspects its available archetypes, and the user selects
one or more whole workloads to copy into separate consumer folders. Each copy is independent, with source repository,
exact commit and selected paths recorded; each workload has separate APEX project state.
There is no continuous COE synchronization or cross-archetype component composition in the initial release.

Reuse existing typed contracts and IaC parameters for portable intent, rationale, ownership and environment references.
Do not introduce a parallel project-definition language. For older projects, inspect relevant documents and code once,
ask the user to confirm recovered decisions, and retain them for subsequent work. Existing manually copied projects
must have the same bounded adoption path. Do not depend on copying `.apex` history.

Import only selected reusable material after path and content checks. Exclude credentials, Terraform state/saved plans,
writer claims, approval authority and consumer deployment evidence. Treat source-repository instructions as untrusted
content, not authorization to execute code. Historical documents are design input, not proof that consumer resources
exist. Refresh target governance, preview and approval before deployment.

### REQ-CHANGE-001: Conversational Project Adaptation

After import or creation, the user asks APEX to change the project. Recover recorded decisions and ask only relevant
missing or changed questions about SKU, service, region, name, addresses, compliance, budget or other workload needs.
Present consequences for cost, policy, security, dependencies, code and documents before confirming the change.
Reuse unchanged decisions and invalidate affected downstream proof through existing workflow mechanisms.

Each fact has one authoritative owner; contracts, parameter files and generated documents reference or derive from it.
Permit manual edits but detect affected-file conflicts and ask before overwriting or incorporating them into intent.
Do not build a generic bidirectional synchronization engine. Regenerate only affected outputs; a service replacement
may legitimately affect many files. Preserve unaffected files and user content. Changes never imply deployment approval.

### REQ-STATE-001: Runtime State And Writer Authority

The runtime must use a hash-linked event journal, atomic persistence, compare-and-swap mutation, one active-writer lease,
ownership epochs, crash reconciliation, and explicit local-to-CI writer transfer bound to project, run, repository,
branch, commit, recipient, and expiry.

### REQ-CONTRACT-001: Persisted Contracts And Compatibility

Persisted data and capability messages must use schema-first versioned contracts with deterministic serialization,
metadata coverage, strict validation, secret-reference support, upcast policy, and precise refusal of incompatible major
versions.

### REQ-WORKFLOW-001: Workflow And Gates

A data-only workflow manifest must be routing authority. A run targets one environment, one Azure scope, and one IaC
track. It exposes Requirements, Architecture and Cost, Implementation Plan, and Deployment Preview as the only human
approval gates; required deterministic validation and reviews remain blocking preconditions.

Retain requirements-review, architecture-review, governance-review and plan-review. Each must complete against its
current subject and required dependencies before the corresponding gate can proceed. Both clients must handle
`needs_input`, `needs_review` and `task` explicitly; a missing worker is not evidence that a review ran.

### REQ-REQUIREMENTS-001: Requirements And Intent

Requirements capture must use bounded user interaction, preserve unresolved assumptions explicitly, produce typed
requirements and SKU intent, and prevent later stages from silently changing approved product intent.

Reuse confirmed intake data without requiring the model to repeat unchanged fields. A bounded amendment path must bind
the base revision, preserve stable requirement IDs, unknowns, deferrals and ownership, and validate the merged artifact
through the same completeness, contradiction and traceability checks as full-document submission. Keep full-document
submission available. Reuse confirmed network intent only when it answers the current Architecture decision; otherwise
ask for confirmation with consequences. Recommendations never record answers or accept risk without human confirmation.

### REQ-ARCH-001: Architecture, Cost, And Assumptions

Architecture must trace decisions to requirements, pricing, security, operations, performance, reliability and cost
reasoning. Capture alternatives, consequences and rationale once so downstream documents can reuse them. Agents query
Microsoft ARM MCP directly through explicit read-only Cost Management and Pricing tool allowlists. Separate unpriced
items from priced totals and retain source dates and uncertainty; never invent prices or confidence.

Scope pricing tools to the roles that need them. Reuse matching rows from bounded current pricing evidence rather than
querying again per line item. Broader queries require a supported provider interface, bounded responses and exact
service, SKU, region, currency and meter matching; do not assume a batch API or invent missing prices.

Quota and regional/SKU availability are assumptions, not required evidence or Architecture approval blockers. Restore,
failover and capacity details may be described as assumptions or guidance, never as tested facts without evidence.
Policy, security controls and deployment authorization remain binding. Native deployment failures require approved
corrections, not silent substitutions.

### REQ-GOV-001: Governance And Policy

Azure Policy always wins in both profiles. Follow [issue #344](https://github.com/jonathan-vella/apex-vnext/issues/344):
a scheduled/manual GitHub Actions collector exports effective management-group policy, including inheritance and
exemptions, to one reviewed committed JSON baseline. Resolve the subscription from the run scope, import only its entry,
and preserve discovery, reconciliation, governance review, then Gate 2.

The consumer repository owns the collection workflow, variables and GitHub Secrets/environment settings. Prefer OIDC
with a read-only collection identity separate from deployment authority; never commit credentials. Azure remains the
policy source of truth. The JSON is observed evidence, not a policy override. Include referenced definitions,
initiative members, effective parameters, inherited and target-scope applicability, exclusions and exemptions; preserve
unsupported semantics as blockers rather than silently dropping them. No valid target snapshot means no IaC planning.

Freshness is measured in UTC elapsed time since successful Azure collection: age below 30 days permits reuse; at
exactly 30 days or older refresh is mandatory before IaC planning or a new deployment approval. Below 30 days show the
collection date and age, offer Use existing snapshot (default) or Refresh from Azure, and retain the choice for the
run instead of asking at each stage. Refresh is optional below the threshold, including before deployment. Failed
optional refresh does not erase valid prior evidence. Missing, incomplete, future-dated or wrong-scope evidence is
unusable regardless of age. Legacy collector TTL values cannot shorten or extend this age rule.

A successful unchanged refresh renews collection time, not policy-content identity. Keep observation freshness separate
from normalized policy-content hashes so timestamp-only renewal does not invalidate approved plans. Material constraint
changes require reconciliation and affected approval renewal. Native preflight and live Azure enforcement always apply;
known policy violations cannot be bypassed by choosing a cached snapshot. APEX must reconcile denial or partial outcomes
without weakening policy. Audit and delayed policy-managed outcomes are not assumed compliant merely because apply succeeds.

Reuse the baseline schema, parser, artifacts, object store, validators and gate. Add only a deterministic importer and
path-only CLI/MCP operation. Carry Deny, Modify and DeployIfNotExists mappings into planning and code validation; other
applicable effects need a mapped or explicit disposition. Missing, stale, unmapped or mismatched baseline evidence must
be surfaced under existing governance checks, never interpreted as no policy.

The same collector/import contract must represent a standalone subscription's effective policies or an evidenced empty
result; labs do not require an ALZ hierarchy. No new Governance agent, hidden worker, local live discovery path,
capability-pack execution, external storage, GitHub artifact delivery or new gate. The full baseline stays outside MCP
payloads, task/model context and journals. Copied COE policy is not consumer authority. A baseline does not guarantee
that Azure Policy will remain unchanged at deployment time.

### REQ-PLAN-001: Track-Neutral Planning

Planning must separate implementation intent from Bicep or Terraform binding, maintain an acyclic dependency graph, map
all requirements and governance constraints, and produce environment inputs without embedding secrets.

### REQ-IAC-001: Dual-Track IaC

Bicep and Terraform must derive from the same approved intent, preserve logical resource parity, use exact tool and module
pins, enforce the security baseline, and pass a thin dual-track proof before broader scenario claims.

### REQ-BICEP-001: Bicep Lifecycle

Bicep preview, apply, inventory, reconciliation, and destroy must use native Azure commands and deployment-stack
ownership where qualified. A fallback may operate only when it proves complete managed-resource coverage and safe delete
semantics.

### REQ-TERRAFORM-001: Terraform Lifecycle

Terraform must use a secured Azure Storage backend with identity-based access, locking, retention, and compliant
networking. Preview must create a protected saved plan; approval and apply must bind that exact plan, lineage, serial,
inputs, commit, recipient, and expiry. Production CI apply remains blocked until recipient-bound encrypted transport is
qualified. Native Terraform CLI and provider interfaces remain lifecycle authorities; Terraform or Azure MCP tools may
assist discovery and guidance but cannot own initialization, schemas, state, plans, imports, apply, or destroy.

### REQ-APPROVAL-001: Preview And Approval Binding

Deployment Preview is the production approval ceremony. Approval must bind actor and run identity, target, operation,
inputs, IaC tree, policy envelope, preview, commit, owner epoch, recipient, and expiry. Stale, substituted, incomplete,
or rejected evidence must fail closed. APEX Gate 4 owns this decision; external CI environment protection is not an
approval authority.

### REQ-OPS-001: Operations, Promotion, And Diagnosis

Operations must be read-first and journaled. Environment promotion creates a linked run, inherits only unchanged neutral
gates, refreshes environment-specific preview and approval, and never inherits Gate 4. Diagnosis, reconciliation,
inventory, and destroy must preserve operation ownership and evidence.

### REQ-QUALITY-001: Quality And Evidence

Retain deterministic validation, evidence hashes, provenance, redaction, restart/fault and cache-correctness checks.
Use the [Output Quality Reference](#output-quality-reference) for human review of usefulness and completeness.
Human judgments must be labeled and cannot satisfy deterministic security or deployment gates. No new token baseline
or token-reduction release gate is required now; existing measurement utilities need not be removed.

### REQ-CAPABILITY-001: Capabilities And Optional Packs

External operations must pass through a versioned capability protocol with grants, roles, expiry, bounded output,
timeouts, redaction, and safe argv execution. Astro, Terraform, and custom Azure Pricing MCP servers must not be active
dependencies. Supported clients must connect directly to Microsoft ARM MCP with explicit read-only tool grants; managed
agents must not receive deployment, budget-write, pricesheet-operation, unknown, or renamed tools. APEX remains the
authority for workflow state, evidence acceptance, and gates. The target governance path is `REQ-GOV-001`, not
capability-pack execution. Existing unrelated packs retain their locks and safety boundaries; this plan does not
authorize their removal or a broader pack framework.

### REQ-SECURITY-001: Security And Supply Chain

Agents must not self-approve, deploy models, or bypass kernel authorization. The release must provide least-privilege
roles, secret and PII redaction, symlink and traversal defenses, immutable dependency pins, release manifest, CycloneDX
SBOM, provenance, and no high or critical unresolved security finding. The SBOM covers released APEX runtime,
customization, and capability deliverables; generated IaC projects do not require an SBOM unless their requirements say
otherwise.

### REQ-CUSTOMIZATION-001: Managed Copilot Experiences

APEX ships one managed projection in the Copilot CLI agent format under DECISION-029. Supported clients are standalone
GitHub Copilot CLI and the GitHub Copilot harness in VS Code, which runs CLI-format agents in the VS Code Agent Host.
Both must produce the same typed workflow outcomes, state and resume behavior, authorization decisions, gates and
evidence. The VS Code Local projection, `vscode/askQuestions`, handoff frontmatter and `.vscode/mcp.json` are retired;
`init` and `update` reject that client with a stable error code and migration hint. Both clients must resolve the
kernel-owned `needs_input` contract and record typed answers without relying on chat history.

- Interactive specialists use `ask_user`. When a request needs several values and the tool lacks native multi-select,
  present the options numbered in kernel order and accept the user's numbers. The kernel validates the resolved values;
  confirmation, correction and cancellation follow [CLIENT-QUALIFICATION](CLIENT-QUALIFICATION.md#multiple-selection-input).
- An `apex-next` skill, invocable by users and agents, reads status and the next task and names the owning agent. It
  delegates the owner with the prepared prompt when the step can complete as a subagent, including any required input.
  Otherwise it prints the client's selection step (`/agent <name>` in standalone CLI, the Agent picker in the VS Code
  harness) and a ready-to-paste scope prompt. The coordinator routes through it.
- A read-only context sidekick publishes the current project and next owner into the session inbox.
- CodeGen, Reviewer and Validator run through `task` delegation with `model-policy: required`; interactive agents use
  `preferred`. Workers rely on kernel task context, not repository instructions. The coordinator may monitor and steer
  delegated workers through agent listing and messaging.
- Built-in helpers are advisory and bounded: Explore for Planner and Operator brownfield discovery (never intake),
  Rubber-duck for Architect and Planner critique, Code-review and Security-review under Reviewer, optional built-in
  Task pre-checks before kernel validation, and user-invoked Research. The owning APEX agent restates any finding as
  typed kernel input; helper output is never evidence, completion or approval.
- Workspace MCP configuration uses `.mcp.json`. User documentation covers `/review` and `/security-review` for
  promoted output.

General-purpose delegation, `/fleet`, `/delegate` and plan mode are not part of managed workflows. Model availability,
grants, agents, skills, managed files and MCP inventory are qualified per client. Qualify both environment profiles and
COE import/change workflows on each supported client. Basic checks accompany features; distribution work is last.

### REQ-COPILOT-APP-001: Standalone Desktop App

**Deferred by maintainer direction on 2026-09-21.** This supersedes the earlier mandatory-third-client decision.
The standalone [GitHub Copilot app](https://github.com/github/app), its native Windows runtime, app-created worktree
integration and app-specific qualification are outside the active release scope. Preserve the requirement ID, probe
evidence and unresolved findings; do not represent deferred work as implemented or qualified.

Resume only after the required standalone CLI and VS Code Copilot harness workflows are confirmed and the maintainer explicitly
selects this backlog item. Upstream replies alone do not resume implementation. See the
[desktop backlog](ROADMAP.md#deferred-standalone-copilot-desktop-app) for retained blockers and restart criteria.
Historical desktop observations do not qualify standalone CLI behavior or replace current supported-client evidence.

### REQ-GUIDANCE-001: Skill And Instruction Capability Parity

The release must preserve required Azure domain behavior in managed vNext skills, scoped instructions, executable
capabilities, contracts, or explicit retirements. Every source must have a target owner,
consumer map, disposition, replacement proof, rollback or removal gate, and supported-client qualification scenario.
Concise role skills may route work, but must not silently replace Azure architecture, WAF, ADR, pricing, security,
governance, IaC pattern, validation, deployment, or diagnostic knowledge with generic model reasoning. Deterministic
authority belongs in the kernel and capability code; non-deterministic domain guidance must remain discoverable on
demand. Use progressive disclosure, bounded task inputs, shared references and removal of redundant reads while
preserving semantic quality. Do not repeatedly feed full documents, policy baselines or the quality-reference corpus
into model context. No token baseline or measurement project is required at this stage.

Keep sequencing in the owning agent and domain knowledge in on-demand skills. Consolidate only demonstrated duplicate
guidance; preserve distinct operational checklists and essential worker safety rules. A shared reference must remain
available in both client projections without requiring speculative skill reads. Tool descriptions must explain each
operation's purpose and boundary, and role/client allowlists must retain required tools while excluding irrelevant ones.

### REQ-DETERMINISM-001: Deterministic Packaging And Validation

Equivalent inputs must produce byte-stable contracts, rendered artifacts, generated IaC, package tarballs, release
manifest, SBOM, and provenance. Validators must have executable registry ownership, stable diagnostics, and equivalent
local, hook, and CI behavior. Validator, hook, and workflow consolidation must reduce duplicate ownership without
changing required check names, permissions, triggers, diagnostics, release authority, or exact-head semantics.

### REQ-MAINTAINABILITY-001: Guidance And Automation Ownership

For each changed concern, identify its existing owner, consumers, diagnostics and security boundary before editing.
Prefer one authoritative fact, focused changes and existing helpers over new schemas, agents, render pipelines or
frameworks. DRY means removing duplicate ownership, not merging unrelated responsibilities. Preserve native validation,
required checks and useful audience-specific guidance. Do not launch repository-wide cleanup as a prerequisite for a
bounded feature; retain historical characterization and existing safety tests.

### REQ-OPTIMIZATION-001: Bounded Input Efficiency

Reduce unnecessary model input as part of each feature: compact authoritative context, relevant questions, unchanged
decision reuse, deterministic filtering and selective regeneration. Preserve rich output and explicit reasoning.
Do not add a token baseline, percentage target, new measurement framework or whole-repository optimization campaign now.

Acceptance for the first delivery batch:

1. Task inputs contain the current accepted revisions required by that task, not every historical completion. Exclude
   superseded and invalidated artifacts from ordinary execution inputs; an explicit revision comparison must identify
   its historical sources separately. Prove that both code-generation tracks select the replacement intent after change.
2. Bounded input reads resolve every review subject to its canonical artifact kind, including plan-review to
   `implementation-intent`. Test missing and stale references, pagination boundaries and complete reconstruction.
3. Context uses deterministic task-specific projections with required dependency evidence and explicit retrieval
   references. Keep useful compact content inline; do not replace one oversized response with mandatory full-history
   pagination. Required templates, recorded input and decisions remain accessible through authorized MCP reads.
4. Enforce input and output byte limits from the run's locked configuration and test the applicable context-size
   contract. Include large fixtures and multibyte content; no silent truncation or claim of measured token savings.
5. Reviewer packs contain the subject, necessary upstream evidence and dispositions, criteria and the exact receipt
   contract. Preserve all review passes and stage-specific reasoning without irrelevant history or full policy baselines.
6. Remove redundant context loading within a request, including subject-only review reads. Preserve task freshness,
   ownership, expiry and journal-integrity checks; this does not authorize persistent snapshots or cross-call caches.
7. Correct next-task guidance, describe registered tools, and test role/client tool coverage. Narrow ARM access by actual
   workflow need; retain legitimate pricing and operational cost paths without granting writes or unsupported tools.
8. Remove proven prompt duplication only with named owners and consumer checks. Keep essential worker boundaries,
   domain-specific guidance and supported output quality; installed file size is not a model-token measurement.

Follow-on acceptance covers bounded requirements amendments and confirmed-decision reuse under `REQ-REQUIREMENTS-001`,
pricing-row reuse under `REQ-ARCH-001`, and supported-client outcomes under `REQ-CUSTOMIZATION-001`. The
[roadmap](ROADMAP.md#optimization-recommendation-dispositions) records the disposition of each reviewed recommendation.
Changes to model routing, transport representation, rendering lifecycle, review concurrency or invalidation semantics
need their stated evidence and authority checks before becoming implementation work. Byte reduction alone cannot
justify weaker review, missing human-readable packages, stale approval reuse or unsupported client mechanics.

This supersedes the blanket product requirement to finish repository-wide optimization before client learning.
Existing executable optimization gates and receipts remain unchanged by documentation edits. Reconcile any blocking
implementation in a focused tested follow-up before running affected scenarios; never bypass checks or fabricate a
receipt. Separately authorized maintenance remains bounded by its manifest and has no merge or deployment authority.

### REQ-MCP-001: Predictable Tool Contracts

The CLI MCP adapter exposes kernel-authorized operations, not a second workflow engine. Improve the current pinned
SDK before considering a protocol migration. Acceptance:

1. Every successful tool result validates through the supported SDK. Preserve existing object responses; wrap Markdown
   and lists in named objects. Retain serialized text alongside structured results for compatible clients.
2. Execution failures return `isError: true` and a stable, sanitized APEX code/message. Unexpected diagnostics, stacks,
   raw provider errors and unreviewed details must not reach the model. Test stale, validation and internal failures.
3. Publish output schemas, starting with intake, task context and bounded reads, reusing canonical contracts. Reject
   unexpected arguments and ambiguous staging forms before mutation. Test every registered tool's response shape.
4. Describe side effects truthfully and supply behavior annotations without treating them as authorization. Do not
   mark task issuance or terminal bookkeeping as read-only or retry-safe. Prefer a genuinely read-only status path.
5. Bound requests and propagate cancellation at safe operation boundaries. Test disconnects, committed partial effects
   and recovery; a timeout must not imply rollback or permit blind mutation retries.
6. Verify stdio cleanliness, initialization, negotiated versions and exact-client behavior. The current SDK supports
   protocols through 2025-11-25; July 2026 SDK/protocol migration requires separate compatibility evidence in both clients.

Progressive discovery, definition caching and programmatic tool calling belong to the host. Do not add a server-side
search platform, arbitrary script execution or generic dispatch to implement client advice. Keep role-scoped tools.
Kernel-enforced intake-only operation scopes need a separate authority design; prompt handoffs and `confirm: true`
are not proof of such enforcement. Protocol caching hints must never substitute for kernel evidence freshness.

References: [server guide](https://modelcontextprotocol.io/docs/2026-07-28/develop/build-server) and
[client practices](https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices).

### REQ-DEV-DIAGNOSTICS-001: Opt-In Development Evidence

Separately authorized repository-development diagnostics support agent-led investigation without requiring a human
to reconstruct session failures. This is not consumer telemetry, a new kernel state machine, an optimization
benchmark, or permission for autonomous remediation. It does not change `REQ-OPTIMIZATION-001` qualification gates.

Acceptance:

1. Commands register explicit development workspaces, generate isolated VS Code capture settings, launch CLI with
   process-scoped metadata export, and disable capture without overwriting project settings or deleting history.
2. Linux/WSL host collection can use the signed-in Azure CLI identity with resource-scoped ingestion permission.
   Tokens remain with Azure CLI/in memory; no token cache mounts, silent credential fallback, role grants, or
   service-principal credential revocation. Existing Azure Policy remains enforced.
3. A bounded reader retrieves registered-workspace Azure telemetry and filtered local evidence automatically.
   Extra client diagnostic directories require explicit registration and content access opt-in. Never scrape global
   chat history or replay transcripts. Record source locations, identifiers, limits, missing evidence and partial reads.
4. Evidence packets distinguish observed errors from root-cause hypotheses. Logs are untrusted data, not instructions.
   Agent recommendations cite evidence and affected code plus a regression check; they cannot approve gates, change
   models, deploy, or alter code without a separately authorized implementation task.
5. Historical ingestion, reader correctness, and client behavior are separate proof obligations. Synthetic telemetry
   validates the pipeline only. Real VS Code/CLI routing and custom-agent handoffs require exact-client evidence;
   desktop-app capture and unattended model-driven assessment remain unqualified until tested and authorized.

Implementation and operational instructions: [development logging](../how-to/debug-local.md).

### REQ-DOCS-001: Documentation And Lifecycle

Installation, workflow, CLI, security, operations, testing, capability packs, upgrade, downgrade, rollback, uninstall,
release, supported Copilot clients, and diagram formats must match the candidate implementation.
New inline diagrams use Mermaid; new standalone architecture and chart artifacts use editable Python sources and rendered
outputs. Active `.github/copilot-instructions.md` and applicable `AGENTS.md` files must identify canonical owners without
duplicating volatile values. Unsupported external state is not resumable in vNext.

### REQ-OUTPUT-001: Rich Output From Accepted Decisions

Produce requirements, architecture/WAF assessment, cost estimates, ADRs, architecture/dependency/runtime diagrams,
implementation plans and references, deployment summaries, and design/as-built documentation from accepted sources.
The operational set includes a runbook, inventory, backup/DR guidance, compliance matrix, as-built costs and an index.
Record justified non-applicability rather than generating empty boilerplate. Separate intended design, observed state,
assumptions and untested procedures. Never report a restore test, deployment, compliance certification or saving without
supporting evidence.

Reuse existing contracts and renderers. Preserve rationale in accepted design data; a renderer formats reasoning, it
does not invent it. Extend an owning contract only for a demonstrated information gap. Render only affected documents
and figures after changes, preserving source lineage and the conflict handling in `REQ-CHANGE-001`.

Use readable summaries, consistent headings and navigation, decision/alternatives tables, clear units and currency,
labelled diagrams and accessible status text. Diagrams must reflect the same accepted data as tables and prose.
Prefer useful structure over badges, decoration or arbitrary length. Editable sources and rendered images should agree
semantically; never execute imported diagram code merely to inspect an archetype.

### REQ-HANDOFF-001: Application And Operations Handoff

Initial scope requires infrastructure outputs and a deployment guide plus operational readiness documentation. Include
service/resource identifiers, endpoints, configuration names, identity/access prerequisites, ownership boundaries,
health checks, monitoring, incident response, rollback and recovery guidance. Reference secrets without embedding them.
The application team supplies its code; APEX does not develop that application.

Ready-to-use application GitHub Actions pipelines and platform-specific application deployment configuration, such as
Helm values or application manifests, are optional follow-on work after vNext is working. This does not defer the IaC
bindings, platform configuration or infrastructure validation needed to provision the workload itself.

### REQ-IMPROVE-001: Bounded Improvement

The quality and evidence lifecycle may store redacted structured observations, detect deterministic recurrence, and
produce inert proposals. A deterministic adapter may ingest allowlisted journal and evidence outcomes, but not raw chat
transcripts or model prose. Human decisions and the normal issue and pull-request flow remain mandatory. Observations and
proposals cannot inject context or autonomously edit policy, prompts, agents, skills, code, issues, pull requests,
releases, or deployments. Release acceptance requires measured precision, duplication, quarantine, recurrence, storage,
and triage outcomes; a noisy automatic adapter remains disabled without weakening manual observation.

## Output Quality Reference

The human quality reference is `agent-output/apex-aks` in the GitHub repository `jonathan-vella/aks-basic`.
Access requires an authorized GitHub session; anonymous link validation returns 404. Reviewers can use authenticated
GitHub access to that repository without making its contents public or copying the corpus into ordinary task context.
Record the inspected revision and selected artifacts when reviewing a candidate. It is an example of useful output,
not a universal workload template or an authority for current prices, resource choices or compliance claims.

| Area                          | Review criterion                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Requirements and architecture | Workload-specific constraints, traceability, WAF reasoning and justified choices               |
| Costs                         | Quantities, source dates, units/currency, uncertainty and consistent priced/unpriced treatment |
| Decisions                     | Context, alternatives, consequences and implementation implications                            |
| Diagrams                      | Legible topology, dependencies and runtime flows consistent with accepted state                |
| Operations                    | Environment-specific, actionable health checks, diagnostics, recovery and escalation           |
| Whole project                 | Navigable documents, consistent facts and no needless regeneration after changes               |

Use a compact review checklist in existing review evidence, not a new benchmark framework. Matching file counts,
document length, decorative style or numeric WAF scores is not required. The reference's AKS-specific configuration
does not become the default for other workloads. Human quality review complements, never replaces, technical checks.

## Non-Functional Requirements

- **Current contracts:** Supported vNext contracts and installation upgrades are exact-versioned. Unsupported state is
  rejected without mutation; users start a current run rather than receiving an implicit migration.
- **Security:** Kernel authorization and deterministic validators fail closed on missing, stale, malformed, secret-bearing,
  or substituted state.
- **Reliability:** Runs survive restart at each gate, reject stale writers, reconcile partial commits, and retain evidence.
- **Performance:** Release measurements meet [quality-scorecard.v1.json](../../config/quality-scorecard.v1.json) targets,
  tolerances, minimum samples, and unavailable-data rules.
- **Portability:** VS Code and standalone CLI use Windows via WSL2; native Windows desktop support is deferred.
  Consumer use requires neither Docker nor a devcontainer and must not depend on unpublished source-workspace state.
- **Accessibility:** User-facing CLI and documentation provide clear text status, actionable diagnostics, and no
  color-only meaning.
- **Privacy:** Telemetry is separate, optional, exportable, and deletable; raw chat history is never scraped or replayed.
- **Maintainability:** Repository guidance and automation have one canonical owner per concern; generated views are
  validated derivatives rather than parallel editable sources. Managed skills and
  instructions use progressive disclosure without removing required domain capability.

## Exclusions

- Distributed collaborative writers.
- Resume of state that does not satisfy current vNext contracts.
- Standalone GitHub Copilot desktop-app work, GitHub Copilot cloud coding-agent sessions, Copilot code review as an
  APEX client, the retired VS Code Local projection, and client runtimes other than standalone Copilot CLI and the VS
  Code Copilot harness.
- General-purpose built-in delegation, `/fleet`, `/delegate` and plan mode in managed workflows.
- Early Agent Plugins implementation; the distribution decision is the final feature-delivery phase.
- A second independent runtime/distribution authority or a new hosted control plane without explicit approval.
- Continuous COE synchronization, cross-archetype composition, and a generic document/code synchronization engine.
- ALZ foundation deployment, application development, native Windows runtime and additional-host promises.
- Token-baseline or comparative-token benchmarking work for now.
- Application deployment pipelines and application-specific deployment configuration until follow-on work.
- Autonomous issue creation, repository edits, pull requests, approvals, releases, or deployments from improvement data
  or the APEX runtime. The separately authorized local pre-agent maintenance controller is limited by
  `REQ-OPTIMIZATION-001`.
- Transcript scraping or direct promotion of observations into instructions, agents, skills, or code.
- Azure Resource Manager MCP deployment, cancellation, or budget-write tools in managed APEX workflows.
- Generic unscoped Bicep destroy or post-approval Terraform plan regeneration.
- Production Terraform CI apply before encrypted recipient-bound plan transport is proven.
- External repository or organization webhook changes without separate authorization.

## Release Metrics

The exact metric contract is [quality-scorecard.v1.json](../../config/quality-scorecard.v1.json). Blocking metrics include
setup completion, first-task success, workflow elapsed time, restart and resume, deterministic validation escape,
capability failure, context size, and cache correctness. Gate-revision loops may omit a claim when unavailable; all other
unavailable blocking measurements block release.

These existing deterministic measurements are not a comparative input-token baseline. Retain their current
executable semantics until any needed alignment is separately implemented and tested. Do not report token savings from
document size alone or add a token measurement prerequisite to the roadmap.

## Cutover Acceptance

Cutover requires all of the following on the exact candidate head:

- Every active requirement above maps to passing automated evidence or an explicitly required manual/live result.
  Explicitly deferred requirements remain backlog items, not passing evidence or current cutover gates.
- Both ALZ-backed and standalone lab/demo profiles pass without weakening policy or shared-resource ownership.
- COE import and conversational changes preserve independent origin, exclude source authority, and leave unaffected
  outputs unchanged; manual conflicts require confirmation.
- Human review against the output-quality reference passes; mandatory application and operational handoff is complete.
- WSL2 consumer installation and both client workflows work without a devcontainer or source-repository clone.
- The final distribution decision covers the APEX MCP lifecycle and is followed by exact-candidate qualification.
- Required CI and CodeQL checks pass, with no unresolved critical or high security finding.
- Clean install, update, rollback, uninstall, package reproducibility, SBOM, provenance, and publication dry run pass.
- Standalone Copilot CLI and VS Code Copilot harness agents, questions, next-step routing, worker execution, MCP startup,
  restart and cross-device resume are qualified against equivalent typed outcomes and client-specific authority
  boundaries.
- Astro, Terraform, custom pricing, and Draw.io MCP dependencies are absent from active discovery only after their
  applicable replacement gates pass.
- ARM pricing and Python diagram replacements satisfy their measured compatibility, reliability, security, and
  maintainability gates.
- Automatic improvement ingestion meets its precision and privacy thresholds while proposals remain inert.
- Changed guidance and automation have identified consumers, behavior, diagnostics, security boundaries and proof tests.
  Any executable gate alignment required by this revised plan is complete; no existing check is bypassed.
- Bicep and Terraform preview, approval, apply, inventory, diagnosis, destroy, and recovery scenarios are qualified.
- Local APEX Gate 4 approval, GitHub OIDC, and local-to-CI writer transfer are proven.
- Scorecard sample requirements and unavailable-data dispositions are satisfied.
- Release and rollback rehearsals, documentation audit, and `npm run validate:all` pass.
- Every open risk has an owner and acceptable release disposition.
- A maintainer explicitly authorizes cutover, publication, final tags, and merge to `main`.
