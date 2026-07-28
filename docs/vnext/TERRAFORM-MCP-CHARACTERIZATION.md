# Retired Terraform MCP Characterization

This historical record characterizes the Terraform MCP dependency retired by issue #147 after bounded replacements and
consumer migration passed. The original machine-readable evidence, schema, fixture, validator, tests, hashes, and
rollback procedure are preserved under
[`terraform-mcp/`](../../.archive/retired-automation/terraform-mcp/README.md).

## Observed Runtime

The devcontainer-provided binary reports version `1.1.0`. Its version command leaves the commit blank, but Go build
metadata attributes the clean binary to revision `5585f452bf7672bebccf2809dbcf0f88efbd2693`, pseudo-version
`v0.0.0-20260715173312-5585f452bf76`, and VCS time `2026-07-15T17:33:12Z`. Its CLI build date is the reproducible-build
epoch. The binary SHA-256 is
`4a5c40dde2c36ea01cbf47144495a1c4403951dd49cc205abaca726dffc8bd2f`.

Setup still shallow-clones the moving upstream default branch without a requested source revision. The observed binary
is source-attributed and byte-bound, but acquisition is not repeatably pinned. Replacement or parity work must not treat
the version string alone as sufficient provenance.

Workspace configuration exposes only the public `registry` toolset over stdio. The live `tools/list` response contains
provider, module, and policy search/details operations, latest provider/module version lookup, and provider capability
lookup. It contains no state, plan, import, apply, destroy, or workspace mutation operation.
The tracked `terraform-mcp-tools-list.fixture.json` preserves every observed input schema, including optional properties,
types, descriptions, enum values, defaults, and bounds. Summary hashes are derived from that fixture during validation.

## Migrated Consumers

| Consumer group | Retirement disposition |
| --- | --- |
| Workspace discovery | Server removed; config validation rejects renamed or disguised reintroduction. |
| Devcontainer setup and health checks | Clone, build, fallback install, and version checks removed. |
| Devcontainer Go feature | Removed after the active-consumer audit found no independent toolchain owner. |
| Import and test skills | Native installed-provider schemas and exact-version official documentation. |
| Codegen, AVM, Terraform, and handoff guidance | Exact contract pins, bounded Registry ownership, and freeze validation. |
| MCP config regression | Converted from preservation to negative retirement assertions. |

The provider configuration example in `docs/guides/operations.md` is not an MCP consumer. It configures APEX's native
Terraform preview/apply provider and remains outside this retirement.

## Replacement Owners

- Public Registry search, details, and versions: bounded Terraform Registry API client with deterministic fixtures,
  caching, pagination, and explicit unavailable results.
- Installed provider schemas: native `terraform providers schema -json` against the selected lock file and initialized
  provider set.
- Import syntax and resource guidance: official provider documentation, linked from the import workflow.

Issue #140 implemented the bounded public Registry client in `@apex/capabilities`. It supports module search, module
details and stable versions, and provider stable versions with deterministic fixtures, bounded transport/cache behavior,
and explicit unavailable results.

Issue #145 added the bounded native provider-introspection owner in `@apex/capabilities`. It uses exact native schema and
version commands against an already initialized root, validates compatible output, preserves schema metadata, and routes
explicit resource/import slugs to version-pinned official provider documentation. Issue #147 migrated active consumers,
removed discovery and setup, archived the characterization evidence, and installed negative retirement gates.

Native Terraform CLI and APEX Gate 4 remain the only lifecycle authorities. MCP output cannot initialize, inspect or
mutate state, create or substitute a saved plan, import resources, apply, destroy, or select workspaces.

## Retirement Gate

`validate:terraform-mcp-retirement` rejects active executable, source, tool, and Go-feature markers while verifying every
archived evidence hash and required provenance field. MCP config mutation tests independently reject renamed servers,
legacy paths, upstream source markers, and registry-toolset signatures.

## Validation

Run:

```bash
npm run validate:terraform-mcp-retirement
npm run test:terraform-mcp-retirement
```

The active retirement validator checks archived provenance and forbidden active markers. Native Terraform lifecycle and
Gate 4 tests remain the authority for state, saved-plan, apply, destroy, and workspace behavior.
