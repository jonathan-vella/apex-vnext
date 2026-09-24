# Client Support

> [Current Version](../../VERSION.md) | Implementation and qualification boundaries for APEX vNext clients.

APEX vNext is pre-release. A projection being implemented does not mean that live parity or release acceptance has
passed.

The active client is GitHub Copilot CLI, standalone or through the VS Code Copilot harness, on Windows via WSL2,
without Docker or a devcontainer. VS Code Local is retired. Standalone desktop-app and native Windows support are
deferred. Both ALZ-backed workloads and standalone labs/demos, independent COE import, conversational changes and
complete design/operational output are release goals. They are not marked implemented by this support matrix. See the
[checkpoint](../vnext/PROJECT.md) and [target client scenarios](../vnext/CLIENT-QUALIFICATION.md).

## Support Matrix

| Surface                        | Implementation                                   | Deterministic proof                       | Live client proof                             | Current status    |
| ------------------------------ | ------------------------------------------------ | ----------------------------------------- | --------------------------------------------- | ----------------- |
| Direct APEX CLI                | Implemented                                      | Required CI and package qualification     | Not applicable                                | Preview-supported |
| GitHub Copilot CLI             | Coordinator, specialists and workers implemented | Projection generation and lifecycle tests | Current candidate pending                     | Conditional       |
| VS Code Copilot harness        | Runs the CLI projection                          | Projection generation and lifecycle tests | Blocked on WSL: picked agents are not applied | Conditional       |
| GitHub Copilot desktop app     | Parked; historical feasibility probes only       | No current acceptance claim               | Incomplete historical probes                  | Deferred          |
| Copilot CLI autonomous workers | Enabled; permissions unchanged                   | Runtime authority and projection tests    | Bounded Luna workflow probes passed           | Conditional       |
| Bicep track                    | Implemented                                      | Deterministic provider and package tests  | Current cloud candidate pending               | Conditional       |
| Terraform track                | Implemented                                      | Deterministic provider and package tests  | Current cloud candidate pending               | Conditional       |

## Client Behavior

The CLI projection ships the coordinator, interactive specialists, and autonomous CodeGen, Reviewer and Validator
workers. CLI workers were enabled with maintainer authorization after bounded Luna workflow probes. Revised
[ADR-0006](../vnext/adrs/03-des-adr-0006-omit-cli-autonomous-workers.md) treats visibility as a usability convention,
not authorization. Kernel task, evidence, ownership and approval checks remain mandatory, and worker tool grants are
unchanged. A directly selectable profile is not itself a security failure.

The coordinator uses `mai-code-1.1-flash`, Requirements, Architect and Planner use `gpt-6-sol`, and Operator uses
`gpt-5.6-terra`, each with `model-policy: preferred`. CodeGen, Reviewer and Validator use `gpt-6-luna` with
`model-policy: required` and `reasoning-effort: max`. Copilot CLI `1.0.88` honors these fields for delegated and
directly selected agents, but a user `subagents` override can still lower a worker's effort. Historical Sol
qualification records refer to the previous identifier; they do not qualify the new model selection.

Ask `APEX` what is next. The `apex-next` skill names the kernel-selected owner, then delegates a hidden worker or prints
`/agent <name>` with a scope prompt to paste after you switch. Interactive specialists run in the foreground, because
`task` subagents never receive `ask_user`. In Requirements, expect native `ask_user` questions followed by
`recordInput` acceptance. Invalid option values require correction; recommendations are never substituted silently.

For multiple-selection questions, Copilot CLI shows checkboxes, and the agent maps your answer back to exact kernel
values. Where checkboxes are unavailable, the agent numbers the options in kernel order and asks for numbers. It rejects
out-of-range, duplicate or non-numeric entries and asks you to confirm the resolved selection. The kernel validates the
values either way, and cancellation records nothing. See
[input qualification](../vnext/CLIENT-QUALIFICATION.md#multiple-selection-input) for required evidence.

Planner and Operator may use the built-in Explore agent for read-only questions about named workspace paths. Managed
agents do not use Rubber-duck, Code-review or Security-review, because they inherit the caller's APEX tools. You can
run `/review` or `/security-review` yourself on promoted output, and `/research` for background reading. Treat their
findings as advice and record any change through the owning APEX agent. General-purpose delegation, `/fleet`,
`/delegate` and plan mode stay out of managed workflows.

In VS Code, open the workspace, start a chat with the session target set to Copilot, and pick an APEX agent in the
Agent picker; `/agent` is not a harness command. With VS Code `1.139.0` and Copilot Chat `0.67.0` over WSL, a picked
agent is not applied and the default agent answers, so the harness cannot run APEX agents on WSL yet.

Hidden-user discovery does not implicitly disable model invocation. The adapter preserves explicit invocation-disable
settings; isolated review-routing probes cover the canonical parent-to-Reviewer path on both tracks. This does not
authenticate reviewers or establish full native validation coverage. Bicep storage-only native validation passed;
Terraform correctly blocks on missing security-baseline and logical-parity executors.

In Copilot CLI, run interactive specialists as foreground custom agents. The coordinator names the required role
and supplies a continuation note with the user's scope; the user selects that role before continuing. Interactive
handoff edges do not grant the background `task` tool. In Requirements, expect native `ask_user` questions followed
by `recordInput` acceptance, not a text-form summary returned by a background agent. Invalid option values require
user correction or confirmation; recommendations are never substituted silently.

For multiple-selection questions, retain native controls where supported. Standalone CLI sessions lacking them may
collect exact option values through the question tool's free-text field, validate the complete selection, and ask for
explicit confirmation before recording an array. Invalid or ambiguous input requires correction; cancellation records
nothing. This is a confirmed free-text fallback, not a native multi-select claim. VS Code retains native multi-select.
See [input qualification](../vnext/CLIENT-QUALIFICATION.md#multiple-selection-input) for required evidence.

Required generation, review and validation outcomes still need a supported CLI path. A missing path blocks the complete
workflow claim; the absence of hidden workers is not an exemption from the product goal.

The direct `apex` CLI is the runtime control surface. It is not a Copilot client and does not perform creative
requirements, architecture, or planning work by itself.

Onboarding is shared: global CLI, one-shot `npx`, and Copilot CLI all invoke `apex bootstrap`.

Agent Plugins and APEX MCP redistribution are evaluated last. Their eventual support must be proven using exact client
versions and lifecycle tests, not inferred from plugin-format compatibility alone.

## Deferred Desktop App

All standalone desktop-app work was parked on 2026-09-21. It is not an active release target under the deferred
[REQ-COPILOT-APP-001](../vnext/PRD.md#req-copilot-app-001-standalone-desktop-app).
The [backlog](../vnext/ROADMAP.md#deferred-standalone-copilot-desktop-app) retains observed limitations and upstream issues.
Existing local intake/worktree probes are characterization only, not full desktop qualification or standalone CLI proof.
No app-specific runtime, adapter, host setup or test expansion should resume without explicit maintainer selection.

## Evidence Boundary

Historical fixtures characterize behavior but cannot grant release authority. Current support requires evidence bound
to the exact candidate, observed client versions, managed projection hashes, and required live interactions.

## Authority

- [`customizations/manifest.json`](../../customizations/manifest.json)
- [`config/toolchain.v1.json`](../../config/toolchain.v1.json)
- [Client qualification control](../vnext/CLIENT-QUALIFICATION.md)

## Related

- [Client projections](../explanation/client-projections.md)
- [Qualification reference](qualification.md)
- [Manage installation](../how-to/manage-installation.md)
