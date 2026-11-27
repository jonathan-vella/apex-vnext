---
name: workflow-engine
description: '**UTILITY SKILL** - Explain and maintain the current vNext kernel workflow. WHEN: "orchestrator routing", "workflow validation", "workflow DAG", "workflow gate". EXCLUDES live deployment and independent state transitions.'
---

# Workflow Authority

[`config/workflow.v1.json`](../../../config/workflow.v1.json) owns routing, source dependencies, reviewers and gates.
[`WorkflowEngine`](../../../packages/kernel/src/workflow-engine.ts) evaluates that manifest. Client guidance must not
implement its own workflow or mutate journal state outside authorized kernel operations.

Use current status and next-task results to resume. Handle `needs_input`, `needs_review`, `task` and blocked outcomes
explicitly; missing client mechanics do not mean a task or review succeeded.

Keep all four review passes and required approvals. Gate 4 binds the exact operation and preview; it is never inherited.
Input revisions, expiry and writer authority remain checked on every state-changing operation.

For changes, update the owning manifest or runtime and test the affected route, invalidation and gate behavior.
`npm run validate:workflow-graph` uses the kernel validator. Agent and projection changes also require their focused
invocation checks. See [workflow and gates](../../../docs/explanation/workflow-and-gates.md) for the public contract.
