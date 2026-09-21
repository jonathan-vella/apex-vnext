# Client Support

> [Current Version](../../VERSION.md) | Implementation and qualification boundaries for APEX vNext clients.

APEX vNext is pre-release. A projection being implemented does not mean that live parity or release acceptance has
passed.

The active clients are VS Code Local and standalone Copilot CLI on Windows via WSL2, without Docker or a devcontainer.
Standalone desktop-app and native Windows support are deferred. Both ALZ-backed workloads and standalone
labs/demos, independent COE import, conversational changes and complete design/operational output are release goals.
They are not marked implemented by this support matrix. See the [checkpoint](../vnext/PROJECT.md) and
[target client scenarios](../vnext/CLIENT-QUALIFICATION.md).

## Support Matrix

| Surface                        | Implementation                                    | Deterministic proof                       | Live client proof                   | Current status    |
| ------------------------------ | ------------------------------------------------- | ----------------------------------------- | ----------------------------------- | ----------------- |
| Direct APEX CLI                | Implemented                                       | Required CI and package qualification     | Not applicable                      | Preview-supported |
| GitHub Copilot in VS Code      | Managed projection implemented                    | Projection generation and lifecycle tests | Current candidate pending           | Conditional       |
| GitHub Copilot CLI             | Coordinator and specialist projection implemented | Projection generation and lifecycle tests | Current candidate pending           | Conditional       |
| GitHub Copilot desktop app     | Parked; historical feasibility probes only        | No current acceptance claim               | Incomplete historical probes        | Deferred          |
| VS Code autonomous workers     | Implemented                                       | Projection and delegation tests           | Current candidate pending           | Conditional       |
| Copilot CLI autonomous workers | Not yet shipped; permissions unchanged            | Runtime authority tests                   | Actual worker qualification pending | Unqualified       |
| Bicep track                    | Implemented                                       | Deterministic provider and package tests  | Current cloud candidate pending     | Conditional       |
| Terraform track                | Implemented                                       | Deterministic provider and package tests  | Current cloud candidate pending     | Conditional       |

## Client Differences

The two implemented Copilot projections receive the coordinator and interactive specialist roles. VS Code also receives
autonomous code generation, review, and validation workers. Copilot CLI workers remain unshipped pending actual workflow
qualification. Revised [ADR-0006](../vnext/adrs/03-des-adr-0006-omit-cli-autonomous-workers.md) treats visibility as a
usability convention, not authorization. Kernel task, evidence, ownership and approval checks remain mandatory, and
worker tool/model grants are unchanged. A directly selectable profile is not itself a security failure.

CLI adapter `1.4.0` maps canonical `GPT-5.6 Terra` and `GPT-5.6 Sol` model labels to the documented CLI identifiers
`gpt-5.6-terra` and `gpt-5.6-sol`. VS Code labels and the selected model families are unchanged. This is identifier
translation, not a model substitution or fallback.

Hidden-user discovery does not implicitly disable model invocation. The adapter preserves explicit invocation-disable
settings; isolated review-routing probes cover the canonical parent-to-Reviewer path on both tracks. This does not
enable shipped workers, add tools, authenticate reviewers or establish successful native validation.

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

Onboarding is shared: global CLI, one-shot `npx`, and Copilot CLI all invoke `apex bootstrap`. VS Code may additionally
use the opt-in user-profile **APEX Bootstrap** agent to invoke that same command before the workspace projection exists.
After reload, the workspace-selected VS Code projection remains the only active APEX client projection.

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
