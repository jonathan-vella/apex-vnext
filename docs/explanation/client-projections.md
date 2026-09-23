# Client Projections

> [Current Version](../../VERSION.md) | How one managed source becomes the Copilot CLI experience in the terminal and
> in VS Code.

## Canonical Source

The managed source under `customizations/.github` defines the coordinator, specialists, workers, skills and
instructions; `customizations/.mcp.json` defines workspace MCP. `customizations/manifest.json` records files, roles,
the supported target, interaction types, models, and invocation edges.

`packages/cli/scripts/prepare-assets.mjs` validates the sources and renders the single `github-copilot-cli` projection.
Packaged assets are derived output and must match canonical source.

## Consumer Guidance

Managed consumer skills retain Azure design, planning, validation, operations, identity, migration, Terraform, artifact,
and inline-diagram guidance through progressive references. They use accepted task context and capability-produced
evidence; direct cloud operations, repository mutation, approval, and deployment remain kernel- or CLI-owned. The
versioned [guidance migration matrix](../../tools/registry/guidance-migration.v1.json) records the disposition of each
root skill and instruction, including repository-only and deferred surfaces.

## One Projection, Two Hosts

Managed agents use Copilot CLI frontmatter: exact CLI model IDs, `model-policy` (`required` for workers, `preferred`
for interactive agents) and `reasoning-effort`. Standalone Copilot CLI and the VS Code Copilot harness run the same
projection; `github-copilot-vscode` remains only the evidence identity for VS Code runs. The VS Code Local projection is
retired and archived under `.archive/vscode-projection/`.

The coordinator and interactive specialists run as foreground agents, because only a foreground agent can ask
questions. CodeGen, Reviewer and Validator are hidden workers that run through `task` delegation with kernel task
context, not repository instructions. Direct-selection visibility is not an authorization boundary; kernel task,
evidence, ownership and approval checks remain authoritative.

## Routing With apex-next

Handoff buttons are gone. The `apex-next` skill reads kernel status and the next task and names the owning agent. It
delegates a hidden worker, or prints the selection step (`/agent <name>` in Copilot CLI, the Agent picker in VS Code)
with a ready-to-paste scope prompt. The coordinator routes through it, and other agents may use it for stage
transitions.

## Built-In Helpers

Planner and Operator may use the built-in Explore agent for read-only questions about named workspace paths. Other
built-in helpers inherit the calling agent's full tool set, so managed agents do not use them. You can still run
`/review`, `/security-review` or `/research` yourself. Helper output is advisory: it never becomes kernel evidence,
completes a task or approves a gate.

## Installation Lifecycle

`apex init` installs the CLI projection and records it in the managed lock. `apex update` performs a managed three-way
update. Rollback, uninstall, and reinstall preserve unrelated files and report conflicts rather than overwriting user
content silently.

`apex bootstrap` is the common onboarding path for global CLI, one-shot `npx`, and Copilot-agent entry points. It pins
the runtime that `.mcp.json` launches, then delegates projection installation to `apex init`.

This is the current npm-managed mechanism. [The roadmap](../vnext/ROADMAP.md#phase-6-distribution-last) defers Agent
Plugins evaluation until feature completion and couples it with APEX MCP redistribution. A plugin format alone does
not prove workspace selection, credential handling, runtime compatibility or rollback. Do not maintain a second set of
editable agents/skills or introduce duplicate MCP registrations during a future migration.

## Support Versus Qualification

Generated projection tests prove deterministic shape and lifecycle behavior. Live support additionally requires exact
client discovery, MCP startup, routing, interaction, restart/resume, and outcome evidence bound to the candidate.

## Related

- [Client support](../reference/client-support.md)
- [Manage installation](../how-to/manage-installation.md)
- [Runtime architecture](runtime-architecture.md)
