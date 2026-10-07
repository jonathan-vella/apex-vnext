# APEX plugin changelog

Each `apex` plugin release published to the [apex-plugins marketplace](https://github.com/jonathan-vella/apex-plugins)
needs a section here headed `## [<version>]`. `npm run publish:plugin -- --apply` refuses to publish a version without
one, and clients only update when the version changes.

The plugin version is the `@apexops/cli` version in `packages/cli/package.json`; the build copies it into `plugin.json`.
Plugin and CLI therefore move in lockstep, and the plugin bundles the CLI release published to npm at that version.
When you prepare a release, rename `## [Unreleased]` to the new version.

## [Unreleased]

First marketplace release of APEX as one Agent Plugins 1.0 plugin.

- The APEX agent, hidden workers and skills from the managed customizations.
- The `apex` MCP server: the bundled `@apexops/cli` runtime as one esbuild bundle on the MCP TypeScript SDK v2, started
  with `node` from the plugin folder and needing no registry download.
- Managed hooks that deny the APEX agent as a task target.
