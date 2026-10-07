# Thick Workspace Projection Archive

CP-11 ([issue #377](https://github.com/jonathan-vella/apex-vnext/issues/377)) retired the copied agents, skills and
workspace `.mcp.json` from the `apex init` projection under DECISION-033 and the DECISION-015 gates (see
[DECISIONS.md](../../docs/vnext/DECISIONS.md)). The apex plugin now ships them. This folder is provenance only: no
build, test, package or runtime path reads it, and `tools/registry/retired-paths.v1.json` keeps
`customizations/.mcp.json` absent. The last commit with the thick projection is the parent of the CP-11 merge on `main`.

## Contents

- `customizations/.mcp.json`: the former workspace MCP config, with `apex` launched through `npx` and
  `azure-resource-manager-mcp` as a remote HTTP server.
- `excerpts/workspace-agent-projection.mjs.txt`: the role rendering removed from `prepare-assets.mjs` and the
  `.mcp.json` checks removed from `validate-vnext`.

Agent and skill sources did not move. They stay in `customizations/.github/agents/` and
`customizations/.github/skills/`, and `tools/scripts/build-plugin.mjs` renders and packages them.

## Gate evidence

- **Consumer migration.** `apex update` or `apex doctor --fix --yes` removes unedited copies, keeps edited copies in
  place, reports them as conflicts and records them in the lock's externally managed class.
- **Replacement proof.** `tools/tests/vnext/plugin-package.test.mjs` checks that every retired path has a plugin
  replacement and that plugin agents equal the renderer output the workspace copies used.
- **Archive provenance.** This folder and `tools/registry/retired-paths.v1.json`.
- **Rollback.** The steps below.
- **Negative reintroduction.** `prepare-assets.mjs`, the bundled asset verifier, `installCustomizations` and
  `validate-vnext` each reject plugin-owned paths in the workspace projection.

## Rollback

For one consumer workspace, run `apex customizations rollback` right after the update that retired the copies. It
restores the previous bundle from `.apex/customization-bases/`, including the copied agents, skills and `.mcp.json`,
removes the unedited `.github/copilot/settings.json` so the repository no longer enables the plugin, and leaves edited
copies untouched. An edited settings file is reported as a conflict and the previous lock is not restored until you
move it. To stay on the thick projection, pin the previous `@apexops/cli` release.

For the product, restoring the thick projection reverses part of DECISION-033 and needs a new maintainer decision:

1. Revert the CP-11 commits to restore role rendering in `prepare-assets.mjs`, the `.mcp.json` projection entry and
   its `validate-vnext` checks, and to drop the `plugin` manifest declaration and lock class.
2. Restore `customizations/.mcp.json` from this folder and remove it from `tools/registry/retired-paths.v1.json`.
3. Bump `CLIENT_ADAPTER_VERSION` and its literals, then run `npm run qualify:vnext`.
