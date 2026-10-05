---
description: "Bad prompt: uses generic agent: agent and pins model:. Should fire model-pin-001."
agent: agent
model: "GPT-5.5"
---

# Bad Generic-Agent Prompt Fixture

This fixture uses `agent: agent` (generic) and pins `model:`. The session
model applies, so the validator should fire `model-pin-001` (severity error).
