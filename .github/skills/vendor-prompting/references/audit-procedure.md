<!-- ref:audit-procedure-v2 -->

# Audit Procedure

Protocol for auditing a single `.agent.md` or `.prompt.md` against vendor prompting best practices and APEX prompt
hygiene. Budget about 10 minutes per target.

## Inputs

- Path to one `.agent.md` or `.prompt.md` file.
- Working copy of this repo with `node`, `gh`, and `git` available.

## Outputs

- A filled-in audit report from [audit-template.md](../assets/audit-template.md), saved to
  `tmp/vendor-prompting-audits/{agent-name}-{YYYYMMDD}.md`.
- A verdict: APPROVED, NEEDS_REVISION, or REJECTED.

## Procedure

### Step 1 — Read frontmatter

Capture `name`, `user-invocable`, `tools[]`, and `handoffs[]`. If `model:`, `model-policy:` or `reasoning-effort:` is
present, record `model-pin-001` as an error.

### Step 2 — Run the validator

```bash
node tools/scripts/validate-agents.mjs \
  --only=vendor-prompting \
  --format=json \
  > /tmp/lint-out.json

jq '.findings[] | select(.file == "<path>")' /tmp/lint-out.json
```

Capture each finding's `ruleId`, `severity`, `message`, and `sourceUrl`.

### Step 3 — Manual pass

Open [checklists.md](checklists.md). For every checklist item, copy any validator finding and manually inspect the
remaining review-only items.

### Step 4 — Produce the report

Open [audit-template.md](../assets/audit-template.md). Fill in:

1. File path and frontmatter snapshot.
2. Automated findings table.
3. Manual findings table.
4. Severity summary.
5. Verdict and remediation.

Save to `tmp/vendor-prompting-audits/{name}-{YYYYMMDD}.md`.

## Bulk Audit

```bash
mkdir -p tmp/vendor-prompting-audits
node tools/scripts/validate-agents.mjs \
  --only=vendor-prompting \
  --format=json \
  > tmp/vendor-prompting-audits/_bulk.json

jq -r '.findings | group_by(.file) | .[] | {
  file: .[0].file,
  errors: ([.[] | select(.severity=="error")] | length),
  warns: ([.[] | select(.severity=="warn")] | length),
  rules: [.[].ruleId] | unique
}' tmp/vendor-prompting-audits/_bulk.json
```
