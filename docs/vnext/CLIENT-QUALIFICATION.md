## Supported Client Qualification Contract

This document defines the client-neutral acceptance contract for GitHub Copilot in VS Code and GitHub Copilot CLI.
It selects a Copilot CLI release and defines future qualification evidence. It does not claim either client has passed
against the re-baselined `0.10.0` implementation.

## Version Selection

| Property            | Selected value                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Copilot CLI release | `1.0.73`                                                                                                 |
| Release source      | [GitHub Copilot CLI v1.0.73](https://github.com/github/copilot-cli/releases/tag/v1.0.73)                 |
| Linux x64 artifact  | `copilot-linux-x64.tar.gz`                                                                               |
| Artifact SHA-256    | `8f9bb5f7e364c267265d1e24ac2aea69ed559ddb956719c6db12a353de6c5970`                                       |
| Verification        | Published digest matched; `copilot version` reported `GitHub Copilot CLI 1.0.73`                         |
| npm observation     | `@github/copilot` tag `latest` resolved to `1.0.71-1` on 2026-07-21                                      |
| VS Code release     | Qualification-required; select and record the exact stable host and extension versions at execution time |

The GitHub release is selected because it was the newest non-draft, non-prerelease release observed at the cutoff and
its platform artifact was independently digest-checked and executed. The npm channel lag is recorded rather than hidden.
Final qualification must disable automatic updates and prove the exact selected binary before starting a scenario.

## Support Boundary

- Supported clients are local GitHub Copilot in VS Code and local GitHub Copilot CLI.
- GitHub Copilot cloud coding-agent sessions, Copilot code review, `/delegate`, and cloud sandboxes are not APEX clients.
- Client UI text, layout, and interaction widgets may differ.
- Kernel contracts, journal events, task and gate state, authorization, evidence, and writer ownership may not differ.
- Client conversation history is not evidence and must not be required to resume an APEX run.
- OpenTelemetry content capture remains disabled. Qualification retains bounded hashes and normalized outcomes, not
  prompts, responses, tool arguments, credentials, or raw transcripts.

## Normalized Outcome

Each scenario result must bind these fields before clients are compared:

- repository, branch, exact candidate commit, package-lock hash, runtime-bundle hash, and customization-bundle hash;
- client name, exact client version, extension version where applicable, operating system, and architecture;
- APEX project and run IDs, selected workflow node, task ID, journal head, and writer epoch;
- normalized task state, artifact and evidence hashes, gate state, denial or error code, and transfer result;
- `pass`, `fail`, or `unavailable`, with immutable evidence references or a blocking owner and next action.

Equivalent outcomes require equality of the applicable normalized fields. UI wording, panel placement, and whether input
is collected through `vscode/askQuestions` or `ask_user` are explicitly excluded from equality.

## Scenario Matrix

| ID           | Required outcome                                                                                           | VS Code mechanism                                                  | Copilot CLI mechanism                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `CLIENT-001` | Exact client and bundle versions are bound before work starts.                                             | Record VS Code and Copilot Chat versions plus managed-file hashes. | Run `copilot version` with auto-update disabled and record managed-file hashes.                               |
| `CLIENT-002` | Repository instructions, APEX agents, and APEX skills are discovered once with expected visibility.        | Inspect workspace discovery and agent/skill pickers.               | Use `/env`, `/agent`, and `copilot plugins list --json`; custom agents require a live session.                |
| `CLIENT-003` | Missing input yields the same kernel `needs_input` contract and one typed answer event.                    | Collect through `vscode/askQuestions`.                             | Collect through interactive `ask_user`; programmatic mode cannot satisfy this scenario.                       |
| `CLIENT-004` | Only the declared APEX MCP server and exact tool allowlist are available to managed APEX roles.            | Inspect `.vscode/mcp.json`, startup state, and tool inventory.     | Inspect workspace `.github/mcp.json` or `.mcp.json` with `copilot mcp list --json`; folder trust is required. |
| `CLIENT-005` | Interactive specialists route directly; hidden workers stay non-user-invocable and return typed results.   | Exercise handoffs and hidden worker calls.                         | Exercise custom-agent selection and `task` delegation with `infer` and tool boundaries.                       |
| `CLIENT-006` | Gates 1-4, stale-state rejection, and unapproved-operation denials produce the same state and error codes. | Submit decisions through APEX MCP from the managed client.         | Submit decisions through the same APEX MCP tools with explicit allow and deny rules.                          |
| `CLIENT-007` | Restart and resume recover the same journal head without conversation history.                             | Restart VS Code and resume from repository state.                  | Use `/restart`, then `--resume` or `--continue` against repository state.                                     |
| `CLIENT-008` | A second client is rejected while a writer lease is active; accepted transfer increments one owner epoch.  | Attempt and then accept the typed transfer from VS Code.           | Attempt and then accept the same typed transfer from Copilot CLI.                                             |
| `CLIENT-009` | Init, update, conflict refusal, rollback, uninstall, and reinstall preserve unrelated files atomically.    | Verify the VS Code projection and managed-file lock.               | Verify the Copilot CLI projection and the same bundle transaction.                                            |
| `CLIENT-010` | Fake-provider workflow completion emits equal terminal state, artifacts, gates, evidence, and denials.     | Run the bounded workflow through managed VS Code agents.           | Run the bounded workflow through managed Copilot CLI agents.                                                  |

## Execution Rules

Client-projection implementation begins only after the
[guidance and automation review](GUIDANCE-AUTOMATION-REVIEW.md) identifies canonical guidance, discovery, linting, and
workflow owners. The review does not block this qualification contract or version selection.

1. Run each client from a clean consumer workspace against the same exact candidate and generated bundle.
2. Record supported stable client versions before the first model interaction; an automatic update invalidates the run.
3. Use interactive mode for `CLIENT-003`. Programmatic mode is allowed only for scenarios that cannot request input.
4. Use explicit tool availability and permission rules. `--allow-all`, `--yolo`, remote sessions, and `/delegate` are
   prohibited.
5. Trust only the clean qualification workspace. Do not write user-global MCP or agent configuration during a run.
6. Keep built-in, user, organization, and unrelated repository tools outside the APEX managed-tool comparison.
7. Treat any missing blocking scenario, version, hash, or normalized field as `unavailable`; it cannot be inferred.
8. Repeat both clients after any release-relevant kernel, contract, bundle, MCP, agent, skill, or toolchain hash changes.

## Evidence Collection

Deterministic preparation must produce the exact candidate, package, runtime, bundle, scenario, and expected-tool hashes.
Human-owned client evidence then records only bounded results:

- version and discovery inventories;
- normalized APEX task, journal, gate, evidence, denial, and writer-transfer records;
- managed-file lifecycle results and hashes;
- pass, fail, or unavailable disposition for every scenario.

A future implementation slice may add a versioned machine-readable client-evidence schema. It must extend or compose the
existing live-qualification boundary rather than creating a second release authority.

## Completion Gate

Issue [#91](https://github.com/jonathan-vella/apex-vnext/issues/91) completes the Milestone H contract when:

- Copilot CLI `1.0.73` is pinned in the canonical toolchain and generated package asset;
- this matrix is linked from project controls and the testing guide;
- project-control, JSON, package-asset, Markdown, and link validation pass;
- the register distinguishes selected-version evidence from still-unavailable client execution.

Milestone J remains open until both clients execute every blocking scenario on one exact candidate and all normalized
outcomes pass.
