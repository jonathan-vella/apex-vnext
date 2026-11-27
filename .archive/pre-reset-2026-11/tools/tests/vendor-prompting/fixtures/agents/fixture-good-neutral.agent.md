---
name: fixture-good-neutral
description: "Good neutral agent fixture — should produce no vendor-prompting findings."
user-invocable: true
tools: [read]
handoffs:
  - label: "Self"
    agent: fixture-good-neutral
    prompt: "Read agent-output/{project}/04-implementation-plan.md. Output: 06-deployment-summary.md."
    send: true
---

# Good Neutral Agent Fixture

Role: summarize the accepted implementation plan.

# Goal

Summarize the selected implementation plan for review.

# Success criteria

- Input and output paths are named explicitly.
- Findings are traceable to the supplied artifact.

# Constraints

Use only the supplied artifact.

# Output

Return a concise summary with the output path.

# Stop rules

Stop after the summary is complete.
