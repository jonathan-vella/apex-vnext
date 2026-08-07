---
name: apex-azure-adr
description: "Record Azure architecture trade-offs in bounded APEX decisions. Use for alternatives, WAF consequences, and decision rationale."
user-invocable: false
---

# APEX Azure Architecture Decisions

Use this skill only for an active architecture or planning task. The kernel-owned architecture artifact, recorded
architecture decisions, requirements, and governance evidence are authoritative.

## Decision Method

1. State the decision as a bounded choice that traces to projected requirements or an accepted kernel decision.
2. Compare the selected option with at least one viable alternative when the trade-off materially affects security,
   reliability, performance, cost, operations, or sustainability.
3. Record both positive and negative consequences in the typed architecture decision rationale.
4. Reference accepted evidence hashes and requirement IDs through `apex/taskContext`; do not invent citations or infer
   cloud state from chat history.
5. Return an explicit blocker when evidence or a user-owned trade-off is missing. Use `apex/recordInput` only for a
   kernel-issued decision request.

## Boundaries

Do not create ADR files, sequence document numbers, write Markdown, use shell or Git, query Azure directly, or alter
architecture artifacts outside APEX MCP. A rendered document is derived output, not the decision authority.

## References

- [Decision record fields](references/decision-record-fields.md) - context, alternatives, consequences, WAF, and constraints.
- [Decision quality](references/decision-quality.md) - pre-completion checklist.
- [Decision guardrails](references/decision-guardrails.md) - anti-patterns and corrections.
- [Decision examples](references/decision-examples.md) - bounded architecture trade-off examples.

## Output

Return typed architecture or plan decisions with rationale, alternatives, consequences, requirement traceability, and
accepted evidence references.
