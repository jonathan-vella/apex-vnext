# Terraform MCP Registry-Only Characterization

This record characterizes the Terraform MCP dependency before replacement work. It does not authorize removal or change
Terraform lifecycle authority. The machine-readable source is
[`terraform-mcp-characterization.json`](../../tools/registry/terraform-mcp-characterization.json).

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

## Active Consumers

| Consumer                                 | Role                       | Current dependency                          |
| ---------------------------------------- | -------------------------- | ------------------------------------------- |
| `.vscode/mcp.json`                       | Active workspace discovery | Launches the registry-only stdio server     |
| `.devcontainer/post-create.sh`           | Installer                  | Shallow clone and local Go build            |
| `.devcontainer/post-start.sh`            | Fallback installer         | Rebuilds when the binary is absent          |
| `.devcontainer/README.md`                | Setup documentation        | Describes Go and Terraform MCP installation |
| `tools/scripts/validate-devcontainer.sh` | Compatibility check        | Requires a runnable version command         |
| `terraform-search-import` skill          | Import guidance            | Provider details and module discovery       |
| `terraform-test` skill                   | Test guidance              | Provider resource-type lookup               |
| Shared codegen workflow                  | Preflight guidance         | Module search, details, and latest version  |
| AVM module guidance                      | Version discovery          | Prefers Terraform MCP as one lookup path    |
| Terraform IaC instruction                | Version discovery          | Uses latest-module-version MCP lookup       |
| Terraform conventions                    | Version discovery          | Names the latest-module-version MCP tool    |
| Terraform patterns examples              | Version discovery          | Offers MCP or Registry lookup               |
| Shared contract/handoff guidance         | Schema cross-check         | Uses module details during handoff checks   |
| MCP config regression                    | Preservation test          | Retains Terraform while retiring servers    |

The provider configuration example in `docs/guides/operations.md` is not an MCP consumer. It configures APEX's native
Terraform preview/apply provider and remains outside this retirement.

## Replacement Owners

- Public Registry search, details, and versions: bounded Terraform Registry API client with deterministic fixtures,
  caching, pagination, and explicit unavailable results.
- Installed provider schemas: native `terraform providers schema -json` against the selected lock file and initialized
  provider set.
- Import syntax and resource guidance: official provider documentation, linked from the import workflow.

Issue #140 implements the bounded public Registry client in `@apex/capabilities`. It supports module search, module
details and stable versions, and provider stable versions with deterministic fixtures, bounded transport/cache behavior,
and explicit unavailable results. Active MCP consumers remain unchanged until native schema and documentation owners are
migrated and tested.

Issue #145 adds the bounded native provider-introspection owner in `@apex/capabilities`. It uses exact native schema and
version commands against an already initialized root, validates compatible output, preserves schema metadata, and routes
explicit resource/import slugs to version-pinned official provider documentation. Active consumers, MCP setup, and Go
remain unchanged until the following migration and retirement slice.

Native Terraform CLI and APEX Gate 4 remain the only lifecycle authorities. MCP output cannot initialize, inspect or
mutate state, create or substitute a saved plan, import resources, apply, destroy, or select workspaces.

## Removal Gate

Do not remove Terraform MCP, its setup, or Go until all declared consumers use passing replacements. The replacement
slice must preserve deterministic unavailable behavior, migrate active guidance, remove setup/config/version checks,
and prove that state, saved-plan, Gate 4, apply, and destroy behavior is unchanged.

## Validation

Run:

```bash
npm run validate:terraform-mcp-characterization
npm run test:terraform-mcp-characterization
```

The validator checks observed binary provenance constants, the full-schema fixture and all derived hashes, exact
registry-only tool summaries, current workspace configuration digest, the complete consumer inventory and markers, and
lifecycle denials without requiring the binary in CI.
