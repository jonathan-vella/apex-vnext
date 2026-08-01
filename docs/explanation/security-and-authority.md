# Security And Authority

> [Current Version](../../VERSION.md) | Trust boundaries for state, approvals, evidence, and cloud operations.

## Fail-Closed Rules

APEX rejects unknown contracts, stale tasks, mismatched tracks, changed dependencies, expired previews, invalid writer
claims, unsafe paths, missing evidence, and unauthorized operations. Accepted risk cannot override secret exposure,
authorization, security baseline, active deny policy, stale previews, or destructive-operation controls.

## Single Writer

Each run has one active writer epoch. Cross-device or CI handoff requires a bounded claim that names repository, branch,
commit, workflow, sender, recipient, current head, and expiry. Importing state does not automatically grant writer or
provider authority.

## Preview And Approval

A preview is proof for one exact dependency revision, IaC track, target, operation, owner epoch, and execution recipient.
Approval must reference that preview and expire no later than it. Deployment revalidates the binding before and after the
provider operation.

## Secrets And Evidence

Credentials, secret values, Terraform state, and Terraform saved plans are prohibited from Git. Evidence is bounded,
redacted, content-addressed, and classified as required, accepted operational, optional diagnostic, or quarantined local
output. Uncertain output stays local until reviewed.

## Azure Baseline

The shipped baseline requires HTTPS, TLS 1.2 or newer, no public blob access, no shared-key authentication, managed
identity preference, Entra-only SQL authentication, disabled registry admin, and no public network access for production
data services. Live Azure Policy can add stricter requirements.

## Human Authority

Creative agents can recommend; validators can reject; only an authorized person can approve gates, destructive actions,
live qualification, publication, tags, or release cutover. No documentation example implies authorization.

## Related

- [Operate a project](../how-to/operate-project.md)
- [Configuration and contracts](../reference/configuration.md)
- [Security guide for the repository](../../SECURITY.md)
