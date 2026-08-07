---
name: apex-bicep-patterns
description: "Apply approved Bicep architecture patterns to APEX implementation intent. Use for AVM composition, private endpoints, networking, diagnostics, and CodeGen acceptance."
---

# APEX Bicep Patterns

Use this skill for an active Bicep-bound planning or CodeGen task. It describes approved intent and acceptance criteria;
CodeGen and validators own generated files and command execution.

## Prerequisites

- `apex/taskContext` identifies an accepted Bicep track task and its typed binding inputs.
- Requirements, governance, security, and architecture decisions are current.

## Workflow

1. Select only patterns supported by the accepted architecture and track binding.
2. Apply [Network and observability](references/network-and-observability.md) to private connectivity and diagnostics.
3. Apply [AVM and CodeGen acceptance](references/avm-and-codegen-acceptance.md) to module decisions and validation intent.
4. Stage only typed intent through APEX MCP; return unavailable modules or stale evidence as blockers.

## Boundaries

- This skill does not write Bicep, resolve module versions, invoke Bicep, or perform deployment commands.
- CodeGen owns generated IaC; validators own build, lint, security, and preview receipts.
- Module choice does not bypass policy, cost, approval, or deployment evidence.

## References

- [Network and observability](references/network-and-observability.md) - hub-spoke, private endpoints, and diagnostics.
- [AVM and CodeGen acceptance](references/avm-and-codegen-acceptance.md) - module binding and validation intent.
