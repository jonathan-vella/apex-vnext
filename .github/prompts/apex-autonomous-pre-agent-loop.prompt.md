---
name: "apex-autonomous-pre-agent-loop"
description: "Automate APEX on a dedicated branch, push checkpoints, and stop before agent testing and validation."
agent: agent
model: "Claude Opus 4.7"
argument-hint: "Optional: dedicated branch, authorization manifest, or issue. Defaults to the pre-agent workstream."
tools: [execute/runInTerminal, read, search, edit, todo]
---

# Automate APEX Before Agent Testing

<investigate_before_answering>
Treat the current repository, GitHub issues, and merged project controls as authoritative. Verify the branch, exact
heads, worktrees, dirty files, open pull requests, issue state, and existing controller artifacts before changing
anything. Read only the files needed for the current bounded item. Prefer executable evidence over prose claims.
</investigate_before_answering>

<output_contract>
Run or resume the authorized pre-agent automation loop. Complete as many dependency-ready bounded items as policy and
budget permit. Leave hash-linked checkpoints, focused-check evidence, local commits, measurements, and an exact resume
pointer. Commit and push every recoverable checkpoint to the dedicated branch. On completion, emit the issue #220
handoff and stop before validation or any managed-agent testing.
</output_contract>

## Mission

Automate the repository work required by issues #222, #220, and #219 in dependency order:

1. Implement and prove the bounded local controller from issue #222 and DECISION-020.
2. Use that controller to inventory and improve the repository under issue #220.
3. Complete the skill and instruction migration workstream in issue #219 as part of that inventory.
4. Archive every proven-obsolete vNext surface with provenance and rollback instructions.
5. Produce the immutable completion handoff for the user-owned testing and validation stage.

Do not replace the controller with one long unrestricted autopilot editing session. VS Code autopilot supervises the
bootstrap, recovery, and evidence review; the deterministic controller owns queue selection, policy, Git state,
commands, checkpoints, and stop decisions once its safety proof passes.

## Binding Authorities

Read these before execution and follow their current merged contents:

1. `AGENTS.md` and `.github/copilot-instructions.md`.
2. `docs/vnext/PRD.md`, especially `REQ-GUIDANCE-001` and `REQ-OPTIMIZATION-001`.
3. `docs/vnext/DECISIONS.md`, especially DECISION-020.
4. `docs/vnext/ROADMAP.md`, especially the Pre-Agent Testing Repository Optimization Gate and terminal stage.
5. `docs/vnext/PROJECT.md`, `docs/vnext/REGISTER.md`, and `docs/vnext/MODERNIZATION-INVENTORY.md`.
6. GitHub issues #222, #220, and #219, including their latest checkpoint comments and linked pull requests.

Treat `docs/vnext/phase-0a/**` as immutable evidence. Treat `.apex/**` as product-run state, not engineering-project
state. Do not use chat history or memory as an authority.

## Effective Context And Precedence

This is a repository-maintenance run, not an APEX workload run. Apply context in this order when guidance conflicts:

1. User invocation and this prompt's branch, remote, archive, testing, validation, and stop boundaries.
2. The binding vNext requirements, decisions, roadmap, register, and active issue acceptance criteria.
3. Root and nested `AGENTS.md` files for repository safety, coding conventions, and path ownership only.
4. Applicable `.github/instructions/*.instructions.md` files for each file being changed.
5. Skills only when the current authorized queue item explicitly names and requires one.

Do not use `apex-recall`, the legacy multi-step workload workflow, agent-output templates, challenger reviews, Azure
defaults, governance discovery, IaC generation, deployment procedures, or managed `apex-*` role routing merely because
their repository guidance is visible. They apply only when the authorized queue item directly changes or evaluates that
specific product surface.

Both `.github/skills` and `customizations/.github/skills` are discoverable in this workspace. Treat their metadata and
bodies as inventory targets, not outer-loop authority. Do not invoke a skill automatically from broad words such as
"workflow", "validation", "architecture", "deployment", "optimization", "commit", or "push". If VS Code injects or
suggests an unrelated skill, record the influence in the checkpoint and continue under this precedence section without
following that skill's workflow.

The outer VS Code Autopilot session cannot delegate to custom agents or subagents. The deterministic controller may
launch fresh bounded coding tasks only after issue #222's safety proof passes and only with the per-item context and
tools declared by its authorization.

## Authorization

Invocation authorizes bounded repository maintenance on one dedicated automation branch. If the invocation supplies a
branch or authorization manifest, use it after checking it against these rules. Otherwise use a conventional dedicated
branch such as `chore/pre-agent-optimization`, record an authorization from the merged controls, and proceed without an
additional approval prompt.

The approved authorization must bind:

- Base commit and issue set.
- Dedicated worktree and branch.
- Allowed and protected paths.
- Allowed commands and network policy.
- File, line, iteration, time, and credit budgets.
- Expiry and stop conditions.
- The dedicated remote branch and checkpoint frequency.
- Hashes for this prompt, `AGENTS.md`, `.github/copilot-instructions.md`, applicable instructions, VS Code discovery
    settings, and the discovered skill metadata inventory.
