# Client Support

> [Current Version](../../VERSION.md) | Implementation and qualification boundaries for APEX vNext clients.

APEX vNext is pre-release. A projection being implemented does not mean that live parity or release acceptance has
passed.

Under [DECISION-033][decision-033] the supported clients are the VS Code Copilot harness and the GitHub Copilot app on
native Windows, and GitHub Copilot CLI on Linux and WSL2. That change is in progress under the [client
pivot](../vnext/ROADMAP.md#client-pivot). Today's package still installs the Copilot CLI projection with npm and
`apex init`; the sections below describe that shipped behavior unless they say otherwise. VS Code Local is retired. Both
ALZ-backed workloads and standalone labs/demos, independent COE import, conversational changes and complete
design/operational output are release goals. They are not marked implemented by this support matrix. See the
[checkpoint](../vnext/PROJECT.md) and [target client scenarios](../vnext/CLIENT-QUALIFICATION.md).

## Support Matrix

| Surface                             | Implementation                                    | Deterministic proof                       | Live client proof               | Current status    |
| ----------------------------------- | ------------------------------------------------- | ----------------------------------------- | ------------------------------- | ----------------- |
| Direct APEX CLI                     | Implemented                                       | Required CI and package qualification     | Not applicable                  | Preview-supported |
| GitHub Copilot CLI (Linux, WSL2)    | CLI projection: coordinator, specialists, workers | Projection generation and lifecycle tests | Slice 11 exploratory runs       | Conditional       |
| VS Code Copilot harness (Windows)   | Runs the CLI projection; plugin delivery planned  | Projection generation and lifecycle tests | Pending on native Windows       | Target, pending   |
| GitHub Copilot app (Windows)        | Plugin delivery and worktree support planned      | None yet                                  | Historical probes only          | Target, planned   |
| GitHub Copilot CLI (native Windows) | Not supported                                     | None                                      | None                            | Unsupported       |
| Copilot CLI autonomous workers      | Enabled; permissions unchanged                    | Runtime authority and projection tests    | Bounded Luna workflow probes    | Conditional       |
| Bicep track                         | Implemented                                       | Deterministic provider and package tests  | Current cloud candidate pending | Conditional       |
| Terraform track                     | Implemented                                       | Deterministic provider and package tests  | Current cloud candidate pending | Conditional       |

## Current Client Behavior

The [client pivot](../vnext/ROADMAP.md#client-pivot) replaces several behaviors below: one `APEX` agent replaces the
coordinator and specialists (DECISION-032), rubber-duck replaces the Reviewer (DECISION-031), and agents stop pinning
models (DECISION-033).

The CLI projection ships the coordinator, interactive specialists, and autonomous CodeGen, Reviewer and Validator
workers. CLI workers were enabled with maintainer authorization after bounded Luna workflow probes. Revised
[ADR-0006](../vnext/adrs/03-des-adr-0006-omit-cli-autonomous-workers.md) treats visibility as a usability convention,
not authorization. Kernel task, evidence, ownership and approval checks remain mandatory, and worker tool grants are
unchanged. A directly selectable profile is not itself a security failure.

The coordinator, Requirements, Architect and Planner use `gpt-6-sol`, and Operator uses
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
agent is not applied and the default agent answers. DECISION-033 moves VS Code to native Windows, where the apex-jon
spike found plugin agents apply.

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

Under DECISION-033, APEX moves to an Agent Plugin plus `apex init` onboarding. Until the plugin ships, install with npm
and `apex init`. Plugin support must still be proven with exact client versions and lifecycle tests.

## Planned Client Changes

These follow DECISION-033 and are not implemented yet:

- **Hosts.** VS Code and the Copilot app run on native Windows 11 (25H2 or 24H2), without WSL. Copilot CLI runs on
  Linux or WSL2. Each workspace uses one host.
- **Sandbox.** Turn on client local sandboxing before using APEX. In the Copilot app it is a project setting; APEX
  cannot set it for you. Outbound network stays allowed.
- **Install.** `apex init` writes `.github/copilot/settings.json`, which installs the APEX plugin through the Copilot
  CLI store. VS Code reads that install; do not also install the plugin from the VS Code marketplace.
- **Models.** Pick the session model yourself (currently HydraFusion); agents no longer pin one.
- **Copilot app worktrees.** Sessions in app-created worktrees share the main checkout's APEX state.

The [GitHub Copilot app requirement](../vnext/PRD.md#req-copilot-app-001-github-copilot-app) owns app acceptance.

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

[decision-033]: ../vnext/DECISIONS.md#decision-033-support-native-windows-clients-and-deliver-apex-as-an-agent-plugin
