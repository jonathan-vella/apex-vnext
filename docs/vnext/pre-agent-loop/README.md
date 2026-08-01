## Pre-Agent Maintenance Loop

The pre-agent loop runs bounded repository maintenance on the dedicated branch declared in
`authorization.json`. The deterministic controller owns admission, queue selection, focused checks, Git commits,
checkpoint pushes, and stop decisions. Copilot tasks can edit only the current queue item's paths and never receive
shell, Git, GitHub, MCP, delegation, skill, or interactive-question capabilities.

Run commands from the authorization's dedicated worktree:

```bash
cd /home/vscode/.worktrees/apex-pre-agent-optimization
npm run pre-agent-loop -- status
npm run pre-agent-loop -- run --dry-run
npm run pre-agent-loop -- run
```

Use `resume` after an interruption and `abort` to record a stop checkpoint and release an owned lock:

```bash
npm run pre-agent-loop -- resume
npm run pre-agent-loop -- abort
```

`run` probes the launcher, creates the lock and deterministic queue, then processes pending items. Every item must
produce valid JSONL, stay inside its path and budget, avoid secrets and binaries, and pass its focused checks. The
controller commits and pushes accepted work only to the authorization-bound branch. Completion writes
`completion-handoff.md`, releases the lock, and stops before full validation or managed-agent qualification.

Focused controller checks:

```bash
npm run validate:pre-agent-loop
npm run test:pre-agent-loop
```
