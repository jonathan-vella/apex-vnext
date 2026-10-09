# Client Projections

> [Current Version](../../VERSION.md) | How one managed source becomes the Copilot CLI experience in the terminal and
> in VS Code.

## Canonical Source

The managed source under `customizations/.github` defines the single foreground APEX agent, hidden workers, skills,
instructions and the plugin settings file. `plugin/mcp.json` defines the plugin's MCP servers: `apex` and
`apex-azure-pricing`. `customizations/manifest.json` records workspace files, the plugin declaration and the files it
owns, roles, the supported target, interaction types and invocation edges.

`packages/cli/scripts/prepare-assets.mjs` validates the sources and generates the thin `github-copilot-cli` workspace
projection. `tools/scripts/build-plugin.mjs` renders the agents with the same Copilot CLI renderer and packages them
with the skills, hooks and MCP servers into the `apex` plugin. Packaged assets are derived output and must match
canonical source.

The plugin cannot restrict which tools a remote MCP server exposes, and the `CostManagement` toolset includes writes
such as budget creation. A managed `preToolUse` hook therefore denies every `apex-azure-pricing` tool that is not in
the read allowlist of `tools/registry/arm-mcp-cost-pricing.v1.json`, for every agent in the session.

## Consumer Guidance

Managed consumer skills retain Azure design, planning, validation, operations, identity, migration, Terraform, artifact,
and inline-diagram guidance through progressive references. They use accepted task context and capability-produced
evidence; direct cloud operations, repository mutation, approval, and deployment remain kernel- or CLI-owned. The
versioned [guidance delivery registry](../../tools/registry/guidance-delivery.v1.json) records current managed ownership,
retained maintainer entrypoints and all deferred obligations.

## One Projection, Two Hosts

Managed agents use Copilot CLI frontmatter without model pins: no `model`, `model-policy` or `reasoning-effort`. Each
session uses the model the user picks (DECISION-033). Standalone Copilot CLI and the VS Code Copilot harness run the same
projection; `github-copilot-vscode` remains only the evidence identity for VS Code runs. The VS Code Local projection is
retired and archived under [archive catalog](../../.archive/CATALOG.json) (entry `.archive/vscode-projection/ROLLBACK.md`).

The `APEX` agent is the only foreground managed agent, because only foreground APEX may ask questions. CodeGen and
Validator are hidden workers that run through `task` delegation with kernel task context, not repository instructions.
The Requirements, Architecture and Plan reviews run in Copilot's built-in `rubber-duck` agent; a managed hook captures
its output and the kernel derives the findings (DECISION-031). Direct-selection visibility is not an authorization
boundary; kernel task, evidence, ownership and approval checks remain authoritative.

## Routing With apex-next

Handoff buttons and specialist switches are gone. The `apex-next` skill reads kernel status and the next task, then
maps the owner role to a stage skill for the same APEX agent or to one hidden worker. It carries the user's requested
outcome to the next stop point and stops while a gate is pending.

## Built-In Helpers

APEX may use the built-in Explore agent for read-only questions about named workspace paths. Other built-in helpers
inherit the calling agent's full tool set, so managed agents do not use them. You can still run
`/review`, `/security-review` or `/research` yourself. Helper output is advisory: it never becomes kernel evidence,
completes a task or approves a gate.

## Installation Lifecycle

`apex init` writes a thin workspace projection and records it in the managed lock:

- `.github/copilot/settings.json`, whose `enabledPlugins` and `extraKnownMarketplaces` entries make Copilot install
  `apex@apex-plugins` from the [apex-plugins](https://github.com/jonathan-vella/apex-plugins) marketplace;
- instructions with `applyTo` globs and `.github/copilot-instructions.md`;
- the governance workflow, script and schema;
- `.apex/` with the runtime, lock and project state.

The plugin owns the agents, skills and MCP servers, so `apex init` copies no `.github/agents/`, `.github/skills/` or
`.mcp.json`. The lock records them in an `externally-managed` class: `doctor` neither checks nor repairs them, and a
customization source that tries to copy one is rejected. `apex update` performs a managed three-way update. Rollback,
uninstall, and reinstall preserve unrelated files and report conflicts rather than overwriting user content silently.

`apex update` and `apex doctor --fix --yes` migrate a workspace from the earlier thick projection. They remove copied
agents, skills and `.mcp.json` the user did not edit. Edited copies stay in place, are listed in `conflicts` and in the
lock's `retained` entries, and `doctor` reports each one until you move or delete it, because a workspace copy would
shadow the plugin's file. The [archive](../../.archive/CATALOG.json)
(entry `.archive/thick-workspace-projection/ROLLBACK.md`) records the retired
surface and its rollback.

`apex bootstrap` is the common onboarding path for global CLI, one-shot `npx`, and Copilot-agent entry points. It pins
the runtime, then delegates projection installation to `apex init`.

## Support Versus Qualification

Generated projection tests prove deterministic shape and lifecycle behavior. Live support additionally requires exact
client discovery, MCP startup, routing, interaction, restart/resume, and outcome evidence bound to the candidate.

## Related

- [Client support](../reference/client-support.md)
- [Manage installation](../how-to/manage-installation.md)
- [Runtime architecture](runtime-architecture.md)

Historical restoration follows the [restore guide](../../.archive/RESTORE.md), never an archive-backed runtime path.
