# Prepare And Run Live Client Qualification

> Human-run CP-20 kit. Preparation is not a client pass, cloud authorization, or release approval.

Use this kit with the [scenario matrix](../vnext/CLIENT-QUALIFICATION.md). Run four separate host/client cases:
native Windows VS Code **Copilot** harness, native Windows Copilot app, Linux Copilot CLI, and WSL2 Copilot CLI.
Do not use VS Code Local, VS Code over WSL, native-Windows CLI sessions, Docker, or a devcontainer. Windows Copilot CLI
may manage the plugin store only. Keep one host per workspace; do not move runs between Windows and WSL2.

The human operates every live client, sign-in, sandbox setting and Azure check. Repository preparation must not start a
Copilot session, dispatch a deployment workflow, publish packages/plugins, or change Azure. Stop at every gate.
`CLIENT-039` to `CLIENT-042` are **PLANNED, blocked/not runnable** until
[CP-26 to CP-30](../vnext/ROADMAP.md#client-pivot-backlog) deliver the purpose-bound lab, azd/Bicep, CI-owned
production and production-setup paths. Do not substitute direct azd commands.

## 1. Freeze The Candidate

This preparation targets source **`a4bc16fbe4eadea48902ab054ea7f02a8bdd008a`** (main after #454).
Published **`0.11.0-next.2`** predates #431: its source is
`e7776c6beb162c80e1846673d436de35056c1ab5`. The published plugin tree SHA-256 is
`93407061c09f00cc1251a582a16840547a6c7bbe256c468aba0c4d2c4f15df22`, recorded in the
[marketplace provenance](https://github.com/jonathan-vella/apex-plugins/blob/0917d99c49a5cc9bdbfe849890ff1eba7779d410/.github/plugin/provenance.json)
at marketplace commit `0917d99c49a5cc9bdbfe849890ff1eba7779d410`. Retain that commit and the provenance file hash if
testing the release. Neither the release nor a matching version string proves qualification of this source candidate.
The earlier #431 source candidate is historical; #454 retired root guidance and changed current delivery declarations.
Retain archived provenance, but do not restore retired runtime paths or carry earlier client passes forward.

Build CLI tarballs and the plugin from **one clean exact-source checkout**. A source build currently still reports
`0.11.0-next.2`; distinguish it by source commit, release-manifest hash and plugin tree hash, not version alone.
Never mix that plugin with registry tarballs at the same version. A later source commit is a new candidate: update the
worksheet and rerun affected scenarios, rather than carrying passes forward.

From the source repository, create the candidate checkout (PowerShell or Bash):

```text
git worktree add --detach ../apex-client-candidate a4bc16fbe4eadea48902ab054ea7f02a8bdd008a
```

In that checkout, check `git rev-parse HEAD` and `git status --porcelain` (must be empty). Restore dependencies with
`npm ci` only if the build reports missing dependencies. Build without publishing:

```text
npm run pack:vnext
npm run build:plugin
node tools/scripts/live-qualification.mjs candidate --branch main --release-manifest dist/vnext-packages/release-manifest.json --output dist/client-candidate.json
```

The existing candidate collector checks clean source and release-manifest/source agreement, and records package-lock,
runtime-bundle and managed-customization hashes. `--branch main` labels the detached source checkout; it does not select
another commit. Preserve `dist/client-candidate.json`, `dist/vnext-packages/` (manifest, tarballs, SBOM, provenance and
installer), `dist/apex-plugin/`, and `dist/apex-plugin.sha256` together. Use a private evidence folder, not a session dump.
Build tools need dependency/cache access; the installed bundled APEX server itself needs no npm registry access.

If build/test tooling needs a scratch location, keep it in this checkout:

```powershell
New-Item -ItemType Directory -Force dist\client-scratch | Out-Null
$env:TEMP = (Resolve-Path dist\client-scratch).Path
$env:TMP = $env:TEMP
```

```bash
mkdir -p dist/client-scratch
export TMPDIR="$PWD/dist/client-scratch"
```

Set this before packing on the relevant host. Record build Node/npm versions separately from the consumer host's.
Transfer the frozen files to Windows or Linux without rebuilding or changing line endings.

### Verify The Plugin After Transfer And Installation

From the candidate checkout with its build dependencies, reuse the build's canonical tree-hash function. Replace
`PLUGIN_DIRECTORY` with the absolute transferred or installed plugin root and `EXPECTED_SHA256` with the frozen
sidecar's first field. The same command works in PowerShell and Bash:

```text
node --input-type=module -e 'import { hashTree } from "./tools/scripts/build-plugin.mjs"; const tree = await hashTree(process.argv[1]); if (tree.sha256 !== process.argv[2]) throw new Error("Plugin tree mismatch"); console.log(tree.sha256);' PLUGIN_DIRECTORY EXPECTED_SHA256
```

Hash **only the plugin root**, not the Copilot home or its `config.json`. Record tarball SHA-256s against the release
manifest before installation (`Get-FileHash -Algorithm SHA256` on Windows, `sha256sum` on Linux).
Recheck the installed plugin tree at the end of the run. A mismatch or client/plugin update invalidates the result.

## 2. Prepare The Host And Consumer

Follow [host prerequisites](prepare-windows-11.md) and the
[clean-host checklist](manage-installation.md#verify-a-clean-host). Use a fresh consumer directory outside the source
checkout for each case and another disposable consumer for destructive lifecycle/tamper checks. Do not test against a
real workload. #378 is closed for implementation; `CLIENT-012` still needs live clean-machine evidence.

On native Windows, record the actual edition, DisplayVersion, OS build and installed sandbox-required update, plus
PowerShell, Node, npm, Git, Copilot store-manager, VS Code/extension or app versions. On Linux/WSL2, record distro,
kernel, architecture, Node/npm/Git/Copilot versions and `bwrap --version`, `slirp4netns --version`.
For WSL2 also record the WSL version and distro mode (`wsl.exe --version`, `wsl.exe --list --verbose`), with user names
redacted. Keep WSL workspaces in the Linux filesystem, not `/mnt/c`.

The recorded Windows decision remains **25H2/24H2**. Vendor app documentation lists **25H2/26H1**; this discrepancy
requires human observation, not an inferred support-matrix edit. Record the actual host and whether that client reports
its sandbox available/enabled, with a redacted UI reference. Do not claim 24H2 works or 26H1 is qualified without a run.

Before starting a new session:

- VS Code: `chat.agent.sandbox.enabled=on`, outbound network allowed; record the session's reported sandbox state.
- App: enable **Sandbox new sessions** in the project, leave **Outbound internet** on; record availability and any
  **Sandbox unavailable** reason.
- CLI: inspect `copilot help sandbox`, install its namespace prerequisites, then `/sandbox enable`; record actual
  session status. Bubblewrap version alone does not prove it runs. Record WSL2/AppArmor namespace failures as blocked;
  do not disable host security policy to get a pass.

Close every VS Code window before changing the Windows plugin store. In the human's disposable testing profile,
remove any old APEX copy before installing the frozen local folder:

```text
copilot plugin install ABSOLUTE_CANDIDATE_PLUGIN_DIRECTORY
copilot plugin list
```

Direct-path install is deprecated but remains the local-candidate preparation route. Use `copilot plugin uninstall apex`
to remove that direct copy before a marketplace install; do not install a second APEX copy. Workspace settings request
`apex@apex-plugins`, so check that the client does not auto-fetch a published copy alongside or instead of the candidate.
If it does, stop and record the mismatch. Doctor's marketplace-store check can also flag the direct install's identity;
retain that result as a source-channel gap, not a successful marketplace lifecycle test.

In each new consumer, initialize Git and install **all five** frozen tarballs. PowerShell:

```powershell
git init
npm init --yes
$tarballs = (Get-ChildItem C:\src\apex-client-candidate\dist\vnext-packages\*.tgz).FullName
npm install --ignore-scripts --no-audit --no-fund $tarballs
```

Linux/WSL2:

```bash
git init
npm init --yes
npm install --ignore-scripts --no-audit --no-fund /absolute/apex-client-candidate/dist/vnext-packages/*.tgz
```

Run the locally installed CLI explicitly, avoiding `npx` fetching a different package:

```text
node node_modules/@apexops/cli/dist/cli.js version --json
node node_modules/@apexops/cli/dist/cli.js init --project qualification --risk-owner partner --target local --json
node node_modules/@apexops/cli/dist/cli.js doctor --json
node node_modules/@apexops/cli/dist/cli.js status --json
```

Save sanitized outputs and `.apex/apex.lock.json`/`customizations.lock.json` hashes, not whole state directories.
Doctor is read-only without `--fix`; it does not prove plugin discovery or sandboxing. Do not repair or update during a
bound run. Record warnings/failures and their reasons. A source install is not a no-checkout clean-host pass:
`CLIENT-012` also requires the human to test the frozen installer/released distribution on a genuinely clean host.

For optional guided CLI/VS Code fixture preparation, use the existing `live-qualification.mjs prepare --branch main
--root ABSOLUTE_NEW_ROOT --release-manifest dist/vnext-packages/release-manifest.json --output dist/preparation.json`
from the candidate checkout. It creates local state and records `qualifiesClientParity=false`, `qualifiesRelease=false`.
It creates only CLI/VS Code workspaces, not an app case; initialize the app consumer separately as above.

## 3. Human Client Checks

Open only the prepared consumer. VS Code: restart **Local Agent Host**, select target **Copilot**, then pick **APEX**;
verify one `apex` under `@agentPlugins`. App: start a new local sandboxed session with APEX. CLI: start
`copilot --agent apex` in Linux/WSL2 and enable sandboxing. Choose and record the session model (HydraFusion if available);
do not silently substitute a model. Use client UI/log snippets only after redaction; a server-side test is not a UI pass.

| Check                                                           | Human action and required observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery (`002`, `004`, `028`, `029`)                          | Ask APEX to call `status` with the absolute consumer `workspace`. Confirm one APEX agent, expected hidden workers, skills and hooks; one `apex` server and `apex-azure-pricing`. Compare tool names with the candidate's packaged `com.github.copilot/hooks/apex-mcp-tools.json` and MCP reference, not a newly invented allowlist. No copied workspace agents/skills/MCP config should shadow the plugin.                                                                                                                                                                                                                                                          |
| Protocol (`038`)                                                | Capture actual client negotiation: successful `server/discover`, version `2026-07-28`, then tools/list and status. Record sanitized request/result references. An initialize fallback to `2025-11-25` is served by design but is **not** a CLIENT-038 pass; record fallback/timeout.                                                                                                                                                                                                                                                                                                                                                                                |
| Routing/input (`003`, `005`, `023`, `024`, `031`, `032`, `037`) | Ask APEX to continue Requirements only, stopping at Gate 1. Answer returned input, including invalid and cancelled selections. Check typed acceptance and same-agent stage routing. Workers must not ask questions; an APEX-as-task target is denied. Built-in helper advice alone must not complete tasks or gates.                                                                                                                                                                                                                                                                                                                                                |
| Review (`033`)                                                  | Wait for a kernel-issued review. Require synchronous rubber-duck with the exact `reviewRequest.prompt`, then `reviewComplete` with only the task ID. Record prompt/subject/response/capture hashes and completion event references; each finding needs disposition and Gate 1 still needs the human intent confirmation. Continue to Architecture or Plan only when explicitly requested; then Gate 2/3 must become `ready` in the kernel without any approval prompt, approval evidence or actor.                                                                                                                                                                  |
| Tamper (`006`, `033`)                                           | In a separate disposable run, pause before reviewComplete. The human edits one capture byte without re-signing, then requests completion. Expect fail-closed rejection and `review.capture-rejected`, no task completion or gate approval. Refresh nextTask for a new nonce. Also try a missing capture: rerun once with the same issued prompt, then stop/report if still missing. Never copy/export `capture.key`, or manufacture a positive review.                                                                                                                                                                                                              |
| Repeat (`036`)                                                  | Repeat one successful bounded mutation with the **identical tool, absolute workspace and argument object**, before any other run change. For example repeat the accepted recordInput call. Compare result hashes/journal head and confirm no second semantic effect. After a state change, stale repeats must be rejected or re-evaluated, not deduped against an unrelated state. Do not retry unknown-outcome deployment calls.                                                                                                                                                                                                                                   |
| Restart (`007`)                                                 | Record status/journal head, close the client session, start a new one and ask what is next without replaying chat. Confirm the same run and next pending task/gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Worktrees (`008`, `034`)                                        | In the app use its worktree session; in CLI use two Git worktrees on the same host. Each calls status with its own absolute path. First workspace performs one bounded run write; second may read but its write must return `APEX_WRITER_CONFLICT`. Resolve main checkout through Git common dir; do not copy `.apex`. Owner calls `releaseWriter`, then second writes and records the new ownership. Record roots as aliases, epochs and before/after heads.                                                                                                                                                                                                       |
| Lifecycle (`009`, `011`, `020`, `026`, `030`)                   | On a disposable consumer follow the installation update/conflict/rollback/uninstall/reinstall checklist. Preserve a user-file canary and active-run journal hashes. A plugin update needs a separately frozen candidate and a new session; on Windows close VS Code first and restart Local Agent Host afterward. Record both candidate identities; do not continue the original run's pass claims after update.                                                                                                                                                                                                                                                    |
| Remaining product outcomes (`010`, `013`–`019`, `027`)          | Follow the authoritative matrix and reuse its existing fake-provider/profile/COE/change fixtures. Record actual implementation gaps as blocked, not passing. Fake-provider results are not Azure or production evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Sandbox/auth (`035`)                                            | Human separately authorizes and drives sign-in/token-refresh/pricing/native-validation checks inside the actual sandbox. Record only success/failure, tool versions and sanitized denial codes. Local checks may proceed without Azure auth; the Azure part stays blocked until authorized. No login output, token cache, tenant/account dump or credential reuse across hosts is collected.                                                                                                                                                                                                                                                                        |
| Lab approval flow (`006`, `031`, `041`)                         | **Not run until a client is qualified against it.** On a new `lab` run, confirm the status shows purpose `lab` and that `production` is rejected. Observe one Gate 1 intent confirmation (purpose, target, requirements) and no Gate 2/3 prompt; `gateDecide` for Gate 2/3 must be refused with reason `GATE_READINESS_AUTOMATIC`, and the journal shows `gate.readiness-recorded` for each. Gate 4 stays the final terminal approval, with the Approval Context in `operations/deployment-preview.md` showing purpose, target, gate provenance, architecture, cost estimate and accepted risks. Record actual events only; never infer a pass from the unit tests. |
| azd/CI (`039`, `040`)                                           | **PLANNED — blocked/not runnable (CP-26 not delivered).** No `azd up`, provision, deploy, pipeline config, workflow dispatch or fabricated preview/approval. Future qualification must bind each operation's own Gate 4 preview, packages/CI recipient and imported evidence per DECISION-035.                                                                                                                                                                                                                                                                                                                                                                      |

Modern stateless requests after discovery require these **params.\_meta** fields (use the actual client name/version):

```json
{
  "_meta": {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { "name": "qualification-client", "version": "OBSERVED_VERSION" },
    "io.modelcontextprotocol/clientCapabilities": {}
  }
}
```

For `tools/call`, add `name` and `arguments` (including absolute `workspace`) alongside `_meta`; for `tools/list` the
metadata suffices. The existing [install smoke](../tutorials/first-run.md#install-smoke) implements discovery/list/status
with this metadata without sign-in. It proves package transport, **not** CLIENT-038 negotiation by a real client.
Do not launch a second MCP server into a client session or use metadata-free tools/list as modern-protocol evidence.
The [2026-10-09 offline probes](../vnext/CLIENT-QUALIFICATION.md#client-038-offline-transport-evidence) already passed
for the pinned source and published preview. Do not rerun them as a supposed fix or convert them into live-client passes.

## 4. Export Only Bounded Evidence

Reuse `tools/scripts/live-qualification.mjs` from the frozen checkout. After human interaction, `input`, `restart`
and `transfer` accept `--client github-copilot-cli` or `github-copilot-vscode` with
`--workspace ABSOLUTE_CONSUMER --output NEW_PRIVATE_FILE`. These validate managed files and export bounded journal
facts; they do not interact with a live client or qualify parity/release. Do not relabel one client's export as another.

Example, from the candidate checkout:

```text
node tools/scripts/live-qualification.mjs input --client github-copilot-cli --workspace ABSOLUTE_CLI_CONSUMER --output dist/cli-input.json
node tools/scripts/live-qualification.mjs restart --client github-copilot-cli --workspace ABSOLUTE_CLI_CONSUMER --output dist/cli-restart.json
```

The current typed client-outcome contract accepts only CLI and VS Code identities. It does **not** accept an app
identity. Keep the app's separate human worksheet and sanitized UI/event/hash references; record typed app export and
closure as an explicit tooling gap. Do not alias the app as CLI/VS Code or invent a JSON identity to claim parity.

Do not use state-transfer exports as a client log bundle: they can contain full artifacts and rejected review text.
Keep raw reviews and client logs private. Share only redacted evidence references, bounded hashes, event sequences/types,
denial codes and observations. Never collect environment dumps, Copilot config/session stores, `.azure`, OAuth URLs,
headers, tokens, cookies, signing keys or credentials. Hashing secrets is not permission to collect them.

The existing `collect-client-outcome.mjs`, `compare-client-outcomes.mjs` and closure/binding tools remain the typed
normalized-outcome path. Their corpus and contracts are not the whole CLIENT-001–040 UI checklist. Do not invent new
scenario IDs in their JSON, use cloud `live-qualification-v1` as a client worksheet, or mark unrun cases successful.

## 5. Copy This Run Worksheet

Keep one private copy per host/client case. This Markdown is a human checklist, not a new runtime contract.

| Binding                                                                   | Actual observation or private evidence reference                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Case/date/operator                                                        | Not recorded                                                                                                                                   |
| Client identity/case                                                      | VS Code: `github-copilot-vscode`; Linux/WSL2: `github-copilot-cli` (separate cases); app: separate human worksheet, typed identity unavailable |
| Channel/source commit/source tree                                         | Not recorded; source build versus published release must be explicit                                                                           |
| CLI/plugin version; plugin expected/installed/end tree SHA-256            | Not recorded                                                                                                                                   |
| Candidate JSON/release manifest/tarballs/provenance/locks                 | Not recorded; include hashes and immutable locator                                                                                             |
| Host version/build/architecture; WSL distro/kernel/mode                   | Not recorded                                                                                                                                   |
| Client/app/extension/Agent Host/store-manager version; executable SHA-256 | Not recorded; use About/version UI where needed                                                                                                |
| Node/npm/Git/IaC/sandbox-tool versions                                    | Not recorded                                                                                                                                   |
| Workspace/run aliases; journal head/owner epoch                           | Not recorded; no personal absolute paths in shared evidence                                                                                    |
| Session model; actual sandbox available/enabled/network setting           | Not recorded                                                                                                                                   |
| Azure auth authorization/outcome                                          | Not authorized/not run                                                                                                                         |
| Negotiated MCP protocol/discovery/inventory reference                     | Not recorded                                                                                                                                   |

| Scenario group         | Applicable cases                                                                        | Initial status                      | Evidence reference/hash, observation or blocker |
| ---------------------- | --------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------- |
| CLIENT-001–020         | All four; separate each scenario in the completed worksheet                             | Not run                             | None                                            |
| CLIENT-021, CLIENT-025 | None; retired by DECISION-032/033                                                       | Not applicable                      | CLIENT-031/037 replace them                     |
| CLIENT-022             | Deferred context sidekick                                                               | Deferred                            | No pass claimed                                 |
| CLIENT-023/024/026/027 | All four on the current projection                                                      | Not run                             | None                                            |
| CLIENT-028–033         | All four                                                                                | Not run                             | None                                            |
| CLIENT-034             | App worktrees and CLI Linux/WSL2; VS Code optional characterization                     | Not run                             | None                                            |
| CLIENT-035             | All four; Azure portion separately authorized                                           | Blocked pending human authorization | None                                            |
| CLIENT-036–038         | All four                                                                                | Not run                             | None                                            |
| CLIENT-039–042         | Future purpose-bound lab, azd/Bicep, CI-owned production and setup paths in all clients | PLANNED, blocked/not runnable       | CP-26 to CP-30 not delivered                    |

For each applicable scenario, record **not run**, **blocked** (reason), **fail**, or **pass** only after observation;
use **not applicable** only with a matrix-backed rationale, never to hide unavailable mechanics. Separate Linux and
WSL2 results despite the shared client ID. Reference actual sanitized files with SHA-256 and collection time.
Finish by rechecking versions/tree hashes and declaring unresolved gaps. Return the worksheet to
[CP-20 #386](https://github.com/jonathan-vella/apex-vnext/issues/386); preparation alone does not close it.
