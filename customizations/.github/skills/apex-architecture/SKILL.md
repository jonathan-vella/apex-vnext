---
name: apex-architecture
description: "Provides internal APEX architecture guidance for traceable WAF, identity, network, recovery, and cost decisions."
user-invocable: false
---

## APEX Architecture

Use this skill only for an active architecture task.

## Prerequisites

- Requirements and recorded architecture decisions are projected by `apex/taskContext`.
- Required governance, pricing, quota, region, and service-availability evidence is present and current.

## Workflow

1. Use only accepted requirements and current task-context evidence. Trace each proposed resource and decision to
   projected requirements, evidence references, and required SLO or workload decisions where supplied.
2. Explain Security, Reliability, Cost, Operational Excellence, and Performance Efficiency trade-offs where material.
3. Keep identity, networking, diagnostics, recovery, data, and lifecycle decisions explicit.
4. Present user-owned choices only when `apex/nextTask` returns `needs_input`; record them through `apex/recordInput`
   before reading the architecture task context.
5. Return missing, unavailable, or stale discovery as a blocker rather than inventing evidence or asserting a live
   provider contract.
6. Stage `architecture`, `cost-estimate`, and `workload-decision-manifest`, then call `apex/completeTask` once with
   every required output in `outputs`. Do not submit a single-output completion.

## Output

Return the kernel result, unresolved decisions, and evidence references supplied by the task envelope.

## Boundaries

Do not claim an evidence shape, freshness duration, external provider result, or gate outcome beyond the task envelope
and kernel result. Do not emit secret values; preserve only typed references accepted by the current contract.
