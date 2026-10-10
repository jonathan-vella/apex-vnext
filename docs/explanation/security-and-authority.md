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

The [accepted production target](../vnext/adrs/03-des-adr-0007-use-purpose-bound-approval-and-ci-owned-production-runs.md)
originates an execution run in CI rather than transferring writer authority from a developer. Single-writer and epoch
protections still apply within that run. The current transfer protocol remains enforced where used until the
replacement is implemented and qualified.

## Preview And Approval

A preview is proof for one exact dependency revision, IaC track, target, operation, owner epoch, and execution recipient.
Approval must reference that preview and expire no later than it. Deployment revalidates the binding before and after the
provider operation.

DECISION-036 permits a future CI-hosted human review surface, not workflow self-approval. The kernel must verify the
actual reviewer and bound candidate before apply; a triggering actor or OIDC token is not human approval evidence.
Unavailable repository approval features, wrong purpose or target, changed artifacts and expired evidence block
production. Labs keep explicit operation approval and native Terraform state locking despite fewer prompts.

## Secrets And Evidence

Credentials, secret values, Terraform state, and Terraform saved plans are prohibited from Git. Evidence is bounded,
redacted, content-addressed, and classified as required, accepted operational, optional diagnostic, or quarantined local
output. Uncertain output stays local until reviewed.

Removing the developer-to-CI handoff does not make CI saved plans or state safe public artifacts. The production
target still requires protected encrypted storage, digest checks, bounded retrieval, retention and cleanup.

## Azure Baseline

The shipped baseline requires HTTPS, TLS 1.2 or newer, no public blob access, no shared-key authentication, managed
identity preference, Entra-only SQL authentication, disabled registry admin, and no public network access for production
data services. Live Azure Policy can add stricter requirements.

## COE And Profile Boundaries

The [planned COE import](../vnext/PRD.md#req-reuse-001-coe-archetype-import) copies reusable intent and code, not authority.
Source approvals, writer claims, Terraform state/plans and credentials must not become consumer inputs. Repository
instructions and scripts are untrusted content during inspection, not commands to execute. Source as-built documents
describe historical resources, not a consumer deployment.

ALZ-backed workloads use supplied platform resources by default and must not modify or delete them as workload-owned.
Standalone labs can own supporting resources but still obey Azure Policy and the security baseline. Target policy is
imported through the reviewed subscription-baseline contract; missing evidence is not an empty-policy result. Quota and
regional availability assumptions never waive policy, ownership checks or deployment approval.

## Human Authority

Creative agents can recommend; validators can reject; only an authorized person can approve gates, destructive actions,
live qualification, publication, tags, or release cutover. No documentation example implies authorization.

## Related

- [Operate a project](../how-to/operate-project.md)
- [Configuration and contracts](../reference/configuration.md)
- [Security guide for the repository](../../SECURITY.md)
