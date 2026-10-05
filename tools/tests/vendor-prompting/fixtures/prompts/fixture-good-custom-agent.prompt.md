---
description: "Good prompt: targets a custom agent without a model pin."
agent: "APEX Requirements"
---

# Good Custom-Agent Prompt Fixture

This fixture targets `APEX Requirements` (a known custom agent) and omits
`model:`. The session model applies, so the validator should produce zero
`model-pin-001` findings.
