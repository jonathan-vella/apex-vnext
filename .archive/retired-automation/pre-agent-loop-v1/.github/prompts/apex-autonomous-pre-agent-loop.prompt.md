---
name: "apex-autonomous-pre-agent-loop"
description: "Run bounded APEX repository maintenance and stop before final validation and agent testing."
agent: agent
model: "GPT-5.6 Terra"
argument-hint: "Optional: status, dry-run, run, resume, or abort. Defaults to status."
tools: [execute/runInTerminal, read, search]
---

# Automate APEX Before Agent Testing

# Goal

Run the deterministic controller in the human-authorized dedicated worktree. Let the controller own authorization,
queue selection, task permissions, diff inspection, focused checks, commits, pushes, checkpoints, and completion.

Do not implement maintenance directly in this outer session and do not invoke repository skills or custom agents.

# Success criteria

- The selected controller command exits successfully or reports its exact fail-closed reason.
- All mutations remain on the authorization-bound dedicated branch and upstream.
- Every accepted item has focused-check, inventory, measurement, commit, push, and checkpoint evidence.
- Completion writes the immutable handoff and stops before final validation or managed-agent testing.

# Constraints

Read `docs/vnext/pre-agent-loop/authorization.json` to obtain the worktree and branch. The authorization is the only
mutation authority. Never widen its paths, commands, budget, expiry, issue set, or branch.

Use only the controller command surface:

```bash
npm run pre-agent-loop -- status
npm run pre-agent-loop -- run --dry-run
npm run pre-agent-loop -- run
npm run pre-agent-loop -- resume
npm run pre-agent-loop -- abort
```

Run the command from the authorization's `worktree`. Do not call Copilot CLI tasks, Git mutation commands, focused
checks, or GitHub operations outside the controller. Do not use `apex-recall`, APEX workload routing, skills,
subagents, MCP tools, full validation, managed-agent scenarios, deployment, publication, or release commands.

# Output

After the controller exits, report:

- Run state and authorization ID.
- Worktree, branch, upstream, local SHA, and confirmed remote SHA when available.
- Accepted or remaining queue items.
- Focused checks and checkpoint paths.
- Exact controller command to resume, or the completion-handoff path.

Do not claim that final validation or agent qualification passed.

# Stop rules

Stop when the controller stops. Do not work around authorization drift, expiry, a live lock, protected-path changes,
MCP or skill discovery, malformed task output, failed focused checks, budget exhaustion, or push verification failure.
Do not continue after `completion-handoff.md` is committed and pushed.
