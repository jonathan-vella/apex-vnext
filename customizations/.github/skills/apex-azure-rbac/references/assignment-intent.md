# Assignment Intent Fields

Represent a future role assignment as typed intent, not direct execution.

| Field | Purpose |
| --- | --- |
| Principal purpose | Workload function that needs access; never a secret or physical principal identifier. |
| Required operation | Narrow action or data access requirement. |
| Role requirement | Built-in role name/definition requirement, or explicit unresolved custom-role need. |
| Scope rationale | Why resource, resource-group, or subscription scope is necessary. |
| Requirement traceability | IDs of requirements served by the access. |
| Evidence references | Governance, identity, or role-definition evidence hashes. |
| Delivery path | Selected IaC binding or explicitly approved capability. |

## Delivery Constraint

Role assignment changes must be represented through the selected IaC binding and approved deployment workflow. Do not
produce Azure CLI commands, raw Bicep/Terraform role-assignment resources, custom-role JSON, or credential material in
the advisory skill output.
