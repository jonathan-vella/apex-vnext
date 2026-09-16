---
name: azure-governance-discovery
description: '**UTILITY SKILL** - Explain reviewed baseline governance inputs for vNext. WHEN: "governance constraints", "policy baseline", "effective policy evidence". EXCLUDES local live discovery and independent workflow state.'
---

# Governance Evidence

Use [accepted governance guidance](../../../customizations/.github/skills/apex-azure-governance/SKILL.md) for interpreting
policy effects, exemptions, required properties and blockers. Missing, incomplete, stale or wrong-scope evidence must
not be treated as no policy. Azure Policy wins in both ALZ-backed and standalone profiles.

Repository collection is owned by `tools/scripts/collect-governance-baseline.ps1` and its GitHub workflow. The intended
consumer path selects the active subscription from a reviewed baseline, then preserves reconciliation, governance review
and Gate 2. See [REQ-GOV-001](../../../docs/vnext/PRD.md#req-gov-001-governance-and-policy) for acceptance and current scope.

Do not launch local live discovery or pass the full baseline through model context, journals or MCP payloads. This skill
does not claim the importer is complete, grant exemptions, mutate policy, or authorize deployment.
