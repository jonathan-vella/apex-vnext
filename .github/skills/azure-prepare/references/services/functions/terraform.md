# Functions Terraform Assessment

> **Assessment-only boundary**
>
> Azure Functions Terraform materialization is unavailable. Do not copy, adapt, generate, stage, or deploy Terraform
> from this reference. Record implementation as blocked future work owned by a reviewed capability.

## Required Findings

- Hosting plan and scaling constraints, with Flex Consumption preferred for new workloads when supported
- Runtime language and supported version evidence
- Storage topology, private access requirements, and managed-identity authentication
- Required data-plane RBAC for runtime and deployment identities
- Trigger dependencies such as Service Bus, Event Grid, or Storage
- Application Insights, diagnostic settings, and retention requirements
- Network integration, private endpoints, DNS, and public-access posture
- Applicable Azure Policy constraints and required tags
- Required AVM modules, provider constraints, and any unsupported provider surface

## Evidence

Record official service documentation, selected region support, policy evidence, identity roles, and module/provider
capability gaps. Do not infer an implementation from these findings.

## Outcome

Return a bounded assessment and a backlog item naming the missing Functions Terraform materializer. The plan must
remain blocked and must not be marked ready for validation or deployment.