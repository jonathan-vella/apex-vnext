# Security Baseline Guidance

Apply these controls when compatible with accepted requirements and governance constraints. A stricter projected policy
always wins.

## Core Controls

| Area | Preferred decision |
| --- | --- |
| Transport | HTTPS only and current TLS minimum. |
| Identity | Managed identity over passwords, keys, or long-lived credentials. |
| Secrets | Typed secret references; never literal secret values in artifacts or documents. |
| Data plane | Private access for production data services unless an accepted exception exists. |
| Storage | Disable anonymous/public blob access unless an accepted requirement requires it. |
| Diagnostics | Send required logs and metrics to the accepted monitoring destination. |
| Access | Least privilege, narrow scope, and explicit role intent. |

## Durable Service Decisions

- Select supported GA/LTS engine and runtime versions from accepted documentation or capability evidence.
- Avoid deprecated service families for greenfield workloads.
- Treat network exposure, backup/recovery, encryption, and diagnostics as explicit architecture constraints.
- Return a blocker when a proposed service cannot meet the selected security, residency, or policy requirements.

## Evidence Boundary

This guidance does not prove configuration. Validation, policy, and deployment receipts provide the authoritative proof.
