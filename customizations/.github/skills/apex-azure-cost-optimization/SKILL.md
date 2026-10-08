---
name: apex-azure-cost-optimization
description: '**ANALYSIS SKILL** — Assesses Azure spend and savings for APEX tasks from read-only cost, forecast and price evidence: rightsizing, orphan candidates, commitments, storage tiers, Redis. WHEN: "optimize Azure costs", "find cost savings", "what did we spend", "cost forecast", "rightsize VMs". DO NOT USE FOR: security findings (use apex-azure-compliance), live failures (use apex-azure-diagnostics).'
user-invocable: false
disable-model-invocation: false
---

When calling any `apex/*` MCP tool, include the current session checkout or worktree as the required absolute
`workspace` path.

# APEX Azure Cost Optimization

Use this skill for an active APEX assessment that evaluates spending and utilization evidence. It is advisory only:
evidence informs findings, and the kernel decides whether a later task may authorize a change.

## Prerequisites

- `apex/taskContext` identifies the target subscriptions, resource boundary, assessment period, currency, and the cost
  question to answer.
- Each evidence record identifies its source, observation time, freshness, target scope, completeness, and redactions.
- Cost, utilization, inventory, and pricing evidence use compatible scopes and periods. Missing, stale, partial, or
  scope-mismatched evidence is a blocker.

## Routing

| Question | Evidence |
| --- | --- |
| What did we spend, and on what? | `apex-azure-pricing/query_costs`; `query_aks_costs` for AKS cluster or namespace breakdowns |
| What will we spend? | `apex-azure-pricing/forecast_costs` |
| What would a different SKU or tier cost? | `apex-azure-pricing/get_retail_prices` |
| Are commitments used well? | `list_benefit_utilization`, `get_benefit_recommendations`, `list_reservation_transactions` |
| Where can we save? | The assessment workflow below |

Use only the read-only `apex-azure-pricing` tools the active agent declares, within the limits in
[cost tool guardrails](references/cost-tool-guardrails.md). Never call `create_budget` or price-sheet download tools.
Resource inventory, utilization metrics, and advisor recommendations are not part of the shipped tool set; their
absence is a blocker for findings that need them, never permission to substitute a CLI, script, or memory.

## Rules

- **Read-only.** Never delete, resize, stop, purchase, or retier anything during an assessment.
- **Real data.** Ground every finding in returned cost, metric, or price evidence and label it with its evidence class.
- **Whole bill.** Present savings next to the scope's total actual cost for the same period.
- **Redis scope.** Use the Redis-specific signals only for an explicitly Redis-only request; a mixed request keeps the
  whole scope and adds Redis signals for those resources.
- **Safe classification.** Classify every candidate and never present a candidate as an approved action.

## Workflow

1. Confirm the target scope and whether the request is portfolio-wide, resource-specific, or Redis-specific. Do not
   expand the boundary from names, tags, or model memory.
2. Query actual cost for the scope and period first, then forecasts or prices only as the question requires.
3. Separate observed cost from observed utilization, validated price context, and calculated savings. A calculated
   estimate is not an invoice prediction.
4. Evaluate only evidence-backed candidates using [cost assessment criteria](references/cost-assessment-criteria.md).
5. Classify each candidate as `safe to investigate`, `review required`, or `high risk`. State dependencies, uncertainty,
   evidence source, and freshness.
6. Return ranked opportunities, non-actionable observations, and blockers. Send any proposed configuration, purchase,
   scaling, or deletion decision to the kernel-authorized owning workflow.

## Boundaries

- Do not treat an orphan candidate, an unused-looking resource, or a missing tag as proof that removal or downsizing is
  safe.
- Do not promise savings where pricing evidence is absent, free allowances may apply, shared allocation is uncertain,
  or the calculation cannot be traced.
- Escalate evidence that indicates an availability, security, compliance, or active incident concern to the
  kernel-selected owning assessment.

## Output

Return the target scope, assessment period, total actual cost, evidence sources and freshness, findings, estimated
savings with method, uncertainty, classification, and kernel-provided next action. Use `indeterminate` when evidence
cannot support the conclusion.

## References

- [Cost tool guardrails](references/cost-tool-guardrails.md) - read-only tool limits, evidence labels, and errors.
- [Cost assessment criteria](references/cost-assessment-criteria.md) - evidence rules, heuristics, storage and Redis
  signals, classification, and uncertainty.
- [Operational checklist](references/operational-checklist.md) - normalization, candidate safety, and savings
  traceability.
