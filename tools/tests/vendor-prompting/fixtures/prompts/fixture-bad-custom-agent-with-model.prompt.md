---
description: "Bad prompt: targets a custom agent and pins model:. Should fire model-pin-001."
agent: "APEX"
model: "Claude Opus 4.7"
---

# Bad Custom-Agent Prompt Fixture

This fixture targets a known custom agent (`APEX`) and pins
`model:`. The session model applies, so the validator should fire
`model-pin-001` (severity error).
