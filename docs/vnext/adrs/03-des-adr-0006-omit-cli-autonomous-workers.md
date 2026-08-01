# ADR-0006: Omit Copilot CLI Autonomous Workers

![Step](https://img.shields.io/badge/Step-3-blue?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Proposed-orange?style=for-the-badge)
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

> Status: Proposed
> Date: 2026-07-29
> Deciders: APEX maintainers

## 🔍 Context

APEX autonomous workers must be unavailable for direct user selection while remaining callable only through declared
parents. Issue #179 showed that Copilot CLI `1.0.73` did not provide that combination. Exact-release characterization of
stable Copilot CLI `1.0.75` reproduced the same behavior: `user-invocable: false` did not prevent direct `--agent`
selection, while `disable-model-invocation: true` removed the worker from the `task.agent_type` catalog.

Direct selection cannot be treated as harmless. Task envelopes constrain capabilities and state, but the kernel does not
authenticate the initiating client-agent profile. Generic `task` prompts would remove profile-bound model and tool
constraints. Requirements: `REQ-CUSTOMIZATION-001`, `REQ-SECURITY-001`, `REQ-DETERMINISM-001`, and `REQ-DOCS-001`.

## ✅ Decision

Omit autonomous worker roles from the Copilot CLI projection until an exact supported CLI independently enforces direct
selection visibility and declared-parent invocation.

- Keep autonomous workers in the VS Code projection, where parent allowlists can express the intended boundary.
- Keep interactive specialists in both projections.
- Derive projection membership from each manifest role's `supportedTargets` declaration.
- Add `task` to a parent only when at least one declared destination is supported by that client projection.
- Mark worker-dependent Copilot CLI scenarios unavailable; do not substitute generic tasks or broaden worker visibility.
- Preserve issue #180's exact-client qualification requirement before any release claim.

## 🔄 Alternatives Considered

| Option                             | Pros                              | Cons                                                                        | WAF Impact                |
| ---------------------------------- | --------------------------------- | --------------------------------------------------------------------------- | ------------------------- |
| Omit CLI autonomous workers        | Fail-closed, explicit, reversible | Worker-dependent CLI flows remain unavailable                               | Security ↑, Reliability ↑ |
| Accept directly selectable workers | Retains profile tools and models  | User can bypass declared parents; kernel cannot authenticate caller profile | Security ↓                |
| Use generic `task` prompts         | Avoids selectable worker profiles | Loses profile-bound model, tools, and deterministic role identity           | Security ↓, Operations ↓  |
| Re-pin to CLI `1.0.75`             | Uses a newer exact stable binary  | Exact probe reproduced the same visibility/delegation gap                   | Reliability →             |

## ⚖️ Consequences

### Positive

- Unsupported CLI authority is absent instead of silently broadened.
- Manifest target declarations make the client boundary deterministic and independently reversible.
- Parent tool injection cannot advertise delegation when that client has no supported destination.

### Negative

- Copilot CLI cannot complete workflows that require CodeGen, Reviewer, or Validator workers.
- `CLIENT-005` and complete paired qualification remain unavailable.
- Target parity is intentionally narrower until the upstream client supports the required controls.

### Neutral

- Interactive CLI specialists, MCP access, state, gates, and transactional installation remain unchanged.
- The selected CLI version remains `1.0.73`; the `1.0.75` probe is decision evidence, not release qualification.

## 🏛️ WAF Pillar Analysis

| Pillar      | Impact | Notes                                                                                    |
| ----------- | ------ | ---------------------------------------------------------------------------------------- |
| Security    | ↑      | Removes directly selectable autonomous worker profiles from the CLI projection           |
| Reliability | ↑      | Unsupported delegation fails through deterministic absence rather than prompt convention |
| Performance | →      | Fewer generated files have negligible runtime impact                                     |
| Cost        | →      | No service, model, or infrastructure cost changes                                        |
| Operations  | ↓      | Some CLI workflows remain unavailable and require explicit qualification status          |

## 🔒 Compliance Considerations

- No new tool, MCP server, model, deployment, approval, publication, or release authority is introduced.
- Raw prompts, responses, tool arguments, tool results, and probe telemetry remain uncommitted.
- The exact `1.0.75` release artifact digest and binary hash are decision evidence only.
- Release qualification still requires the selected exact client and generated projection hashes.

## 📝 Implementation Notes

- Set autonomous roles' `supportedTargets` to `vscode` in `customizations/manifest.json`.
- Permit a nonempty subset of supported targets in the manifest schema and generator validation.
- Skip unsupported role/client pairs during deterministic projection generation.
- Filter delegation-tool injection by destination support for the active client.
- Mutation-test empty and unknown target declarations, single-target roles, and client-specific delegation.
- Roll back by restoring a role's `github-copilot` target only after exact-client evidence proves the required boundary.

---

<div align="center">

| ⬅️ [Previous ADR](03-des-adr-0005-use-selected-client-agent-projections.md) | 🏠 [Project Index](README.md) | Next ADR ➡️ |
| --------------------------------------------------------------------------- | ----------------------------- | ----------- |
| [ADR-0005](03-des-adr-0005-use-selected-client-agent-projections.md)        | [README](README.md)           | None        |

</div>
