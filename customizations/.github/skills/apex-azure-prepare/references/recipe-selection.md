<!-- ref:recipe-selection-v1 -->

# Recipe and Configuration Comparison

Adapted from `jonathan-vella/apex@c209d8bb765681aa21dce5d3cd2a3b080dad8d5e`.
Read [the authority boundary](kernel-boundary.md). The accepted selected-track binding wins;
workspace detection suggests questions, not an automatic track change.

| Configuration | Useful context | Static files | Execution boundary |
| --- | --- | --- | --- |
| azd + Bicep | Azure multi-service apps, environment/service packaging | `azure.yaml`, Bicep, service files | Planned CP-26; separate provisioning and service Gate 4 decisions |
| azd + Terraform | Terraform expertise with azd environment/service management | `azure.yaml` with `infra.provider: terraform`, HCL | Planned/unqualified; azd replans during provisioning, so native Terraform retains saved-plan authority |
| Azure CLI | Existing scripts, imperative service diagnostics, custom integration | Reviewed syntax and diagnostic queries | Read directly; mutations only through a supported bounded operation |
| Bicep | Azure-native declarative infrastructure | Bicep modules and accepted parameter binding | Current native Bicep preview/deploy track |
| Terraform | Accepted provider/module/state management | HCL, locks, backend and parameter binding | Current native saved-plan preview/deploy track |

azd can use Bicep or Terraform. Do not default every Terraform request to azd or imply CP-26 is delivered.
`azd up` is historical upstream context only; APEX never runs it.
Current azd package deployment and pipeline setup also have unresolved preview constraints;
see [known constraints](kernel-boundary.md#known-azd-constraints). Unsupported paths fail closed.

## Detection and Preservation

- `*.AppHost.csproj`/`Aspire.Hosting`: preserve AppHost-derived composition; see [Aspire](aspire.md).
  `azd init --from-code -e <environment>` is a local materialization example, not an independently authorized write.
- Existing `azure.yaml`: preserve accepted service names, provider and paths; reconcile changes through the task.
- Existing HCL, Bicep or `az` scripts: preserve authorized ownership and bindings; do not regenerate user work.
- A new application: ask relevant requirements/architecture questions and bind one accepted track.

Record rationale, infrastructure provider, application host, environment handling, packaging and pipeline intent as
typed task content. Multi-cloud capability, developer convenience and learning curve are trade-offs, not approval.
Static GitHub Actions generation is not `azd pipeline config` and does not authorize identities/RBAC/settings changes.

## Technical References

- [azd](recipes/azd/README.md), [Terraform with azd](recipes/azd/terraform.md)
- [Azure CLI](recipes/azcli/README.md), [Bicep](recipes/bicep/README.md),
  [Terraform](recipes/terraform/README.md)
