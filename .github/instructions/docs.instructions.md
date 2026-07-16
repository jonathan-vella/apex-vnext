---
description: "Standards for user-facing Markdown documentation in docs/guides"
applyTo: "docs/guides/**/*.md"
---

# Documentation Standards

Instructions for creating and maintaining user-facing documentation in `docs/guides/`.

## Structure Requirements

### File Header

Every doc file must start with:

```markdown
# {Title}

> [Current Version](../../VERSION.md) | {One-line description}
```

Adjust the relative path depth based on folder nesting.

### Single H1 Rule

Each file has exactly ONE H1 heading (the title). Use H2+ for all other sections.

### Link Style

- Use relative links for internal docs (example pattern: `Quickstart -> quickstart.md`)
- For root file references, increase `../` depth based on folder nesting (for example: `../VERSION.md`,
  `../../VERSION.md`)
- Use reference-style links for external URLs
- No broken links (validated in CI)

## Current Architecture

See `tools/registry/count-manifest.json` for current agent, subagent, and skill counts.
See `tools/registry/agent-registry.json` for the agent role → file mapping.
See `tools/registry/agent-registry.json` for the agent role → file/model/skills mapping.

## Prohibited References

Do NOT reference these removed agents/skills:

- `diagram.agent.md` → Use `drawio` or `python-diagrams` skill
- `adr.agent.md` → Use `azure-adr` skill
- `docs.agent.md` → Use `azure-artifacts` skill or `as-built` agent
- `azure-workload-docs` skill → Use `azure-artifacts` skill
- `azure-deployment-preflight` skill → Merged into deploy agent
- `orchestration-helper` skill → Deleted (absorbed into orchestrator)
- `github-issues` / `github-pull-requests` skills → Use `github-operations`
- `gh-cli` skill → Merged into `github-operations`
- `_shared/` directory → Use `azure-defaults` + `azure-artifacts` skills

## Callouts

Use GitHub-compatible blockquote callouts. Pick the weakest type that
communicates the urgency; escalate only when needed.

| Type        | When to use                                                     | Marker           |
| ----------- | --------------------------------------------------------------- | ---------------- |
| `NOTE`      | Side information that aids understanding but isn't required     | `> [!NOTE]`      |
| `TIP`       | Optional best practice or shortcut                              | `> [!TIP]`       |
| `IMPORTANT` | Required context for a successful workflow                      | `> [!IMPORTANT]` |
| `WARNING`   | Behaviour that can cause confusion, unexpected cost, or rework  | `> [!WARNING]`   |
| `CAUTION`   | Data loss, security regression, irreversible destructive action | `> [!CAUTION]`   |

Rules:

- At most one `CAUTION` per page; overuse trains readers to ignore it.
- Do not stack callouts back-to-back; if two appear consecutively, merge or
  rewrite as prose.

## Related footers

Every guide under `docs/guides/` ends with a `## Related`
section listing 2–4 adjacent topics (sibling guides, upstream concepts,
downstream references). Use bullet links with a one-line description each.
Example:

```markdown
## Related

- [Cost & Governance](../cost-governance/) — track spend against policy
- [Security Baseline](../security-baseline/) — TLS, identity, key rotation
- [Troubleshooting](../troubleshooting/) — diagnose failed deploys
```

## Content Principles

| Principle                  | Application                                             |
| -------------------------- | ------------------------------------------------------- |
| **DRY**                    | Single source of truth per topic                        |
| **Current state**          | No historical context in main docs                      |
| **Action-oriented**        | Every section answers "how do I...?"                    |
| **Minimal**                | If it doesn't help users today, remove it               |
| **Prompt guide for depth** | Point to the prompt guide section in the published site |

## Validation

Documentation is validated in CI (warn-only):

- No references to removed agents
- Version numbers match `VERSION.md` (repo root)
- No broken internal links
- `npm run validate:docs` passes