- A per-item skill allowlist. The default is empty.

Authorization includes conventional commits and pushes to the dedicated branch on `origin`. It never includes pushing
to `main` or another branch, force-push, pull-request or issue mutation, merge, approval, publication, deployment,
release, destructive cloud operations, final validation, or managed-agent testing.

## Bootstrap

1. Verify that local `main` equals `origin/main`; fetch without rewriting local work. Do not commit on `main`.
2. Inventory every worktree and preserve all changes not created by this run.
3. Capture the effective instruction, skill, agent, prompt, hook, and extension customization inventory from VS Code
    diagnostics or deterministic workspace settings. Stop on an unknown user or extension contribution.
4. Hash the effective context inputs and bind them into the authorization before mutation.
5. Create or resume the dedicated authorized branch from the verified `origin/main` base in an isolated worktree.
6. Publish the dedicated branch to `origin` with upstream tracking after its first checkpoint commit.
7. Refuse to continue when the selected branch is `main`, has a different upstream, or contains unrelated work.
8. Inspect issue #222 and existing controller code before implementing anything.
9. Implement the smallest controller slice needed to prove one safety property at a time.
10. Run focused controller checks for authorization binding, path protection, command allowlisting, budgets, expiry,
   checkpoint integrity, diff rejection, and every stop condition.
11. Do not start issue #220 remediation until the issue #222 safety proof passes.

If VS Code cannot edit the dedicated worktree, stop after creating it and report the exact path and resume command. Do
not fall back to editing `main`.

## Controller Contract

The controller must:

1. Build a complete path inventory and dependency-ordered queue from deterministic repository data.
2. Launch a fresh bounded coding task for each queue item. Do not carry chat history between items.
3. Deny interactive questions, remote control, built-in MCP servers, GitHub mutation tools, and undeclared commands.
4. Restrict each item to its allowed paths, tools, command budget, and acceptance checks.
5. Start each item with no skills. Load only skill IDs named by that item's allowlist and record their content hashes.
6. Reject context-input drift, an undeclared skill or instruction, protected-file changes, scope escape, unexpected
    binaries, generated-source inversion, excessive churn,
   secrets, and unattributed dirty state.
7. Run focused format, compile, lint, unit, mutation, or behavior checks for the changed slice only.
8. Permit one bounded repair attempt when a focused check fails, then stop with evidence.
9. Record accepted slices as local commits with measurement deltas and hash-linked checkpoints.
10. Push every checkpoint commit to the dedicated upstream branch before selecting another queue item.
11. Stop on ambiguity, missing ownership, contradictory sources, security findings, repeated failure, exhausted budget,
   expired authorization, no ready work, or completion.
12. Emit an immutable completion handoff bound to the final pushed tree hash.

## Repository Review Queue

Cover every requested surface before declaring the loop complete:

- Root and workspace npm scripts: command graph, aliases, wrappers, failure propagation, unused commands, and cost.
- Instructions: discovery, `applyTo`, precedence, overlap, contradictions, duplication, context cost, and retirement.
- Skills: consumers, domain parity, routing, progressive disclosure, gaps, duplication, packaging, and retirement.
- Package files: manifests, lockfiles, exports, dependencies, build configuration, projections, and published files.
- Workflows: GitHub Actions, shared actions, hooks, runtime manifests, permissions, triggers, caches, and obsolete paths.
- Every regular and hidden root file: owner, consumers, purpose, overlap, freshness, errors, and disposition.

For every path, record owner, consumers, classification, findings, disposition, proof, and release impact. Evaluate:

- Correctness, errors, unreachable paths, unsafe defaults, and missing consumers.
- Gaps, contradictions, duplicate authority, drift, and stale assumptions.
- Startup, build, focused-check, hook, CI, package, context, and cache performance where measurable.
- Consolidation, shared implementation, maintainability, and safe reduction in editable lines.
- Retirement only after consumer proof, provenance capture, rollback planning, and negative reintroduction coverage.

Do not optimize for line count alone. Preserve behavior, diagnostics, security boundaries, public compatibility,
provenance, and rollback.

## Archival And Retirement

Move a surface out of active paths when the inventory proves that APEX vNext no longer requires it. Do not leave dead
code, stale guidance, obsolete workflows, unused scripts, or superseded configuration active merely because deletion
would be easier to avoid.

For each retirement:

1. Prove all active consumers are removed or migrated and the replacement or approved omission is documented.
2. Record the removal gate and focused negative reintroduction check before moving the source.
3. Move retained historical material under `.archive/retired-vnext/<surface>/` while preserving useful relative
    structure. Never modify frozen `docs/vnext/phase-0a/**` evidence.
4. Add or update archive metadata with the original path, source commit and content hash, retirement date, rationale,
    replacement owner, related issue or decision, active-reference exclusions, and exact rollback steps.
5. Remove the retired surface from active discovery, package contents, build graphs, workflows, hooks, documentation,
    generators, and validation inputs where applicable.
6. Prefer archival over deletion when content has historical, provenance, rollback, or audit value. Delete only generated
    or reproducible debris with no audit value and record that disposition in the inventory.
