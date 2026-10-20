---
name: apex-architecture
description: "Guides the foreground APEX agent during kernel-issued Architecture decisions, architecture tasks, policy refresh and review dispositions. Covers accepted WAF, policy, identity, network, recovery and cost reasoning. Not an independent design workflow or repository-maintenance skill."
user-invocable: false
---

When calling any `apex/*` MCP tool, include the current session checkout or worktree as the required absolute
`workspace` path.

## APEX Architecture

Use this skill only when the kernel routes the active foreground `APEX` agent to an architecture decision request,
review or task.

## Prerequisites

- Requirements and recorded architecture decisions are projected by `apex/taskContext`.
- Governance findings are accepted or imported before Architecture; Architecture maps policies but does not collect
  baselines.
- Pricing is retrieved through `apex-azure/pricing` with command `pricing_get`, following the
  [central pricing contract](../apex-azure-defaults/references/retail-pricing.md). Kernel capability grants do not
  represent external MCP availability.

## Workflow

1. Call `apex/status`, then `apex/nextTask` only when status leaves runnable Architecture work. For `needs_input`, ask
   the returned decision questions in chat, explain viable alternatives and material consequences, then submit answers
   through `apex/recordInput`. Do not request task context for an input request.
2. For `status=task`, read `apex/taskContext` with the exact task ID. If the result is externalized, use
   `apex/readTaskInput` until the bounded context is complete. Use its inputs, decisions, evidence and output templates
   as authoritative; ask targeted follow-ups only for unresolved user-owned decisions.
3. Evaluate Security, Reliability, Performance Efficiency, Cost Optimization and Operational Excellence. Submit the
   qualitative `wellArchitectedAssessment` shape from the task template, including status, accepted requirements,
   evidence references, recommendations and trade-offs for every pillar. Treat performance and scale numbers as later
   validation goals; missing measurement boundaries, unverified latency, scale feasibility and capacity-test detail are
   not Architecture blockers.
4. Keep identity, networking, diagnostics, recovery, data and lifecycle decisions explicit. For material alternatives,
   include decision records with stable IDs, context, decision, accepted requirement IDs, at least two alternatives,
   consequences, WAF impacts, compliance considerations and implementation notes.
5. After selecting candidate SKUs, call `apex-azure/pricing` with command `pricing_get` for every distinct price query.
   Do not infer pricing unavailability from APEX task grants. A well-scoped no-result query becomes a partial estimate
   and `unpricedItems` entry with attempted timestamp and reason. Never submit synthetic zero prices, placeholders or
   invented prices through `apex/architectureComplete`. A capped (5,000-row) or incomplete query is unpriced, never a
   successful priced line; retain exact query/version/completeness provenance under the central pricing contract.
6. Design against accepted governance. Every Architecture component lists the ARM resource types it deploys. Read
   relevant governance findings with `apex/readTaskInput` using the task-context input hash for those designed types.
   Map each applicable finding in `policyMappings` with assignment, definition, reference ID, effect, logical resource,
   property path, expected value where known and disposition: `satisfied`, `planned`, `blocked` or
   `not-applicable` with a factual reason. Never mark `exempt`.
7. Assume selected Azure services and SKUs are regionally available and quota is sufficient. Mention material regional,
   zonal, recovery or capacity assumptions in documentation when useful; do not request, validate, gate or create
   findings for regional support, quota, deployment, restore, failover or unresolved retail meters.
8. Submit `architecture`, `cost-estimate`, `workload-decision-manifest` and `policyMappings` atomically through
   `apex/architectureComplete`. APEX derives identity, artifact hashes, top-level requirement traceability and
   cost/SKU bindings. Before submitting, check common rejection causes: WAF statuses use the allowed values; dates use
   UTC milliseconds; ADR alternative fields are strings; policy mappings have property paths; and SKU decision
   logical IDs match component IDs.
9. Report the read-only Gate 2 review package under `agent-output/<project>/<run>/architecture/`, including
   Architecture, WAF, cost breakdown, uncertainty diagrams, assessment, SKU comparison and challenger findings.
   Diagrams are derived views, not gate evidence. The same architecture, cost estimate and accepted risks are shown
   again at the final Gate 4 approval.
10. When the `architecture-review` task appears, run the rubber-duck review steps in `apex-next` with the exact
    `task.taskId`. For `needs_review`, do not request task context or run rubber-duck again. Present findings in one
    decision panel and record a disposition for every finding through `apex/reviewDecide`. Automatically
    dismiss findings that only request regional, zonal, quota, deployment, restore, failover or complete pricing checks.
11. For a `policy-refresh` task after Gate 2, start from the `policy-property-map` template in task context. Decide only
    rows listed in `governanceFindings`, submit the complete map through `apex/completeTask`, and let blocked rows
    reopen Architecture and Gate 2.
12. After `apex/reviewDecide`, call `apex/status`. In a lab run Gate 2 is an automatic readiness checkpoint that the
    kernel records once the review and deterministic checks pass. Never ask the user to approve Gate 2 and never call
    `apex/gateDecide` for it. If status shows a "readiness checkpoint is not recorded" blocker, call `apex/nextTask` once
    to retry recording it; if it still reports the blocker, report the blocking finding, review or validator result and
    stop. Otherwise follow `apex/nextTask`. The user's later confirmations are Gate 1 (intent) and Gate 4 (final
    preview).

## Domain Selection

Load only the relevant domain skill within this task: `apex-azure-kubernetes` for AKS topology, identity and sizing;
`apex-azure-reliability` for SLO/RTO/RPO and failure-domain reasoning; `apex-azure-upgrade` for lifecycle alternatives;
and `apex-python-diagrams` for accepted architecture/WAF/cost figure semantics. Domain advice neither issues a task
nor grants tools, deployment authority or new artifact/renderer support.

## Examples

| Kernel result or request | Required response |
| --- | --- |
| Architecture decision request with a missing network choice | Ask the returned question; record only confirmed input, not a fabricated design |
| Partial retail query with an unresolved meter | Preserve an unpriced item and uncertainty; do not submit zero as a price |
| Lab Architecture review accepted, Gate 2 not yet ready | Read status; retry readiness once with `apex/nextTask`, never request human Gate 2 approval |

## Boundaries

The kernel is authoritative for accepted requirements, governance completeness, task state, review findings and gates.
Write only through APEX MCP. Azure MCP and ARM CostManagement access is read-only; do not call mutation, deployment
or filesystem tools. Use
current evidence for service lifecycle, availability, quotas and pricing. Generated review files are read-only
projections of accepted state.

## Output

Return the kernel result, user-confirmed recommendation, evidence posture, review-package location, unresolved
decisions and the reason for stopping. Do not claim gate readiness unless the kernel reports it.
