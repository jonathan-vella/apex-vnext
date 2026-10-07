# APEX plugin changelog

Each `apex` plugin release published to the [apex-plugins marketplace](https://github.com/jonathan-vella/apex-plugins)
needs a section here headed `## [<version>]`. `npm run publish:plugin -- --apply` refuses to publish a version without
one, and clients only update when the version changes.

The plugin version is the `@apexops/cli` version in `packages/cli/package.json`; the build copies it into `plugin.json`.
Plugin and CLI therefore move in lockstep, and the plugin bundles the CLI release published to npm at that version.
When you prepare a release, rename `## [Unreleased]` to the new version.

## [Unreleased]

First marketplace release of APEX as one Agent Plugins 1.0 plugin.

- The APEX agent, hidden workers and skills from the managed customizations. Agents are rendered with the Copilot CLI
  client mechanics the workspace copies carried before `apex init` stopped copying them (CP-11).
- The `apex` MCP server: the bundled `@apexops/cli` runtime as one esbuild bundle on the MCP TypeScript SDK v2, started
  with `node` from the plugin folder and needing no registry download.
- The `apex-azure-pricing` MCP server: Azure Resource Manager MCP over streamable HTTP with the `CostManagement` and
  `Pricing` toolsets. It replaces `azure-resource-manager-mcp` from the retired workspace `.mcp.json`; agent tool
  references use `apex-azure-pricing/<tool>`.
- Managed hooks that deny the APEX agent as a task target, and every `apex-azure-pricing` tool except the read-only
  pricing and cost tools from `tools/registry/arm-mcp-cost-pricing.v1.json`.
