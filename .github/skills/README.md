# Repository Skills

This directory supports development and maintenance of APEX vNext. Installed consumer guidance comes from
[`customizations/`](../../customizations/README.md), not from copying this directory into consumer projects.

## Invocation

- Invoke `/docs-writer` manually for the documentation workflow. It loads `apex-unslop` once within the authorized scope.
- Invoke `/apex-unslop` directly for scoped prose cleanup, or let docs-writer load it. Neither changes technical authority.
- `wayfinder` is manual-only. Other skills follow their own frontmatter and task scope.
- No skill may approve gates, restore historical authority, or bypass the kernel workflow.

## Retained Owners

The [current guidance delivery registry](../../tools/registry/guidance-delivery.v1.json) records current source
ownership and deferred obligations. Managed product skills live under `customizations/.github/skills/`;
they are distinct from these repository-maintenance entry points.

| Group                                                         | Why it remains                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| docs-writer, apex-unslop                                      | Repository documentation and scoped prose quality.                                                |
| github-operations                                             | Explicitly authorized Git and GitHub maintenance.                                                 |
| context-management, vendor-prompting                          | Current client diagnostics and managed-guidance validation.                                       |
| golden-principles, wayfinder                                  | Repository operating rules and manually requested planning.                                       |
| workflow-engine                                               | Current kernel routing, dependencies and approval boundaries.                                     |

Historical product-authoring copies are not current workload entry points. Their originals and deferred obligations
are preserved through the approved cleanup catalog; current product behavior does not load archived source.
Retirement requires replacement checks and archive verification. Directory size or old terminology alone is not
proof that behavior is unused.

## Repository Instructions

The files in `.github/instructions/references/` are supporting references, not a second set of executable workflow rules.
Security/policy, cost, governance, agent structure, review, Markdown formatting and precedence references remain because
active guidance or validation consumes them. Managed scoped instructions live under `customizations/.github/instructions/`.

Use [AGENTS.md](../../AGENTS.md) for validation scope. Small prose edits need focused Markdown/link checks, skill edits
need metadata/reference checks, and shared runtime or packaging changes need their owning tests and integration proof.

## Adding Or Retiring Guidance

Update the existing owner, consumer mapping and relevant tests together. Validate invocation metadata and references with
`npm run validate:skills` and `npm run validate:guidance-delivery`. `validate:skills` checks the shipped
`customizations/.github/skills/` and this directory with per-root rules; pre-existing errors live only in the shrink-only
[skill validation baseline](../../tools/registry/skill-validation-baseline.json). Preserve licenses and attributions.
Historical storage
is optional; current source, documentation and required checks must remain usable without it.
