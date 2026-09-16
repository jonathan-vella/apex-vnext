---
name: context-management
description: '**UTILITY SKILL** - Diagnose vNext task-context and Copilot log issues. WHEN: "context optimization", "token budget", "log parsing", "handoff gaps". EXCLUDES infrastructure generation, deployment and automatic benchmarking.'
compatibility: Log parsing requires Python; runtime reads use the current APEX client.
---

# Context Management

## Runtime Boundaries

Use the current task's authorized inputs and targeted reads. The kernel owns accepted revisions, task budgets,
expiry and writer authority; chat summaries do not replace them. Do not discard policy, security, cost uncertainty,
review criteria or required evidence merely to shorten context. Preserve rich outputs from accepted decisions.

Follow the [managed context rules](../../../customizations/.github/instructions/apex-context.instructions.md).
Load relevant skills once and references on demand using [skill loading](references/skill-loading.md).
Resume through current APEX status and task operations. Do not invent checkpoint commands, model limits or mandatory
chat-reset ceremonies. If a bounded read cannot supply required evidence, report the blocker rather than truncate it.

## Requested Diagnostics

Inspect only the user-selected logs or task. Keep raw transcripts and credentials out of committed reports.
Distinguish observed metrics from estimates; file bytes are not measured model tokens. Follow
[the current optimization scope](../../../docs/vnext/PRD.md#req-optimization-001-bounded-input-efficiency).
Do not start a benchmarking campaign, add telemetry or change models without separate authorization.

## Reference Index

| Reference                                                  | Use                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| [Audit setup](references/audit-setup.md)                   | Discover selected logs and prerequisites.                       |
| [Analysis methodology](references/analysis-methodology.md) | Analyze observed reads, latency and handoff gaps.               |
| [Log profiling](references/log-profiling.md)               | Profile normalized metrics using the existing utility.          |
| [Token estimation](references/token-estimation.md)         | Label approximate estimates when measured usage is unavailable. |
| [Log parser](scripts/parse-chat-logs.py)                   | Parse selected logs into structured observations.               |
| [Report template](templates/optimization-report.md)        | Report findings when a diagnostic report is requested.          |

Run only checks relevant to changed behavior under `AGENTS.md`. Diagnostic findings are proposals, not permission to
change runtime state, accept risk, waive reviews or deploy.
