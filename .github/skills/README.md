# Repository Skills

This directory supports development and maintenance of APEX vNext. Installed consumer guidance comes from
[`customizations/`](../../customizations/README.md), not from copying this directory into consumer projects.

## Invocation

- Invoke `/docs-writer` manually for the documentation workflow. It loads `apex-unslop` once within the authorized scope.
- Invoke `/apex-unslop` directly for scoped prose cleanup, or let docs-writer load it. Neither changes technical authority.
- `wayfinder` is manual-only. Other skills follow their own frontmatter and task scope.
- No skill may approve gates, restore historical authority, or bypass the kernel workflow.

## Retained Owners

The [guidance migration registry](../../tools/registry/guidance-migration.v1.json) records every root skill's disposition.
Do not maintain a second model, skill-count or resource-migration inventory here.

| Group                                                         | Why it remains                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| docs-writer, apex-unslop                                      | Repository documentation and scoped prose quality.                                                |
| github-operations                                             | Explicitly authorized Git and GitHub maintenance.                                                 |
| context-management, vendor-prompting                          | Current client diagnostics and managed-guidance validation.                                       |
| golden-principles, wayfinder                                  | Repository operating rules and manually requested planning.                                       |
| workflow-engine                                               | Current kernel routing, dependencies and approval boundaries.                                     |
| Azure, IaC, Entra, Microsoft documentation and Mermaid skills | Source material with declared managed vNext consumers.                                            |
| python-diagrams                                               | Required diagram quality and deferred capability source; not an obsolete dependency by age alone. |

The source guidance is retained only while current code, validators or declared vNext requirements need it. Moving a
source requires migration of those consumers and a focused replacement test. Directory size and old terminology alone
are not proof that its behavior is unused. The old skill-audit automation is retired; it is not a maintenance prerequisite.

## Repository Instructions

The files in `.github/instructions/references/` are supporting references, not a second set of executable workflow rules.
Security/policy, cost, governance, agent structure, review, Markdown formatting and precedence references remain because
active guidance or validation consumes them. Managed scoped instructions live under `customizations/.github/instructions/`.

Use [AGENTS.md](../../AGENTS.md) for validation scope. Small prose edits need focused Markdown/link checks, skill edits
need metadata/reference checks, and shared runtime or packaging changes need their owning tests and integration proof.

## Adding Or Retiring Guidance

Update the existing owner, consumer mapping and relevant tests together. Validate invocation metadata and references with
`npm run validate:skills` and `npm run validate:guidance-migration`. Preserve licenses and attributions. Historical storage
is optional; current source, documentation and required checks must remain usable without it.
