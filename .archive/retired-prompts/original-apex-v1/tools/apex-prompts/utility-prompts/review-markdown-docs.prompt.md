---
description: "Audit repository Markdown for completeness, accuracy, broken links, stale claims, and maintainability; report-only unless safe fixes are explicitly requested."
model: "Claude Opus 4.7"
agent: agent
tools: [read, search, execute, edit, todo]
argument-hint: "Optional scope under docs/ and optional --apply-fixes"
---

# Review Markdown Documentation

Audit the repository-native Markdown documentation without requiring a site
build. Default to report-only. Apply fixes only when the user includes
`--apply-fixes`.

<investigate_before_answering>

- Confirm `docs/README.md`, `README.md`, and the requested scope exist.
- Read `docs/MIGRATION.md` before treating historical source-repository links
  as stale.
- Treat `docs/vnext/phase-0a/**` as frozen evidence. Never rewrite it during a
  documentation review.
- Establish claims from current code, configuration, schemas, and tests before
  calling prose inaccurate.
  </investigate_before_answering>

## Scope

In scope:

- `docs/**/*.md`, excluding frozen Phase 0A payloads
- `README.md`, `CONTRIBUTING.md`, and current release notes in `CHANGELOG.md`
- Documentation-specific instructions, skills, prompts, hooks, and workflows

Out of scope:

- `agent-output/**/*.md`, which uses the artifact contract
- Historical changelog entries unless they contain a broken local link
- Generated or vendored Markdown
- Runtime, agent, skill, or infrastructure edits

## Review Workflow

1. Build an inventory of Markdown files and links from `docs/README.md`.
2. Run `npm run validate:docs` and record every deterministic failure.
3. Check each user guide against the current CLI, package scripts, schemas,
   configuration, and workflows it describes.
4. Check project-control docs for current repository, branch, issue, release,
   and qualification ownership.
5. Flag removed-site syntax or assumptions, including Starlight routes,
   `:::` callouts, MDX-only components, and `site/` build commands.
6. Check headings, navigation, code examples, terminology, security warnings,
   and release-boundary language.
7. Rank findings by impact: blocker, high, medium, or low.
8. If `--apply-fixes` is absent, stop after the report.
9. If `--apply-fixes` is present, apply only deterministic documentation fixes
   within the requested scope, then rerun `npm run validate:docs`.

## Output

Write `agent-output/_baselines/docs-review-{timestamp}.md` containing:

- Scope and source commit
- Validator results
- Findings with file and line references
- Proposed or applied changes
- Remaining manual verification
- Final verdict: `PASS`, `NEEDS_REVISION`, or `BLOCKED`

## Constraints

- Do not invent product behavior to make documentation internally consistent.
- Do not weaken validators or ignore broken links.
- Do not edit frozen Phase 0A evidence.
- Do not modify runtime code in a documentation review.
- Use `tools/registry/count-manifest.json` whenever an exact entity count is
  required.
