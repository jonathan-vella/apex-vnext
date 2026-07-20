# ADR-0004: Use Bounded Observe-And-Propose Improvement

![Step](https://img.shields.io/badge/Step-3-blue?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Accepted-brightgreen?style=for-the-badge)
![Type](https://img.shields.io/badge/Type-ADR-purple?style=for-the-badge)

> Status: Accepted
> Date: 2026-07-17
> Deciders: APEX maintainers

## 🔍 Context

Issue [#12](https://github.com/jonathan-vella/apex-vnext/issues/12) asks APEX to learn from repeated modernization evidence
without granting an agent autonomous repository or deployment authority. Two concept sources were reviewed at exact
commits:

- `pskoett/self-improving-agent@114ca7b5572258bb4c68ad6095f79ab981962d95`
- `pskoett/pskoett-ai-skills@20e64cec1529d9c371fdcc20c751b7ef10b68af7`

GitHub reported `NOASSERTION`, and neither checkout had a root license. APEX therefore treats them as concept references
only. No implementation, prompt text, templates, or documentation were copied. The design below was implemented
clean-room against APEX contracts and authority boundaries.

## ✅ Decision

Adopt a policy-controlled observe-and-propose subsystem with these properties:

1. Store only structured, redacted observations tied to a project, run, and content-addressed evidence.
2. Deduplicate identical observations within a run and require recurrence across distinct runs in a bounded window.
3. Generate deterministic proposals marked `inert: true`; proposals never mutate code, instructions, skills, backlog,
   issues, pull requests, runtime context, approvals, or infrastructure.
4. Require an explicit human CLI decision to accept, reject, or defer a proposal. A decision records intent only and
   does not apply a change.
5. Lock the policy hash into the runtime bundle. Policy fixes sources, categories, targets, limits, recurrence,
   retention, human authority, issue-creation denial, and context-injection denial.
6. Expose only observation submission and read-only observation/proposal access through MCP. Keep scan, decision,
   deletion, and pruning in the trusted CLI.

## 🔄 Alternatives Considered

| Option | Pros | Cons | WAF Impact |
| --- | --- | --- | --- |
| Autonomous self-modification | Fast feedback loop | Prompt injection and unreviewed mutation become authority | Security ↓, Operations ↓ |
| Copy either reference project | Lower implementation effort | No usable license or APEX authority guarantees | Security ↓, Operations ↓ |
| Manual issue notes only | Minimal code | No deterministic deduplication, recurrence, or retention | Reliability ↓, Operations ↓ |
| Bounded observe-and-propose | Measurable and reviewable | Requires human triage and lifecycle maintenance | Security ↑, Operations ↑ |

## ⚖️ Consequences

### Positive

- Repeated evidence becomes deterministic, deduplicated, reviewable data rather than hidden model memory.
- Redaction, quarantine, strict schemas, retention, and deletion reduce data and prompt-injection risk.
- Human authority and repository/deployment authority remain separate from proposal generation.

### Negative

- Maintainers must review proposals and implement accepted changes through the normal contribution workflow.
- Conservative recurrence thresholds can delay useful proposals; broad patterns can still require human rejection.

### Neutral

- This subsystem does not change task, gate, writer, preview, approval, or deployment state.
- An accepted decision is not evidence that a repository change was implemented.

## 🏛️ WAF Pillar Analysis

| Pillar | Impact | Notes |
| --- | --- | --- |
| Security | ↑ | Redaction, quarantine, no context injection, and no autonomous mutation |
| Reliability | ↑ | Stable IDs, distinct-run recurrence, atomic writes, and deterministic replay |
| Performance | → | Bounded local scans add small storage and CPU costs outside deployment authority |
| Cost | → | Local processing adds no Azure resource or external model requirement |
| Operations | ↑ | Proposals and immutable decisions provide an auditable human triage path |

## 🔒 Compliance Considerations

- Improvement files use atomic mode-`0600` writes and remain local runtime data.
- Secret-like fields are redacted; instruction-like content is quarantined and cannot enter recurrence.
- Policy provides observation and decision retention plus explicit observation deletion and pruning commands.
- External references are restricted to GitHub issue or pull-request URLs and are never created automatically.

## 📝 Implementation Notes

- The deterministic proof command is `npm run test:bounded-improvement`.
- The proof produced active recurring evidence, one deduplicated repeat, one quarantined injection, one inert proposal,
  and a human rejection with zero autonomous actions.
- CLI operations and authority boundaries are documented in
  [the CLI reference](../../docs/guides/cli-reference.md#operate-bounded-improvement).
- Security and lifecycle controls are documented in
  [the security guide](../../docs/guides/security.md#bound-improvement-authority).

---

<div align="center">

| ⬅️ [Previous ADR](03-des-adr-0003-use-bounded-entra-only-handoff-session.md) | 🏠 [Project Index](README.md) | Next ADR ➡️ |
| --- | --- | --- |
| [ADR-0003](03-des-adr-0003-use-bounded-entra-only-handoff-session.md) | [README](README.md) | None |

</div>
