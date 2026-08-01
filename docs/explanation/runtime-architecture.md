# Runtime Architecture

> [Current Version](../../VERSION.md) | How APEX vNext separates authority, contracts, capabilities, and clients.

## Kernel Authority

`packages/kernel` owns deterministic state transitions, task issuance, gates, authorization, journals, evidence, and
bounded improvement decisions. Any state-changing operation must pass through this boundary.

The kernel is intentionally client-neutral. It accepts typed inputs and emits typed state; it does not rely on chat
history, prose artifacts, or a particular editor to decide what is allowed.

## Contracts

`packages/contracts` owns versioned schemas for persisted and published data. Contracts make workflow handoffs explicit
and allow validators to fail closed on malformed, stale, oversized, or unsupported inputs.

## Capabilities

`packages/capabilities` owns bounded operations such as IaC generation, Bicep and Terraform command planning, provider
schema inspection, capability-pack lifecycle, and read-only Azure operations. Capabilities cannot grant their own
authorization.

## CLI And MCP

`packages/cli` is the lifecycle and terminal boundary. It installs managed customizations, selects projects and runs,
translates commands into service calls, and exposes a narrow MCP facade. The CLI does not create a second state machine.

## Renderers And Testkit

`packages/renderers` turns typed contracts into deterministic Markdown. `packages/testkit` provides fixtures, providers,
clocks, IDs, and qualification scenarios. Neither package owns production decisions.

## Managed Clients

`customizations` contains canonical managed source and client projections. Agents and skills guide users, gather creative
inputs, and invoke kernel tools. They may not bypass gates, mutate `.apex` directly, or claim unsupported client behavior.

## State And Evidence

Consumer-project state lives under `.apex/`. Journals are append-only and hash-linked; objects are content-addressed.
Approvals, execution attestations, and operation records are immutable evidence. Derived views can be rebuilt from
verified source state.

## Related

- [Workflow and gates](workflow-and-gates.md)
- [Security and authority](security-and-authority.md)
- [Configuration and contracts](../reference/configuration.md)
