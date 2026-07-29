# Managed Custom-Agent Contract Plan

> **Status:** Planned under issue [#175](https://github.com/jonathan-vella/apex-vnext/issues/175). This plan does not
> authorize agent, model, tool, role, deployment, publication, or release changes.

## Purpose

Align canonical APEX agents and generated client projections with the current VS Code and GitHub custom-agent
contracts. Preserve one semantic role graph while emitting only the frontmatter and mechanics supported by the selected
client.

The managed source remains reusable across GitHub Copilot in VS Code and GitHub Copilot CLI. A missing `target` in that
source is therefore intentional: the official contract defines omission as availability in both environments. Generated
single-client projections should state `target: vscode` or `target: github-copilot` explicitly.

## Documented Contract

| Property or behavior           | Current official behavior                                                                                    | APEX planning decision                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `target`                       | Accepts `vscode` or `github-copilot`; omission defaults to both environments.                                | Omit in shared source; require the matching value in each generated single-client projection.                               |
| `model`                        | VS Code accepts one model or a prioritized list; the GitHub contract specifies one model.                    | Retain source priority lists for VS Code and render one manifest-selected model for Copilot CLI.                            |
| `tools`                        | Missing means all tools, an empty list means none, and unknown names are ignored.                            | Continue explicit least-privilege lists and fail validation on unknown managed tools instead of relying on ignore behavior. |
| `agents`                       | VS Code uses the list to constrain available subagents and requires the agent tool.                          | Preserve in VS Code projections; derive Copilot CLI delegation from manifest edges and native `task` mechanics.             |
| `user-invocable`               | Controls whether users can select an agent.                                                                  | Keep interactive roles selectable and hidden workers non-user-invocable.                                                    |
| `disable-model-invocation`     | Controls model-initiated use; its exact effect differs between VS Code subagents and GitHub cloud selection. | Encode role intent only after explicit delegation is characterized in both supported clients.                               |
| `infer`                        | Retired in favor of the independent visibility fields.                                                       | Reject it in canonical and generated managed agents.                                                                        |
| `argument-hint` and `handoffs` | Used by VS Code and ignored by Copilot cloud agent.                                                          | Keep in VS Code projections and omit from Copilot CLI projections.                                                          |
| `mcp-servers` and `metadata`   | GitHub-specific and unused by VS Code agents.                                                                | Do not add them to shared APEX agents; retain client MCP projections as the authority.                                      |
| `hooks`                        | Agent-scoped VS Code feature in preview.                                                                     | Defer until stable and separately characterized.                                                                            |

## Compatibility Boundaries

- `target: github-copilot` identifies the GitHub Copilot environment family. It is not a Copilot CLI versus Copilot
  cloud-agent discriminator and must not be cited as enforcement of the product's cloud-agent exclusion.
- Agent-local `mcp-servers` would create another configuration owner. `.vscode/mcp.json`, `.github/mcp.json`, the
  customization manifest, and generated client locks remain authoritative.
- Unknown tools are ignored by clients, but managed validation must fail closed so a misspelled least-privilege grant
  does not silently disappear.
- VS Code prompt-file tool lists take precedence over custom-agent tool lists. Any prompt that targets a managed APEX
  agent must be checked for grant broadening.
- Repository-level agent filenames override organization and enterprise definitions with the same filename. Client
  qualification must detect collisions and prove that each managed role is discovered exactly once.
- GitHub limits the agent body prompt to 30,000 characters. The repository line budget remains useful but is not a
  substitute for this byte-independent character limit.

## Role Projection Matrix

| Role class              | Canonical intent                                                          | VS Code projection                                                                                        | Copilot CLI projection                                                                  | Required proof                                                                                     |
| ----------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Coordinator             | User-selectable, manual routing, no worker delegation                     | `target: vscode`; retain `argument-hint`, direct `handoffs`, and VS Code question tool                    | `target: github-copilot`; scalar model; native question tool; no VS Code-only fields    | Manual selection works and no model-initiated coordinator invocation occurs.                       |
| Interactive specialists | User-selectable, direct transitions, declared hidden-worker access only   | `target: vscode`; retain handoffs, `agents`, model priorities, and bounded question access                | `target: github-copilot`; scalar model and manifest-derived `task` delegation           | Direct transitions and worker routing match manifest edges without tool widening.                  |
| Hidden workers          | Not user-selectable, no user questions, callable only by declared parents | `target: vscode`; preserve parent allowlists and the model-invocation setting required for subagent calls | `target: github-copilot`; preserve explicit `task` reachability and no manual selection | Undeclared parents fail; declared parents succeed; workers never appear as user-selectable agents. |

The current CLI renderer derives `disable-model-invocation: true` for non-user-invocable roles. Official wording can make
that combination appear unreachable. Do not change it from documentation alone: first test explicit `task` delegation
on the pinned CLI and VS Code subagent invocation on the pinned extension, then encode the observed valid combination as
a validator invariant.

## Implementation Slices

1. **Freeze field ownership.** Extend `customizations/manifest.json` with the intended environment set for each role.
   Validate that shared source omission and generated scalar targets encode that intent without duplicating role or edge
   authority.
2. **Render target-specific frontmatter.** Update `packages/cli/scripts/prepare-assets.mjs` so the VS Code projection
   emits `target: vscode` and the Copilot CLI projection emits `target: github-copilot`. Preserve VS Code model priority
   arrays and emit the manifest-selected scalar model for CLI.
3. **Characterize visibility and delegation.** Exercise coordinator, interactive specialist, and hidden-worker
   combinations of `user-invocable`, `disable-model-invocation`, `agents`, and native delegation. Correct the renderer
   only after the pinned-client behavior is captured.
4. **Keep MCP and tool authority singular.** Reject agent-local `mcp-servers` and `metadata` in shared managed agents.
   Continue deriving MCP availability from selected-client projections. Reject unknown tools and prompt-level grant
   broadening for prompts that name a managed agent.
5. **Strengthen validation.** Update agent, vNext, model-consistency, and assessment checks for allowed target values,
   retired `infer`, target-specific fields, scalar-versus-list model syntax, the prompt character limit, filename
   collisions, and contradictory visibility/delegation settings.
6. **Add mutation coverage.** Prove failures for a missing or wrong generated target, GitHub-only fields in VS Code,
   VS Code-only fields in CLI, hidden-worker selection, broken parent allowlists, retired fields, unknown tools, and
   oversized prompts. Preserve deterministic client locks and source-to-generated digests.
7. **Qualify both clients.** Extend `CLIENT-002`, `CLIENT-004`, and `CLIENT-005` evidence to record effective targets,
   discovered roles, field filtering, tool inventories, selection visibility, and declared delegation on one exact
   candidate.
8. **Update guidance and provenance.** Revise managed agent authoring instructions, client qualification guidance,
   generated asset metadata, and changelog only with the implementation slice that changes those owners.

## Expected File Owners

| Surface                                                | Planned responsibility                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `customizations/manifest.json`                         | Semantic role, supported-client intent, model, interaction type, cost tier, and invocation edges |
| `customizations/.github/agents/*.agent.md`             | Shared role body and cross-client frontmatter intent; no client-local MCP configuration          |
| `packages/cli/scripts/prepare-assets.mjs`              | Deterministic target-specific field and tool rendering                                           |
| `tools/scripts/validate-agents.mjs`                    | Source frontmatter, visibility, field, size, tool, handoff, and subagent invariants              |
| `tools/scripts/validate-vnext.mjs`                     | Manifest-to-source-to-projection parity and selected-client validity                             |
| `packages/cli/src/test/` and `tools/tests/`            | Projection, mutation, lifecycle, and regression coverage                                         |
| `docs/vnext/CLIENT-QUALIFICATION.md`                   | Live discovery, selection, MCP inventory, and delegation evidence contract                       |
| `.github/instructions/agent-authoring.instructions.md` | Author guidance after executable owners and tests land                                           |

## Acceptance Gates

- Canonical agents, manifest roles, and both generated projections agree on supported environments and invocation edges.
- Every generated agent has the correct explicit `target` and contains only fields supported by that projection.
- Interactive roles remain selectable; hidden workers remain hidden and reachable only through declared parents.
- Tool lists remain explicit and cannot be broadened unnoticed by a prompt or agent-local MCP configuration.
- Generated outputs, client locks, and provenance are deterministic and mutation-tested.
- Pinned VS Code and Copilot CLI sessions discover each intended role once and pass the affected client scenarios.
- No result is represented as Copilot cloud-agent support or as release authorization.

## Sources

- [VS Code custom agents][vscode-custom-agents]
- [GitHub custom-agent configuration][github-agent-config]
- [Creating custom agents for Copilot cloud agent][github-create-agent]

[vscode-custom-agents]: https://code.visualstudio.com/docs/agent-customization/custom-agents
[github-agent-config]: https://docs.github.com/en/copilot/reference/custom-agents-configuration
[github-create-agent]: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-custom-agents
