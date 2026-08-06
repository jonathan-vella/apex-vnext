---
name: apex-requirements
description: "Structure a bounded APEX requirements task. Use for constraints, NFRs, compliance, budget, and scope."
---

## APEX Requirements

Use this skill only for an active requirements task.

## Prerequisites

- `apex/taskContext` returns a requirements task envelope.
- The interactive Requirements agent is active when user input may be needed.
- The kernel's returned input request is the authoritative requirements question catalog.

## Workflow

1. Call `apex/nextTask`. When it returns `needs_input`, use its `intake` metadata and `questions` exactly as returned;
   do not maintain a separate client-side question list.
2. Ask the returned questions through the active client projection's question mechanism and record every answer as
   supplied, unknown, or explicitly deferred with its owner.
3. Submit that request only through `apex/recordInput`, preserving its request ID, expected journal head, and owner epoch.
4. Call `apex/nextTask` again and repeat until it returns a requirements `task`; only then read `apex/taskContext`.
5. Treat the service-preferences round as a preference boundary. Capture retained, prohibited, and preferred services,
   SKU preferences, and environment overrides without selecting architecture, SKUs, or implementation details.
6. Submit the typed result only through `apex/stageArtifact` and `apex/completeTask`.

The kernel catalog and its versioned input contracts are authoritative. Do not choose architecture, SKUs, or
implementation details while gathering requirements.

## Output

Return the kernel result plus any unresolved user-owned fields.
