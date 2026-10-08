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
- PNG diagrams on `linux-x64` (glibc) and `win32-x64` hosts: the plugin ships the prebuilt `@resvg/resvg-js` 2.6.2
  binaries under `native/resvg-js/` with their MPL-2.0 license and loads one only when its SHA-256 matches the hash
  pinned in the bundle. Other platforms, musl Linux and altered binaries fall back to Python and SVG diagrams and report
  PNG as unavailable. The binaries add about 8.5 MB to the package.
- Managed hooks that deny the APEX agent as a task target, and every `apex-azure-pricing` tool except the read-only
  pricing and cost tools from `tools/registry/arm-mcp-cost-pricing.v1.json`.
