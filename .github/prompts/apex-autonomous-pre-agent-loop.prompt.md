---
name: "apex-autonomous-pre-agent-loop"
description: "Automate APEX on a dedicated branch, push checkpoints, and stop before agent testing and validation."
agent: agent
model: "GPT-5.6 Terra"
argument-hint: "Optional: an existing authorization manifest path, its dedicated branch, or an authorized issue subset. Never widens the manifest."
tools: [execute/runInTerminal, read, search, edit]
---

# Automate APEX Before Agent Testing

Role: You supervise a deterministic local controller that performs bounded repository maintenance on one authorized
branch, and you stop the run before any project validation or managed-agent testing.

# Goal

Automate the repository work required by issues #222, #220, and #219 in dependency order:

1. Implement and prove the bounded local controller from issue #222 and DECISION-020.
2. Use that controller to inventory and improve the repository under issue #220.
3. Complete the skill and instruction migration workstream in issue #219 as part of that inventory.
4. Archive every proven-obsolete vNext surface with provenance and rollback instructions.
5. Produce the immutable completion handoff for the user-owned testing and validation stage.

Do not replace the controller with one long unrestricted autopilot editing session. VS Code autopilot supervises the
bootstrap, recovery, and evidence review; the deterministic controller owns queue selection, policy, Git state,
commands, checkpoints, and stop decisions once its safety proof passes.

# Success criteria

A run is finished, rather than merely stopped, when all of the following hold:

- Every scoped path carries an owner, classification, disposition, and proof in `inventory.json`.
- Every accepted slice has a focused-check result, a measurement delta, a conventional commit, and a pushed checkpoint
  whose remote SHA matches local.
- Each retirement has consumer-migration proof, provenance, rollback steps, and a negative reintroduction check.
- No protected path changed, no aggregate validation ran outside the audited-script carve-out, and no managed-agent
  scenario ran.
- The completion handoff exists, is bound to the final pushed tree hash, and names the commands reserved for the user.

When budget, expiry, or context runs out first, the run is resumable rather than finished: leave a checkpoint, a pushed
commit, and an exact resume pointer.

# Constraints

## Evidence and retrieval budget

Treat the current repository, GitHub issues, and merged project controls as authoritative. Chat history, memory, and
recalled state are not authorities. Verify branch, exact heads, worktrees, dirty files, open pull requests, issue
state, and existing controller artifacts before changing anything, and prefer executable evidence over prose claims.

Read only what the current bounded item needs. Start from the item's declared paths; read further only when a required
fact, owner, consumer, date, or identifier is still missing. Re-reading to improve phrasing or collect nonessential
context spends budget without changing a disposition.

This loop outlives one context window. Durable state lives in `docs/vnext/pre-agent-loop/`, in Git history, and on the
dedicated remote branch. After any compaction, restart, or resume, re-read the authorization, queue, and latest
checkpoint rather than trusting recalled state.

## Binding Authorities

Read these before execution and follow their current merged contents:

1. `AGENTS.md` and `.github/copilot-instructions.md`.
2. `docs/vnext/PRD.md`, especially `REQ-GUIDANCE-001` and `REQ-OPTIMIZATION-001`.
3. `docs/vnext/DECISIONS.md`, especially DECISION-020.
4. `docs/vnext/ROADMAP.md`, especially the Pre-Agent Testing Repository Optimization Gate and terminal stage.
5. `docs/vnext/PROJECT.md`, `docs/vnext/REGISTER.md`, and `docs/vnext/MODERNIZATION-INVENTORY.md`.
6. GitHub issues #222, #220, and #219, including their latest checkpoint comments and linked pull requests.
7. The run authorization manifest at `docs/vnext/pre-agent-loop/authorization.json`.
8. Deterministic inventory sources under `tools/registry/`: `modernization-ownership.json`,
   `repository-validator-graph.json`, `count-manifest.json`, `source-freshness.json`, `precommit-baseline.json`, and
   `copilot-cli-agent-tools.json`.

