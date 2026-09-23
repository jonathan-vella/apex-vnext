# APEX vNext Decision Register

Stable IDs remain available for requirements, risks, ADRs, and issue references. Consequential architecture records
live in [ADRs](adrs/README.md).

## DECISION-001: Use Hybrid Project Governance

GitHub Issues own actionable work; repository controls own durable requirements, decisions, risks, and release procedures.

## DECISION-002: Use Main As The vNext Integration Branch

All feature work targets this repository's protected `main` through pull requests. Superseded branch history is not an
active product control.

## DECISION-003: Modernize Through Dependency-Complete Vertical Slices

Each slice includes implementation, tests, documentation, ownership migration, and rollback or retirement evidence.

## DECISION-004: Keep Improvement Observe-And-Propose Only

Improvement observations may produce inert proposals. They cannot mutate code, policy, prompts, issues, releases, or
infrastructure autonomously. See [ADR-0004](adrs/03-des-adr-0004-use-bounded-observe-and-propose-improvement.md).

## DECISION-005: Support Managed Copilot Clients Through Projections

Superseded by DECISION-012. Client-specific interaction mechanics are projections over one kernel-owned workflow.

## DECISION-006: Extend The Existing Bug Form For Regressions

vNext regressions use the repository bug form with integration head, failed check, and regression-test fields.

## DECISION-007: Treat Historical Build Plans As Nonbinding

Current requirements, roadmap, decisions, risks, source packages, and versioned configuration are authoritative.

## DECISION-008: Keep Product Documentation Self-Contained

Current source, contracts and requirements own product behavior. No historical record is required to build, test,
install or operate vNext. Supported vNext version transitions retain their explicit contract guarantees.

## DECISION-009: Do Not Run Devcontainer CI

The disabled container workflow remains archived. Repository maintenance on 2026-09-16 also retired the remaining
container setup in favor of the WSL2 setup scripts. Workspace editor and hook validation remain active. Historical
materials are optional retention only: current checks do not depend on their presence.

## DECISION-010: Keep Deployment Approval In APEX Gate 4

Gate 4 binds one exact preview, actor, target, operation, recipient, dependency revision, writer epoch, and expiry. CI
environment protection is defense in depth, not APEX approval authority. See
[ADR-0002](adrs/03-des-adr-0002-use-local-gate-4-before-ci-handoff.md).

## DECISION-011: Use A Bounded Entra-Only Handoff Session

Cross-boundary state and provider handoff uses short-lived recipient-bound evidence without shared static transport
secrets. See [ADR-0003](adrs/03-des-adr-0003-use-bounded-entra-only-handoff-session.md).

## DECISION-012: Support VS Code And GitHub Copilot CLI

Superseded by DECISION-029. Both clients receive the coordinator and interactive specialists. Their shared interactions
must produce equivalent typed outcomes; unsupported mechanics remain explicit.

## DECISION-013: Re-Baseline Every Release Candidate

Historical evidence characterizes behavior but cannot qualify a changed candidate. Required evidence is rebound to the
exact candidate before release.

## DECISION-014: Use Microsoft ARM MCP Directly For Managed Pricing

Managed clients use explicit read-only Cost Management and Pricing tools. APEX owns request/evidence acceptance,
arithmetic, workflow, and gates.

## DECISION-015: Retire Unneeded MCP And Diagram Surfaces Through Explicit Gates

A surface is removed only with consumer migration, replacement proof, archive provenance, rollback, and a negative
reintroduction check.

## DECISION-016: Keep Npm As The Sole Distribution Authority

Current implementation remains npm-owned: CLI packages, exact dependencies, release manifest, SBOM and provenance.
The permanent npm-only product restriction is superseded by DECISION-024. No distribution migration has been selected
or implemented by revising the plan.

## DECISION-017: Operationalize Bounded Improvement Without Promotion Authority

Recurring structured observations can be measured and triaged, but humans retain issue, code, policy, and release
authority.

## DECISION-018: Consolidate Automation Conservatively

Shared setup and canonical validators may remove duplication only when required check names, permissions, triggers,
diagnostics, security, and exact-head semantics remain intact.

## DECISION-019: Characterize Guidance And Automation Before Rewriting

Ownership and consumers are mapped before consolidation. Completed characterizations remain archived provenance rather
than active product instructions.

## DECISION-020: Use A Bounded Local Controller For Pre-Agent Optimization

Repository maintenance may use a separately authorized local controller with exact scope, commands, budgets, checks,
expiry, checkpoints, and stop conditions. It has no merge, release, or deployment authority.

Its availability does not require a new repository-wide optimization campaign. DECISION-025 supersedes the blanket
pre-agent product prerequisite, without bypassing executable gates or changing historical receipts.

## DECISION-021: Build A Workload Factory With Two Profiles

