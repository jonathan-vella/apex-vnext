# Hidden-Worker Visibility And Delegation Characterization

> **Status:** Characterized under issue [#179](https://github.com/jonathan-vella/apex-vnext/issues/179). The observed
> clients do not authorize a visibility-field change or release claim.

## Outcome

GitHub Copilot CLI `1.0.73` does not provide a demonstrated custom-agent field combination that makes an APEX worker
both unavailable for direct user selection and available for explicit `task` delegation. The current generated worker
combination is directly selectable but absent from the `task.agent_type` catalog.

VS Code behavior was not executed because the installed VS Code version is `1.131.0`, not the selected `1.130.0`, and
Copilot Chat producer metadata was unavailable from the remote extension inventory. The VS Code side is therefore
`unavailable`, not failed or inferred.

Issue [#180](https://github.com/jonathan-vella/apex-vnext/issues/180) owns the required design decision. No projection
flag should change until that issue selects an evidence-backed worker architecture.

## Official Semantics

| Surface                                  | Documented behavior                                                                                                                        | Characterization implication                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| VS Code `user-invocable: false`          | Removes an agent from direct user selection while leaving it available as a subagent.                                                      | Matches the intended hidden-worker boundary.                          |
| VS Code `disable-model-invocation: true` | Prevents general model-driven subagent invocation.                                                                                         | A parent `agents` allowlist can explicitly override this setting.     |
| VS Code `agents`                         | Restricts the custom agents available to a parent; an explicit entry overrides model-invocation disablement.                               | Supports declared-parent access but requires pinned live proof.       |
| Copilot CLI custom-agent `infer`         | Controls whether the main agent can auto-delegate to the custom agent.                                                                     | Does not document direct-selection hiding.                            |
| Copilot CLI `task`                       | Exposes an `agent_type` enum containing available built-in and project agents.                                                             | Catalog membership determines explicit model delegation reachability. |
| Cross-environment fields                 | GitHub's common configuration reference describes independent visibility fields, while the CLI-specific reference still documents `infer`. | Pinned-client behavior must win over cross-environment assumptions.   |

Sources:

- [VS Code custom agents][vscode-custom-agents]
- [VS Code subagents][vscode-subagents]
- [GitHub custom-agent configuration][github-agent-config]
- [Copilot CLI custom agents][copilot-cli-agents]

## Environment Binding

| Input                          | Expected                                                           | Observed                                                           | Disposition                           |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------- |
| Repository head                | `73c25c6e2feb943223606e2a92880d02c70051d0`                         | Same                                                               | Bound                                 |
| Customization manifest SHA-256 | `1d1a6b81779e7e623b17a46932a3f0ad2844a00e6c3ee2500b3ce4d7cb4e9d9d` | Same                                                               | Bound                                 |
| CLI inventory SHA-256          | `750eed0ea06eddb847231745334c667a18efd21f2c914b76416e4b58ac7dd970` | Same                                                               | Bound                                 |
| Copilot CLI version            | `1.0.73`                                                           | `1.0.73`                                                           | Version matched                       |
| Copilot CLI binary SHA-256     | `d47d8fe63b4a4bd6f0f7cd1ed4074ffff9f4b90c78df61f8513e99e098490c33` | `08892391ed7f6bd71ea0d19695a87e871caff72d37986d2313f9bb2d7f5ba91f` | Binary mismatch; non-release evidence |
| VS Code version                | `1.130.0`                                                          | `1.131.0`                                                          | Unavailable for qualification         |
| Copilot Chat version           | `0.58.0`                                                           | Not exposed in the remote extension inventory                      | Unavailable for qualification         |

The CLI binary mismatch means these observations characterize behavior only. They do not satisfy `CLIENT-002` or
`CLIENT-005` release evidence.

## Probe Boundary

The disposable workspace contained only fixed-marker custom agents. Built-in MCP servers, repository instructions,
workspace MCP servers, shell tools, file tools, remote access, and automatic updates were disabled. No APEX source,
credentials, Azure resources, or mutating tools were exposed.

Raw prompts, responses, tool arguments, tool results, and telemetry are not committed. The retained matrix below contains
only frontmatter controls, catalog membership, boolean outcomes, and fixed non-sensitive markers.

## Result Matrix

| Variant                           | Frontmatter controls                                       | Direct `--agent` selection | Present in `task.agent_type` | Explicit `task` result               |
| --------------------------------- | ---------------------------------------------------------- | -------------------------- | ---------------------------- | ------------------------------------ |
| Current projected worker          | `user-invocable: false`, `disable-model-invocation: true`  | Accepted                   | No                           | Child invocation did not start       |
| Model-callable worker             | `user-invocable: false`, `disable-model-invocation: false` | Accepted                   | Yes                          | Returned fixed marker                |
| CLI-documented disabled inference | `infer: false`                                             | Accepted                   | No                           | Not callable through catalog         |
| Parent control                    | default inference, `task` tool                             | Accepted                   | Yes                          | Could call the model-callable worker |

The initial current-worker parent probe selected the parent again because the requested child was absent from the task
enum and then reached the configured nesting limit. Content-free telemetry recorded only the parent agent, a `task` call,
and failure; no child `invoke_agent` span existed. The model-callable control returned its fixed marker through `task`,
proving that catalog membership was the discriminating condition.

## Findings

1. `user-invocable: false` did not prevent direct `--agent` selection in the observed CLI.
2. `disable-model-invocation: true` and `infer: false` both removed the agent from the task catalog.
3. `disable-model-invocation: false` restored explicit task reachability but did not prevent direct selection.
4. No tested CLI field combination satisfied both hidden selection and explicit parent-callability.
5. The current CLI projection cannot complete declared hidden-worker delegation as designed.
6. VS Code documentation supports the intended boundary through parent allowlists, but live proof remains unavailable on
   the exact selected client pair.

## Decision Gate

Issue #180 must choose among these bounded options:

- accept CLI-selectable internal workers with kernel-enforced authority and revise the parity contract;
- use bounded generic `task` prompts instead of project custom-agent worker profiles;
- re-pin to a client that independently controls user selection and model/task invocation; or
- keep the Copilot CLI workflow unavailable until the required boundary is supported.

The decision must include threat analysis, declared-parent success, undeclared-parent denial, tool/model preservation,
typed outcome parity, exact client hashes, clean installation, and rollback proof.

## Resolution

ADR-0006 selects the fail-closed option. Autonomous workers are omitted from the Copilot CLI projection until an exact
supported CLI independently enforces direct-selection hiding and declared-parent invocation. Exact official CLI
`1.0.75` reproduced the `1.0.73` gap, so re-pinning did not resolve it. Generic tasks were rejected because they lose
profile-bound model, tool, and role identity; directly selectable workers were rejected because the kernel does not
authenticate the initiating client-agent profile.

The manifest now owns target support per role. Generation, verification, installation, update, rollback, uninstall,
and reinstall preserve worker absence for CLI while retaining workers for VS Code.

## Release Impact

- `CLIENT-002`: CLI discovery must prove omitted workers are absent from files, locks, selection, and task catalogs.
- `CLIENT-005`: unavailable for CLI while autonomous workers are omitted.
- ADR-0005 remains Proposed.
- ADR-0006 records the fail-closed worker boundary.
- Paired client qualification and final cutover remain blocked.

[vscode-custom-agents]: https://code.visualstudio.com/docs/agent-customization/custom-agents
[vscode-subagents]: https://code.visualstudio.com/docs/agents/subagents
[github-agent-config]: https://docs.github.com/en/copilot/reference/custom-agents-configuration
[copilot-cli-agents]: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#custom-agents-reference
