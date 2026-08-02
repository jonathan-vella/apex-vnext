# Client Projections

> [Current Version](../../VERSION.md) | How one managed source becomes bounded VS Code and Copilot CLI experiences.

## Canonical Source

The managed source under `customizations/.github` defines shared coordinator, specialist, worker, skill, instruction, and
MCP content. `customizations/manifest.json` records files, roles, supported targets, interaction types, models, and
invocation edges.

`packages/cli/scripts/prepare-assets.mjs` validates and renders client-specific projections. Packaged assets are derived
output and must match canonical source.

## VS Code

The VS Code projection supports the coordinator and interactive requirements, architecture, planning, and operations
roles. It also supports autonomous code generation, review, and validation workers through bounded subagent delegation.

## GitHub Copilot CLI

The Copilot CLI projection supports the coordinator and interactive specialists. Autonomous workers are omitted because
the required hidden-but-delegable boundary is unavailable. The projection must not advertise or attempt those edges.

## Installation Lifecycle

`apex init` selects one bundled client projection and records that selection. `apex update` performs a managed three-way
update. Rollback, uninstall, and reinstall preserve unrelated files and report conflicts rather than overwriting user
content silently.

`apex bootstrap` is the common onboarding path for global CLI, one-shot `npx`, and Copilot-agent entry points. It pins
the runtime that workspace MCP configuration executes, then delegates workspace projection installation to `apex init`.
The optional VS Code profile bootstrap agent is deliberately outside the customization manifest and both client
projections. It is a discovery and command-launching aid only; it cannot own workspace MCP configuration or kernel
state.

## Support Versus Qualification

Generated projection tests prove deterministic shape and lifecycle behavior. Live support additionally requires exact
client discovery, MCP startup, routing, interaction, restart/resume, and outcome evidence bound to the candidate.

## Related

- [Client support](../reference/client-support.md)
- [Manage installation](../how-to/manage-installation.md)
- [Runtime architecture](runtime-architecture.md)
