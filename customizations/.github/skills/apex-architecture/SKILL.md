---
name: apex-architecture
description: "Shape traceable APEX architecture. Use for WAF, resources, identity, networking, recovery, and cost."
---

## APEX Architecture

Use this skill only for an active architecture task.

## Prerequisites

- Requirements are accepted and projected by `apex/taskContext`.
- Required governance, pricing, quota, region, and service-availability evidence is present and current.

## Workflow

1. Trace each proposed resource and decision to projected requirements.
2. Explain Security, Reliability, Cost, Operational Excellence, and Performance Efficiency trade-offs where material.
3. Keep identity, networking, diagnostics, recovery, data, and lifecycle decisions explicit.
4. Ask the user only about choices the kernel identifies as user-owned.
5. Return missing or stale discovery as a blocker rather than inventing evidence.
6. Stage `architecture`, `cost-estimate`, and `workload-decision-manifest`, then call `apex/completeTask` once with
   every required output in `outputs`. Do not submit a single-output completion.

## Output

Return the kernel result, unresolved decisions, and evidence references supplied by the task envelope.
