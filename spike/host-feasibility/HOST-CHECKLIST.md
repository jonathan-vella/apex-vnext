# Step 0 Host-Feasibility Checklist (#559)

This spike proves host behavior only. It is not APEX runtime code and must not advance Phase 0 by implication.
Record the exact plugin directory, commit, host version, OS, shell, Copilot CLI version, VS Code version, Copilot
App build, and model used for every row. Preserve sanitized client logs and tool traces; never record credentials.

## Runtime preflight

The required runtimes are Node.js 26 LTS `>=26.13.1`, Python 3.15 `>=3.15.0`, and npm. A lower local version is a
blocked GUI `PATH` qualification, not a passing result.

```powershell
Set-Location C:\repos\apex-vnext\spike\host-feasibility
node --version
npm --version
python --version
python -c "import sqlite3; c=sqlite3.connect(':memory:'); print(c.execute(\"CREATE VIRTUAL TABLE p USING fts5(x)\").fetchone())"
npm ci
npm run check
npm run smoke:mcp
```

The Linux/WSL2/macOS equivalents are:

```bash
cd /absolute/path/to/apex-vnext/spike/host-feasibility
node --version
npm --version
python --version
python -c "import sqlite3; c=sqlite3.connect(':memory:'); print(c.execute('CREATE VIRTUAL TABLE p USING fts5(x)').fetchone())"
npm ci
npm run check
npm run smoke:mcp
```

The GUI `PATH` check must be run in the GUI host's integrated shell or app terminal, not inferred from a standalone
terminal:

```text
node --version
npm --version
python --version
python -c "import sqlite3; c=sqlite3.connect(':memory:'); c.execute('CREATE VIRTUAL TABLE p USING fts5(x)'); print('FTS5_OK')"
```

Expected: Node `v26.13.1` or newer, Python `3.15.0` or newer, and `FTS5_OK`.

## Install the same local candidate

Use an absolute path. Run this in the environment owned by the client under test:

```powershell
$Spike = (Resolve-Path C:\repos\apex-vnext\spike\host-feasibility).Path
copilot plugin marketplace add $Spike
copilot plugin install apex-host-feasibility@apex-host-feasibility-marketplace
copilot plugin list
```

```bash
SPIKE="$(cd /absolute/path/to/apex-vnext/spike/host-feasibility && pwd)"
copilot plugin marketplace add "$SPIKE"
copilot plugin install apex-host-feasibility@apex-host-feasibility-marketplace
copilot plugin list
```

The install must list `apex-host-feasibility`. For Windows native and WSL2, repeat the install in each environment;
their stores are not interchangeable. VS Code and Copilot App should discover the plugin from the host's Copilot
plugin store. Use **Developer: Restart Local Agent Host** after a Windows install or reinstall if the new plugin is
not immediately visible.

Uninstall between candidate revisions:

```text
copilot plugin uninstall apex-host-feasibility
copilot plugin marketplace remove apex-host-feasibility-marketplace
```

## Launch in each host

Copilot CLI, baseline then sandboxed:

```bash
copilot -C /absolute/path/to/apex-vnext/spike/host-feasibility \
  --agent host-feasibility-coordinator
copilot --sandbox -C /absolute/path/to/apex-vnext/spike/host-feasibility \
  --agent host-feasibility-coordinator
```

PowerShell:

```powershell
copilot -C C:\repos\apex-vnext\spike\host-feasibility `
  --agent host-feasibility-coordinator
copilot --sandbox -C C:\repos\apex-vnext\spike\host-feasibility `
  --agent host-feasibility-coordinator
```

VS Code: open the spike folder, open Copilot Chat, choose the `Host Feasibility Coordinator` agent, and run the
prompts below in a fresh session. After installation, check the plugin's Agents and MCP server in the Agent Plugins
view; do not infer discovery from `copilot plugin list`.

Copilot App: run `copilot app`, open the spike folder as a local workspace, choose `Host Feasibility Coordinator`,
and run the prompts below in a fresh local session. Keep the app's native environment separate from an App session
that opens WSL2.

For the CLI `ask_user` negative path, run once with:

```bash
copilot --no-ask-user -C /absolute/path/to/apex-vnext/spike/host-feasibility \
  --agent host-feasibility-coordinator
```