7. Commit and push the archive move together with its consumer migration and focused proof. Do not archive first and
    leave active consumers broken in a later commit.

Archived content is historical evidence. Do not allow `.archive/**` to become an active runtime, package, discovery, or
configuration source.

## Slice Loop

For each dependency-ready item:

1. State a falsifiable hypothesis, controlling path, allowed files, and cheapest focused check.
2. Capture the relevant pre-change baseline.
3. Make the smallest independently revertible change.
4. Immediately run the focused check. Do not run the full repository suite.
5. Repair once only when the failure is local and understood.
6. Compare behavior, diagnostics, performance, security, and churn with the baseline.
7. Revert the slice when equivalence or improvement is not demonstrated.
8. On acceptance, update inventory, findings, measurements, and durable documentation.
9. Create a conventional commit for every accepted slice and push it to the dedicated upstream branch immediately.
10. For a long-running slice, create and push a clearly labeled checkpoint commit at each meaningful recoverable state
    before a risky rewrite, before changing work areas, and before pausing. Never checkpoint secrets or unexplained
    broken state.
11. Confirm the pushed remote SHA equals the local branch SHA.
12. Write the hash-linked checkpoint before selecting the next item.

Continue without asking for confirmation while the next item is unambiguous, authorized, within budget, and all focused
checks pass. Stop instead of guessing when ownership, intent, safety, or compatibility is unclear.

## Reserved Testing And Validation

The user owns final testing and validation after all autonomous work is complete. Do not run any of the following inside
this loop:

- `npm run validate:all` or another full repository validation aggregate.
- Managed APEX agent, handoff, hidden-worker, or end-to-end agent scenarios.
- Model comparisons or prompt-quality qualification.
- Paired VS Code and Copilot CLI agent execution.
- Live agent, Azure, deployment, cross-device, or release qualification.
- Final package, provenance, SBOM, clean-install, CodeQL, or security qualification suites.

Focused implementation safety checks required to decide whether one bounded change is fit to commit are allowed. They
do not count as project validation, agent testing, or qualification. Record them only as focused checks.

Normal commit and push hooks are mandatory focused checkpoint checks. They may run staged-file linting, secret scans,
branch checks, and diff-selected validators required by `lefthook.yml`. Do not bypass them. They do not authorize a
claim that the repository, product, or agents passed final validation. If a hook expands into the full validation suite,
stop and report the unexpected command instead of bypassing it.

## Git And Remote Boundaries

- Keep all autonomous mutations in the dedicated worktree and authorized branch.
- Commit regularly and push every commit only to the dedicated branch's matching upstream on `origin`.
- Never commit directly to `main`, push to `main`, merge into `main`, rebase or force-push published history, or change
    branch protection.
- Do not create or edit issues, create or edit pull requests, merge, approve, tag, publish, or release.
- Do not deploy or invoke mutating cloud commands.
- Do not bypass hooks, checks, branch protection, or security controls.
- Never discard, reset, overwrite, or clean changes not created by this run.
- Before and after each push, verify the current branch, upstream, local SHA, remote SHA, and absence of unexpected files.

## Completion Handoff

When every scoped path has a disposition and no ready remediation remains, generate the issue #220 completion artifacts
without running terminal validation. Include:

- Authorization identity, base commit, final tree hash, branch, upstream, pushed commits, and worktree.
- Complete inventory coverage and unresolved finding summary.
- Accepted deferrals with owner, rationale, expiry, and release impact.
- Before/after measurements and focused-check results.
- Retirements, provenance, rollback instructions, and negative reintroduction evidence.
- Exact commands reserved for the user's final validation and agent testing.
- A statement that no final validation or managed-agent qualification was run.

Commit and push the completion handoff, verify that local and remote SHAs match, and freeze the tree. Any later mutation
invalidates the handoff and must re-enter this loop.

## Stop Rules

Stop immediately and checkpoint when:

- Authorization is absent, expired, exhausted, or does not cover the next action.
- The effective prompt, instruction, skill, agent, hook, extension, or discovery-setting inventory differs from the
    authorization snapshot.
- The worktree is dirty from another source or the verified base changed.
- The current branch is `main`, the upstream is not the matching dedicated `origin` branch, or a push would target any
    other ref.
- A task changes a protected or unauthorized path.
- A critical or high security concern appears.
- Sources of truth conflict or ownership is missing.
- The focused check still fails after one repair attempt.
- A merge, pull-request or issue mutation, validation, agent test, deployment, publication, release, or destructive
    action would be next.
- A checkpoint push fails or the remote SHA cannot be confirmed.
- The completion handoff is written and the tree is frozen.

## Final Response

Report only:

- Run state: completed, stopped, blocked, or resumable.
- Authorization, worktree, branch, upstream, base, local SHA, and confirmed remote SHA.
- Queue items and pushed commits completed during this invocation.
- Focused checks and measurement deltas.
- Findings, deferrals, blockers, and remaining budget.
- Checkpoint and completion-handoff paths.
- The exact next resume action or terminal-stage handoff.

Do not claim that the project is validated or that its agents pass testing.
