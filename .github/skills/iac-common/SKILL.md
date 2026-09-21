---
name: iac-common
description: '**UTILITY SKILL** - Shared vNext IaC lifecycle boundaries. WHEN: "deploy strategy", "circuit breaker", "shared IaC pattern". Use the active task and trusted APEX operations; no independent deployment workflow.'
---

# Shared IaC Guidance

The kernel owns validation, preview binding, approval and operation state. Reuse the accepted plan and exact preview;
do not create a second gate, substitute deployment tools, or silently change region, SKU or ownership on failure.

- Deployment and recovery: [APEX deployment guidance](../../../customizations/.github/skills/apex-azure-deploy/SKILL.md).
- Preflight: [APEX validation guidance](../../../customizations/.github/skills/apex-azure-validate/SKILL.md).
- Planning: [APEX planning](../../../customizations/.github/skills/apex-planning/SKILL.md).
- Code generation: [APEX code generation](../../../customizations/.github/skills/apex-codegen/SKILL.md).
- Track mechanics: [IaC tracks](../../../docs/reference/iac-tracks.md).

Read only the relevant owner's references. An indeterminate operation requires reconciliation, not another apply.
Policy, security failures and expired or mismatched evidence block execution. Changes require fresh affected evidence
and human approval where the kernel requires it. Never infer permission from a retry or a lab profile.

## Reference Index

The canonical [Resource Graph primer](references/azure-resource-graph-primer.md) remains available for read-only queries.
