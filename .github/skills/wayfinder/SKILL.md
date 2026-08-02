---
name: wayfinder
description: "Plans large, uncertain efforts as a GitHub issue map of decision tickets. Use when a request exceeds one session, has unresolved dependencies, or needs staged research and human decisions."
disable-model-invocation: true
license: MIT
---

# Wayfinder

Use Wayfinder to discover the route through a large, uncertain effort before
implementing it. It builds a durable GitHub issue map of decisions, not a task
breakdown of implementation work.

## When To Use

- The requested outcome cannot be planned confidently in one session.
- Several decisions, research questions, or human choices block the route.
- Work must continue across sessions or collaborators.

Do not use it for a bounded change with a clear implementation path. Do not use
Wayfinder to alter APEX runtime state, approve gates, or deploy resources.
Those actions remain behind the kernel and its normal authorization flow.

## Prerequisites

- Confirm the repository has GitHub Issues enabled and `gh` has repository
  access.
- Read [.github/skills/github-operations/SKILL.md](../github-operations/SKILL.md)
  before creating, assigning, closing, or linking issues.
- Use the repository's existing labels when they express the ticket type;
  create `wayfinder:map`, `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, and `wayfinder:task` only when absent.

## Map Model

Create one map issue labelled `wayfinder:map`. Its child decision tickets are
ordinary issues linked to the map in their body. An open, unassigned, unblocked
child issue is on the frontier.

Use this map body:

```markdown
## Destination

<The outcome this map is finding a route toward.>

## Notes

<Relevant constraints, domain guidance, and standing preferences.>

## Decisions So Far

- [<closed ticket title>](<issue-url>) - <one-line decision gist>

## Not Yet Specified

<In-scope questions that are too vague to become tickets.>

## Out Of Scope

<Work deliberately excluded from this map.>
```

Use this ticket body:

```markdown
## Question

<One decision or investigation that this ticket resolves.>

## Wayfinder Map

<URL of the parent map issue.>

## Blocked By

- <Linked blocking issue, if any.>
```

Refer to issues by their linked title in user-facing prose, never only by an
issue number. Record the full resolution in the ticket comment; keep the map's
`Decisions So Far` entry to a one-line linked gist.

## Ticket Types

- `research`: Agent-led fact finding that resolves an external knowledge gap.
- `prototype`: A human-reviewed rough artifact that sharpens a choice.
- `grilling`: A human decision gathered one question at a time.
- `task`: Work that unblocks a later decision, not destination delivery.

A human must supply the answer for `prototype` and `grilling` tickets. Do not
invent or infer the human decision.

## Chart A Map

1. Confirm the destination in one or two sentences. If it is already clear and
   bounded, stop and use the normal planning or implementation workflow.
2. Map the visible frontier breadth-first. Create tickets only for questions
   that can be stated precisely now; place the rest in `Not Yet Specified`.
3. Create the map and its currently visible ticket issues. Add each ticket's
   map URL and `Blocked By` links after issue URLs exist.
4. Add `wayfinder:<type>` labels. Assign no frontier ticket yet unless this
   session will immediately resolve exactly one of them.
5. For research tickets, use an appropriate bounded research agent or skill and
   link its findings in the ticket. Do not resolve implementation work while
   charting.

## Work One Ticket

1. Load the map issue and choose the named ticket, or the first unassigned,
   unblocked child ticket.
2. Claim it before investigation:

   ```bash
   gh issue edit ISSUE_NUMBER --add-assignee @me
   ```

3. Resolve only that decision. Read linked tickets only when needed. Ask the
   user directly for human-in-the-loop ticket answers.
4. Post the resolution as a comment, close the issue, and add a one-line linked
   decision gist to the map.
5. Add newly precise tickets, remove their former fog entry, and update any
   blocking links. Close and record work that is outside the destination.

Never resolve more than one ticket in a session, except independent research
tickets that are delegated to bounded subagents.

## Validate The Map

Before ending a Wayfinder session, verify that:

- The map has a clear destination and no duplicate decision detail.
- Every open child ticket links back to the map and has one ticket-type label.
- Every blocking relationship is expressed in `Blocked By`.
- Human decisions are recorded only from the human's explicit input.
- Each resolved ticket has a resolution comment, is closed, and is represented
  once in `Decisions So Far`.

When no open decisions or meaningful fog remain, hand the route to the normal
APEX requirements, architecture, planning, or implementation workflow.
