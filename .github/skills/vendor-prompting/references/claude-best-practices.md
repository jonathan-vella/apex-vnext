<!-- ref:claude-best-practices-v2 -->

# Anthropic Prompting Background

Use this file as background when manually auditing prompts that cite Anthropic guidance. Automated repository rules are
family-neutral; this reference does not define validator-backed Claude-only rules.

## Useful Patterns

- Put task-specific context close to the request.
- Use clear section names when the prompt has multiple responsibilities.
- Keep examples short and place them after the main instructions.
- State desired behavior directly rather than writing long negative lists.
- Treat unsupported assistant prefill guidance as a manual audit concern for external Claude integrations.

## Manual Audit Notes

- XML-style sections can be useful in external Claude prompts, but repository-managed APEX agents should follow their
  current markdown contracts unless a task explicitly asks for an external Claude prompt review.
- If a prompt claims Claude-specific runtime behavior, verify it against current Anthropic documentation before relying
  on it.
