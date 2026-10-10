# APEX plugin changelog

Each `apex` plugin release published to the [apex-plugins marketplace](https://github.com/jonathan-vella/apex-plugins)
needs a section here headed `## [<version>]`. `npm run publish:plugin -- --apply` refuses to publish a version without
one, and clients only update when the version changes.

The plugin version is the `@apexops/cli` version in `packages/cli/package.json`; the build copies it into `plugin.json`.
Plugin and CLI therefore move in lockstep, and the plugin bundles the CLI release published to npm at that version.
When you prepare a release, rename `## [Unreleased]` to the new version.

## [Unreleased]

- Operations skills re-ported at the pinned upstream commit (CP-18/CP-21): full recipe/CLI/azd/SDK and service
  references, migration scenarios/runtime examples and inline Mermaid syntax. Script/workflow sources are
  non-executable references. Native-provider authority, task/evidence boundaries, the current runtime's Gate 4 and the
  unavailable status of the planned DECISION-036 flow (CP-26 to CP-30) are preserved; no deployment or Mermaid renderer
  capability is added.

- Azure design skills re-ported from `jonathan-vella/apex` (CP-18): trigger-rich descriptions, retail pricing, SKU
  availability and cost tool references, guidance aligned to the read-only `apex-azure-pricing` tools, and the upstream
  Azure CLI and azd commands. Read commands run directly; commands that change Azure route through `apex deploy` and
  Gate 4 or the approved GitHub Actions pipeline. APEX never runs `azd up`.

## [0.11.0-next.2] - 2026-10-09

Fixes a Copilot review finding on the second marketplace release pull request (closed without merging): the
apex-automation instruction now requires pinning third-party actions to a full commit SHA instead of a mutable major
version tag.

## [0.11.0-next.1] - 2026-10-09

Fixes 3 findings from the Copilot review on the first marketplace release pull request (closed without merging): the
preToolUse hook now fails closed on a missing script, the APEX CodeGen agent no longer carries an unused
`apex/completeTask` grant, and `apex-azure-quotas` no longer blocks an exact-fit quota request.

## [0.11.0-next.0] - 2026-10-08

First marketplace release of APEX as one Agent Plugins 1.0 plugin.

- The APEX agent, hidden workers (CodeGen and Validator) and skills from the managed customizations. Agents are rendered
  with the Copilot CLI client mechanics the workspace copies carried before `apex init` stopped copying them (CP-11).
  The built-in `rubber-duck` agent runs the Requirements, Architecture and Plan reviews; the APEX Reviewer worker is
  retired.
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
  pricing and cost tools from `tools/registry/arm-mcp-cost-pricing.v1.json`. They also capture kernel-requested
  rubber-duck reviews as signed records for the kernel, and deny state-changing APEX tools to rubber-duck while it runs.
- The `apex` MCP server refuses a workspace whose `.apex/apex.lock.json` names another `@apexops/cli` version with
  `APEX_RUNTIME_MISMATCH`; `status` reports the mismatch read-only. Run `apex update` for an older workspace, or
  install the plugin version that matches a newer one (CP-25).
- The manual-only `apex-unslop` skill (`/apex-unslop`): polishes prose you ask it to without changing facts,
  identifiers or APEX file contracts, and never edits kernel-managed artifacts.
