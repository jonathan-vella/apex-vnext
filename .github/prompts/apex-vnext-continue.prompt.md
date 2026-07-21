---
description: "Resume and execute the next bounded APEX vNext project slice with durable checkpoints and integration safeguards."
agent: agent
model: "Claude Opus 4.7"
argument-hint: "Optional: issue number or approved roadmap slice. Leave blank to resume from the durable checkpoint."
tools: [vscode/askQuestions, execute/runInTerminal, read, search, edit, todo, agent]
---

# Continue APEX vNext Execution

<investigate_before_answering>
Treat repository files and current GitHub state as authoritative, not this chat or an earlier checkpoint.
Resolve the active branch, exact heads, worktrees, dirty files, draft PR state, checks, and active issue before editing.
Read only the governing files needed for the next slice, then execute that slice instead of producing another plan.
If evidence conflicts, reconcile it in the register and checkpoint before continuing.
</investigate_before_answering>

<output_contract>
Complete one dependency-complete slice and leave it resumable from repository and GitHub state alone.
Update the durable checkpoint and active issue before pausing, with exact head and validation evidence.
Report changed files, GitHub resources, checks run, blockers, and the next executable issue.
Do not claim completion when required automated or manual evidence is unavailable.
</output_contract>

<scope_fencing>
Follow `docs/vnext/PRD.md`, `DECISIONS.md`, and `ROADMAP.md` as the binding product, decision, and delivery authorities.
Do not expand a slice into unrelated cleanup, a mass rewrite, or autonomous self-modification.
Use this repository's `main` as the vNext integration line. Keep the original APEX `main` untouched as the v1 line.
Stop before any merge, auto-merge, release, tag, publication, deployment, or cutover action.
</scope_fencing>

This prompt is safe to use in a fresh chat. Do not depend on chat memory or `/memories/**` for authoritative state.

## Invocation Approval

By invoking this prompt, the user approves these operating decisions:

- Use the existing `jonathan-vella/apex-vnext` repository, not a temporary vNext repository.
- Keep `main` as the durable vNext integration branch.
- Use short-lived issue branches in isolated worktrees and target their pull requests to `main`.
- Use GitHub Issues for executable work state, repository documents for durable intent and governance, and the
  `APEX vNext` GitHub Project only as a planning view.
- Use the small project-control document set under `docs/vnext/`.
- Modernize through dependency-complete vertical slices.
- Keep improvement limited to structured observe-and-propose measurement with human decisions.
- Support GitHub Copilot in VS Code and GitHub Copilot CLI; do not treat cloud coding-agent sessions as an APEX client.
- Commit and push validated work on the issue branch and open or update a pull request targeting
  `main`.

This invocation does not authorize merge, auto-merge, release tags, package publication, deployment, destructive cloud
operations, or production cutover.

## Canonical Inputs

Read these first, without re-reading a file already loaded in the current session:

1. `AGENTS.md` and `.github/copilot-instructions.md`.
2. `docs/vnext/PRD.md`, `DECISIONS.md`, and `ROADMAP.md` as binding authorities.
3. `docs/vnext/PROJECT.md`, `REGISTER.md`, and `MODERNIZATION-INVENTORY.md` for the current checkpoint, risks, and
   ownership gates.
4. The two `plan-*.prompt.md` files only when tracing historical intent; they are superseded and nonbinding.
5. Applicable path-scoped instruction files for files that the selected slice will change.
6. The active GitHub issue and its latest resumable checkpoint comment, when one exists.

Treat `docs/vnext/phase-0a/**` as immutable evidence. Treat `.apex/**` as product-run state, never as vNext engineering
project state.

## Fresh-State Verification

Before selecting work:

1. Run `git status --short --branch`, `git worktree list --porcelain`, and inspect configured remotes.
2. Fetch `origin` without changing local branches.
3. Use `gh` CLI to verify access to `jonathan-vella/apex-vnext`, current `main`, open pull requests, required checks,
   and the active issue. Do not run `gh auth` commands.
4. Confirm `origin/main` is the exact base for the next issue branch.
5. Inventory dirty and untracked files in every relevant worktree. Preserve all changes that were not created by this
   execution.
6. Record material differences from the latest `PROJECT.md` checkpoint instead of silently correcting history.

