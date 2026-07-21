---
description: "Good prompt: targets a custom agent and correctly omits model: (inherits from agent)."
agent: "APEX Requirements"
---

# Good Custom-Agent Prompt Fixture

This fixture targets `APEX Requirements` (a known custom agent) and intentionally
omits `model:`. The validator should resolve effective family via the agent's
own `model:` and produce zero findings under `prompt-model-source-001`.
