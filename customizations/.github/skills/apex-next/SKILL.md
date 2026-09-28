---
name: apex-next
description: "Names the kernel-selected next APEX step and its owning agent, then delegates a hidden worker or prints the agent selection step and a scope prompt. Use for what's next, continue, or routing after a stage."
---

## APEX Next

Route the next APEX step from kernel state. The kernel selects the owner; this skill names it and moves the work there.

## Prerequisites

- The workspace has the APEX CLI and MCP server configured, and a project is selected.

## Workflow

1. Call `apex/status`. For a status-only request, report it and stop. If status reports no project, blockers, a
   pending gate or a terminal run, report that kernel state and stop.
2. Call `apex/nextTask` once. Do not call it again for the same unanswered request or unresolved review, and do not
   poll.
3. Name the owner from the result. Do not ask the user to choose a role or search session history.

   | Kernel result                                      | Owner                                                   |
   | -------------------------------------------------- | ------------------------------------------------------- |
   | `status=needs_input` with `request.intake`         | `apex-requirements`                                     |
   | `status=needs_input` with `request.decision`       | `apex-architect`                                        |
   | `status=needs_input` with `request.governance`     | `apex-operator`                                         |
   | `status=needs_review` with `review.gate` 1, 2 or 3 | `apex-requirements`, `apex-architect` or `apex-planner` |
   | `status=task`                                      | the `task.role` owner below                             |

   | `task.role`                                  | Owner                   |
   | -------------------------------------------- | ----------------------- |
   | `requirements`                               | `apex-requirements`     |
   | `architect`                                  | `apex-architect`        |
   | `planner`                                    | `apex-planner`          |
   | `governance-operator`, `diagnostic-operator` | `apex-operator`         |
   | `reviewer`                                   | worker `APEX Reviewer`  |
   | `bicep-codegen`, `terraform-codegen`         | worker `APEX CodeGen`   |
   | `validator`                                  | worker `APEX Validator` |

   For any other result or role, report it and stop.
4. Write the scope prompt for the owner's current task only: the owner, the exact `request.requestId`,
   `review.reviewHash` or `task.taskId`, and the user's requested outcome, exact stop point and prohibited operations,
   verbatim. Do not carry later-stage prerequisites, such as governance-discovery evidence, into an earlier owner task.
   If the original scope is unavailable, limit continuation to intake or the owner's task context.
5. A worker completes as a subagent. Delegate it with `task` and the scope prompt, report its result, then call
   `apex/status`. If `task` is unavailable, report the pending worker task and stop.
6. If the active agent is already the named interactive owner, continue with the current `nextTask` result instead of
   printing a switch instruction. Otherwise, an interactive owner needs the foreground because only it can ask
   questions, including a `status=task` result for `apex-requirements`, `apex-architect`, `apex-planner` or
   `apex-operator`. Print its selection step and the scope prompt, then stop:
   - Copilot CLI: `/agent apex-requirements`, using the owner's agent name from the table.
   - VS Code Copilot harness: choose the agent, such as **APEX Requirements**, in the Agent picker.

   State that routing is pending until the user switches. Do not claim the switch, answer acceptance or task creation.

## Boundaries

- The kernel owns state, gates, task ownership and transitions. A delegated worker never approves a gate.
- Delegate only the workers above. Never delegate an interactive owner, and never substitute Explore or a
  general-purpose agent for the owner.
- Never collect, answer, summarize or record the owner's questions, and never replace invalid choices with defaults.
- Never use `session_store_sql`, SQL, session-history searches or tool discovery to route work.

## Output

Report the owner and either the worker result or the selection step. Put the ready-to-paste scope prompt in a fenced
`text` code block so the user can copy plain text after switching.
