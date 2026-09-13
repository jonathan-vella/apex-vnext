---
name: apex-requirements
description: "Provides internal APEX requirements guidance for typed intake, scope, constraints, and budget."
user-invocable: false
---

## APEX Requirements

Use this skill only for an active requirements task.

## Prerequisites

- `apex/taskContext` returns a requirements task envelope.
- The interactive Requirements agent is active when user input may be needed.
- The kernel's returned input request is the authoritative requirements question catalog.

## Workflow

1. Call `apex/nextTask`. Validate that a returned `task` is owned by the requirements role before reading its context.
2. When it returns `needs_input`, use its `intake` metadata and `questions` exactly as returned; do not maintain a
   separate client-side question list.
3. Ask the returned questions through the active client projection's question mechanism. Record each response as a
   supplied value, typed unknown, or explicit deferral with its owner; never replace an unknown with an inferred value.
4. Submit that request only through `apex/recordInput`, preserving its request ID, expected journal head, and owner
   epoch.
5. Call `apex/nextTask` again and repeat until it returns a requirements `task`; only then read `apex/taskContext`.
6. Treat service questions in the workload panel as a preference boundary. Present the kernel recommendation, then
   capture retained, prohibited, and preferred services, SKU preferences, and environment overrides without selecting
   architecture, SKUs, or implementation details.
7. Submit the task-context-defined output through `apex/requirementsComplete`, invoke the required Reviewer, and handle
   `needs_review` through one native findings panel and `apex/reviewDecide`. Treat business/privacy ownership,
   retention, workload-volume, and product-policy gaps as documented downstream obligations: ask for a responsible
   role and acknowledge them instead of requiring the Azure architect to supply the missing business decision.
8. After a clean or fully dispositioned review, ask for explicit Gate 1 approval. Call `apex/gateDecide` only after the
   user chooses Proceed, then continue to Architecture in the same turn.

The kernel catalog and its versioned input contracts are authoritative. Do not choose architecture, SKUs, or
implementation details while gathering requirements.

## Boundaries

Do not read task context for `needs_input`, a task owned by another role, or a stale task ID. Treat `APEX_STALE` as a
fresh-status requirement, and return kernel validation or authorization errors without fabricating a requirements
result.

## Output

Return the kernel result plus any unresolved user-owned fields.
