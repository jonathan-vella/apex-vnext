# Native Terraform Provider Introspection

`@apex/capabilities` provides `TerraformProviderIntrospection` for bounded, read-only inspection of provider schemas
already selected by a caller-initialized Terraform root. It does not initialize, upgrade, fetch, or mutate that root.

## Native Commands

The API runs exactly these shell-free commands in the caller-selected working directory:

```text
terraform providers schema -json
terraform version -json
```

Ambient `TF_CLI_ARGS` and command-specific `TF_CLI_ARGS_*` variables are removed before execution so they cannot alter
the reviewed argument arrays. Each process has explicit timeout and combined-output limits. Both bounded operations
settle before the API returns.

## Result Contract

Operations return one deterministic status:

- `ok`: validated installed schema metadata or a version-pinned documentation route;
- `missing`: valid native output does not contain the requested provider or schema;
- `invalid`: caller input or configured bounds are invalid and no process starts; or
- `unavailable`: native execution, output size, JSON shape, format compatibility, or version correlation failed.

Unavailable results contain stable reason codes and never include ambient process errors or standard error content.

## Compatibility And Selection

The parser accepts compatible schema format `1.x`, ignores unknown additive properties, and fails closed on unsupported
format majors. Provider, resource, data-source, and list-resource schema entries must contain Terraform's versioned block
representation. Names and provider sources are sorted deterministically.

Registry provider versions come from native `provider_selections`. The built-in `terraform.io/builtin/terraform`
provider is retained with a null plugin version, and unrelated installed provider selections are ignored. Schema keys
that resemble credentials remain unchanged because schema standard output does not pass through value redaction.

## Documentation Routing

Documentation routes require an explicit Registry provider source, schema name, documentation kind, and slug. The API
does not guess slugs or fetch documentation. It returns only HTTPS URLs under `registry.terraform.io`, pinned to the
exact native provider selection:

```text
https://registry.terraform.io/providers/hashicorp/azurerm/4.81.0/docs/resources/storage_account
```

Official provider pages remain authoritative for arguments, resource behavior, and import guidance.

## Authority Boundary

This slice adds no Registry HTTP request, agent-facing tool, Terraform initialization, state inspection, import, plan,
apply, destroy, workspace operation, deployment, publication, release, tag, or cutover authority. Active Terraform MCP
consumers and setup remain unchanged until the separately tested consumer-migration and retirement slice.

## Validation

Deterministic tests cover exact command plans, bounds, schema compatibility, built-in and extra provider selections,
runtime-invalid input, malformed schema entries, process failures, sibling completion, environment isolation, explicit
documentation routes, secret-like schema keys, and absence of lifecycle or arbitrary-command methods.
