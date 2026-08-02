# APEX vNext Project Controls

This directory contains binding repository-development and release controls. Product tutorials, procedures,
explanations, and references start at the [documentation index](../README.md).

## Sources Of Truth

| Concern | Authority |
| --- | --- |
| Current engineering checkpoint | [PROJECT.md](PROJECT.md) |
| Product scope and acceptance | [PRD.md](PRD.md) |
| Delivery order | [ROADMAP.md](ROADMAP.md) |
| Risks and assumptions | [REGISTER.md](REGISTER.md) |
| Decisions and ADR index | [DECISIONS.md](DECISIONS.md) and [ADRs](adrs/README.md) |
| Client qualification | [CLIENT-QUALIFICATION.md](CLIENT-QUALIFICATION.md) |
| Live Azure procedure | [LIVE-QUALIFICATION.md](LIVE-QUALIFICATION.md) |
| Documentation ownership | [documentation-inventory.v1.json](documentation-inventory.v1.json) |
| Frozen baseline evidence | [phase-0a](phase-0a/) |

Versioned runtime behavior is owned by `packages/`, `config/`, and `customizations/`. Project controls may add release
requirements but may not create a competing runtime state machine.

## Scope Boundary

This table governs the APEX repository: its product requirements, delivery, release, and qualification. In a consumer
workspace, the installed kernel and its managed `.apex/` state own project/run state, gates, approvals, evidence, and
selected-client state. Consumer state cannot change repository requirements, release status, or distribution authority.
See [Sources of truth](../reference/sources-of-truth.md) for the complete boundary.

## Current Boundary

APEX vNext is pre-release and no release candidate is selected. Deterministic and package qualification are required for
ordinary changes. Live client, Azure, publication, tagging, and cutover actions require separate explicit authorization
and candidate-bound evidence.

GitHub Issues own actionable work state. These documents own durable requirements, decisions, risks, and procedures;
chat history and generated summaries are never authoritative.

## Contribution Flow

1. Read the current checkpoint and linked issue.
2. Verify `main`, worktrees, required checks, and local changes.
3. Implement one dependency-complete slice on a short-lived branch.
4. Run the cheapest falsifying check immediately after the first edit.
5. Update affected controls and product documentation in the same slice.
6. Run full validation and deterministic qualification.
7. Merge only through protected checks.

## Validation

```bash
npm run validate:vnext-project-controls
npm run validate:all
npm run qualify:vnext
```

The project-control validator preserves required files, unique IDs, local links, issue-form fields, and the frozen Phase
0A digest.

## Historical Material

Predecessor history belongs only in [Migration](../MIGRATION.md) and frozen/archive evidence. Active product behavior is
documented from vNext source authorities.
