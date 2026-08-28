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
- The document registry exposes the matching renderer and all required slots.
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

## Available Documents

- [Requirements document](templates/requirements.md) - present an accepted `requirements` artifact.
- Architecture assessment - presents accepted components, decisions, risks, and all five qualitative WAF pillars.
- Cost estimate - presents priced and unpriced tables, pricing evidence, monthly breakdown, and uncertainty ranges.

The registry also exposes direct, non-template renderers for run status, deployment preview, approval evidence, and
resource inventory. Architecture and cost packages also include deterministic Python, SVG, and PNG diagram views.
All are read-only views of accepted typed sources.

## Reference-Only Outlines

- [Architecture assessment](templates/architecture-assessment.md) and [cost estimate](templates/cost-estimate.md) remain
    reference-only outlines; their accepted sources use direct deterministic renderers. [Governance constraints](templates/governance-constraints.md),
    [implementation plan](templates/implementation-plan.md), [deployment summary](templates/deployment-summary.md),
    [operations runbook](templates/operations-runbook.md), and [resource inventory](templates/resource-inventory.md) are
    reference-only until the registry has a matching source producer and renderer.
- [Additional document outlines](references/reference-only-outlines.md) preserve useful source-document semantics.

Reference-only outlines never authorize rendering, file creation, cloud queries, repository reads, or state changes.
If a caller needs one, require a supported custom-document capability or clearly report that the capability is absent.

Source template structure may inform an outline, but it is not a producer or renderer registration. A template becomes
renderable only when a typed producer, registry binding, and document receipt are all available.

The current registry declares no Mermaid-capable slots. Do not request inline diagrams for these documents.

## Output

Return a bounded document request or kernel-rendered Markdown receipt. Include projected source and template identifiers,
unknowns, deferrals, evidence references, and capability blockers.
