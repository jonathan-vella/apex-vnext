# Supported Client Qualification

This control defines release-blocking evidence for GitHub Copilot in VS Code and GitHub Copilot CLI. Generated
projection tests are necessary but do not replace live client interaction.

The initial host path is Windows via WSL2/Ubuntu, without Docker or a devcontainer. Required outcomes follow the
[PRD](PRD.md), including both environment profiles, COE reuse and conversational changes. Basic interaction checks
accompany feature delivery; final installation qualification follows the distribution decision. No token baseline is
required now. Existing executable gate alignment must be completed before affected scenarios; do not bypass it.

## Candidate Binding

Before interaction, record the exact source commit, package and runtime locks, managed projection digests, client
versions, executable hashes, MCP inventory, and clean consumer workspace identity. An update during a run invalidates
that client result.

## Scenario Matrix

| ID           | Shared required outcome                                                  | VS Code               | Copilot CLI              |
| ------------ | ------------------------------------------------------------------------ | --------------------- | ------------------------ |
| `CLIENT-001` | Candidate versions and hashes are bound before work.                     | Required              | Required                 |
| `CLIENT-002` | Instructions, target projection, agents, and skills are discovered once. | Required              | Required                 |
| `CLIENT-003` | Missing input creates one kernel request and one typed answer event.     | `vscode/askQuestions` | Interactive `ask_user`   |
| `CLIENT-004` | APEX MCP starts with the exact managed allowlist.                        | Required              | Required                 |
| `CLIENT-005` | Specialists route correctly and worker boundaries hold.                  | Workers delegated     | Workers absent by design |
| `CLIENT-006` | Gates, stale-state rejection, and operation denial match.                | Required              | Required                 |
| `CLIENT-007` | Restart resumes the same journal head without chat history.              | Required              | Required                 |
| `CLIENT-008` | Writer conflict and accepted transfer preserve owner epochs.             | Required              | Required                 |
| `CLIENT-009` | Init, update, conflict, rollback, uninstall, and reinstall are atomic.   | Required              | Required                 |
| `CLIENT-010` | Shared fake-provider workflow outcomes normalize equally.                | Required              | Required                 |
| `CLIENT-011` | Bootstrap installs the exact local runtime and selected projection.      | Profile or CLI route  | CLI route                |

Unavailable client mechanics remain unavailable; they are not inferred as passing. Copilot CLI autonomous workers are
intentionally omitted under ADR-0006.

That omission is a client-mechanics boundary, not permission to omit generation, review or validation. Demonstrate a
supported bounded path for every required outcome. These additional acceptance scenarios are planned requirements,
not assertions that corresponding runtime or registry coverage already exists:

| ID           | Required outcome in both clients                                                              |
| ------------ | --------------------------------------------------------------------------------------------- |
| `CLIENT-012` | WSL2 clean consumer setup and use without a devcontainer or APEX source checkout              |
| `CLIENT-013` | Explicit ALZ/lab profile selection and correct supplied-versus-owned resource handling        |
| `CLIENT-014` | COE discovery, one-archetype selection, independent import and recorded source revision       |
| `CLIENT-015` | Manually copied project adoption without importing secrets, state or approval authority       |
| `CLIENT-016` | Relevant change questions, consequences and confirmation; unchanged decisions are reused      |
| `CLIENT-017` | Affected outputs refresh, unrelated files remain unchanged and manual conflicts are confirmed |
| `CLIENT-018` | Target-subscription policy import; full baseline never enters model-facing context            |
| `CLIENT-019` | Complete design and operational handoff reviewed against the PRD quality reference            |
| `CLIENT-020` | Final distribution starts the correct APEX MCP and preserves active runs across updates       |

Exercise both IaC tracks and both profiles with representative cases in the existing tests. Reuse fixtures and helpers;
do not build a separate benchmark harness. Record explicit gaps until implemented.

## Execution Rules

1. Use clean independent consumer workspaces for each client.
2. Install the same exact package candidate and one selected projection.
3. Trust only the qualification workspace. A disposable, isolated profile root may be mutated solely for the managed
   VS Code bootstrap agent scenario; do not mutate a real user profile or global MCP configuration.
4. Use explicit tool grants. Broad allow-all or remote delegation modes are prohibited.
5. Record structured outcomes and content-free provenance, not raw chat or secrets.
6. Repeat both clients after any release-relevant runtime, contract, projection, MCP, skill, or toolchain change.

## Acceptance

A client passes only when every applicable blocking scenario has current evidence and all normalized comparisons verify.
The aggregate cannot grant release authority; it becomes one input to the final release receipt.

## VS Code Installation Lifecycle

The [VS Code installation lifecycle matrix](../../tools/registry/vscode-installation-lifecycle.v1.json) defines the
bootstrap, reload, update, rollback, uninstall, and reinstall scenarios required for end-user lifecycle qualification.
Its deterministic evidence is committed; live scenarios remain `not-run` until executed in a clean supported profile.
