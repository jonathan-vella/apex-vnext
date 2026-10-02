# Workflow And Gates

> [Current Version](../../VERSION.md) | Why APEX separates creative work, deterministic validation, and approval.

## Workflow Shape

A run covers one environment, one Azure scope, and one IaC track. The versioned workflow advances through requirements,
governance discovery, architecture with policy mapping, implementation planning, IaC generation and validation,
preview, deployment, inventory, diagnosis, and quality evaluation. Governance comes before architecture so the design
starts from known policy: a reviewed subscription baseline, or the shipped ALZ Corp reference baseline when none exists.

Creative specialists propose typed results. Deterministic validators decide whether those results satisfy contracts and
business rules. Human-owned gates authorize progression.

## Gates

| Gate | Decision boundary                                                                  |
| ---: | ---------------------------------------------------------------------------------- |
|    1 | Requirements and SKU intent are complete and reviewed.                             |
|    2 | Architecture, cost, governance constraints, and its policy map are acceptable.     |
|    3 | Implementation intent, IaC binding, environment inputs, and review are acceptable. |
|    4 | The exact current preview is approved for its bound recipient and operation.       |

Gate 4 is local runtime authority. CI may transport and prove the approved candidate, but it does not silently recreate
or inherit approval.

## Invalidation

Changes invalidate downstream proof. Updating requirements invalidates architecture, planning, generated IaC, previews,
approvals, deployment evidence, and later views. Changes closer to deployment invalidate a narrower suffix.

A preview becomes stale when its dependencies, IaC, target, track, writer epoch, intended recipient, or configured TTL no
longer match. The correct response is to regenerate and reapprove it, not to override staleness.

## Tasks And Inputs

`nextTask` can return an input request, a review decision, a task, or terminal status. Input requests must be answered
before task context is requested. New Requirements runs use three kernel-owned panels: business discovery, combined
workload and service preferences, and security and compliance. Pending four-round requests remain replayable.

Recommendations require confirmation before recording. Service preferences do not authorize an agent to make
architecture, SKU, or implementation choices. Review revision invalidates the affected active evidence while retaining
immutable history. Task IDs and owner epochs prevent stale completion.

## Bicep And Terraform

The workflow branches by selected track for code generation, validation, preview, and deployment, then converges on the
same operation, inventory, diagnosis, and quality contracts.

## Planned COE Reuse And Change

The following is the target experience in [the PRD](../vnext/PRD.md#req-reuse-001-coe-archetype-import), not a claim that
new import commands or conflict-aware regeneration already exist:

1. The user identifies a COE repository; APEX inspects available archetypes and asks which whole workload to import.
2. APEX creates an independent consumer copy with source revision and selected paths, excluding source credentials,
   runtime state, writer claims and deployment approval authority.
3. APEX recovers reusable intent from existing contracts and parameters. For older or manually copied projects, it
   inspects relevant code/documents once and asks the user to confirm recovered decisions.
4. The user requests changes. APEX asks only relevant missing questions, explains consequences and confirms the change.
5. Existing dependency and invalidation mechanisms update affected decisions, code and documents. Manual conflicts
   require confirmation; unrelated files and decisions remain intact.
6. Consumer governance, validation, preview and approval are bound to the new target before deployment.

Both environment profiles are required: ALZ-backed workloads consume supplied networking, identity and monitoring by
default; standalone labs/demos can provision their own workload support resources. Both obey applicable policy and
security. They are profile/ownership choices in one workflow, not separate engines or inferred from subscription count.

## Output And Handoff

Design reasoning belongs in accepted sources, not repeatedly recreated from generated prose. Renderers should produce
consistent, navigable design/ADR and operational documents from those sources and observed deployment evidence. Follow
the [quality checklist](../vnext/PRD.md#output-quality-reference), distinguishing assumptions from tested outcomes.
Infrastructure outputs, deployment guidance and operational readiness are mandatory. Application pipelines and
application-specific deployment configuration are optional later work; APEX does not develop application code.

## Related

- [Run the workflow](../how-to/run-workflow.md)
- [Maintain requirements intake](../how-to/maintain-requirements-intake.md)
- [Bicep and Terraform](../reference/iac-tracks.md)
- [Security and authority](security-and-authority.md)
