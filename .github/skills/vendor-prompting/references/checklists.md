<!-- ref:checklists-v2 -->

# Audit Checklists

Copy-paste reviewer checklists. Each item names the `rules.json` rule ID and a verification hint.

## Agent Checklist (`*.agent.md`)

- [ ] Frontmatter has no `model:`, `model-policy:` or `reasoning-effort:`.
      _(rule `model-pin-001`)_
      Hint: `head -20 <file>`.
- [ ] Every `handoffs[].prompt` contains both an input reference and an output reference.
      _(rule `handoff-enrichment-001`)_
      Hint: `grep -A2 "prompt:" <file> | grep -E "agent-output|Input:|Output:"`.
- [ ] Absolute words density (ALWAYS/NEVER/MUST/HARD RULE) is no more than 0.05 outside
      security/governance/approval-gate/non-negotiable paragraphs.
      _(rule `cross-language-density-001`)_
      Hint: `grep -ciE "ALWAYS|NEVER|MUST|HARD RULE" <file>` and divide by `wc -l`.
- [ ] `# Personality` appears only on user-facing agents.
      _(rule `personality-scoping-001`)_
      Hint: check `user-invocable`, the agent role, and whether the section affects user-facing behavior.

## Prompt Checklist (`*.prompt.md`)

- [ ] Frontmatter has no `model:`, `model-policy:` or `reasoning-effort:`.
      _(rule `model-pin-001`)_
      Hint: `node tools/scripts/validate-agents.mjs --only=vendor-prompting`.
- [ ] Prompt does not over-specify procedure when the target agent should decide the workflow details.
      _(manual review)_

## Verdict Template

```text
File:            <path>
Errors:          <count>
Warnings:        <count>
Info:            <count>
Reviewer notes:  <freeform>

Verdict:         APPROVED | NEEDS_REVISION | REJECTED
```

- APPROVED if errors are zero and no warning affects the target workflow.
- NEEDS_REVISION when a validator-backed or manual finding needs remediation.
- REJECTED if a violation will break runtime, such as invalid frontmatter or `model-pin-001`.
