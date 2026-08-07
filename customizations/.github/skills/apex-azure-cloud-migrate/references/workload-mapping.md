# Workload Mapping Intent

Map source capabilities to logical Azure target patterns from accepted evidence. A mapping is a design hypothesis until
an authorized implementation and validation capability produces accepted receipts.

## Mapping Dimensions

| Source concern | Target intent to record |
| --- | --- |
| Compute and triggers | Execution model, event boundary, runtime support, and scale requirements |
| Data and messaging | Managed service pattern, consistency, retention, residency, and recovery needs |
| Identity and access | Managed identity preference, least-privilege requirement, and consent or role blockers |
| Networking | Connectivity, ingress, egress, private access, and policy constraints |
| Observability | Logs, metrics, traces, alerts, retention, and operational ownership |
| Delivery | Approved IaC track, environment promotion intent, validation obligations, and rollback ownership |

## Confidence And Alternatives

For each material mapping, record evidence source, confidence, rejected alternative, and decision owner. When no direct
Azure analogue satisfies the accepted requirements, return a blocker or user decision rather than inventing equivalence.
