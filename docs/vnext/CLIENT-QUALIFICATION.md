## Supported Client Qualification Contract

This document defines the client-neutral acceptance contract for GitHub Copilot in VS Code and GitHub Copilot CLI.
It selects a rolling stable client policy and defines qualification evidence. It does not claim either client has passed
against the re-baselined `0.10.0` implementation.

## Version Policy

| Client              | Live qualification policy                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------ |
| GitHub Copilot CLI  | Latest stable supported release; bind observed version and binary SHA-256 to the candidate |
| VS Code             | Latest stable supported release; bind observed host version and SHA-256 to the candidate   |
| Copilot Chat        | Latest stable host-installed release; bind the observed extension version to the candidate |
| Aggregate invariant | Every scenario uses one consistent observed VS Code, Copilot Chat, and CLI version set     |
| Historical evidence | Exact context matrix and characterization versions remain immutable                        |

Do not downgrade clients to historical characterization versions. Automatic stable updates are allowed between
candidates. A candidate remains immutable: every live outcome records observed versions, and the aggregate rejects
mixed version sets. Version presence alone is not proof; managed projection, capability inventory, executable digest,
runtime evidence, and scenario semantics must still pass.

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

Issue #150 implements the shared kernel boundary for `CLIENT-003`. Input requests and submissions are versioned,
journal-head-bound, writer-epoch-bound, replay-safe, and recorded through `apex/recordInput`. VS Code and Copilot CLI UI
mapping remains a separate client-projection slice; neither client may infer answers from conversation history.

Issue #152 implements deterministic client-valid agent generation and selected-client transactional materialization.
ADR-0005 records why installing both projections or one polyglot definition would weaken client validity or authority.
Issue #154 implements the versioned normalized outcome, comparison, and matrix-qualification contracts for every
scenario. The collector derives content-free semantic receipts from the hash-linked journal; the comparator verifies
each VS Code/CLI pair; and aggregate verification requires the exact comparison and outcome payload closure.
Fixture evidence proves deterministic behavior only and always records `qualifiesRelease: false`.

Issue #179 characterized hidden-worker controls without changing projections. The observed Copilot CLI `1.0.73` binary
and an exact official `1.0.75` release probe exposed the same gap: workers unavailable for model invocation were absent
from the `task` catalog, while task-callable workers remained directly selectable. ADR-0006 therefore omits autonomous
workers from the CLI projection. Interactive CLI discovery can satisfy its applicable `CLIENT-002` checks, but
worker-dependent CLI execution and `CLIENT-005` remain unavailable pending supported-client controls and requalification.

Live evidence remains required for every scenario. Production live qualification requires the complete client evidence
closure, binds it to the exact project and release candidate, and rejects fixture, partial, stale, substituted, duplicate,
or unreferenced evidence. Collection binds the observed latest-stable clients to the candidate and blocks mixed version
sets, missing capabilities, or malformed version evidence.

## Scenario Matrix

| ID           | Required outcome                                                                                                   | VS Code mechanism                                                       | Copilot CLI mechanism                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `CLIENT-001` | Observed client versions and exact bundle hashes are bound before work starts.                                     | Record VS Code and Copilot Chat versions plus managed-file hashes.      | Run `copilot version` and record the binary and managed-file hashes.                                                 |
| `CLIENT-002` | Repository instructions, target-matched APEX agents, and APEX skills are discovered once with expected visibility. | Inspect workspace discovery, `target: vscode`, and agent/skill pickers. | Use `/env`, `/agent`, and `copilot plugins list --json`; verify `target: github-copilot` in the selected projection. |
| `CLIENT-003` | Missing input yields the same kernel `needs_input` contract and one typed answer event.                            | Collect through `vscode/askQuestions`.                                  | Collect through interactive `ask_user`; programmatic mode cannot satisfy this scenario.                              |
| `CLIENT-004` | Only the declared APEX MCP server and exact tool allowlist are available to managed APEX roles.                    | Inspect `.vscode/mcp.json`, startup state, and tool inventory.          | Inspect workspace `.github/mcp.json` or `.mcp.json` with `copilot mcp list --json`; folder trust is required.        |
| `CLIENT-005` | Interactive specialists route directly; hidden workers stay non-user-invocable and return typed results.           | Exercise handoffs and hidden worker calls.                              | Unavailable while autonomous workers are omitted; fail if a worker is selectable or appears in `task.agent_type`.    |
| `CLIENT-006` | Gates 1-4, stale-state rejection, and unapproved-operation denials produce the same state and error codes.         | Submit decisions through APEX MCP from the managed client.              | Submit decisions through the same APEX MCP tools with explicit allow and deny rules.                                 |
| `CLIENT-007` | Restart and resume recover the same journal head without conversation history.                                     | Restart VS Code and resume from repository state.                       | Use `/restart`, then `--resume` or `--continue` against repository state.                                            |
| `CLIENT-008` | A second client is rejected while a writer lease is active; accepted transfer increments one owner epoch.          | Attempt and then accept the typed transfer from VS Code.                | Attempt and then accept the same typed transfer from Copilot CLI.                                                    |
| `CLIENT-009` | Init, update, conflict refusal, rollback, uninstall, and reinstall preserve unrelated files atomically.            | Verify the VS Code projection and managed-file lock.                    | Verify the Copilot CLI projection and the same bundle transaction.                                                   |
| `CLIENT-010` | Fake-provider workflow completion emits equal terminal state, artifacts, gates, evidence, and denials.             | Run the bounded workflow through managed VS Code agents.                | Run the bounded workflow through managed Copilot CLI agents.                                                         |

## Execution Rules

Client-projection implementation begins only after the
[guidance and automation review](GUIDANCE-AUTOMATION-REVIEW.md) identifies canonical guidance, discovery, linting, and
workflow owners. The review does not block this qualification contract or version selection.

1. Run each client from a clean consumer workspace against the same exact candidate and generated bundle.
2. Record the observed stable client versions before the first model interaction. An update during a candidate run
   invalidates that run; stable updates between candidates are allowed.
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

The machine-readable evidence path uses `client-outcome-v1`, `client-outcome-comparison-v1`, and
`client-outcome-qualification-v1`. Supporting outcomes and comparisons are immutable evidence-manifest entries; the
aggregate is bound through the dedicated `clientQualification` entry and must be referenced by a live scenario.
`npm run validate:client-outcomes` validates the canonical scenario corpus, and `npm run test:client-outcomes` exercises
collection, comparison, aggregation, strict parsing, confidentiality, and authority-denial mutations.

## Completion Gate

Historical issue [#91](https://github.com/jonathan-vella/apex-vnext/issues/91) completed the Milestone H baseline when:

- Copilot CLI `1.0.73` is pinned in the canonical toolchain and generated package asset;
- this matrix is linked from project controls and the testing guide;
- project-control, JSON, package-asset, Markdown, and link validation pass;
- the register distinguished selected-version evidence from then-unavailable client execution.

Milestone J remains open until both clients execute every blocking scenario on one exact candidate and all normalized
outcomes pass.
