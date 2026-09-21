# Bicep Infrastructure

Agent instructions specific to the `infra/bicep/` subtree.

## SKU Source of Truth

Read `agent-output/{project}/sku-manifest.json` first. Never re-derive
creative SKUs (App Service plan, VM, SQL, Cosmos, AKS pool, Redis, APIM,
App Gateway, Storage replication) from `04-implementation-plan.md`
prose. Each Bicep resource maps to a `services[].iac_logical_names.bicep`
entry; per-environment overrides come from
`services[].environment_overrides.{env}`. See
[workload decision SSOT](../../docs/reference/sources-of-truth.md).

## Authentication Prerequisites

`az` authentication is required only for explicitly authorized native provider operations. Confirm its current WSL
session before a preview or deployment; ordinary builds and linting remain credential-free.

| Tool | Token cache | Validate with |
| --- | --- | --- |
| `az` | `~/.azure/` | `az account get-access-token --resource https://management.azure.com/ --output none` |

```bash
# Step 1 — Azure CLI (az account show is NOT sufficient; must get a real token)
az account get-access-token \
  --resource https://management.azure.com/ --output none

```

## Build Commands

```bash
# Validate a project's templates
bicep build infra/bicep/{project}/main.bicep
bicep lint infra/bicep/{project}/main.bicep

# Kernel-authorized native lifecycle
apex preview --provider bicep --operation apply
# Approve the required gate, then use the authorized deployment operation.
apex deploy
```

## Module Structure

Each project follows this layout:

```text
infra/bicep/{project}/
  main.bicep           # Orchestrator — parameters, unique suffix, module calls
  main.bicepparam      # Parameter values
  modules/
    *.bicep            # One module per resource or logical group
```

## Conventions

- **AVM-first**: Use `br/public:avm/res/{provider}/{resource}:{version}` for all resources that have an AVM module
- **Unique suffix**: Generate `uniqueString(resourceGroup().id)` once in `main.bicep`, pass to all modules
- **Tags**: Use the live Azure Policy tag contract. When no contract exists, use the canonical lowercase fallback in
  the repository Azure defaults guidance.
- **Parameters**: Use `@description()` decorator on every parameter
- **Security**: TLS 1.2, HTTPS-only, managed identity, no public blob access, Azure AD-only SQL auth
- **No hardcoded secrets**: Use Key Vault references for sensitive values
- **Diagnostics**: Send logs to Log Analytics workspace; use AVM diagnostic settings pattern

## Governance

Before generating templates, always check `agent-output/{project}/04-governance-constraints.md`
for subscription-level Azure Policy requirements that may impose additional rules.
