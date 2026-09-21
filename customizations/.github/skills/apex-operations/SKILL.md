---
name: apex-operations
description: "Provides internal APEX guidance for operations and reviewed governance baseline imports."
user-invocable: false
---

## APEX Operations

Use this skill only in the interactive Operator agent.

## Prerequisites

- `apex/status` identifies the selected run.
- A task context is required only when the kernel issues a task-backed operation.
- Governance import requires an explicit request and a local path to a reviewed baseline; never load its bytes into
   model context.

## Workflow

1. Use `apex/status` for taskless status. Use `apex/preview` only to read the current preview and explain its recorded
   semantic changes, target, expiry, destructive actions, ignored or unevaluated items, and uncertainty.
2. Use `apex/inventory` only to read the inventory already recorded for the selected run. Use `apex/reconcile` only for
   an indeterminate operation; do not repeat a side effect independently.
3. For task-backed diagnosis, call `apex/nextTask` after status returns. For `needs_input` or `needs_review`, route to
   the owning interactive stage without polling or reading task context. Only `status=task` supplies `task.taskId`;
   read `apex/taskContext` with that exact ID for the diagnosis task before calling `apex/diagnose`.
4. Direct the user to `apex gate decide` and `apex deploy`; those trusted CLI ceremonies are not MCP tools.
5. Report provider and kernel results without claiming transactional rollback, live Azure diagnostics, or a diagnosis
   beyond the returned bounded status and doctor checks.
6. For governance selection, call `apex/governanceSelect` with the local reviewed path. Present `request.governance`
   questions and record the exact answer with `apex/recordInput`. Reuse is recommended below 30 days; refresh remains
   optional there and is the only option at 30 days. Remembered choices return `status=selected`; do not re-ask.
   Refresh records intent only and blocks progression until a newer collected file is explicitly imported. Do not
   invoke local discovery, claim collection succeeded or synthesize consent. The CLI route is `apex governance select`.
   An explicit request to reconsider refresh can use `reopen: true` (CLI `--reopen`) for the same candidate; it asks
   again without selecting an answer. At 30 days reuse remains unavailable. Never reopen automatically.
7. For reviewed governance baseline import, call `apex/governanceImport` with `{ "path": "<local-baseline-path>" }` only.
   The trusted CLI equivalent is `apex governance import --path <local-baseline-path>`. Return the service's `outputHash`
   and `summary`, never baseline bytes. Import preserves reconciliation, governance review, and Gate 2; it does not
   perform live discovery or authorize deployment.

## Output

Return the operation ID, state, evidence references, blockers, and kernel-provided next action.

## Boundaries

Required validation, authorization, freshness, and writer-epoch checks are kernel-controlled. Do not invent operations,
retry effects, or claim a provider inspection that the current APEX MCP result does not contain.