The coordinator should fail to display the question form even though the rest of the agent prompt remains loaded.
Record the exact result. This tests a disabled host capability; it does not replace the separate frontmatter-negative
test with `ask_user` omitted.

## Human probe prompts

Start a fresh session with agent **Host Feasibility Coordinator**. Use the same prompts in each host:

1. `Run the complete host feasibility probe. Use the active workspace absolute path.`
2. Open [probe.bicep](./probe.bicep), make it the active file, and ask:
   `Read probe.bicep and explain the Bicep rule marker that was attached.`
3. Ask: `Show Host Feasibility Leaf in the agent picker if available, or report that it is hidden.`
4. In the sandbox configuration under test, restart the session and ask:
   `Repeat the echo and write probe without changing sandbox settings.`

Prompt 1 intentionally drives delegation, MCP writes, read-only denial, and `ask_user`. Accept the displayed boolean
form so the agent can complete; also repeat once with cancellation in a disposable session if the client exposes a
cancel path.

## Acceptance matrix

Mark a cell **Pass** only with direct client evidence. Use **Fail** for an observed contract violation and **Blocked**
for missing UI, runtime, authentication, or sandbox capability.

| Check | VS Code Win | VS Code Linux | Copilot CLI WSL2 | Copilot CLI Linux | Copilot App Win | Copilot App macOS | Copilot App Linux |
|---|---|---|---|---|---|---|---|
| Discovery and MCP startup | | | | | | | |
| Named delegation through `task` | | | | | | | |
| Leaf cannot call `host-probe/write_probe` | | | | | | | |
| Leaf cannot edit a file | | | | | | | |
| Explicit `ask_user` renders and returns/cancels correctly | | | | | | | |
| `user-invocable: false` hides leaf | | | | | | | |
| `probe.bicep` rule emits `BICEP_PROBE_RULE_ATTACHED` | | | | | | | |
| GUI `PATH`: Node 26 >=26.13.1 | | | | | | | |
| GUI `PATH`: Python 3.15 >=3.15.0 + FTS5 | | | | | | | |
| Sandbox: MCP stdio starts | | | | | | | |
| Sandbox: workspace read works | | | | | | | |
| Sandbox: coordinator write works when approved | | | | | | | |
| Sandbox: denied write remains denied | | | | | | | |

Additional per-check criteria:

- **Discovery:** exactly one visible coordinator, one hidden leaf, and one `host-probe` server are attributable to
  this plugin. Workspace/personal definitions do not shadow them.
- **Delegation:** the leaf runs as a named specialist without an `agents: [...]` frontmatter field. Record the task
  request and returned result.
- **Negative permission:** the leaf receives host/tool authorization denial for both `host-probe/write_probe` and
  file editing. A refusal written only in the leaf prompt, a silent no-op, or coordinator-side completion is not a
  pass.
- **`ask_user`:** an interactive form appears because `ask_user` is explicit in the coordinator's `tools` list, and
  its answer/cancellation returns to the agent. On a separate disposable session, omit `ask_user` from the tools list
  in a local copy and record whether the host blocks it; never classify omission as safe without this negative test.
- **Hidden agent:** the leaf is absent from every user agent picker and cannot be selected directly, while `task`
  delegation still reaches it.
- **Rule attach:** the exact marker appears only for a `.bicep` match. Open a `.txt` file from the same session and
  confirm the marker does not attach.
- **Sandbox:** test the host's normal/default sandbox first. If one narrow exception is required, record the exact
  operation, scope, host build, denial text, and exception. Do not recommend blanket sandbox-off from one failed
  case. Distinguish inability to start stdio from inability to access the workspace.

## Evidence and exit gate

For every host/OS row, save:

1. runtime preflight output;
2. `copilot plugin list` output;
3. agent discovery or picker capture;
4. delegated leaf transcript with denied tool and denied edit;
5. `ask_user` result/cancellation behavior;
6. `.bicep` positive and `.txt` negative rule observations;
7. MCP `echo` and `write_probe` evidence;
8. sandbox configuration and denial/approval transcript.

Step 0 exits only when every required host capability is pass-qualified. Any unsupported required behavior blocks
Phase 0 until a reviewed architectural adjustment is recorded; README wording cannot convert a failure into a pass.
