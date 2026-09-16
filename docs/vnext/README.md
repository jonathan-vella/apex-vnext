# APEX vNext Project Controls

This directory contains binding repository-development and release controls. Product tutorials, procedures,
explanations, and references start at the [documentation index](../README.md).

## Sources Of Truth

| Concern                        | Authority                                                          |
| ------------------------------ | ------------------------------------------------------------------ |
| Current engineering checkpoint | [PROJECT.md](PROJECT.md)                                           |
| Product scope and acceptance   | [PRD.md](PRD.md)                                                   |
| Delivery order                 | [ROADMAP.md](ROADMAP.md)                                           |
| Risks and assumptions          | [REGISTER.md](REGISTER.md)                                         |
| Decisions and ADR index        | [DECISIONS.md](DECISIONS.md) and [ADRs](adrs/README.md)            |
| Client qualification           | [CLIENT-QUALIFICATION.md](CLIENT-QUALIFICATION.md)                 |
| Live Azure procedure           | [LIVE-QUALIFICATION.md](LIVE-QUALIFICATION.md)                     |
| Documentation ownership        | [documentation-inventory.v1.json](documentation-inventory.v1.json) |

Versioned runtime behavior is owned by `packages/`, `config/`, and `customizations/`. Project controls may add release
requirements but may not create a competing runtime state machine.

## Approved Product Direction

Start with the [PRD goals](PRD.md#goals), [workload boundary](PRD.md#workload-boundary), and
[output quality reference](PRD.md#output-quality-reference). Start with the
[first optimization batch](ROADMAP.md#first-batch-input-correctness-and-scope), then follow the existing phases for
governance, COE reuse and conversational changes, rich output, both-client WSL2 workflows and distribution including
APEX MCP. The roadmap records applicable recommendation follow-ons and deferrals. No token baseline is current work.
Do not duplicate these rules in a new master plan or treat target requirements as already implemented commands.

## Scope Boundary

This table governs the APEX repository: its product requirements, delivery, release, and qualification. In a consumer
workspace, the installed kernel and its managed `.apex/` state own project/run state, gates, approvals, evidence, and
selected-client state. Consumer state cannot change repository requirements, release status, or distribution authority.
See [Sources of truth](../reference/sources-of-truth.md) for the complete boundary.

## Current Boundary

APEX vNext is pre-release and no release candidate is selected. Validation follows the changed surface and integration
requirements in [AGENTS.md](../../AGENTS.md). Live client, Azure, publication, tagging, and cutover actions require
explicit authorization
and candidate-bound evidence.

GitHub Issues own actionable work state. These documents own durable requirements, decisions, risks, and procedures;
chat history and generated summaries are never authoritative.

## Contribution Flow

1. Read the current checkpoint and linked issue.
2. Verify `main`, worktrees, required checks, and local changes.
3. Implement one dependency-complete slice on a short-lived branch.
4. Run the cheapest falsifying check immediately after the first edit.
5. Update affected controls and product documentation in the same slice.
6. Run the relevant integration checks under the repository validation policy.
7. Merge only through protected checks.

## Validation

```bash
npm run validate:vnext-project-controls
npm run validate:all
npm run qualify:vnext
```

The project-control validator preserves required files, unique IDs, local links and issue-form fields.
Current [decisions](DECISIONS.md) and PRD requirements govern product direction. Code and registry changes require
tested alignment; prose changes do not qualify a candidate or grant deployment authority.
