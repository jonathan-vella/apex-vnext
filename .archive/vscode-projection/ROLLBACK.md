# VS Code Local Projection Archive

Slice 8 of [DECISION-029](../../docs/vnext/DECISIONS.md#decision-029-ship-one-copilot-cli-projection) retired the
VS Code Local projection on 2026-09-23 (issue #348, PR #350). This folder is provenance only: no build, test, package
or runtime path reads it, and `tools/registry/retired-paths.v1.json` keeps the former live paths absent. `excerpts/`
holds removed code blocks as plain text.

## Contents

| Archived path                                             | Former live source                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `customizations/.github/agents/*.agent.md`                | VS Code-format agent sources at `a74e058`, before slice 3        |
| `customizations/.vscode/mcp.json`                         | Managed VS Code MCP config: APEX, ARM MCP and the Azure MCP shim |
| `.github/instructions/references/agent-file-structure.md` | VS Code custom-agent frontmatter reference                       |
| `tools/scripts/_lib/managed-handoffs.mjs`                 | Handoff and agent-allowlist lint behind `lint:workflow-handoffs` |
| `packages/cli/src/azure-mcp*.ts` and its test             | Azure MCP launcher used only by the VS Code MCP config           |
| `tools/scripts/validate-azure-mcp-latest.mjs`             | `@azure/mcp` freshness check (`validate:azure-mcp-latest`)       |
| `excerpts/render-vscode-projection.mjs.txt`               | VS Code branch of `renderClientAgentProjection`                  |
| `excerpts/profile-bootstrap-*.ts.txt`                     | `apex profile` commands and the VS Code profile bootstrap agent  |
| `excerpts/vscode-mcp-validation.mjs.txt`                  | `validate-vnext` checks for `customizations/.vscode/mcp.json`    |
| `excerpts/local-only-tests.mjs.txt`                       | Tests for the profile agent, handoff lint and VS Code MCP config |
| `excerpts/vscode-lifecycle-001.json`                      | Profile bootstrap scenario of the VS Code lifecycle matrix       |

## Rollback

Restoring VS Code Local reverses DECISION-029 and needs a new maintainer decision. The last commit with the live
projection code is `9c3a459`; the slice 8 commit removes it.

1. Revert the slice 8 commit to restore the renderer branch, `profile` commands, VS Code MCP config and checks, the
   handoff lint, the Azure MCP launcher and its `@azure/mcp` dependency.
2. Restore VS Code agent sources from `customizations/.github/agents/` here, or revert slice 3 (`9f79725`).
3. Re-admit `github-copilot-vscode` as an installable client (slices 2 and 4: `a89d79c`, `b0ea737`) and add the
   `vscode` target back to the manifest roles and projections.
4. Remove the restored paths from `tools/registry/retired-paths.v1.json`, then run `npm run qualify:vnext`.
