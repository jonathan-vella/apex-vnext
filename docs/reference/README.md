# Reference

> [Current Version](../../VERSION.md) | Exact APEX vNext interfaces, support boundaries, and contracts.

Use reference pages to look up implemented behavior. For procedures, use the [how-to guides](../how-to/).

## Product Surfaces

- [Client support](client-support.md) — implementation and qualification status by client
- [CLI commands](cli.md) — direct command groups, required inputs, and exit codes
- [MCP tools](mcp.md) — tools exposed to supported Copilot clients
- [Configuration and contracts](configuration.md) — versioned runtime inputs and persisted schemas
- [Sources of truth](sources-of-truth.md) — repository and consumer-workspace authority boundaries
- [Bicep and Terraform](iac-tracks.md) — equivalent outcomes and track-specific mechanics
- [Qualification](qualification.md) — deterministic, package, client, live, and release evidence

## Authority

Reference content is derived from source packages and versioned configuration. For repository-development and release
concerns, use [Project controls](../vnext/README.md). For an initialized consumer workspace, kernel-managed `.apex/`
state is authoritative. When prose and source disagree, the identified source is authoritative.

## Related

- [Documentation index](../README.md)
- [Runtime architecture](../explanation/runtime-architecture.md)
- [Project controls](../vnext/README.md)
