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

### Exact Bicep Module Scope

Bicep AVM bindings can declare `physicalResources` as intended authorization scope. Each entry contains an exact
`resourceId`, ARM `type`, `ownership` (`managed` or `existing`), and `role` (`primary` or `ancillary`). A map contains
1-128 entries and exactly one managed primary matching the logical resource type. IDs must be within the run's exact
subscription/resource group; case-insensitive duplicates, collisions with native resources, expressions and wildcards
are rejected. Native bindings and Terraform bindings cannot use this field.

The Gate 3 binding document displays this scope. Native Bicep requests include only approved managed IDs, and material
what-if changes outside that exact set block preview. Observed deployment-stack inventory must contain only unique
approved managed IDs before deployment completion is recorded. Protected existing IDs are never added to the managed
set. Ancillary inventory entries retain distinct identities under their accepted logical parent.
Delete and replace previews are also rejected when an approved managed ID is an ancestor of a protected existing ID;
omitting the protected child from what-if does not authorize its implicit removal.

This declaration is not proof of resource existence, AVM expansion or policy compliance. Unknown child resources block
preview instead of inheriting permission from their parent. Nonempty policy maps still require source-bound native
property receipts; declaring physical IDs does not resolve module property expressions. Terraform module descendant
ownership and full AVM policy evaluation remain unsupported. No live Azure qualification is implied by offline tests.

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
