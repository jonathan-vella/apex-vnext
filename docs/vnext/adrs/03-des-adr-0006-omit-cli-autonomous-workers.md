# ADR-0006: Kernel Authority For Copilot CLI Workers

![Step](https://img.shields.io/badge/Step-3-blue?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Accepted-green?style=for-the-badge)
![Type](https://img.shields.io/badge/Type-ADR-purple?style=for-the-badge)

<details open>
<summary><strong>📑 Decision Contents</strong></summary>

- [🔍 Context](#-context)
- [✅ Decision](#-decision)
- [🔄 Alternatives Considered](#-alternatives-considered)
- [⚖️ Consequences](#%EF%B8%8F-consequences)
- [🏛️ WAF Pillar Analysis](#%EF%B8%8F-waf-pillar-analysis)
- [🔒 Compliance Considerations](#-compliance-considerations)
- [📝 Implementation Notes](#-implementation-notes)

</details>

> Status: Accepted; revised with maintainer approval on 2026-09-21
> Date: 2026-07-29
> Deciders: APEX maintainers

## Current Scope Note

On 2026-09-23 the maintainer authorized shipping CodeGen, Reviewer and Validator to CLI for personal candidate testing
after bounded workflow qualification. Current profiles select `gpt-6-luna` with `reasoning-effort: max`; tool permissions
and kernel safeguards are unchanged. The [current qualification record](../CLIENT-QUALIFICATION.md#current-worker-attempt)
documents passing Bicep storage-only validation, both-track reviews, Terraform blocked handling and remaining limits.
The model and target-membership statements below describe the earlier decision baseline, not a ban on this authorized
enablement. Full release and paired-client acceptance remain separate.

Direct-selection visibility is a usability convention, not a security gate. The maintainer-approved revision replaces
the earlier visibility-based omission rationale with runtime authority checks and exact-client worker qualification.
The [PRD client requirement](../PRD.md#req-customization-001-managed-copilot-experiences) still requires complete workflow
outcomes in both clients. Existing worker permissions, models, kernel safeguards and shipped target membership remain
unchanged by this decision. CLI worker candidates must be qualified before shipping; omission is a qualification status,
not a requirement that the upstream CLI hide workers securely.

## 🔍 Context

### Standalone CLI Recheck: 2026-09-21

Copilot CLI `1.0.86` on Ubuntu/WSL2 still executes a directly selected custom worker marked
`user-invocable: false` and `disable-model-invocation: false`. An isolated fixture used `tools: []`, an empty available
tool set, separate CLI configuration and Git roots, disabled built-in MCP, custom instructions, question tools,
remote access/export and automatic updates. A nonexistent-agent control was rejected and listed the fixture workers;
direct `--agent cli-probe-worker` then returned the diagnostic marker with no reported file changes.

Executable SHA-256: `be0152ea29b06d54dd23e1fc5512e978b4e84097f6da5314df96b3731a2dd6aa`.
Worker-profile SHA-256: `407cfc86692ad861c7c820d6a7040327663638d28caf03a10c94c702b1733c3b`.
The tool-free model response used `mai-code-1.1-flash`; no production APEX runtime or credentials were copied into
the fixture. Local characterization artifacts are retained under `dist/cli-worker-probe-01`, not as release receipts.

This reproduced the former direct-selection prerequisite independently of the parked desktop app. It does not establish
picker visibility, declared-parent enforcement, the disabled-invocation variant, or all worker behavior on this CLI
version. The revised decision below no longer treats that observation alone as an authorization failure.

An explicitly requested standalone-terminal recheck on the same date independently confirmed this result. CLI `1.0.86`
rejected `cli-probe-nonexistent` with exit code 1, then accepted `--agent cli-probe-worker` with exit code 0 and returned
`CLI_WORKER_DIRECT_SELECTION_REACHED`. The desktop app was not involved. The new isolated CLI home had no available
model tools; the CLI reported no file changes and 0.07 AI credits. The executable hash above was unchanged; the current
worker-profile hash was `656f054b2b47cdb46f567357a8dd4450ed7abc18ae92bfa83750cc26b6795942`. A separate local result is
retained as `dist/cli-worker-probe-01/recheck-02.json`. Picker visibility and parent restrictions were not tested.

The original decision required workers to be unavailable for direct user selection while remaining callable only through
declared parents. Issue #179 showed that Copilot CLI `1.0.73` did not provide that combination. Characterization of
stable Copilot CLI `1.0.75` reproduced the same behavior: `user-invocable: false` did not prevent direct `--agent`
selection, while `disable-model-invocation: true` removed the worker from the `task.agent_type` catalog.

Direct selection violated that former visibility requirement, but does not by itself demonstrate an authorization bypass.
Task envelopes constrain operations and state; the kernel does not authenticate the initiating client-agent profile.
Generic `task` prompts would also remove profile-bound model and tool constraints. Requirements:
`REQ-CUSTOMIZATION-001`, `REQ-SECURITY-001`, `REQ-DETERMINISM-001`, and `REQ-DOCS-001`.

### Runtime Authority Probe: 2026-09-21

A separate adversarial check tested runtime behavior instead of agent visibility. Selected kernel/service tests cover
missing, foreign, wrong-type, completed, stale and expired tasks; wrong subject/source bindings; staged-path escapes
and overwrite conflicts; fabricated native validation claims; review blockers; unapproved deployment; and stale
preview/writer authority. Rejection checks compare journal/run state and affected file contents. All 31 selected
deterministic tests passed; the strengthened approval and staging cases also passed after adding explicit preservation
assertions.

Standalone CLI `1.0.86` then directly selected a diagnostic worker with `user-invocable: false` in an isolated Git/config
root. It exposed only `apex/reviewComplete`, backed by the production MCP server and service against synthetic state.
Server-side audit records, not model prose, established these results:

| Call                                                              | Observed result   | State outcome                                                   |
| ----------------------------------------------------------------- | ----------------- | --------------------------------------------------------------- |
| Unknown task                                                      | `APEX_NOT_FOUND`  | Journal, run, accepted-artifact references and canary unchanged |
| Completed task                                                    | `APEX_STALE`      | Same state checks unchanged                                     |
| Initial positive-control submission                               | `APEX_VALIDATION` | Same state checks unchanged; retained as a failed attempt       |
| Current review task with exact JSON and omitted optional criteria | Accepted          | One bound review added; no gate approved; canary preserved      |

The first positive-control failure was not an authorization denial. Its exact argument shape was not retained; a
separate exact-JSON retry succeeded. This is a limited diagnostic, not production reviewer qualification. Local fixtures,
server audit and independently verified results are retained under `dist/cli-authority-probe-03`.

A deterministic characterization also confirms that one service client can submit both requirements and their valid
review. Task/subject binding does not prove independent reviewer identity. No test here establishes declared-parent
enforcement, authenticates the model that performed a review, or qualifies production CodeGen/Validator delegation.

These results support the explicitly approved revision below. They do not by themselves enable worker projections,
relax permissions, approve deployment or qualify the actual CodeGen, Reviewer and Validator workflows.

## ✅ Decision

Do not block Copilot CLI worker support solely because a user can directly select a worker. Authorize work through
current task envelopes, permitted operations, accepted input hashes, writer ownership, native evidence and explicit
deployment approval. Agent names, hidden flags and parent routing are not authenticated principals.

- Preserve existing worker tools and model selections; do not add shell, approval, deployment or generic delegation
  permissions to make a test pass.
- Require invalid, foreign, wrong-type, completed, stale and expired tasks to fail without accepting outputs or advancing
  gates. Native validation must execute its checks rather than trust model-authored receipts.
- Retain review tasks, subject binding and required review criteria. Describe review role separation as orchestration,
  not authenticated independent identity; do not claim more provenance than the runtime records.
- Qualify actual CodeGen, Reviewer and Validator profiles in an isolated CLI candidate with production MCP/kernel
  behavior and mock cloud providers. Verify calls, artifacts, gates, restart and failures independently of model prose.
- Test supported parent-to-worker routing as workflow functionality. Direct invocation alone is not a failing security
  criterion; a demonstrated excess-authority action is.
- Leave shipped `supportedTargets` and permissions unchanged during qualification. Enable reviewed CLI projections only
  after the candidate passes the required workflow checks; continue to report unqualified scenarios honestly.
- Preserve exact-client qualification before any release claim. Desktop-app work remains parked.

## 🔄 Alternatives Considered

| Option                           | Pros                              | Cons                                                                      | WAF Impact                       |
| -------------------------------- | --------------------------------- | ------------------------------------------------------------------------- | -------------------------------- |
| Block on hidden-profile behavior | Simple visibility rule            | Treats discoverability as authorization and blocks otherwise bounded work | No demonstrated security gain    |
| Kernel-bound, qualified workers  | Tests actual authority boundaries | Requires workflow evidence and honest review-provenance limits            | Security preserved; Operations ↑ |
| Use generic `task` prompts       | Avoids selectable worker profiles | Loses profile-bound model, tools, and deterministic role identity         | Security ↓, Operations ↓         |
| Re-pin to CLI `1.0.75`           | Uses a newer exact stable binary  | Exact probe reproduced the same visibility/delegation gap                 | Reliability →                    |

## ⚖️ Consequences

### Positive

- Direct-selection visibility no longer blocks support without evidence of excess authority.
- Existing task, evidence, ownership and approval enforcement remains the security boundary.
- Exact projections and independent runtime receipts make qualification inspectable and reversible.

### Negative

- Shipped CLI worker workflows remain unavailable until actual profiles pass qualification and are enabled.
- Required model/client execution can still fail; passing a tool-free probe does not close `CLIENT-005`.
- Same-client review submission cannot be presented as authenticated independent reviewer identity.

### Neutral

- Interactive CLI specialists, MCP access, state, gates, and transactional installation remain unchanged.
- Historical version probes remain dated evidence. The current `1.0.86` diagnostics are not release qualification.

## 🏛️ WAF Pillar Analysis

| Pillar      | Impact | Notes                                                                                    |
| ----------- | ------ | ---------------------------------------------------------------------------------------- |
| Security    | →      | Retains kernel authorization and existing worker grants; visibility is not authority     |
| Reliability | ↑      | Requires observed worker outcomes and rejection checks on the exact CLI candidate        |
| Performance | →      | Fewer generated files have negligible runtime impact                                     |
| Cost        | →      | No service, model, or infrastructure cost changes                                        |
| Operations  | ↑      | Removes an unsupported visibility prerequisite without claiming untested workflow parity |

## 🔒 Compliance Considerations

- No new tool, MCP server, model, deployment, approval, publication, or release authority is introduced.
- Raw prompts, responses, tool arguments, tool results, and probe telemetry remain uncommitted.
- The exact `1.0.75` release artifact digest and binary hash are decision evidence only.
- Release qualification still requires the selected exact client and generated projection hashes.

## 📝 Implementation Notes

- Keep current shipped role membership unchanged while creating isolated qualification candidates.
- Permit a nonempty subset of supported targets in the manifest schema and generator validation.
- Skip unsupported role/client pairs during deterministic projection generation.
- Filter delegation-tool injection by destination support for the active client.
- Mutation-test empty and unknown target declarations, single-target roles, and client-specific delegation.
- Compare candidate worker tools and models with canonical source; reject added permissions.
- Qualify actual worker outcomes before a separate reviewed target-membership change. Do not reintroduce a hidden-profile
  pass/fail security criterion in projection tests or release checklists.

---

<div align="center">

| ⬅️ [Previous ADR](03-des-adr-0005-use-selected-client-agent-projections.md) | 🏠 [Project Index](README.md) | Next ADR ➡️ |
| --------------------------------------------------------------------------- | ----------------------------- | ----------- |
| [ADR-0005](03-des-adr-0005-use-selected-client-agent-projections.md)        | [README](README.md)           | None        |

</div>
