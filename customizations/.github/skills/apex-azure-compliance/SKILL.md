---
name: apex-azure-compliance
description: '**ANALYSIS SKILL** — Assesses accepted Azure compliance and security posture evidence for APEX tasks: finding sources, severity, Key Vault expiration metadata, redacted reporting. WHEN: "compliance scan", "security audit", "posture findings", "Key Vault expiration check", "expired certificates". DO NOT USE FOR: spend (use apex-azure-cost-optimization), policy evidence (use apex-azure-governance).'
user-invocable: false
disable-model-invocation: false
---

When calling any `apex/*` MCP tool, include the current session checkout or worktree as the required absolute
`workspace` path.

# APEX Azure Compliance Assessment

Use this skill for an active APEX task that evaluates accepted posture evidence. It does not certify compliance, perform
a scan, disclose sensitive material, or authorize remediation.

## Prerequisites

- `apex/taskContext` identifies the target scope, applicable control source, assessment question, sensitivity
  boundary, and freshness policy.
- Capability-produced evidence includes its producer, evidence hash, target scope, observation time, completeness,
  redactions, and control mapping.
- A finding is traceable to an observed configuration or item metadata. A recommendation without mapped evidence
  remains an observation.

## Rules

- **Report, never remediate.** Keep compliance reporting separate from remediation; route every fix to its owner.
- **Metadata only.** Key Vault assessment uses item metadata. Never request or retain secret values, including the
  secrets that back certificates.
- **Coverage is explicit.** Denied access, unknown tools, unpaged results, and omitted item types are coverage gaps,
  never permission to broaden access or a reason to report "compliant".
- **Provenance matters.** Keep the recommendation source with every finding; sources differ in focus and confidence.
- **Repeat on a cadence.** Recommend a regular reassessment schedule and track findings over time; one assessment is a
  point-in-time view.

## Workflow

1. Confirm that evidence scope matches the intended subscription, resource group, resource, or vault boundary and
   identify omitted targets explicitly.
2. Separate control status, security posture signal, reliability signal, and cost observation. Do not turn one category
   into another.
3. Correlate findings by control, affected target, source, severity rationale, and evidence hash. Avoid counting
   duplicate signals from several sources as separate exposure.
4. For expiration evidence, apply the interpretation rules in
   [compliance finding criteria](references/compliance-finding-criteria.md).
5. Return a triaged, redacted finding set and route remediation decisions to the kernel-authorized owner. Escalate
   potential active exposure or outage indicators without asserting exploitation or incident cause.

## Boundaries

- Do not run external assessments, enumerate resources, inspect vault content, or request secret values. All
  observations are scoped capability-produced evidence and must remain redacted to the task's approved boundary.
- Do not represent a partial assessment as compliant, noncompliant, or secure.
- Do not prescribe, apply, or validate remediation. This skill identifies the evidence-backed need and escalation
  boundary only.
- Route spend questions to cost assessment, live service symptoms to diagnostic assessment, and policy-scope
  interpretation to the applicable governance task.

## Output

Return target scope, control basis, evidence hashes, freshness, redaction and coverage limits, findings with sources,
severity rationale, uncertainty, escalation need, and kernel-provided next action.

## References

- [Compliance finding criteria](references/compliance-finding-criteria.md) - sources, categories, severity, expiration
  interpretation, and escalation.
- [Operational checklist](references/operational-checklist.md) - assessment coverage, finding correlation, and
  redaction limits.
