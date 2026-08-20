---
name: apex-planning
description: "Provides internal APEX planning guidance for implementation intent, controls, dependencies, ownership, tracks, and bindings."
user-invocable: false
---

## APEX Planning

Use this skill only for an active planning task.

## Prerequisites

- The kernel projects accepted architecture and current governance inputs.
- The selected IaC track and target environment are present in the task envelope.

## Workflow

1. Use accepted task-context artifacts and preserve their source hashes in implementation intent. Keep intent free of
   Bicep or Terraform syntax.
2. Define logical resources, controls, dependencies, identity, networking, diagnostics, outputs, and environment
   obligations. Keep dependencies acyclic.
3. Put modules, providers, API versions, variables, parameters, phases, backend, and stack ownership in the selected
   binding rather than neutral intent. Bind only the selected task track.
4. Trace every binding obligation to intent and projected policy requirements. Represent environment secrets only as
   typed references; do not include secret values.
5. Stage each typed output through `apex/stageArtifact`, then call `apex/completeTask` once with every required
   output in `outputs`. Do not submit a single-output completion for a multi-output task.

## Output

Return the kernel result and any architecture-rooted or user-owned blocker.

## Boundaries

The kernel validates source hashes, track consistency, binding coverage, dependency shape, and secret safety. Do not
claim a binding, hash format, provider capability, or gate result that is not returned by the current task contract.
