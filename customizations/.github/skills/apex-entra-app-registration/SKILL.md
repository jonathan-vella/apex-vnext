---
name: apex-entra-app-registration
description: '**ANALYSIS SKILL** — Models Microsoft Entra app registration and OAuth design intent for APEX: app type, flow, redirect URIs, API permissions, consent, credentials. WHEN: "app registration", "configure OAuth", "API permissions", "admin consent", "client credentials", "AADSTS error". DO NOT USE FOR: Azure resource roles (use apex-azure-rbac), Key Vault audits (use apex-azure-compliance).'
user-invocable: false
disable-model-invocation: false
---

When calling any `apex/*` MCP tool, include the current session checkout or worktree as the required absolute
`workspace` path.

# APEX Entra App Registration Guidance

Use this skill only for an active architecture, planning, or approved implementation-binding task. The kernel owns
task state, evidence freshness, authorization, artifact acceptance, and all state-changing work.

## Prerequisites

- `apex/taskContext` identifies the active task, allowed outputs, applicable requirements, and evidence references.
- The workload purpose, client type, tenant boundary, target APIs, and user-interaction model are known; otherwise
  return `needs_input`.
- An identity operation is available only through a kernel-authorized capability. A request alone is not authority to
  create or alter an application registration.

## Rules

- **Least-privilege permissions.** Request only the scopes or application permissions the workload uses.
- **Credentials by environment.** Public clients hold none; Azure-hosted workloads use managed identity; other
  confidential workloads prefer federation or certificates over secrets.
- **Consent is a decision.** Application permissions and privileged delegated permissions need admin consent from an
  authorized owner; never infer or approve it.
- **Additive rotation.** A new credential coexists with the old one until consumers validate it; retiring the old one
  is a separate approved step.
- **Exact HTTPS redirects.** Redirect URIs are exact matches on the correct platform and use HTTPS outside local
  development.
- **Validate tokens.** Resource APIs validate issuer, audience, and expiry.
- **Graph consent is not Azure RBAC.** Access to Azure resources is designed with `apex-azure-rbac`.

## Workflow

1. Model the application type, audience, tenant model, redirect-URI class, and OAuth interaction.
   Record the selected flow and rationale without protocol requests or application configuration.
2. Map each business operation to the minimum delegated or application permission requirement.
   Record consent ownership, scope, and unresolved permission evidence; do not infer or approve consent.
3. Select a credential posture and record lifecycle ownership and rotation, never a value.
4. Submit typed identity intent only through the kernel-authorized capability named in the task envelope.
   Preserve its receipt or blocker in the architecture, plan, or binding artifact.
5. Hand off approved identity intent to the authorized implementation, validation, or operations capability.
   Do not claim that registration, permissions, credentials, or consent exist without an accepted receipt.
6. Classify observed identity failures with [identity design and diagnostic rules](references/design-and-diagnostics.md).
   Return the responsible owner and evidence gap without attempting remediation.

## Boundaries

Do not use portal, CLI, Microsoft Graph, SDK, HTTP, IaC, repository, source-scanning, or file-mutation actions. Do
not create registrations, configure redirect URIs, grant consent, assign permissions, create or handle credentials,
expose identifiers, tokens, or secret material, test authentication, or deploy. Direct operational requests must be
converted into bounded intent and an authorized capability handoff.

## References

- [OAuth and registration model](references/oauth-registration-model.md) - client, audience, flow, exposed API, and
  redirect-URI decisions.
- [Permissions and credential posture](references/permissions-and-credentials.md) - access models, consent, and
  credential trade-offs.
- [Capability receipt and handoff](references/capability-receipts.md) - required evidence, blockers, and next-task rules.
- [Identity design and diagnostic rules](references/design-and-diagnostics.md) - flow, permission, and sign-in error
  classification without configuration or protocol operations.

## Output

Return typed identity design intent, requirement traces, authorized capability receipt references, explicit blockers,
and the next kernel-controlled task.
