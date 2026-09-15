# Bicep And Terraform Tracks

> [Current Version](../../VERSION.md) | Equivalent governed outcomes with track-specific execution mechanics.

## Shared Contract

Each run selects exactly one IaC track. Both tracks consume the same approved requirements, architecture, governance,
policy map, and implementation intent. Both must produce typed bindings, generated files, validation evidence, an exact
preview, approval evidence, an operation record, and inventory.

A track cannot reuse the other track's preview or approval.

## Resource Ownership

The logical-resource manifest distinguishes `existing` from `managed` ownership. Artifact staging and acceptance reject
contradictory declarations with `APEX_VALIDATION`: existing resources use Bicep `existing` declarations or Terraform
`data` sources, while managed resources use `resource` or `module` implementations. Cross-track reference kinds are
rejected. The owning predicate is
[`hasValidLogicalResourceReferences`](../../packages/contracts/src/targets.ts).

Preview requires a valid accepted manifest covering every intent resource. Only `managed` entries enter APEX's provider
apply/destroy request resource lists and simulated changes/inventory. Existing references remain in the accepted intent
and its hash binding. An all-existing workload has no simulated changes but still requires fresh deployment approval.

This check validates manifest consistency, not the truth of an ownership claim or the generated code. Binding supplied
platform resource identities to approved intent, native preview changes and cleanup remains follow-on work. An accepted
manifest does not grant authority to modify shared platform resources or bypass deployment approval.

## Differences

| Concern           | Bicep                               | Terraform                                                      |
| ----------------- | ----------------------------------- | -------------------------------------------------------------- |
| Validation        | `bicep build` and repository checks | `terraform init`, format, validate, and provider schema checks |
| Preview           | Azure CLI deployment what-if        | Saved Terraform plan plus JSON rendering                       |
| Apply             | Azure deployment create             | Apply the exact saved plan                                     |
| Preview lifetime  | Up to the configured Bicep TTL      | Up to the shorter configured Terraform TTL                     |
| State             | Azure deployment control plane      | Terraform backend; state must never be committed               |
| Provider metadata | Azure/Bicep schemas and AVM         | Installed provider schema and bounded Registry client          |

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
