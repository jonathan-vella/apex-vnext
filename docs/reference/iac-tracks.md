# Bicep And Terraform Tracks

> [Current Version](../../VERSION.md) | Equivalent governed outcomes with track-specific execution mechanics.

## Shared Contract

Each run selects exactly one IaC track. Both tracks consume the same approved requirements, architecture, governance,
policy map, and implementation intent. Both must produce typed bindings, generated files, validation evidence, an exact
preview, approval evidence, an operation record, and inventory.

A track cannot reuse the other track's preview or approval.

## Differences

| Concern | Bicep | Terraform |
| --- | --- | --- |
| Validation | `bicep build` and repository checks | `terraform init`, format, validate, and provider schema checks |
| Preview | Azure CLI deployment what-if | Saved Terraform plan plus JSON rendering |
| Apply | Azure deployment create | Apply the exact saved plan |
| Preview lifetime | Up to the configured Bicep TTL | Up to the shorter configured Terraform TTL |
| State | Azure deployment control plane | Terraform backend; state must never be committed |
| Provider metadata | Azure/Bicep schemas and AVM | Installed provider schema and bounded Registry client |

The shipped defaults currently define a longer Bicep preview TTL than Terraform. Any dependency, target, owner,
recipient, generated IaC, or provider change invalidates stale proof.

## Support Boundary

Deterministic and package qualification cover both tracks. Current-candidate live Azure qualification remains required
before claiming production readiness or release acceptance.

## Terraform Reference Operations

The Terraform Registry client performs bounded public metadata lookups with cache and status handling. Native provider
introspection reads installed provider schemas through Terraform; it does not grant deployment authority or replace
kernel validation.

## Authority

- [`config/workflow.v1.json`](../../config/workflow.v1.json)
- [`config/defaults.v1.json`](../../config/defaults.v1.json)
- [`packages/capabilities/src/command-plans.ts`](../../packages/capabilities/src/command-plans.ts)
- [`packages/capabilities/src/terraform-registry-client.ts`](../../packages/capabilities/src/terraform-registry-client.ts)

## Related

- [Operate a project](../how-to/operate-project.md)
- [Workflow and gates](../explanation/workflow-and-gates.md)
- [Qualification reference](qualification.md)
