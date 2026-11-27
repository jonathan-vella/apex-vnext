---
name: vendor-prompting
description: '**ANALYSIS SKILL** — Audit-grade reference for vendor prompting best practices and APEX prompt hygiene. WHEN: "audit agent", "review prompt", "vendor best practices", "anthropic best practices", "openai prompting". DO NOT USE FOR: routine prompt edits where rules are already known, generic markdown style.'
license: MIT
---

# Vendor Prompting Best Practices

Audit-grade reference for vendor prompting patterns and repository-neutral prompt hygiene. Repository agents and prompts
do not pin a model, so automated validator rules are family-neutral.

The machine-readable source of truth is [rules.json](rules.json). Every rule has an ID, source citation, severity,
applies-to value, and validator-check binding. `validate-agents.mjs` emits those same rule IDs.

## When to Use This Skill

- Auditing an existing `.agent.md` or `.prompt.md` against vendor prompting best practices.
- Investigating a finding from `npm run lint:vendor-prompting`.
- Reviewing an external prompt that mentions vendor-specific patterns.

Do not load this skill for routine edits where the format is already known. The thin prompt-authoring instruction
contains the hard-rule shortlist for ordinary `.agent.md` and `.prompt.md` edits.

## Decision Tree

```text
I am editing or reviewing a *.agent.md / *.prompt.md ...
├── Need automated rule details?
│   └── Read rules.json and cross-model-rules.md.
├── Need a manual checklist?
│   └── Read checklists.md.
├── Need vendor background?
│   ├── Anthropic patterns → read claude-best-practices.md.
│   └── OpenAI patterns    → read gpt-5-prompting.md.
└── Need a full written audit?
    └── Read audit-procedure.md and assets/audit-template.md.
```

## Reference Index

| Reference                                                       | Load when                                      |
| --------------------------------------------------------------- | ---------------------------------------------- |
| [cross-model-rules.md](references/cross-model-rules.md)         | Validator-backed neutral prompt hygiene rules  |
| [checklists.md](references/checklists.md)                       | Performing a manual pass-through audit         |
| [audit-procedure.md](references/audit-procedure.md)             | Executing the full audit procedure             |
| [claude-best-practices.md](references/claude-best-practices.md) | Background for Anthropic prompting patterns    |
| [gpt-5-prompting.md](references/gpt-5-prompting.md)             | Background for OpenAI prompting patterns       |
| [gpt-5-upgrade.md](references/gpt-5-upgrade.md)                 | Background for OpenAI prompt-style migrations  |

## Rules

- Source of truth is [rules.json](rules.json).
- No model pins: agents and prompts omit `model:`, `model-policy:` and `reasoning-effort:`.
- Automated rules are family-neutral: `cross-language-density-001`, `handoff-enrichment-001`,
  `personality-scoping-001`, and `model-pin-001`.
- Run `npm run lint:vendor-prompting` before opening a PR that changes agent or prompt guidance.

## Steps

1. Read frontmatter and capture `name`, `user-invocable`, `tools`, and `handoffs[]`.
2. Run `node tools/scripts/validate-agents.mjs --only=vendor-prompting --format=json` and filter by file path.
3. Load [checklists.md](references/checklists.md) for the manual pass.
4. Produce a report using [assets/audit-template.md](assets/audit-template.md). Verdict is APPROVED if there are zero
   errors and no unresolved warnings that affect the target workflow; otherwise return NEEDS_REVISION with per-rule
   remediation.

## Source Citations

Every rule in [rules.json](rules.json) cites an upstream source by `source_id`. Vendor source snapshots remain available
for manual audits, but model-specific classification is no longer part of the automated validator.
