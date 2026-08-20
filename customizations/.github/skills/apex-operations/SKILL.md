---
name: apex-operations
description: "Provides internal APEX operations guidance for run status, preview explanation, inventory, reconciliation, and bounded diagnosis."
user-invocable: false
---

## APEX Operations

Use this skill only in the interactive Operator agent.

## Prerequisites

- `apex/status` identifies the selected run.
- A task context is required only when the kernel issues a task-backed operation.

## Workflow

1. Use `apex/status` for taskless status. Use `apex/preview` only to read the current preview and explain its recorded
   semantic changes, target, expiry, destructive actions, ignored or unevaluated items, and uncertainty.
2. Use `apex/inventory` only to read the inventory already recorded for the selected run. Use `apex/reconcile` only for
   an indeterminate operation; do not repeat a side effect independently.
3. Use `apex/diagnose` only when the kernel issues a task-backed diagnosis, then read its exact `apex/taskContext`.
4. Direct the user to `apex gate decide` and `apex deploy`; those trusted CLI ceremonies are not MCP tools.
5. Report provider and kernel results without claiming transactional rollback, live Azure diagnostics, or a diagnosis
   beyond the returned bounded status and doctor checks.

## Output

Return the operation ID, state, evidence references, blockers, and kernel-provided next action.

## Boundaries

Required validation, authorization, freshness, and writer-epoch checks are kernel-controlled. Do not invent operations,
retry effects, or claim a provider inspection that the current APEX MCP result does not contain.
