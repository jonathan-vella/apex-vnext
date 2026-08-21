---
name: apex-workflow
description: "Provides internal APEX workflow routing for status, resume, project selection, and next tasks."
user-invocable: false
---

## APEX Workflow

Use this skill to orient an interactive agent without reconstructing workflow state from chat or files.

## Prerequisites

- The workspace has the APEX CLI and MCP server configured.
- The user has selected or identified an APEX project when more than one exists.

## Workflow

1. Call `apex/status` for the selected project.
2. If the selected project is wrong or absent, use the active client question mechanism to select a project, then repeat
   `apex/status`.
3. If status identifies blockers, gates, or a terminal run, report that kernel state and do not infer a task.
4. Otherwise call `apex/nextTask`. For `needs_input`, return the exact request to its owning interactive role. For
   `task`, route only to the returned task owner through the active client projection.
5. For resume, fetch fresh status instead of relying on an earlier conversation. On an `APEX_STALE` error, refresh
   status and do not reuse a task ID, request ID, journal head, or owner epoch.

Do not infer progress from generated files, conversation history, or handoff completion. If selection is ambiguous, the
interactive agent may use its active client question mechanism before repeating `apex/status`.

## Boundaries

`apex/nextTask` returns only `needs_input` or `task`. Terminal, blocked, missing-project, authorization, and stale
conditions are represented by status or stable kernel errors; do not invent additional tool results or transitions.

## Output

Report the project, run, environment, current state, blockers, and one kernel-provided next action.
