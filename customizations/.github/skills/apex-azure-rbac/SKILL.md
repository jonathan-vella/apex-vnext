---
name: apex-azure-rbac
description: "Design least-privilege Azure access in APEX decisions. Use for managed identity, role scope, and permission trade-offs."
user-invocable: false
---

# APEX Azure RBAC Guidance

Use this skill only for an active architecture or planning task. Accepted requirements, governance constraints, and
recorded identity decisions are authoritative.

## Decision Rules

1. Prefer managed identities and built-in Azure roles over credentials and custom roles.
2. Select the narrowest resource, resource-group, or subscription scope that satisfies the projected operation.
3. Record the principal purpose, role name or role requirement, scope rationale, and requirement IDs in the typed
   architecture or binding decision.
4. Treat unresolved permissions as a kernel-owned blocker or deferred decision. Do not grant broad access because a
   role name is uncertain.
5. Bind role design to accepted identity, data-access, and governance evidence. Do not use this skill to discover live
   assignments or role definitions.

## Boundaries

Do not call Azure CLI, Microsoft Graph, ARM, or documentation tools; assign roles; generate direct Bicep/Terraform role
assignment code; create custom roles; or expose principal IDs, credentials, or secrets. Approved role changes belong in
the selected IaC/deployment capability and Gate 4 workflow.

## Output

Return bounded least-privilege design decisions and unresolved access requirements through APEX MCP artifacts.
