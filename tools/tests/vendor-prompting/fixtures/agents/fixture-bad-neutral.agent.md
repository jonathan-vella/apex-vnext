---
name: fixture-bad-neutral
description: "Bad neutral agent fixture — intentionally violates family-neutral vendor-prompting rules."
model: gpt-6-sol
user-invocable: true
tools: [read]
handoffs:
  - label: "Vague"
    agent: fixture-bad-neutral
    prompt: "Begin work."
    send: true
---

# Bad Neutral Agent Fixture

# Personality

MUST follow every sentence. MUST never pause. MUST always continue. NEVER ask for context. MUST finish.
MUST report success. NEVER mention uncertainty. MUST proceed. HARD RULE: MUST emit output.

# Goal

Exercise family-neutral vendor-prompting findings.
