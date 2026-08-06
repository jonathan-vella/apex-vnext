# Workflow And Gates

> [Current Version](../../VERSION.md) | Why APEX separates creative work, deterministic validation, and approval.

## Workflow Shape

A run covers one environment, one Azure scope, and one IaC track. The versioned workflow advances through requirements,
architecture and governance, implementation planning, IaC generation and validation, preview, deployment, inventory,
diagnosis, and quality evaluation.

Creative specialists propose typed results. Deterministic validators decide whether those results satisfy contracts and
business rules. Human-owned gates authorize progression.

## Gates

| Gate | Decision boundary                                                                     |
| ---: | ------------------------------------------------------------------------------------- |
|    1 | Requirements and SKU intent are complete and reviewed.                                |
|    2 | Architecture, cost, governance constraints, and policy reconciliation are acceptable. |
|    3 | Implementation intent, IaC binding, environment inputs, and review are acceptable.    |
|    4 | The exact current preview is approved for its bound recipient and operation.          |

Gate 4 is local runtime authority. CI may transport and prove the approved candidate, but it does not silently recreate
or inherit approval.

## Invalidation

Changes invalidate downstream proof. Updating requirements invalidates architecture, planning, generated IaC, previews,
approvals, deployment evidence, and later views. Changes closer to deployment invalidate a narrower suffix.

A preview becomes stale when its dependencies, IaC, target, track, writer epoch, intended recipient, or configured TTL no
longer match. The correct response is to regenerate and reapprove it, not to override staleness.

## Tasks And Inputs

`nextTask` can return an input request, a task, or terminal status. Input requests must be answered before task context
is requested. Requirements intake has four kernel-owned rounds: business discovery, workload pattern, service
preferences, and security and compliance. Each accepted round causes the client to request the next task again; only
after the final round does the kernel issue the requirements task.

The third round is a preference boundary. It records retained, prohibited, and preferred services, SKU preferences, and
environment overrides. It does not authorize an agent to make architecture, SKU, or implementation choices. Task IDs
and owner epochs bind inputs and outputs to the current state and prevent stale completion.

## Bicep And Terraform

The workflow branches by selected track for code generation, validation, preview, and deployment, then converges on the
same operation, inventory, diagnosis, and quality contracts.

## Related

- [Run the workflow](../how-to/run-workflow.md)
- [Maintain requirements intake](../how-to/maintain-requirements-intake.md)
- [Bicep and Terraform](../reference/iac-tracks.md)
- [Security and authority](security-and-authority.md)
