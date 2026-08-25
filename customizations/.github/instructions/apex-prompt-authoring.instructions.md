---
description: "Consumer prompt and model instruction boundaries"
applyTo: ".github/agents/**/*.agent.md, .github/prompts/**/*.prompt.md"
---

# APEX Prompt Rules

- Use the model assigned by the managed role and do not override it redundantly.
- Keep prompts outcome-focused with explicit scope, input, output, and stop conditions.
- Keep tool lists minimal and use native client questions for user-owned decisions.
- Do not grant direct mutation, secrets, repository maintenance, or cloud lifecycle authority.
- Route workflow state changes through the declared APEX MCP operation.
