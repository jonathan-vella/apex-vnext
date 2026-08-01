---
description: "Human-authored Markdown style guidance for repository documentation. Pairs with markdown.instructions.md."
applyTo: "docs/**/*.md"
---

# Markdown Documentation Standards

Audience-specific style and template rules for **human-authored documentation**
in the in-repo `docs/**` folder. Cross-cutting rules (line length, ATX headings, code fences,
link syntax, patterns-to-avoid) live in
[`markdown.instructions.md`](markdown.instructions.md) and apply here too.

## Content Families

- Tutorials teach one bounded local learning path.
- How-to guides solve one operational task.
- Explanations describe architecture, workflow, or trust boundaries.
- References list exact interfaces and source authorities.
- `docs/vnext/` contains binding project controls, not product tutorials.

Keep pages quiet and repository-native. Do not copy agent-output badge rows,
collapsible tables of contents, or step-navigation chrome into product docs.

## Validation

```bash
npm run validate:docs
```

## Reference

Full examples and formatting guide:
`.github/instructions/references/markdown-formatting-guide.md`.