ALZ-backed workloads and standalone single-subscription labs/demos are both day-one requirements. Use one workflow with
explicit profile and ownership data. Outside labs, application services consume supplied networking, identity and
monitoring by default. Labs can create their workload support resources without creating an ALZ platform. Azure Policy
always wins. [PRD workload boundary](PRD.md#workload-boundary) owns the detailed scope.

## DECISION-022: Reuse Independent Archetypes And Adapt In Conversation

Import one selected COE archetype as an independent snapshot with source revision, not a continuously linked product.
Reuse existing contracts and parameters, with one authoritative owner per fact. Ask relevant change questions, confirm
consequences and manual-edit conflicts, then update affected outputs. Do not copy source deployment authority or create
a generic synchronization engine. Requirements `REQ-REUSE-001` and `REQ-CHANGE-001` own acceptance.

## DECISION-023: Preserve Rich Output Without Repeated Authoring

Use [the PRD quality reference](PRD.md#output-quality-reference) to assess useful design reasoning, visuals and
operational guidance. Reuse accepted decisions in existing renderers. Infrastructure outputs, deployment guidance and
operational readiness are mandatory; application pipelines and application-specific deployment configuration are later
optional work. Quality is not document length or a numeric score copied from a reference workload.

## DECISION-024: Use WSL2 And Decide Distribution Last

Windows via WSL2 is the initial host path; consumers do not require Docker or a devcontainer. Keep npm usable now.
Evaluate Agent Plugins together with APEX MCP redistribution only after functional delivery, then qualify the chosen
lifecycle in both clients. The choice remains open; avoid competing runtime owners, updaters and custom frameworks.

## DECISION-025: Minimize Input Without A Token Baseline Now

Use compact task inputs, scoped guidance, relevant questions and unchanged-decision reuse. No token baseline, comparative
benchmark or new measurement framework is current work. Preserve existing safety tests and measurement utilities.
Reconcile conflicting executable gate contracts through focused tested changes before affected scenarios; no bypasses.

## DECISION-026: Use Reviewed Policy Baselines And Explicit Assumptions

Implement [issue #344](https://github.com/jonathan-vella/apex-vnext/issues/344) through deterministic subscription-only
import, existing governance reconciliation/review and Gate 2. Cover standalone subscriptions through the same contract.
The full baseline never enters model context. Quota and regional availability remain assumptions, not Architecture
evidence gates. Policy, security and deployment approval cannot be waived by an assumption or lab profile.

## DECISION-028: Require Governance Refresh At Thirty Days

Consumer clarification on 2026-09-19 fixes snapshot eligibility at less than 30 elapsed UTC days since successful Azure
collection. Refresh below that age is optional; at 30 days it is mandatory before planning or new deployment approval.
Display age and prefer reuse without repeated prompts. Observation renewal is separate from policy-content identity.
Native checks and live Azure enforcement remain required. Acceptance and implementation boundaries are owned by
[REQ-GOV-001](PRD.md#req-gov-001-governance-and-policy) and [Phase 2](ROADMAP.md#phase-2-finish-governance).

## DECISION-027: Optimize Current Inputs Before Changing Execution Mechanics

Start with the [first roadmap batch](ROADMAP.md#first-batch-input-correctness-and-scope): repair revision-safe reads,
bound task/reviewer context, correct routing and tool scope, then remove proven prompt duplication. Acceptance remains
in `REQ-OPTIMIZATION-001`; recommendation dispositions remain in the roadmap. Retain requirements-review,
architecture-review, governance-review and plan-review, equivalent client outcomes, and rich deterministic output.

Reuse confirmed requirements, decisions and pricing evidence in the existing delivery phases. This does not authorize
model downgrades, new telemetry, persistent snapshots, concurrent review commits, ID-only invalidation, asynchronous
rendering or structured-only MCP results. Those proposals require the evidence and boundaries in the roadmap before
adoption. Preserve DECISION-025, revised ADR-0006 kernel authority and scoped worker grants, journal integrity and human
approval; changing documentation
does not alter executable gates or close historical findings.

## DECISION-029: Ship One Copilot CLI Projection

Maintainer direction on 2026-09-23 supersedes DECISION-012. Managed agents, skills and MCP configuration use only the
Copilot CLI agent format. Supported clients are standalone Copilot CLI and the VS Code Copilot harness, which runs
CLI-format agents in the VS Code Agent Host. The VS Code Local projection, its renderer path, `.vscode/mcp.json` and the
combined installation mode retire through DECISION-015 gates: consumer migration, replacement proof, archive provenance
under `.archive/vscode-projection/`, rollback and a negative reintroduction check. `apex init` and `apex update` reject
the retired client with a stable error code and migration guidance. The archive is never a runtime dependency.
`github-copilot-cli` is the only installable projection; `github-copilot-vscode` remains the evidence identity for VS
Code running CLI agents, so paired-client comparison continues. Builder-only VS Code tooling for this repository stays.

An `apex-next` skill replaces handoff buttons. It reads kernel status and the next task, names the owning agent, and
either delegates that agent with the prepared prompt or prints the client's selection step (`/agent` in standalone CLI,
the Agent picker in the VS Code harness) and scope prompt. Built-in CLI agents are advisory helpers only: Explore,
Rubber-duck, Code-review, Security-review, built-in Task and user-invoked Research never produce kernel evidence,
complete tasks or approve gates. General-purpose delegation, `/fleet`, `/delegate` and plan mode stay out of managed
workflows. Kernel authority, typed outcomes, the four review passes and human gates are unchanged.
[REQ-CUSTOMIZATION-001](PRD.md#req-customization-001-managed-copilot-experiences) owns acceptance and the
[CLI-only projection plan](ROADMAP.md#cli-only-projection) owns delivery.

After the slice 1 probes on 2026-09-23, the maintainer settled slices 5 to 8. The read-only context sidekick is
deferred until a Copilot CLI release launches custom sidekicks. Multi-choice input uses native `ask_user` checkboxes
where offered and numbered selection otherwise. Planner, Operator, Architect and Reviewer get read-only file tools so
built-in helpers can read, and Reviewer gets `task`. Validator may run `bicep` and `terraform` pre-checks only through
a shell limited to those commands. The VS Code installation lifecycle tests and client-comparison tooling are
retargeted to the VS Code Copilot harness; only Local-only tests are archived. For slice 5 the maintainer retired the
rule that a subagent may not use a costlier model tier than its parent, so the coordinator delegates CodeGen, Reviewer
and Validator through `apex-next`. Under the maintainer's standing rule to take the recommended option while away,
slice 6 ships only Explore: the other review helpers inherit the caller's APEX completion and disposition tools, and
agent frontmatter cannot limit Validator's shell, so Validator gets none.
