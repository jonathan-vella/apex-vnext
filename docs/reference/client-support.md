# Client Support

> [Current Version](../../VERSION.md) | Implementation and qualification boundaries for APEX vNext clients.

APEX vNext is pre-release. A projection being implemented does not mean that live parity or release acceptance has
passed.

Under [DECISION-033][decision-033] the supported clients are the VS Code Copilot harness and the GitHub Copilot app on
native Windows, and GitHub Copilot CLI on Linux and WSL2. That change is in progress under the [client
pivot](../vnext/ROADMAP.md#client-pivot). Today's package installs with npm, and `apex init` writes a thin workspace
projection whose `.github/copilot/settings.json` installs the `apex` plugin; the sections below describe that behavior
unless they say otherwise. VS Code Local is retired. Both
ALZ-backed workloads and standalone labs/demos, independent COE import, conversational changes and complete
design/operational output are release goals. They are not marked implemented by this support matrix. See the
[checkpoint](../vnext/PROJECT.md) and [target client scenarios](../vnext/CLIENT-QUALIFICATION.md).

## Support Matrix

| Surface                             | Implementation                                  | Deterministic proof                      | Live client proof               | Current status    |
| ----------------------------------- | ----------------------------------------------- | ---------------------------------------- | ------------------------------- | ----------------- |
| Direct APEX CLI                     | Implemented                                     | Required CI and package qualification    | Not applicable                  | Preview-supported |
| GitHub Copilot CLI (Linux, WSL2)    | apex plugin: APEX agent plus hidden workers     | Plugin package and lifecycle tests       | Slice 11 exploratory runs       | Conditional       |
| VS Code Copilot harness (Windows)   | Runs the apex plugin from the Copilot CLI store | Plugin package and lifecycle tests       | Pending on native Windows       | Target, pending   |
| GitHub Copilot app (Windows)        | Plugin delivery and worktree support planned    | None yet                                 | Historical probes only          | Target, planned   |
| GitHub Copilot CLI (native Windows) | Not supported                                   | None                                     | None                            | Unsupported       |
| Copilot CLI autonomous workers      | Enabled; permissions unchanged                  | Runtime authority and projection tests   | Bounded Luna workflow probes    | Conditional       |
| Bicep track                         | Implemented                                     | Deterministic provider and package tests | Current cloud candidate pending | Conditional       |
| Terraform track                     | Implemented                                     | Deterministic provider and package tests | Current cloud candidate pending | Conditional       |

## Current Client Behavior

The [client pivot](../vnext/ROADMAP.md#client-pivot) uses one foreground `APEX` agent for every interactive stage
(DECISION-032). Rubber-duck replaces the Reviewer later (DECISION-031), and agents do not pin models (DECISION-033).

The CLI projection ships one user-facing `APEX` agent and autonomous CodeGen, Reviewer and Validator workers. CLI
workers were enabled with maintainer authorization after bounded Luna workflow probes. Revised
[ADR-0006](../vnext/adrs/03-des-adr-0006-omit-cli-autonomous-workers.md) treats visibility as a usability convention,
not authorization. Kernel task, evidence, ownership and approval checks remain mandatory, and worker tool grants are
unchanged. A directly selectable profile is not itself a security failure.

Managed agents carry no `model`, `model-policy` or `reasoning-effort` (DECISION-033). Every agent, including the
hidden workers, runs on the session model the user picks; auto is the default. Historical qualification records name
the models that were pinned when they ran; they do not qualify any other model.

Ask `APEX` what is next. The `apex-next` skill maps the kernel-selected owner role to a same-agent stage skill or
hidden worker. There is no `/agent` switch or specialist scope prompt. Human questions stay in the foreground `APEX`
agent through `ask_user`, followed by `recordInput` acceptance. Invalid option values require correction;
recommendations are never substituted silently.

For multiple-selection questions, Copilot CLI shows checkboxes, and the agent maps your answer back to exact kernel
values. Where checkboxes are unavailable, the agent numbers the options in kernel order and asks for numbers. It rejects
out-of-range, duplicate or non-numeric entries and asks you to confirm the resolved selection. The kernel validates the
values either way, and cancellation records nothing. See
[input qualification](../vnext/CLIENT-QUALIFICATION.md#multiple-selection-input) for required evidence.

The foreground APEX agent may use the built-in Explore agent for read-only questions about named workspace paths.
Managed agents do not use Rubber-duck, Code-review or Security-review, because they inherit the caller's APEX tools.
You can run `/review` or `/security-review` yourself on promoted output, and `/research` for background reading. Treat
their findings as advice and record any change through APEX. General-purpose delegation, `/fleet`,
`/delegate` and plan mode stay out of managed workflows.

In VS Code, open the workspace, start a chat with the session target set to Copilot, and pick the `APEX` agent in the
Agent picker; `/agent` is not a harness command. DECISION-033 moves VS Code to native Windows, where the apex-jon spike
found plugin agents apply.

Hidden-user discovery does not implicitly disable model invocation. The adapter preserves explicit invocation-disable
settings; isolated review-routing probes cover the canonical parent-to-Reviewer path on both tracks. This does not
authenticate reviewers or establish full native validation coverage. Bicep storage-only native validation passed;
Terraform correctly blocks on missing security-baseline and logical-parity executors.

In Copilot CLI, run the foreground `APEX` custom agent. APEX loads the stage skill for the kernel owner role and keeps
the user's requested outcome until the next stop point. Hidden worker delegation does not grant interactive authority.
Expect native `ask_user` questions followed by `recordInput` acceptance, not a text-form summary returned by a
background agent. Invalid option values require user correction or confirmation; recommendations are never substituted
silently.

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

Under DECISION-033, APEX ships as an Agent Plugin plus `apex init` onboarding. `apex init` writes
`.github/copilot/settings.json` with `enabledPlugins` set to `apex@apex-plugins` and `extraKnownMarketplaces` pointing
at `jonathan-vella/apex-plugins`, so Copilot CLI and the cloud agent install the plugin for that repository. The
workspace keeps only instructions, the governance workflow and scripts, and `.apex/`; agents, skills and MCP servers
come from the plugin. Plugin support must still be proven with exact client versions and lifecycle tests.

## Planned Client Changes

These follow DECISION-033 and are not implemented yet:

- **Hosts.** VS Code and the Copilot app run on native Windows 11 (25H2 or 24H2), without WSL. Copilot CLI runs on
  Linux or WSL2. Each workspace uses one host.
- **Sandbox.** Turn on client local sandboxing before using APEX. In the Copilot app it is a project setting; APEX
  cannot set it for you. Outbound network stays allowed.
- **Install.** VS Code reads the Copilot CLI store install that `.github/copilot/settings.json` triggers; do not also
  install the plugin from the VS Code marketplace. Qualification still has to prove the app and VS Code pick it up.
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
