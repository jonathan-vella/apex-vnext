# Terraform Infrastructure

Agent instructions specific to the `infra/terraform/` subtree.

## SKU Source of Truth

Read `agent-output/{project}/sku-manifest.json` first. Never re-derive
creative SKUs (App Service plan, VM, SQL, Cosmos, AKS pool, Redis, APIM,
App Gateway, Storage replication) from `04-implementation-plan.md`
prose. Each Terraform resource maps to a
`services[].iac_logical_names.terraform` entry; per-environment overrides
come from `services[].environment_overrides.{env}`. See
[workload decision SSOT](../../docs/reference/sources-of-truth.md).

## Build Commands

```bash
# Format check
terraform fmt -check -recursive infra/terraform/

# Per-project validation
cd infra/terraform/{project}
terraform init -backend=false
terraform validate

# Full suite (all projects)
npm run validate:terraform

# Kernel-authorized native lifecycle
apex preview --provider terraform --operation apply
# Approve the required gate, then use the authorized deployment operation.
apex deploy
```

## Module Structure

Each project follows this layout:

```text
infra/terraform/{project}/
  main.tf              # Root module — providers, module calls
  variables.tf         # Input variables with descriptions and validations
  outputs.tf           # Output values
  terraform.tf         # Required providers and backend configuration
  locals.tf            # Local values (naming, tags, computed values)
  terraform.tfvars     # Variable values (not committed for sensitive data)
  modules/
    */                 # One module per resource or logical group
      main.tf
      variables.tf
      outputs.tf
```

## Conventions

- **AVM-first**: Use AVM-TF modules from `registry.terraform.io/Azure/avm-res-{provider}-{resource}/azurerm`
- **Provider pin**: `~> 4.0` for AzureRM
- **Backend**: Azure Storage Account
- **Unique suffix**: `random_string` resource (4 chars, lowercase, `special = false`, `upper = false`)
- **Tags**: Use the live Azure Policy tag contract. When no contract exists, use the canonical lowercase fallback in
  the repository Azure defaults guidance.
- **Variables**: Every variable must have a `description` and a `type`; use `validation` blocks where appropriate
- **Security**: TLS 1.2, HTTPS-only, managed identity, no public blob access, Azure AD-only SQL auth
- **No hardcoded secrets**: Use Key Vault data sources or `sensitive = true` variables
- **State**: Never commit `.tfstate` files; use remote backend

## Governance

Before generating configurations, always check `agent-output/{project}/04-governance-constraints.md`
for subscription-level Azure Policy requirements that may impose additional rules.
