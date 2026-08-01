# ADR-0005: Use Selected Client Agent Projections

![Step](https://img.shields.io/badge/Step-3-blue?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Proposed-orange?style=for-the-badge)
![Type](https://img.shields.io/badge/Type-ADR-purple?style=for-the-badge)

> Status: Proposed
> Date: 2026-07-28
> Deciders: APEX maintainers

## 🔍 Context

DECISION-012 requires equivalent governed outcomes in GitHub Copilot for VS Code and GitHub Copilot CLI. Issue
[#150](https://github.com/jonathan-vella/apex-vnext/issues/150) made input requests and answers kernel-owned, but the
current customization bundle installs identical VS Code-shaped agent files for both clients.

Pinned Copilot CLI `1.0.73` accepts scalar model fields, `ask_user`, global `task` delegation,
`disable-model-invocation`, and `user-invocable`. It does not define VS Code's model arrays, `vscode/askQuestions`,
`handoffs`, `argument-hint`, or per-parent `agents` allowlists. A single active file cannot satisfy both client contracts
without invalid fields, extra tools, or weaker delegation controls.

Requirements: `REQ-DIST-001`, `REQ-CUSTOMIZATION-001`, `REQ-SECURITY-001`, `REQ-DETERMINISM-001`, and
`REQ-DOCS-001`.

## ✅ Decision

Generate two client-valid projections from one semantic role graph in `customizations/manifest.json` and one shared body
per role. Materialize exactly one selected client projection into a consumer workspace through the existing transactional
customization lifecycle.

- VS Code projections use array model syntax, `vscode/askQuestions`, direct handoffs, and per-parent agent allowlists.
- Copilot CLI projections use scalar model syntax, `ask_user`, `task`, `disable-model-invocation`, and no VS Code-only
  fields.
- Shared role bodies, task semantics, kernel operations, and authority boundaries remain canonical once.
- The selected client ID is persisted in the customization lock and retained by update, rollback, and recovery.
- Generated provenance binds manifest role, body source, adapter version, client ID, target path, bytes, and digest.
- Exact CLI APEX MCP tool selectors come from a pinned live inventory; generation fails closed when that inventory is
  absent or stale.
- Live paired-client qualification remains mandatory before this ADR can become Accepted.

## 🔄 Alternatives Considered

| Option                                    | Pros                                                     | Cons                                                                | WAF Impact                       |
| ----------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------- |
| Explicit selected-client materialization  | Valid least-privilege definitions and one semantic owner | Adds client selection and projection generation                     | Security ↑, Operations ↑         |
| One polyglot agent set                    | Simpler installation                                     | Invalid client fields, extra question tools, and broader delegation | Security ↓, Reliability ↓        |
| Install CLI agents under `.claude/agents` | Separate source trees                                    | Nonpreferred discovery, shadowing risk, and duplicate ownership     | Operations ↓, Reliability ↓      |
| Add a custom delegation extension         | Could enforce identical child allowlists                 | New runtime/tool authority and larger qualification surface         | Security →, Cost ↓, Operations ↓ |

## ⚖️ Consequences

### Positive

- Each client receives syntax and tools it actually supports.
- One semantic manifest and shared body prevent workflow or role drift.
- Selected-client installation avoids duplicate role names and polyglot authority.
- Existing atomic conflict, rollback, recovery, and unrelated-file preservation remain the lifecycle owner.

### Negative

- Initialization requires an explicit supported client selection.
- Generated agent files are no longer byte-identical across clients.
- Copilot CLI cannot reproduce VS Code's per-parent delegation allowlist in frontmatter; kernel authorization and live
  denial tests must close that gap.
- Tool inventories and client parser behavior need version-bound qualification.

### Neutral

- Client UI mechanics may differ while typed kernel outcomes remain equal.
- GitHub Copilot cloud coding-agent sessions, Copilot code review, and `/delegate` remain outside the APEX client scope.

## 🏛️ WAF Pillar Analysis

| Pillar      | Impact | Notes                                                                           |
| ----------- | ------ | ------------------------------------------------------------------------------- |
| Security    | ↑      | Client-valid least-privilege tools replace a broader polyglot definition        |
| Reliability | ↑      | Deterministic generation and client-bound locks prevent projection drift        |
| Performance | →      | Build-time rendering adds negligible runtime cost                               |
| Cost        | →      | No Azure resource or additional service is introduced                           |
| Operations  | ↑      | Explicit selection, provenance, rollback, and validation improve supportability |

## 🔒 Compliance Considerations

- No user-global client configuration is written.
- Managed MCP operations remain workspace-local and kernel-authorized.
- Generated files contain no credentials, client transcripts, prompts, or raw tool results.
- Client selection cannot grant deployment, approval, publication, release, tag, or cutover authority.

## 📝 Implementation Notes

- Issue [#152](https://github.com/jonathan-vella/apex-vnext/issues/152) owns implementation.
- Add manifest and generated-projection schemas before changing installation behavior.
- Keep body sources free of client-specific tool names; inject mechanics in deterministic adapters.
- Validate both projections independently, but install only the selected one.
- Rerun `CLIENT-002`, `CLIENT-003`, `CLIENT-005`, `CLIENT-009`, and `CLIENT-010` on pinned clients before acceptance.

---

<div align="center">

| ⬅️ [Previous ADR](03-des-adr-0004-use-bounded-observe-and-propose-improvement.md) | 🏠 [Project Index](README.md) | Next ADR ➡️ |
| --------------------------------------------------------------------------------- | ----------------------------- | ----------- |
| [ADR-0004](03-des-adr-0004-use-bounded-observe-and-propose-improvement.md)        | [README](README.md)           | None        |

</div>
