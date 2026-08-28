---
name: apex-architecture
description: "Provides internal APEX architecture guidance for traceable WAF, identity, network, recovery, and cost decisions."
user-invocable: false
---

## APEX Architecture

Use this skill only for an active architecture task.

## Prerequisites

- Requirements and recorded architecture decisions are projected by `apex/taskContext`.
- Accepted governance, quota, region, and service-availability evidence is used when present and current.
- Pricing is retrieved directly through the Architect's declared read-only ARM MCP tool. Kernel task capability grants
   do not represent ARM MCP availability.

## Workflow

1. Use only accepted requirements and current task-context evidence. Trace each proposed resource and decision to
   projected requirements, evidence references, and required SLO or workload decisions where supplied.
2. Complete the task template's qualitative assessment for Security, Reliability, Cost Optimization, Operational
   Excellence, and Performance Efficiency. Bind every pillar to accepted requirements and evidence; do not derive
   numeric scores.
3. Keep identity, networking, diagnostics, recovery, data, and lifecycle decisions explicit.
4. Present user-owned choices only when `apex/nextTask` returns `needs_input`; record them through `apex/recordInput`
   before reading the architecture task context.
5. Call `azure-resource-manager-mcp/get_retail_prices` after selecting candidate SKUs. Do not infer unavailability from
   task capability grants. Record a well-scoped no-result query as an explicit partial estimate `unpricedItems` entry;
   do not create a synthetic zero-price line or stop the Architecture stage solely because one meter is absent.
6. Reject stale or mismatched supplied evidence. When no qualified quota, region, or service-availability capability is
   available, record a `concern`, recommendation, and risk instead of inventing evidence or blocking Architecture.
7. Submit `architecture`, `cost-estimate`, and `workload-decision-manifest` once through
   `apex/architectureComplete`; APEX derives identity, hashes, requirement traceability, and cost/SKU bindings.
8. Report the derived Architecture, qualitative WAF, cost-breakdown, and uncertainty diagrams materialized in the
   Gate 2 package. These diagrams do not replace typed artifacts, pricing tables, evidence, review, or approval.

## Output

Return the kernel result, unresolved decisions, and evidence references supplied by the task envelope.

## Boundaries

Do not claim an evidence shape, freshness duration, external provider result, or gate outcome beyond the task envelope
and kernel result. Do not emit secret values; preserve only typed references accepted by the current contract.
