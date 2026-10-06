<!-- ref:cross-model-rules-v1 -->

# Cross-Model Rules

Family-neutral rules for handoff design, language calibration and decision logging.

## Rule R-X-3 — No model pins

> Source: [DECISIONS.md](../../../../docs/vnext/DECISIONS.md) DECISION-033.

**Rule** (`model-pin-001`): `.agent.md` and `.prompt.md` files must not
declare `model:`, `model-policy:` or `reasoning-effort:`. The user picks
the session model (auto by default); pins drift from the client picker
and fail when a model is retired.

**Severity**: error.

## Rule R-X-4 — Handoff prompt enrichment

> Source: [agent-authoring.instructions.md](../../../../customizations/.github/instructions/apex-agent-authoring.instructions.md)
> (existing repo convention).

**Rule** (`handoff-enrichment-001`): every `handoffs[].prompt` must
contain BOTH:

1. An **input reference** — regex `agent-output/.+\.md` OR the
   literal `Input:` (case-insensitive).
2. An **output reference** — regex `Output:` OR an explicit save
   path.

**Example (good)**:

```yaml
handoffs:
  - agent: 03-Architect
    prompt: "Create a WAF assessment based on agent-output/{project}/01-requirements.md.
      Output: 02-architecture-assessment.md and 03-des-cost-estimate.md."
```

**Example (bad — missing input)**:

```yaml
handoffs:
  - agent: 03-Architect
    prompt: "Begin architecture review."
```

## Rule R-X-5 — Decision logging

Record significant architecture, SKU, security, networking and deployment choices in the owning typed artifact with
rationale, alternatives and consequences. Submit through the current stage-specific completion operation; reviewers do
not write state or approve their own findings. See [checklists.md](checklists.md).

## Rule R-X-6 — Few-shot example placement

> Source: Anthropic "Use examples effectively" + OpenAI guide
> on prompt examples.

**Reviewer hint**: examples should appear at the END of the agent
body (both vendors agree). Claude wraps in `<example>` /
`<examples>`; GPT-5.5 uses fenced code blocks. Keep examples under
12 lines.

## Rule R-X-7 — Language calibration

> Source: [Anthropic doc](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
> "Tell Claude what to do instead of what not to do."
> Plus [OpenAI guide](.snapshots/openai-prompting-guide.md)
> "Avoid unnecessary absolute rules."

**Rule** (`cross-language-density-001`, both vendors): density of
absolute words ("ALWAYS", "NEVER", "MUST", "HARD RULE") must not
exceed 0.05 outside permitted contexts (security baseline,
governance, approval gate, non-negotiable).

**Permitted prose contexts** (detected by paragraph keywords):

- `security baseline` paragraphs (e.g., TLS 1.2, HTTPS-only)
- `governance` paragraphs (Azure Policy compliance)
- `approval gate` paragraphs (workflow checkpoints)
- `non-negotiable` paragraphs (explicit invariants)

Outside these, prefer decision rules over absolutes.
