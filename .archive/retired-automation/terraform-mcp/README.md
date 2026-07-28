## Terraform MCP Characterization

This directory preserves the exact characterization evidence and validator retired after deterministic Registry and
native provider-introspection replacements were implemented and active consumers migrated.

- **Original paths:** preserved below `terraform-mcp/`.
- **Introduced by:** `69bac4e1d6e463a72d4a16111d1163ec30589094`.
- **Archived from:** `7b3dee20b2713430c7302f5cdfc7b4a19e5a73e4`.
- **Retirement issue:** [#147](https://github.com/jonathan-vella/apex-vnext/issues/147).

| Original path | SHA-256 |
| --- | --- |
| `tools/registry/terraform-mcp-characterization.json` | `5c7ad2e8094bb66cd33afea1ab63c5d193b5e524b6b18a57fe768080eb8d5643` |
| `tools/registry/terraform-mcp-tools-list.fixture.json` | `0559fd51a2c05f08c2f74c1b64591a2f74837e416eb73cb1904d9b76f3cbfaec` |
| `tools/registry/schemas/terraform-mcp-characterization.schema.json` | `419a2b3817349644d5033bcec71038687611ba19cecebfa9d667c39a84f352e2` |
| `tools/scripts/validate-terraform-mcp-characterization.mjs` | `f4554e616ed320acf17fa670ff8c9d81f4515afae82bf4a98dd33bd234e21d7d` |
| `tools/tests/validate-terraform-mcp-characterization.test.mjs` | `6e84643f78d14b012b40a4794a769aedb6b9292cd71eb7674637f295d68079b0` |

## Rationale

Terraform MCP exposed public Registry lookups but had no lifecycle authority. Its acquisition cloned a moving upstream
branch and built locally without a requested revision. The bounded replacement owners now provide deterministic input,
transport, response, cache, process, and documentation-routing contracts. Keeping the prior validator active would make
retired configuration an executable repository dependency.

## Replacement Owners

- `TerraformRegistryClient` in `@apex/capabilities` owns public module search, details, and versions.
- `TerraformProviderIntrospection` owns bounded installed-provider schema inspection and exact-version documentation
  routing through native read-only Terraform commands.
- Exact-version official Registry pages own module inputs, provider behavior, and import guidance.
- `validate:avm-versions:freeze` enforces exact AVM module pins.
- `validate:terraform-mcp-retirement` rejects active reintroduction and verifies these archived bytes.
- Native Terraform CLI and APEX Gate 4 remain the only lifecycle authorities.

## Rollback

1. Restore each file to its recorded original path without changing bytes.
2. Restore the characterization package scripts and validator-graph commands.
3. Restore setup and discovery only from a pinned, reviewed source revision.
4. Run characterization, MCP config, lifecycle, devcontainer, repository, and hosted exact-head validation.
5. Record why the bounded replacement owners no longer satisfy the required read-only behavior.
