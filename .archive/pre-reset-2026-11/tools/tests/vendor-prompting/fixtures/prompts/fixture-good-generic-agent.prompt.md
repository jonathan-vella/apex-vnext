---
description: "Good prompt: uses generic agent: agent without a model pin."
agent: agent
---

# Good Generic-Agent Prompt Fixture

This fixture uses `agent: agent` (generic) and omits `model:`. The session
model applies, so the validator should produce zero `model-pin-001` findings.
