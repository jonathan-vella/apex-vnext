---
name: apex-artifacts
description: "Presents accepted APEX typed artifacts as bounded Markdown views. Use for renderer templates, document slots, provenance receipts, resource inventories, cost views, runbooks, and reference-only document outlines."
user-invocable: false
---

# APEX Artifact Presentations

Present accepted typed artifacts without creating a second source of truth. The artifact schema, accepted values,
kernel decisions, and accepted object hash remain canonical; Markdown is a derived view.

## Prerequisites

- An accepted typed artifact and `apex/taskContext` are available.
- The kernel exposes the matching renderer capability and all required slots.
- Any referenced evidence is accepted, immutable, and safe to disclose.

## Rules

1. Select an active template only when the renderer binds it to the accepted artifact kind.
2. Preserve the selected template's heading order, slot meaning, and provenance receipt.
3. Fill slots only from `apex/taskContext`, accepted artifact values, accepted evidence, or explicit kernel decisions.
4. Preserve accepted unknown, unavailable, not-applicable, and deferred states exactly; never turn them into facts.
5. Stop when a required slot, source identifier, template identifier, or renderer capability is unavailable.
6. Return the bounded document request or kernel-rendered receipt. Never write workflow files or mutate artifact state.
7. Do not use Markdown as gate evidence, claim validation or deployment occurred, or alter values to fit an outline.

## Workflow

1. Confirm artifact acceptance, kind, disclosure boundary, and renderer support.
2. Choose an active binding below. Use an advisory outline only to shape a supported custom presentation.
3. Map every required slot to an accepted source and retain source identifiers for traceability.
4. Render once, then check heading order, unresolved slots, status language, links, and provenance.
5. Correct the bounded request and re-render until the renderer accepts it; otherwise return the blocker.

Read [presentation conventions](references/presentation-conventions.md) before preparing any document request.

## Active Renderer Bindings

- [Requirements document](templates/requirements.md) - present an accepted `requirements` artifact.
- [Architecture assessment](templates/architecture-assessment.md) - present an accepted `architecture` artifact.
- [Cost estimate](templates/cost-estimate.md) - present an accepted `cost-estimate` artifact.
- [Governance constraints](templates/governance-constraints.md) - present an accepted `governance-constraints` artifact.
- [Implementation plan](templates/implementation-plan.md) - present an accepted `implementation-plan` artifact.
- [Deployment summary](templates/deployment-summary.md) - present an accepted `deployment-summary` artifact.
- [Operations runbook](templates/operations-runbook.md) - present an accepted `operations-runbook` artifact.

## Reference-Only Outlines

- [Resource inventory](templates/resource-inventory.md) is advisory until a renderer binding supplies its slots.
- [Additional document outlines](references/reference-only-outlines.md) preserve useful source-document semantics without
   claiming an artifact kind, capability, package binding, or workflow phase.

Reference-only outlines never authorize rendering, file creation, cloud queries, repository reads, or state changes.
If a caller needs one, require a supported custom-document capability or clearly report that the capability is absent.

Load `.github/skills/apex-mermaid/SKILL.md` only when a renderer-supported inline-diagram slot is present.

## Output

Return a bounded document request or kernel-rendered Markdown receipt. Include projected source and template identifiers,
unknowns, deferrals, evidence references, and capability blockers.
