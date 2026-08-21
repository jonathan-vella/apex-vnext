---
name: apex-azure-governance
description: "Guide APEX planning from accepted Azure governance evidence. Use for policy constraints and blockers."
user-invocable: false
---

# APEX Azure Governance Guidance

Use this skill for an active APEX planning, architecture, or validation task
that needs Azure Policy constraints. Only capability-produced, accepted
governance evidence in `apex/taskContext` is authoritative.

## Prerequisites

- The task context identifies the target subscription and applicable
  management-group ancestry.
- Accepted governance evidence includes its discovery status, discovery time,
  freshness limit, completeness signature, and scope.

Return a blocker when evidence is missing, partial, failed, stale, unsigned,
or scoped to a different subscription or management-group ancestry. Do not
infer policy state from model memory, templates, or a prior task.

## Workflow

1. Confirm the evidence has a `COMPLETE` status and covers the task scope.
2. Compare the discovery time with its declared freshness limit; route stale
   evidence to the governance discovery capability.
3. Treat `Deny` findings as blockers unless an accepted exemption records
   them as informational.
4. Account for `DeployIfNotExists` and `Modify` findings as deployment-time
   conditions rather than silently assuming the desired result.
5. Carry required tags, allowed locations, and relevant property-path
   constraints into the typed planning or architecture decision.
6. Record the evidence identifier, scope, completeness signature, and any
   unresolved constraint in the staged artifact.

## Boundaries

- This skill is advisory. It does not discover policy state, query Azure,
  refresh evidence, or modify resources, files, or task state.
- Governance evidence constrains a design; it does not grant an exemption or
  override an unresolved policy.
- Send deployment and remediation decisions to their authorized capability
  and gate, not to this skill.

## References

- [Evidence interpretation](references/evidence-interpretation.md) -
  envelope checks, classification, exemptions, and blocker routing.
- [Operational checklist](references/operational-checklist.md) -
   resume conditions, effect handling, and evidence handoff.
