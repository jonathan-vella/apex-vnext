# Bounded Terraform Registry Client

`@apex/capabilities` provides a read-only `TerraformRegistryClient` for the public Terraform Registry subset selected to
replace Terraform MCP registry lookup. It does not expose arbitrary URLs or Terraform lifecycle operations.

## Supported Operations

- Search public modules with bounded query length, offset, and page size.
- Read one exact module version's summary and source.
- List stable module versions and select the latest stable version.
- List stable provider versions and select the latest stable version.

Provider documentation and import guidance remain owned by official provider documentation. Installed provider schemas
remain owned by `terraform providers schema -json`. Native Terraform CLI and APEX Gate 4 remain the only state, plan,
import, apply, destroy, and workspace authorities.

## Result Contract

Every operation returns one deterministic status:

- `ok`: validated normalized data, with a `cached` flag;
- `missing`: Registry returned `404`, distinct from availability failure;
- `invalid`: caller input or bounds are invalid and no transport is attempted; or
- `unavailable`: bounded timeout, throttling, transport, HTTP, response-size, JSON, or schema failure.

Unavailable results contain stable reason codes and do not project ambient response bodies or transport exception text.

## Bounds

The client fixes the origin to `https://registry.terraform.io`, validates every path segment, disables redirects, and
uses GET with an injected transport. Constructor options bound timeout, retries, retry delay, response bytes, cache TTL,
and cache entries. Search options additionally bound query length, offset, and page size.

The in-memory cache stores only `ok` and `missing` results. It expires entries by an injected clock and evicts the oldest
entry before exceeding its configured cardinality.

## Validation

Deterministic fixtures cover:

- module search, terminal pagination, details, and stable versions;
- provider stable versions;
- cache hits, expiry, and cardinality eviction;
- missing resources, throttling, malformed JSON/schema, timeout, and response limits; and
- invalid identifiers, request bounds, constructor bounds, and the absence of lifecycle/arbitrary-URL methods.

Run:

```bash
npm run build:vnext
npm --workspace @apex/capabilities test
```

A bounded live compatibility smoke test on 2026-07-27 returned normalized `ok` results for all four supported operations.
Live results are compatibility evidence only; deterministic fixtures own regression behavior.

## Retirement Status

Issue #147 migrated active consumers and retired Terraform MCP after native lifecycle parity passed. The prior
characterization, replacement owners, archive hashes, and rollback procedure are recorded in
[TERRAFORM-MCP-CHARACTERIZATION.md](TERRAFORM-MCP-CHARACTERIZATION.md). Active reintroduction is blocked by
`validate:terraform-mcp-retirement` and MCP config mutation tests.