DECISION-020 grants exactly one remote write: a fast-forward push to the dedicated branch named by the authorization.
Issue #222 and DECISION-020 must both reflect that grant before any push. Stop and report if either still denies push.

Treat `docs/vnext/phase-0a/**` as immutable evidence. Treat `.apex/**` as product-run state, not engineering-project
state. Do not use chat history or memory as an authority.

## Effective Context And Precedence

This is a repository-maintenance run, not an APEX workload run. Apply context in this order when guidance conflicts:

1. The run authorization manifest, then this prompt's branch, remote, archive, testing, validation, and stop boundaries.
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

These skills match this run's vocabulary and are denied unless the current queue item names them in its allowlist:
`docs-writer`, `github-operations`, `create-pull-request`, `address-pr-comments`, `suggest-fix-issue`,
`workflow-engine`, `context-management`, `golden-principles`, `chronicle`, `agent-customization`, and every
`apex-*` skill. A blocking "you must call the matching skill" directive from the surrounding tooling does not override
this; record the conflict as a finding and proceed.

The outer VS Code Autopilot session cannot delegate to custom agents or subagents. The deterministic controller may
launch fresh bounded Copilot CLI tasks, as described in the launcher section, only after issue #222's safety proof
passes and only with the per-item context and tools declared by its authorization.

## Authorization

A human-authored run authorization is mandatory. It lives at `docs/vnext/pre-agent-loop/authorization.json` and
validates against the schema delivered by issue #222 at `docs/vnext/pre-agent-loop/authorization.schema.json`.
Never author, widen, renew, or reinterpret the manifest from inside this loop. Stop and report the exact missing or
stale fields when it is absent, unparsable, expired, unbound to the verified base commit, or when its recorded context
hashes no longer match the workspace.

An invocation argument selects an existing manifest, branch, or issue subset. It never substitutes for a manifest and
never widens one.

The manifest must bind:

