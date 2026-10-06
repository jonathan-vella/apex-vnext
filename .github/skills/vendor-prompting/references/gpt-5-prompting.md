<!-- ref:gpt-5-prompting-v2 -->

# OpenAI Prompting Background

Use this file as background when manually auditing prompts that cite OpenAI guidance. Automated repository rules are
family-neutral; this reference does not define validator-backed GPT-only rules.

## Useful Patterns

- Prefer outcome-first prompts with explicit goal, success criteria, constraints, output, and stop conditions.
- Reserve personality or collaboration style for user-facing assistants.
- Avoid unnecessary absolute language; use it only for true invariants.
- Keep tool-use instructions concrete and scoped to the tools actually available.

## Manual Audit Notes

- If an external prompt targets a specific OpenAI model, verify any claimed model-specific behavior against the
  pinned source snapshots before relying on it.
- Repository-managed APEX agents should not pin OpenAI model names; the session model applies.
