---
description: "Guidelines for creating high-quality Agent Skills for GitHub Copilot"
applyTo: "**/.github/skills/**/SKILL.md, **/.claude/skills/**/SKILL.md"
---

# Agent Skills File Guidelines

Agent Skills are folders of instructions, scripts, and resources that Copilot
loads on demand. They follow the [Agent Skills open standard](https://agentskills.io/)
and work across VS Code, Copilot CLI, and Copilot coding agent.

For the complete official reference, see
[VS Code Agent Skills docs](https://code.visualstudio.com/docs/copilot/customization/agent-skills).

## Required SKILL.md Frontmatter

```yaml
---
name: webapp-testing
description: "Toolkit for testing local web apps using Playwright. Use when asked to verify frontend functionality, debug UI behavior, or capture screenshots."
---
```

| Field                      | Required | Constraints                                                                        |
| -------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `name`                     | Yes      | Lowercase, hyphens for spaces, max 64 chars. **Must match parent directory name.** |
| `description`              | Yes      | State **WHAT** it does, **WHEN** to use it, and **KEYWORDS**; max 1024 chars       |
| `argument-hint`            | No       | Hint text shown in chat input when invoked as a `/` slash command                  |
| `user-invocable`           | No       | Boolean, default `true`. Set `false` to hide from `/` menu                         |
| `disable-model-invocation` | No       | Boolean, default `false`. Set `true` to require manual `/` invocation only         |
| `license`                  | No       | Reference to `LICENSE.txt` or SPDX identifier                                      |

**Name matching rule**: The `name` field MUST match its parent directory.
If the directory is `.github/skills/webapp-testing/`, the name must be
`webapp-testing`. Mismatched names prevent the skill from loading.

**Description is the discovery key**: Copilot reads ONLY `name` +
`description` to decide whether to load a skill. A vague description
means the skill never activates.

**NEVER use YAML block scalars** (`>`, `>-`, `|`, `|-`) for description.
Use a single-line `description: "..."` inline string.
Block scalars break VS Code prompts-diagnostics-provider.

## Slash Command Visibility

Skills are available as `/` slash commands alongside prompt files.
Use `user-invocable` and `disable-model-invocation` to control access:

| Configuration                    | In `/` menu | Auto-loaded by model | Use case               |
| -------------------------------- | ----------- | -------------------- | ---------------------- |
| Default (both omitted)           | Yes         | Yes                  | General-purpose skills |
| `user-invocable: false`          | No          | Yes                  | Background knowledge   |
| `disable-model-invocation: true` | Yes         | No                   | On-demand only         |
| Both set                         | No          | No                   | Disabled               |

## Skill Locations

| Scope        | Path                                                           |
| ------------ | -------------------------------------------------------------- |
| Workspace    | `.github/skills/`, `.claude/skills/`, `.agents/skills/`        |
| User profile | `~/.copilot/skills/`, `~/.claude/skills/`, `~/.agents/skills/` |
| Custom       | Configured via `chat.agentSkillsLocations` setting             |

## Body Sections

| Section                     | Purpose                                             |
| --------------------------- | --------------------------------------------------- |
| `# Title`                   | Brief overview of what this skill enables           |
| `## When to Use This Skill` | List of scenarios (reinforces description triggers) |
| `## Prerequisites`          | Required tools, dependencies, environment setup     |
| `## Step-by-Step Workflows` | Numbered steps for common tasks                     |
| `## Troubleshooting`        | Common issues and solutions table                   |
| `## References`             | Links to bundled docs or external resources         |

## Directory Structure

```text
.github/skills/<skill-name>/
├── SKILL.md              # Required: Main instructions (≤500 lines)
├── LICENSE.txt            # Recommended: License terms
├── scripts/              # Executable automation (loaded when executed)
├── references/           # Documentation (loaded when referenced by SKILL.md)
├── assets/               # Static files used AS-IS in output (not loaded into context)
└── templates/            # Starter code the AI agent MODIFIES and builds upon
```

**Assets vs Templates**: If the AI reads and builds upon it → `templates/`.
If the file is used as-is in output → `assets/`.

## Progressive Loading

| Level           | What Loads                    | When                              |
| --------------- | ----------------------------- | --------------------------------- |
| 1. Discovery    | `name` and `description` only | Always (lightweight metadata)     |
| 2. Instructions | Full `SKILL.md` body          | When request matches description  |
| 3. Resources    | Scripts, examples, docs       | Only when Copilot references them |

## Writing Rules

- Imperative mood: "Run", "Create", "Configure"
- Include exact commands with parameters
- Keep SKILL.md body ≤500 lines; split large workflows into `references/`
- Use relative paths for all resource references (e.g., `[script](./run-tests.js)`)
- Use `#tool:<tool-name>` to reference agent tools in body text
- No hardcoded credentials or secrets
- Include `--help` documentation and error handling in scripts

## Wiring a Skill to an Agent

Skills are wired by referencing them in the agent body and managed customization manifest, **not** by a separate agent
registry. The orphan-content validator
(`tools/scripts/validate-orphaned-content.mjs`) discovers references at
runtime by scanning agent bodies, other skills, and instruction files for
the canonical pattern:

```text
.github/skills/{name}/SKILL.md
```

There is one tier. Use this filename for every wiring reference.

The validator also accepts:

- References without the leading `.github/` prefix (`skills/{name}/SKILL.md`)
- References inside fenced shell code blocks (e.g., `cat .github/skills/{name}/SKILL.md`)

References to `references/` or `templates/` subpaths inside the same skill
are picked up via fallback containment checks but are not the preferred
wiring form. Use the canonical `SKILL.md` pattern for explicit wiring.

## Anthropic Skill Authoring Best Practices

Source: [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).
Apply these whenever a `SKILL.md` or a bundled file is created or modified. The frontmatter mechanics above win on
format; these rules govern content.

### Conciseness and degrees of freedom

- Assume the model is already capable. Add only context it does not have, and delete any paragraph that does not
  justify its token cost.
- Match specificity to task fragility:
  - **High freedom** (prose guidance) when several approaches are valid and context decides.
  - **Medium freedom** (parameterised pseudocode or a configurable script) when a preferred pattern exists.
  - **Low freedom** (one exact command, no variation) when the operation is fragile or order-dependent. Say
    "Do not modify the command" explicitly.
- Give one default approach plus an escape hatch. Never list interchangeable libraries or tools as equal options.

### Naming and description

- Prefer gerund names (`processing-pdfs`, `analyzing-spreadsheets`). Noun-phrase and action forms are acceptable;
  keep one pattern across the collection.
- Never use vague names (`helper`, `utils`, `tools`), overly generic names (`documents`, `data`), reserved words
  (`anthropic`, `claude`), or XML tags in `name` or `description`.
- Write descriptions in third person. Never "I can help you…" or "You can use this to…".

### Progressive disclosure

- Treat `SKILL.md` as a table of contents, not the manual. Push detail into bundled files.
- Pick one pattern: high-level guide with links, domain-split `references/` files, or conditional links to advanced
  material.
- Keep every reference **one level deep from `SKILL.md`**. Nested links cause partial reads and lost information.
- Give any reference file over 100 lines a `## Contents` list at the top.
- Name files by content (`form-validation-rules.md`, not `doc2.md`) and organise directories by domain.

### Workflows, feedback loops, and content hygiene

- Express multi-step work as numbered steps with a copyable progress checklist.
- Include a validator loop for quality-critical work: run the check, fix the reported errors, re-run, and only proceed
  once it passes.
- Use a conditional-workflow branch at decision points, and move large branches into separate files.
- Provide output templates marked either exact ("ALWAYS use this template") or advisory ("sensible default").
- Show concrete input/output example pairs when output style matters. Examples beat abstract description.
- Exclude time-sensitive statements. Put superseded guidance in a collapsed "Old patterns" section instead.
- Use one term per concept throughout the skill.

### Bundled scripts

- Scripts must solve the problem, not defer it. Handle missing files and permission errors with a usable fallback.
- Justify every constant in a comment. No unexplained magic numbers.
- Prefer a committed utility script over model-generated code; it is more reliable and consumes no context.
- State intent explicitly: "Run `x.py` to …" (execute) versus "See `x.py` for the algorithm" (read as reference).
- For batch or destructive work use plan → validate → execute: write a structured plan file, validate it with a
  script, then apply. Validation errors must name the offending value and list the valid alternatives.
- List required packages with their install command. Never assume a package or CLI is present.
- Use forward slashes in every path.
- Reference MCP tools fully qualified as `ServerName:tool_name`.

### Evaluation

- Build evaluations before writing extensive content: identify the gap without the skill, create at least three
  scenarios, measure a baseline, write the minimum instructions that pass, then iterate.
- Test across every model tier the skill will run on. Content tuned for a strong model can under-specify for a fast one.
- Watch real usage. Unexpected read order, an ignored reference file, or a repeatedly re-read file all signal a
  structure problem: promote repeatedly-read content into `SKILL.md` and delete content that is never read.

## Validation Checklist

- [ ] Valid frontmatter with `name` and `description`
- [ ] `name` is lowercase with hyphens, ≤64 characters, matches directory name
- [ ] `description` states WHAT, WHEN, and KEYWORDS, in third person, with no XML tags
- [ ] Body ≤500 lines; large content in `references/`
- [ ] Every reference link is one level deep from `SKILL.md`
- [ ] Reference files over 100 lines open with a `## Contents` list
- [ ] One default approach per task, not a menu of equivalents
- [ ] No time-sensitive statements outside an "Old patterns" section
- [ ] Consistent terminology; concrete examples rather than abstract description
- [ ] Workflows have numbered steps and a validator feedback loop where quality matters
- [ ] Scripts include help docs and error handling, solve rather than defer, and justify every constant
- [ ] Execute-versus-read intent is explicit for every bundled script
- [ ] All paths use forward slashes; MCP tools are fully qualified
- [ ] No hardcoded credentials

## Managed Task File Re-Read Budget (HARD LIMIT)

Managed interactive agents MUST treat accepted predecessor artifacts as session-cached. The rule:

- Read `agent-output/{project}/04-implementation-plan.md`,
  `agent-output/{project}/04-governance-constraints.{md,json}`, and
  `agent-output/{project}/02-architecture-assessment.md` at most **twice**
  per Step (once at boot, once during a re-validation pass at most). Every
  further lookup against these artifacts MUST use
  `apex-recall show <project> --json` (or
  `apex-recall search <project> '<term>' --json`) against the cached
  session state — NOT a fresh `read_file` of the disk artifact.
- Subagents (`bicep-validate-subagent`, `terraform-validate-subagent`,
  `challenger-review-subagent`) receive a **compressed digest** of the
  plan + governance constraints from their parent agent — they do not
  re-read the source artifacts unless the parent explicitly omits the
  digest and the prompt instructs them to.
- The May 2026 nordic-foods retro showed `04-implementation-plan.md` read
  6× and `04-governance-constraints.md` read 4× in a single Step 5 run.
  Each redundant read shipped ~7 KB into a 200 K context. The cache
  contract closes that hole.

**Validator**: `npm run validate:context-budget` enforces a structural
floor — every agent that declares one of the frozen artifacts under a
"Prerequisites Check" / "Read at startup" / "Context budget" heading must
also reference `apex-recall show` (the cached read path) and contain a
phrase forbidding redundant reads ("do not re-read predecessor artifacts",
"frozen_inputs", or "plan_readonly").

## Resources

- [Agent Skills Specification](https://agentskills.io/)
- [VS Code Agent Skills Docs](https://code.visualstudio.com/docs/copilot/customization/agent-skills)
- [Anthropic skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Reference skills repository](https://github.com/anthropics/skills)
