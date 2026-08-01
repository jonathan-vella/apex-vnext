# APEX vNext Decision Register

Stable IDs remain available for requirements, risks, ADRs, and issue references. Detailed migration provenance is kept in
[Migration](../MIGRATION.md); consequential architecture records live in [ADRs](adrs/README.md).

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

## DECISION-008: Keep Migration History Separate From Product Documentation

Extraction and predecessor history lives in [Migration](../MIGRATION.md), frozen evidence, and archives. Active product
documentation is vNext-only.

## DECISION-009: Do Not Run Devcontainer CI

The disabled container workflow remains archived. Static contracts, focused checks, and deliberate local rebuilds own
container validation.

## DECISION-010: Keep Deployment Approval In APEX Gate 4

Gate 4 binds one exact preview, actor, target, operation, recipient, dependency revision, writer epoch, and expiry. CI
environment protection is defense in depth, not APEX approval authority. See
[ADR-0002](adrs/03-des-adr-0002-use-local-gate-4-before-ci-handoff.md).

## DECISION-011: Use A Bounded Entra-Only Handoff Session

Cross-boundary state and provider handoff uses short-lived recipient-bound evidence without shared static transport
secrets. See [ADR-0003](adrs/03-des-adr-0003-use-bounded-entra-only-handoff-session.md).

## DECISION-012: Support VS Code And GitHub Copilot CLI

Both clients receive the coordinator and interactive specialists. Their shared interactions must produce equivalent
typed outcomes; unsupported mechanics remain explicit.

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

The CLI package, exact runtime dependencies, release manifest, SBOM, and provenance define distribution. No second
package manager or customization distribution authority is supported.

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
