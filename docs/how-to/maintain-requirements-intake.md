# Maintain Requirements Intake

> [Current Version](../../VERSION.md) | Safely evolve the kernel-owned requirements question catalog and its replay contract.

## Locate The Authority

The requirements agent and client projections ask only the request returned by `nextTask`. The authoritative catalog is
`REQUIREMENTS_INTAKE` in [`packages/cli/src/service.ts`](../../packages/cli/src/service.ts). Its input shapes are
versioned in [`packages/contracts/src/runtime.ts`](../../packages/contracts/src/runtime.ts). Managed guidance must
describe that authority; it must not duplicate a mutable question list.

New runs use three ordered panels before the requirements task:

1. Business discovery
2. Workload pattern and service preferences
3. Security and compliance

Business discovery requires an explicit `workload-profile`: `alz-backed` or `standalone-lab`. Neither is recommended
or inferred from environment names. The answer remains in the existing input journal and requirements task context,
and the requirements template projects it as a `must` requirement with source `intake:workload-profile`.

Pending three-panel requests issued before profile capture and legacy four-round requests replay unchanged. They do not
gain an inferred profile. Profile-dependent follow-on work must clarify missing intent before relying on it.

Profile capture does not itself enforce supplied-resource ownership or implement profile-specific planning and cleanup.
Those remain follow-on work under the [workload boundary](../vnext/PRD.md#workload-boundary); policy, security and
deployment approval requirements are unchanged.

The workload-pattern round appends migration questions only when business discovery records `migration` or
`modernization`. Conditional questions must be derived from accepted prior-round answers in the kernel; do not let an
agent or client choose whether to ask them.

The service portion of the workload panel is a preference boundary. Record retained, prohibited, preferred, and environment-specific
services plus SKU preferences, without choosing an architecture, SKU, or implementation.

## Make A Compatible Change

1. Update the kernel catalog first, including prompts, options, and ordering where the new behavior requires it.
2. Update versioned contracts when a round identifier, request metadata, or answer shape changes.
3. Preserve stable round and question IDs for persisted history and downstream consumers. Add a new compatible value
   instead of repurposing an existing ID.
4. Review journal replay for pending and recorded requests. Legacy or malformed persisted input must fail closed; do not
   reinterpret it as a current request or silently continue a run with ambiguous input.
5. Update focused replay and workflow tests for the catalog sequence, valid recording, stale and malformed input, and
   legacy persisted requests.
6. Update managed agent and skill guidance, then regenerate client projections and other generated assets through their
   owning command. Do not edit generated assets directly.
7. Update this guide and the workflow, MCP, and configuration references when the user-visible contract changes.
8. Managed agents use stage-specific completion operations. Keep generic `completeTask` only for compatibility callers.

## Validate The Change

Run the focused CLI workflow tests first, then validate the managed and documentation surfaces:

```bash
npm run build --workspace @apexops/cli
node --test --test-name-pattern='three panels|malformed persisted input requests|legacy' \
   packages/cli/dist/test/workflow.test.js
npm run validate:agents
npm run lint:md
```

Run `npm run prepare:vnext-assets` only when source changes require regenerated projections or packaged assets. Review
the generated output, but keep generated files out of a documentation-only change.

## Related

- [Run the workflow](run-workflow.md) — complete intake before the requirements task.
- [Workflow and gates](../explanation/workflow-and-gates.md) — input and decision boundaries.
- [MCP tools](../reference/mcp.md) — `nextTask` and `recordInput` contract.
- [Configuration and contracts](../reference/configuration.md) — versioned runtime authority.
