# Architecture Decision Record Fields

Use these fields in a typed architecture or planning decision. They are presentation and quality guidance; the accepted
artifact schema remains authoritative.

## Context

State the problem, constraints, evidence, affected requirement IDs, and why a decision is required now. Keep one material
trade-off per decision.

## Selected Option

State the selected option precisely. Tie it to an accepted requirement, a kernel-recorded user choice, or accepted
evidence. Do not use vague statements such as "use a database".

## Alternatives

Record at least one viable alternative when the choice materially affects the workload. For each alternative, state its
benefits, drawbacks, rejection rationale, and affected Well-Architected pillars.

## Consequences

Record at least one positive and one negative consequence. Use measurable statements where evidence exists. Include
neutral constraints or follow-up obligations when they affect later planning.

## WAF And Compliance

Describe effects on Security, Reliability, Performance Efficiency, Cost Optimization, and Operational Excellence. Record
compliance, residency, identity, and governance implications from accepted constraints; do not infer live policy.

## Implementation Constraints

Record binding constraints such as required module/provider family, identity model, network posture, diagnostics, or
recovery objective. Do not include direct shell commands, role assignment snippets, secret values, or deployment steps.