The source SHA in `SOURCE_PROVENANCE.json` is evidence, not a permanent base. Always use the currently verified
`origin/main` head when creating a new slice branch.

## Worktree Routing

Apply these rules:

1. Derive a conventional branch name and isolated worktree from the active issue.
2. If the worktree and branch already exist, inspect and resume them. Do not recreate, reset, or rewrite them.
3. If neither exists, create the branch and worktree from the verified `origin/main` head.
4. If only one exists, diagnose the mismatch and recover without deleting work or rewriting history.
5. Never check out `main` in a second worktree when another worktree owns it.
6. Preserve unrelated dirty files and generated evidence that this execution did not create.
7. If the active client cannot access the new worktree, stop after creating it and ask the user to open or select that
   worktree before invoking this prompt again.

## Work Selection

1. Read `docs/vnext/PROJECT.md` for the resume pointer, not granular status.
2. Query GitHub Issues and the `APEX vNext` Project for the authoritative active item when access is available.
3. If an issue number was supplied, verify that it is open, approved, dependency-ready, and consistent with the roadmap.
4. Otherwise, select the first dependency-ready issue in the current milestone and workstream.
5. Execute only that issue's dependency-complete slice during this invocation.
6. Do not begin a later milestone while an earlier release gate is unresolved.

Ask one concise question only when multiple equally valid items require a product decision. Do not ask the user to
repeat information already available in repository or GitHub state.

## Slice Execution Protocol

For every slice:

1. State one falsifiable local hypothesis, the controlling path, and the cheapest check that could disprove it.
2. Make the smallest grounded edit that advances the issue.
3. Immediately run the narrowest executable validation for the touched behavior.
4. Repair locally and rerun the same check when a failure supports the hypothesis.
5. Preserve compatibility aliases until their documented removal gates pass.
6. Do not weaken tests, checks, diagnostics, permissions, or release gates to obtain a green result.
7. Keep secrets, raw chat history, credentials, and unredacted command output out of tracked files and GitHub comments.
8. Update affected documentation, the register, and the decision index as part of the same slice.
9. Run broader relevant validation before commit, then inspect the final diff for unrelated changes.
10. Use a conventional commit, push without bypassing hooks, and open or update a PR whose base is
    `main`.

Use `gh` CLI for GitHub operations. Do not enable auto-merge or merge the pull request without explicit authorization.

## Checkpoint Contract

Before pausing for any reason:

1. Update `docs/vnext/PROJECT.md` with the UTC timestamp, `main` head, active branch or PR, blockers, validation state,
   and next issue links.
2. Add or update the active issue checkpoint comment with worktree, branch, head, completed work, next action, blockers,
   tests run, and uncommitted changes.
3. Update `REGISTER.md` for unresolved risks, defects, regressions, dependencies, or external failures.
4. Update `DECISIONS.md` when a consequential choice was made or a viable alternative was rejected.
5. Ensure issue state and assignee remain the authority for daily status.

## Validation

Select the narrowest relevant commands first, then run the broader gate required by the slice. For the project-controls
bootstrap, include:

- `npm run lint:md`
- `npm run lint:links`
- Repository JSON and YAML validation
- Issue-form validation
- `npm run validate:agents` when prompts or agent-facing metadata changed
- Applicable docs checks

Record exact commands and results. Classify failures as product regressions, pre-existing failures, or external/platform
failures with evidence and ownership. Never describe an unrun check as passing.

## Final Response

Return a concise, self-contained status containing:

- Slice or issue completed
- Worktree, branch, commit, and pull request
- Files and GitHub resources changed
- Validation results and exact-head status
- Open blockers or unavailable evidence
- Durable checkpoint location
- Next dependency-ready issue

## Stop Rules

Stop and checkpoint when:

- Continuing would overwrite or discard changes not created by this execution.
- The verified GitHub or repository state conflicts with a consequential plan assumption that requires maintainer choice.
- Required credentials or permissions are unavailable.
- A destructive, deployment, publication, merge, release, or cutover action would be next.
- A blocking metric or critical/high risk remains unresolved at a release gate.
- The current dependency-complete issue is finished and its durable checkpoint is written.

Do not stop at a proposal when the selected slice can be implemented and validated safely.
