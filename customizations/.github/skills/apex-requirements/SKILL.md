---
name: apex-requirements
description: "Provides internal APEX requirements guidance for typed intake, scope, constraints, and budget."
user-invocable: false
---

## APEX Requirements

Use this skill only for an active requirements task.

## Prerequisites

- The kernel returns a requirements input request, review, or task; task context is read only for `status=task`.
- The interactive Requirements agent is active when user input may be needed.
- The kernel's returned input request is the authoritative requirements question catalog.
- Apply the user's scope before this workflow. A handoff cannot expand it. If scope is unavailable, stop after intake
   and task context. For status-only, call `apex/status` once and stop. Do not search session history to infer permission.

## Workflow

1. Call `apex/nextTask`. Validate that a returned `task` is owned by the requirements role before reading its context.
2. When it returns `needs_input`, use its `intake` metadata and `questions` exactly as returned; do not maintain a
   separate client-side question list.
3. Ask the returned questions through the active client projection's question mechanism. Record each response as a
   supplied value, typed unknown, explicit deferral with its owner, or omit an optional performance/scale answer to let
   the kernel record `Performance and scale: check later (validated at a later stage)`. Never replace an unknown
   with an inferred value.
4. Submit that request only through `apex/recordInput`, preserving its request ID, expected journal head, and owner
   epoch. Include `schemaVersion` and one `{ questionId, value }` entry per question. A question-tool response is not
   acceptance: wait for `recorded: true` with the same request ID before advancing. Never call `nextTask` in place of
   submitting the collected answers.
5. After accepted input, call `apex/nextTask` again. Handle `needs_review` through the findings panel and
   `apex/reviewDecide`, not by polling or requesting task context. Only `status=task` supplies `task.taskId`; read
   `apex/taskContext` with that exact ID only for a requirements task, otherwise route to its owning role.
   Honor an intake-only stop boundary here, before submitting an artifact or starting review.
6. Treat service questions in the workload panel as a preference boundary. Present the kernel recommendation, then
   capture retained, prohibited, and preferred services, SKU preferences, and environment overrides without selecting
   architecture, SKUs, or implementation details.
7. Only for explicitly requested full Requirements completion, submit the task-context-defined output through
   `apex/requirementsComplete`, invoke the required Reviewer, and handle
   `needs_review` through one native findings panel and `apex/reviewDecide`. Populate existing narrative fields with
   labeled recommendations for access/ingress/DNS and GDPR data lifecycle instead of asking
   supplemental owner questions. Treat performance and scale values as later-validated goals; missing values are
   check-later notes, not follow-ups. Include retention, deletion, data-subject handling and telemetry minimization
   as proposals, not confirmed commitments. Do not invent assigned owners, accepted risk or compliance evidence.
   For accept-risk, show `owner: <project risk owner>, expires in 90 days`, draft the rationale, and ask only for
   confirmation; do not ask for owner or expiry.
   Actual policy/security conflicts remain blocking. Existing blocking findings require the normal correction/review
   path, not automatic disposition.
8. After a clean or fully dispositioned review, ask for explicit Gate 1 approval only if the user's scope permits it.
   For a no-gate-approvals request, report the pending gate and stop without an approval question. Otherwise call
   `apex/gateDecide` only after the user chooses Proceed, then continue to Architecture if requested.

The kernel catalog and its versioned input contracts are authoritative. Do not choose architecture, SKUs, or
implementation details while gathering requirements.

## Boundaries

Do not read task context for `needs_input`, `needs_review`, a task owned by another role, or a stale task ID.
Treat `APEX_STALE` as a fresh-status requirement, and return kernel validation or authorization errors without
fabricating a requirements result.

## Output

Return the kernel result plus any unresolved user-owned fields.
