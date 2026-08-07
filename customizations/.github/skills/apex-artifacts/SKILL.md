---
name: apex-artifacts
description: "Present accepted APEX typed artifacts as bounded Markdown documents. Use for artifact templates, document slots, and derived views."
user-invocable: false
---

# APEX Artifact Presentations

Use this skill only after the kernel has accepted the typed artifact. The artifact schema and accepted object hash remain
canonical; a Markdown document is a derived presentation.

## Rules

1. Select the document template that matches the accepted artifact kind.
2. Preserve the template's heading order and section slots.
3. Fill slots only from `apex/taskContext`, accepted artifact values, or explicit kernel decisions.
4. Treat an unavailable required renderer slot as a blocker. Preserve unknown and deferred values; do not replace them
   with assumptions.
5. Return the presentation through the kernel-rendered document capability when it is available.
6. Do not treat rendered Markdown as gate evidence or alter typed artifact values to fit a template.

## Templates

- [Requirements document](templates/requirements.md) - present an accepted `requirements` artifact.
- [Architecture assessment](templates/architecture-assessment.md) - present an accepted `architecture` artifact.
- [Cost estimate](templates/cost-estimate.md) - present an accepted `cost-estimate` artifact.
- [Governance constraints](templates/governance-constraints.md) - present an accepted `governance-constraints` artifact.
- [Implementation plan](templates/implementation-plan.md) - present an accepted `implementation-plan` artifact.
- [Deployment summary](templates/deployment-summary.md) - present an accepted `deployment-summary` artifact.
- [Operations runbook](templates/operations-runbook.md) - present an accepted `operations-runbook` artifact.

Read [presentation conventions](references/presentation-conventions.md) before presenting any accepted artifact.
Read `.github/skills/apex-mermaid/SKILL.md` only when a renderer-supported inline diagram slot is available.

## Output

Return a bounded document request or the kernel-rendered Markdown receipt. Include source artifact and template hashes
when the capability projects them.