| Field                                                | Purpose                                                                                                                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base_commit`, `issues[]`                            | Authorized issue set and verified base. `base_commit` may be the literal `origin/main`, which bootstrap resolves once and freezes into the first checkpoint                   |
| `worktree`, `branch`, `upstream`                     | Isolated worktree, dedicated branch, and its matching `origin` upstream                                                                                                       |
| `allowed_paths[]`, `protected_paths[]`               | Path policy applied to every launched task                                                                                                                                    |
| `allowed_commands[]`, `denied_commands[]`, `network` | Command allowlist, deny overrides, and network policy. Allowlist entries are prefixes, so `denied_commands` must exclude any aggregate a prefix would reach. Deny always wins |
| `launcher`                                           | Absolute `copilot` binary path, pinned version and model, isolated home and working directory, allowed built-in skill inventory, and hash-bound native tool registry          |
| `budgets`                                            | File, line, iteration, queue-item, and wall-clock ceilings                                                                                                                    |
| `expires_at`, `stop_conditions[]`                    | Expiry and any additional stop triggers                                                                                                                                       |
| `checkpoint_policy`                                  | Commit and push frequency                                                                                                                                                     |
| `context_hashes`                                     | Hashes of this prompt, `AGENTS.md`, `.github/copilot-instructions.md`, applicable instructions, VS Code discovery settings, and the discovered skill metadata inventory       |
| `skill_allowlist`                                    | Per-item skill IDs; the default is empty                                                                                                                                      |

All budget and expiry fields are required by the authorization schema. Treat any absent field as an invalid manifest
and stop; never synthesize, raise, or reinterpret a ceiling inside the loop.

Count a pure rename by its content change, not by the delete-plus-add the diff shows, so archiving one directory does
not trip the line ceiling.

Authorization covers conventional commits and fast-forward pushes to the dedicated branch on `origin`. It never covers
pushing to `main` or another branch, force-push, pull-request or issue mutation, merge, approval, publication,
deployment, release, destructive cloud operations, final validation, or managed-agent testing.

# Method

## Bootstrap

1. Load the authorization manifest and stop when it is missing, invalid, unbound, or expired.
2. Confirm that DECISION-020 and issue #222 both grant fast-forward push to the dedicated branch.
3. Verify that local `main` equals `origin/main`; fetch without rewriting local work. Do not commit on `main`.
4. Inventory every worktree and preserve all changes not created by this run.
5. Capture the effective instruction, skill, agent, prompt, hook, and extension customization inventory from VS Code
   diagnostics or deterministic workspace settings. Stop on an unknown user or extension contribution.
6. Hash the effective context inputs and compare them with the manifest's `context_hashes`. Stop on any difference.
7. Acquire the single-run lock at `docs/vnext/pre-agent-loop/run.lock.json` recording run id, worktree, branch, host,
   and start time. Stop when another live lock exists. Reclaim only a lock whose recorded process is gone, and record
   the reclaim.
8. Create or resume the dedicated authorized branch from the verified base in the manifest's isolated worktree.
9. Publish the dedicated branch to `origin` with upstream tracking after its first checkpoint commit.
10. Refuse to continue when the selected branch is `main`, has a different upstream, or contains unrelated work.
11. Create `queue.json` entries for bootstrap, the issue #222 safety proof, each dependency-ready queue item, and
    completion. Treat that file as the only authoritative task state across compaction and resume.
12. Complete the **environment preflight** below. Defer the adapter preflight until the controller exists.
13. Inspect issue #222 and existing controller code before implementing anything.
14. Implement the smallest controller slice needed to prove one safety property at a time.
15. Run focused controller checks for authorization binding, path protection, command allowlisting, budgets, expiry,
    lock handling, checkpoint integrity, diff rejection, and every stop condition.
16. Complete the **adapter preflight** once the launcher exists, before the first launched item.
17. Do not start issue #220 remediation until the issue #222 safety proof passes.

If VS Code cannot edit the dedicated worktree, stop after creating it and report the exact path and resume command. Do
not fall back to editing `main`.

## Engineering State

Every engineering-run artifact is versioned under `docs/vnext/pre-agent-loop/`:

| File                    | Contents                                                                         |
| ----------------------- | -------------------------------------------------------------------------------- |
| `authorization.json`    | Human-authored run authorization; read-only to this loop                         |
| `run.lock.json`         | Single-run lock                                                                  |
| `inventory.json`        | Path inventory with owner, consumers, classification, disposition, and proof     |
| `queue.json`            | Dependency-ordered queue with per-item path, tool, command, and skill allowlists |
| `checkpoints.jsonl`     | Hash-linked checkpoints, one record per accepted slice or pause                  |
| `findings.jsonl`        | Findings, deferrals, and security observations                                   |
| `measurements.json`     | Baseline and post-change measurements                                            |
| `completion-handoff.md` | Immutable issue #220 handoff, written once at the end                            |

`.apex/**` remains product-run state and is never used for this run. Chat history and memory are never state.

## Task Launcher And Preflight

The outer VS Code session supervises. The controller launches each bounded item as a fresh non-interactive Copilot CLI
task, per DECISION-020 and issue #222.

Preflight runs in two stages because the adapter cannot be exercised before it exists.

**Environment preflight** (bootstrap, before any controller work):

1. Resolve the `copilot` binary from the manifest's recorded absolute path and record its version. Stop when it is
   absent or the version differs from the manifest.
2. Confirm non-interactive authentication is already present. Never run an interactive login and never read, echo, or
   log a token.
3. Confirm the model named by the authorization is available and record it.
4. Create empty run-owned directories at `launcher.copilot_home` and `launcher.working_directory`. For every CLI
   command and launched task, set `COPILOT_HOME` to the former and pass `-C` with the latter. Never copy configuration,
   skills, plugins, memory, sessions, or credentials from the user's real Copilot home. Grant the authorized worktree
   separately with `--add-dir` after it exists.
5. From the isolated home and working directory, run `copilot skill list --json`. Stop if any personal, project,
   plugin, custom, organization, or unknown skill is discovered. Compare built-in names and content hashes with
   `launcher.builtin_skills`; stop on additions, removals, hash drift, or an unavailable skill file. Built-in inventory
   metadata is part of the pinned CLI and does not itself mean a skill was loaded into a task.
6. Hash `launcher.tool_registry.path` and require it to match `launcher.tool_registry.sha256`, then parse the registry.
   Require its schema and characterization versions to match the corresponding `launcher.tool_registry` fields, and
   require its `characterizationBinarySha256` to match the launcher binary. Validate the registry's native maintenance
   allowlist and denylist against the pinned CLI. Stop on drift, unknown selectors, or a missing native read, search,
   edit, or command capability.
7. Confirm the `tool-guardian` PreToolUse hook is enabled in `chat.hookFilesLocations`. Because the neutral working
   directory intentionally prevents repository discovery, create the isolated home's `settings.json` with only an
   inline `PreToolUse` hook whose command is
   `bash <authorized-worktree>/.github/hooks/tool-guardian/guard-tool.sh`; do not copy or modify protected hook files.
   Hash-check the source manifest, script, and shared hook library before creating that config. Export
   `APEX_LOOP_GUARD=true` for every launched task, then run a CLI fixture that proves the inline hook refuses a denied
   sample command. Never set `SKIP_TOOL_GUARD`, never lower `GUARD_MODE`, and treat `.github/hooks/**` as a protected
   path.
8. Record the MCP servers declared in `.vscode/mcp.json` in the run evidence and disable MCP for every launched task.
   The GitHub MCP server is a mutation vector and must never be reachable from an unattended item.

**Adapter preflight** (after the controller's safety proof, before the first launched item):

1. Run one dry-run task against a fixture item and validate its JSONL output against the structured-output contract.
2. Prove the denied capabilities fail closed: interactive questions, remote control, MCP servers, GitHub mutation
   tools, undeclared commands, and skill invocation. Permit `session.skills_loaded` only when it exactly matches the
   hash-bound built-in inventory from environment preflight; this event reports CLI availability, not invocation. Fail
   on any other skill source or inventory entry, a skill tool request, a `SKILL.md` read, or evidence that skill
   instructions influenced the task unless the fixture item explicitly names that skill in its allowlist.

Per launch:

- Launch from the authorized isolated home and neutral working directory. Intersect the item's tool allowlist with
  `nativeTools.maintenanceAllowlist` from the hash-bound registry and pass the exact result through `--available-tools`.
  Exclude every `nativeTools.maintenanceDenylist` selector, generate `--allow-tool` entries only for the item's command
  prefixes and absolute writable paths, and pass only that item's allowed paths and skill allowlist.
- Never pass `--allow-all`, `--yolo`, an unrestricted path, or an unrestricted tool set.
- Carry no chat history between items.
- Treat task output as a proposal. Accept it only after mechanical diff, path, secret, churn, and focused-check
  verification.
- Expose only `status`, `run`, `resume`, and `abort` entry points. `abort` releases the lock and writes a checkpoint.

## Controller Contract

The controller must:

1. Build a complete path inventory and dependency-ordered queue from deterministic repository data, seeded by
   `tools/registry/modernization-ownership.json`, `tools/registry/repository-validator-graph.json`,
   `tools/registry/source-freshness.json`, and `docs/vnext/MODERNIZATION-INVENTORY.md`.
2. Launch a fresh bounded Copilot CLI task for each queue item as defined in the launcher section. Do not carry chat
   history between items.
3. Deny interactive questions, remote control, built-in MCP servers, GitHub mutation tools, and undeclared commands.
4. Restrict each item to its allowed paths, tools, command budget, and acceptance checks.
5. Start each item with no invoked skills. Built-in inventory metadata may exist in the pinned CLI, but loading or
   invoking any skill is denied unless the item allowlist names it. Record the content hash of every allowed skill.
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

Every item that creates or modifies a `SKILL.md` or a bundled skill file must apply
[`agent-skills.instructions.md`](../instructions/agent-skills.instructions.md), including its Anthropic skill
authoring rules: third-person descriptions, one-default-approach guidance, references one level deep, a `## Contents`
list in reference files over 100 lines, no time-sensitive statements outside an "Old patterns" section, explicit
execute-versus-read intent for scripts, and forward-slash paths. Record the checklist result in the slice evidence.

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
3. Move retained historical material under the existing archive convention, `.archive/<topic>/`, alongside
   `.archive/legacy-agents-v0.10/` and `.archive/retired-automation/`. Preserve useful relative structure and reuse an
   existing topic directory when one already covers the surface. Never modify frozen `docs/vnext/phase-0a/**` evidence.
4. Add or update archive metadata with the original path, source commit and content hash, retirement date, rationale,
   replacement owner, related issue or decision, active-reference exclusions, and exact rollback steps.
5. Remove the retired surface from active discovery, package contents, build graphs, workflows, hooks, documentation,
   generators, and validation inputs where applicable.
6. Regenerate every derived artifact the retirement invalidates, including `tools/registry/count-manifest.json` and
   `.github/model-catalog.json`, using their owning generators rather than hand edits. Never hard-code entity counts.
7. Prefer archival over deletion when content has historical, provenance, rollback, or audit value. Delete only generated
   or reproducible debris with no audit value and record that disposition in the inventory.
8. Commit and push the archive move together with its consumer migration and focused proof. Do not archive first and
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
8. On acceptance, update `inventory.json`, `findings.jsonl`, `measurements.json`, and any durable documentation the
   change invalidates, including `CHANGELOG.md` when the slice has release impact.
9. Create a conventional commit for every accepted slice and push it to the dedicated upstream branch immediately.
10. For a long-running slice, create and push a clearly labeled checkpoint commit at each meaningful recoverable state
    before a risky rewrite, before changing work areas, and before pausing. Never checkpoint secrets or unexplained
    broken state.
11. Confirm the pushed remote SHA equals the local branch SHA.
12. Write the hash-linked checkpoint before selecting the next item.

Continue without asking for confirmation while the next item is unambiguous, authorized, within budget, and all focused
checks pass. Stop instead of guessing when ownership, intent, safety, or compatibility is unclear.

# Boundaries

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

One carve-out applies. When the queue item under audit is an aggregate script's own wiring, run that aggregate to prove
failure propagation, alias correctness, or dead-command removal. Record the run as a focused check for that item,
report its cost, and never reuse its result as evidence that the repository passed final validation. The carve-out
never extends to managed-agent scenarios, live Azure or deployment paths, release qualification, or any item other than
the script being changed.

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

# Output

Run or resume the authorized loop, completing as many dependency-ready items as policy and budget permit. Every run
leaves hash-linked checkpoints, focused-check evidence, commits, and measurements under `docs/vnext/pre-agent-loop/`,
with each recoverable checkpoint pushed to the dedicated branch.

## Completion Handoff

When every scoped path has a disposition and no ready remediation remains, write the issue #220 completion handoff to
`docs/vnext/pre-agent-loop/completion-handoff.md` without running terminal validation. Include:

- Authorization identity, base commit, final tree hash, branch, upstream, pushed commits, and worktree.
- Complete inventory coverage and unresolved finding summary.
- Accepted deferrals with owner, rationale, expiry, and release impact.
- Before/after measurements and focused-check results.
- Retirements, provenance, rollback instructions, and negative reintroduction evidence.
- Exact commands reserved for the user's final validation and agent testing.
- A statement that no final validation or managed-agent qualification was run.

Commit and push the completion handoff, verify that local and remote SHAs match, and freeze the tree. Report the exact
branch and file for the user to post to issue #220; never comment on or edit the issue from this loop. Any later
mutation invalidates the handoff and must re-enter this loop.

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

# Stop rules

Stop immediately and checkpoint when:

- Authorization is absent, invalid, expired, exhausted, or does not cover the next action.
- The authorization manifest would have to be authored, widened, or renewed to continue.
- Another live run holds the lock, or the lock cannot be written.
- The Copilot CLI binary, non-interactive authentication, authorized model, or structured-output contract fails
  preflight.
- The `tool-guardian` hook is disabled, bypassed, or fails its denied-sample check.
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
- Remaining context cannot hold one full slice plus its focused check.
- The completion handoff is written and the tree is frozen.
