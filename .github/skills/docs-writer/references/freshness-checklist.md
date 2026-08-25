<!-- ref:freshness-checklist-v1 -->

# Freshness Checklist

> For use by the `docs-writer` skill. Defines audit targets and auto-fix
> rules for detecting stale documentation.

## How to Run a Freshness Audit

1. Read `VERSION.md` to get the canonical version number.
2. Walk through each audit target below.
3. For each issue found, note: file path, line, issue, suggested fix.
4. Present all issues in a summary table.
5. Apply fixes after user confirmation (or immediately if told "fix all").

## Audit Targets

### 1. Version Number Sync

**Source of truth**: `VERSION.md` → `Current Version: X.Y.Z`

**Files to check**:

| File                                        | What to look for                   |
| ------------------------------------------- | ---------------------------------- |
| `docs/*.md`                                 | `> Version X.Y.Z` in header line   |
| `customizations/.github/instructions/apex-documentation.instructions.md` | Version in header template example |

**Auto-fix**: Replace old version string with current from `VERSION.md`.

### 2. Agent Count and Table

**Source of truth**: List `customizations/.github/agents/*.agent.md` files
(exclude `_subagents/` directory).

**Expected count**: computed dynamically from `tools/registry/count-manifest.json`
(run `validate:no-hardcoded-counts` to verify)

**Files to check**:

| File                                        | What to verify                   |
| ------------------------------------------- | -------------------------------- |
| `customizations/.github/instructions/apex-documentation.instructions.md` | Managed agent inventory and table |

**Auto-fix**: Update count in heading. Add missing agents to table
matching the existing column format. Remove entries for agents that
no longer exist.

### 3. Skill Count and Table

**Source of truth**: List `.github/skills/*/` directories
(exclude `README.md` file).

**Expected count**: computed dynamically from `tools/registry/count-manifest.json`
(run `validate:no-hardcoded-counts` to verify)

**Files to check**:

| File                                        | What to verify                   |
| ------------------------------------------- | -------------------------------- |
| `customizations/.github/instructions/apex-documentation.instructions.md` | Managed skill inventory and table |

**Auto-fix**: Update count in heading. Add missing skills to the
appropriate category table. Remove entries for deleted skills.

### 4. Documentation Index Currency

**Source of truth**: `docs/README.md`, `customizations/.github/agents/`, and `.github/skills/`.

**Files to check**:

| File             | What to verify                                      |
| ---------------- | --------------------------------------------------- |
| `docs/README.md` | User guides and project-control links match files   |
| `README.md`      | Entry points match the current documentation layout |

**Auto-fix**: Update links and descriptions to match the current files.

### 5. Prohibited References

**Rule**: Removed agents must not be referenced in live docs.

**Banned patterns**:

- `diagram.agent.md`
- `adr.agent.md`
- `docs.agent.md`
- `site/src/content/docs/`
- `site/public/`

**Files to check**: All `docs/**/*.md`, `README.md`, and `CONTRIBUTING.md`.

**Auto-fix**: Replace with the correct skill reference
(see `references/doc-standards.md` → Prohibited References table).

### 6. Deprecated Path Links

**Rule**: No live doc should link to removed directories.

**Check**: Grep all in-scope markdown files for links to non-existent paths.

**Auto-fix**: Remove the link or replace with the current equivalent.

### 7. Instruction File Table Sync

**Source of truth**: List `customizations/.github/instructions/*.instructions.md` files.

**Expected count** (as of 2026-02-26): computed dynamically from `tools/registry/count-manifest.json`
(run `validate:no-hardcoded-counts` to verify)

**Files to check**: Only relevant if the root
`README.md` lists instruction files.

**Auto-fix**: Update table entries.

### 8. Template Inventory Sync

**Source of truth**: List `.github/skills/azure-artifacts/templates/*.template.md` files.

**Expected count** (as of 2026-02-09): computed dynamically from `tools/registry/count-manifest.json`
(run `validate:no-hardcoded-counts` to verify)

**Files to check**: Only relevant if documentation references
template counts.

**Auto-fix**: Update count reference.

### 9. Support And Project Controls

**Source of truth**: `customizations/manifest.json`, versioned config, package source, and `docs/vnext/` controls.

Verify that client, IaC, qualification, release, and product-status claims distinguish implementation from current
evidence. Update the documentation inventory when ownership or lifecycle changes.

## Summary Table Template

When reporting audit results, use this format:

```markdown
| #   | File                 | Line | Issue                                      | Fix            |
| --- | -------------------- | ---- | ------------------------------------------ | -------------- |
| 1   | docs.instructions.md | 34   | Missing `design` and `orchestrator` agents | Add table rows |
```

## Current Contract

Run `npm run validate:docs`. The generated CLI/MCP inventories, active navigation, retired-path guard, and predecessor
history boundary must all pass.
