# Vendor-Prompting Audit Report

> Template for audit reports produced by [audit-procedure.md](../references/audit-procedure.md). Save filled reports to
> `tmp/vendor-prompting-audits/{name}-{YYYYMMDD}.md`.

## Target

- **File**: `<path/to/file.agent.md>`
- **Audit date**: `YYYY-MM-DD`
- **Auditor**: `<name or agent>`

## Frontmatter snapshot

| Field            | Value                      |
| ---------------- | -------------------------- |
| `name`           | `<value>`                  |
| `user-invocable` | `<true / false / default>` |
| `tools`          | `<count>`                  |
| `handoffs`       | `<count>`                  |

## Automated findings

| Rule ID     | Severity | Message     | Source         |
| ----------- | -------- | ----------- | -------------- |
| `<rule-id>` | error    | `<message>` | `<source_url>` |
| `<rule-id>` | warn     | `<message>` | `<source_url>` |

## Manual findings

| Checklist item              | Rule ID     | Result | Notes                              |
| --------------------------- | ----------- | ------ | ---------------------------------- |
| `<item from checklists.md>` | `<rule-id>` | YES    | `<observation>`                    |
| `<item from checklists.md>` | `<rule-id>` | NO     | `<observation + remediation hint>` |

## Severity summary

| Severity | Count |
| -------- | ----- |
| error    | `<n>` |
| warn     | `<n>` |
| info     | `<n>` |

## Recommended fixes

For each NO or non-clean finding, list the smallest change that brings the target into compliance.

## Verdict

`APPROVED | NEEDS_REVISION | REJECTED`

**Justification**: 1-2 sentence rationale referencing the gate applied.
