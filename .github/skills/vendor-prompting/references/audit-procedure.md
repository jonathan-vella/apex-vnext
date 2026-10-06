<!-- ref:audit-procedure-v1 -->

# Audit Procedure

End-to-end protocol for auditing a single `.agent.md` or `.prompt.md`
against vendor prompting best practices. ~10-15 minutes per agent.

## Inputs

- Path to one `.agent.md` or `.prompt.md` file.
- Working copy of this repo with `node`, `gh`, and `git` available.

## Outputs

- A filled-in audit report (template:
  [assets/audit-template.md](../assets/audit-template.md)) saved to
  `tmp/vendor-prompting-audits/{agent-name}-{YYYYMMDD}.md`.
- A verdict: APPROVED, NEEDS_REVISION, or REJECTED.

## Procedure

### Step 1 — Read frontmatter

Open the target file. Capture:

- `name`
- `user-invocable` (default `true` if missing)
- `agents` (subagent list)
- `tools[]` count
- `handoffs[]` count

If `model:`, `model-policy:` or `reasoning-effort:` is present, record
`model-pin-001` (error). Repository agents omit them; the session model
applies.

### Step 2 — Record target context

Record any known session model, client, or vendor target supplied by
the audit request. Repository-managed agents and prompts do not declare
`model:`; do not add a model pin while auditing. If no target model is
known, run only the model-neutral validator checks and any manual
checks that are relevant to the prose being reviewed.

### Step 3 — Load matching checklist

Open [checklists.md](checklists.md). Use:

- Agent column for `.agent.md`, prompt column for `.prompt.md`.
- The cross-vendor section ALWAYS.
- Any vendor-specific background section relevant to the known target
  context or prompt style.

### Step 4 — Run the validator

```bash
node tools/scripts/validate-agents.mjs \
  --only=vendor-prompting \
  --format=json \
  > /tmp/lint-out.json

# Filter for the target file
jq '.findings[] | select(.file == "<path>")' /tmp/lint-out.json
```

Capture each finding's `ruleId`, `severity`, `message`, `sourceUrl`.

### Step 5 — Manual pass

For every checklist item from step 3:

- If the validator already covered it (rule ID present in step 4
  output), copy the finding.
- If not, perform the verification hint manually and record YES/NO
  - 1-line note.

Reviewer-only rules (no validator binding) MUST be assessed
manually.

### Step 6 — Produce the report

Open [assets/audit-template.md](../assets/audit-template.md).
Fill in:

1. File path and known target context, if any.
2. Automated findings table (from step 4).
3. Manual findings table (from step 5).
4. Severity summary (counts of error / warn / info).
5. Verdict per gate:
   - **APPROVED** if `errors == 0` AND `warnings ≤ 5`.
   - **NEEDS_REVISION** otherwise (with per-rule remediation).
   - **REJECTED** if any validator finding or manual audit finding will
     break runtime.

Save to `tmp/vendor-prompting-audits/{name}-{YYYYMMDD}.md`.

## Bulk audit (all agents)

```bash
mkdir -p tmp/vendor-prompting-audits
node tools/scripts/validate-agents.mjs \
  --only=vendor-prompting \
  --format=json \
  > tmp/vendor-prompting-audits/_bulk.json

# Per-agent breakdown
jq -r '.findings | group_by(.file) | .[] | {
  file: .[0].file,
  errors: ([.[] | select(.severity=="error")] | length),
  warns: ([.[] | select(.severity=="warn")] | length),
  rules: [.[].ruleId] | unique
}' tmp/vendor-prompting-audits/_bulk.json
```

For the live-audit gate (Phase 8 of the implementation plan, item #50),
reject the release if:

- Any agent has `errors > 0`, OR
- Average `warns` across all agents > 5.
