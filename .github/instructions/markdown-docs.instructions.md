---
description: "Human-authored Markdown style guidance for repository documentation. Pairs with markdown.instructions.md."
applyTo: "docs/**/*.md"
---

# Markdown Documentation Standards

Audience-specific style and template rules for **human-authored documentation**
in the in-repo `docs/**` folder. Cross-cutting rules (line length, ATX headings, code fences,
link syntax, patterns-to-avoid) live in
[`markdown.instructions.md`](markdown.instructions.md) and apply here too.

## Template-First Approach

For documentation pages that mirror agent-output structure, preserve
the H2 heading order from the canonical agent-output templates so that
internal links from agent-output pages resolve.

- Preserve H2 heading order — invariant sections come first
- No embedded skeletons — link to templates instead of copying them
- Optional sections after the last required H2
- The full template registry is enforced by
  `tools/scripts/validate-artifacts.mjs` (applies to `agent-output/**`,
  not repository documentation — included here for reference)

## Visual Styling

See `azure-artifacts/SKILL.md` for the canonical styling reference
(badges, emoji, callouts, status icons, collapsible sections). Reproduce
these conventions consistently in repository documentation so links between
docs and agent-output artifacts feel unified.

Common reusable elements:

| Element              | Source                                                   |
| -------------------- | -------------------------------------------------------- |
| Badge row            | `![Step]` / `![Status]` / `![Agent]` shields             |
| Collapsible TOC      | `<details open>` block with section links                |
| Traffic-light status | ✅ / ⚠️ / ❌ (all three required when used as a column) |
| Cross-navigation     | Header table with ⬅️ Previous / 📑 Index / Next ➡️       |

## Validation

```bash
npm run validate:docs
```

## Reference

Full examples and formatting guide:
`.github/instructions/references/markdown-formatting-guide.md`.
