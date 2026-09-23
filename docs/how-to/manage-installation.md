# Manage Installation

> [Current Version](../../VERSION.md) | Install, update, roll back, reinstall, or remove managed APEX vNext files.

## Prepare A Consumer Machine

Candidate packaging now generates a standalone `apex-install.sh` alongside the tarballs. Its digest is recorded in
`release-manifest.json` and the provenance statement. Obtain that script and its expected digest from the approved
release channel and verify it before execution. This source template is not directly executable as an installer:
packaging substitutes the canonical Node, npm, Copilot CLI and minimum VS Code versions.

From an existing Ubuntu WSL2 terminal, review the plan for an exact available APEX package version:

```bash
bash apex-install.sh --version RELEASE_VERSION --plan
bash apex-install.sh --version RELEASE_VERSION --install --yes
```

The generated script runs without Node or an APEX source checkout. It checks Git, Node/npm, GitHub CLI, Copilot CLI,
Azure CLI, Bicep, Terraform, PowerShell, azd, the VS Code host command and APEX. Compatible tools are preserved. It pins
Node/npm/Copilot to the packaged toolchain minimums and retrieves other missing binary tools from official stable
releases with SHA-256 verification and safe archive extraction. APEX comes from the configured npm registry at the exact
requested version. A missing/unpublished package or unsupported Ubuntu package repository fails rather than completing.

Ubuntu package and Azure CLI repository changes require the separate `--allow-system` flag and existing noninteractive
sudo authorization. Run `sudo -v` yourself when instructed; never supply a password through an agent. Incompatible tools
require `--replace-incompatible`, which permits user-local shadowing, not removal of existing installations. Unowned files
in the install destinations block replacement. The installer does not edit shell profiles: add `~/.local/bin` to PATH in
future terminals. Successful APEX installation also provides `apex-bootstrap`, a launcher for `apex bootstrap`.

Windows/WSL installation, VS Code host installation, WSL/Copilot extension verification and account sign-in remain explicit
host/user actions. No login, repo initialization, GitHub mutation, Azure identity/role change or deployment is executed
by the installer. Concurrent installs are blocked by an install lock; inspect a stale lock after interruption before
removing it. Completed compatible steps are retained for reruns. Current proof consists of offline safety tests and generated
package/provenance checks, not a successful clean-machine installation or complete first-run acceptance.

## Install A Local Candidate

This is a maintainer/local-candidate path, not the intended normal consumer prerequisite. Consumers use Windows via
WSL2 without Docker or a devcontainer and install an available approved package. They do not need a source checkout.

Build and install every tarball from the same release manifest:

```bash
npm ci
npm run pack:vnext
cd /path/to/consumer
npm install --ignore-scripts --no-audit --no-fund \
  /path/to/apex-vnext/dist/vnext-packages/*.tgz
npx apex version --json
```

Initialize VS Code with `apex init --client github-copilot-vscode`, standalone CLI with
`--client github-copilot-cli`, or a combined managed installation with `--client both`.

The combined preset installs both MCP configurations and keeps one update/rollback ownership record. VS Code profiles
retain their APEX names; CLI profiles use `APEX CLI`, `APEX CLI Requirements` and corresponding role names, with
`apex-cli-*.agent.md` filenames. Start the CLI coordinator with `copilot --agent apex-cli`. Each definition retains its
client's exact model and tool contracts. Distinct names avoid relying on unsupported CLI `target` filtering or added-root
precedence. Complete paired-client workflow qualification remains pending; CLI worker membership is unchanged.

For an approved registry release, follow [Publish npm Packages](publish-npm.md) before using the published bootstrap
route.

## Bootstrap A Workspace

Run `apex bootstrap` (or `apex-bootstrap` after machine installation) in an interactive terminal to start guided setup.
`apex bootstrap wizard` selects the same flow explicitly. Choose either or both clients, optionally supply a remote
COE URL and exact commit, select one or more listed workload numbers, and review each copy and workspace installation
plan before confirming it. Bootstrap does not ask for or invent a project ID, environment, workload target or IaC track.
Each selected copy uses a separate workspace; the APEX agent gathers details and creates the first project later.
Enter `cancel` to stop; completed copies and configured workspaces are retained. Declining a plan does not execute it.

The wizard can collect consumer-governance identity inputs and display the evidence-bound OIDC plan, or record that a
central reviewed baseline will be used. Target-bound baseline checks are deferred until a project and target exist;
bootstrap must not invent them to validate a baseline. For a reused approved identity, the wizard can show a
verified provisioning plan and separately ask to create only its missing exact federation and Reader assignment.
It does not create GitHub repositories or new Azure identities, dispatch collection, import central baselines
automatically, or adopt source decisions without review. It reports these
as pending rather than claiming complete onboarding. Interactive login and client health verification remain separate.
Automation must use the typed plan/import/bootstrap commands; the wizard rejects `--yes`, `--json` and non-TTY input.

Inspect local initialization prerequisites without changing files or running commands:

```bash
apex bootstrap plan --client both --create-repo --json
```

This bounded preflight checks the local Git boundary, workspace APEX package version and existing APEX state. It returns
`ready`, `pending` or `blocked` for those checks, with the requested configuration and its hash. The hash is not an
execution approval. Matching initialized state can be reused when selected-project settings, managed files and runtime
locks pass local checks. Partial or conflicting state remains blocked and preserved. Machine prerequisites, client
health, remote COE, GitHub, OIDC and reviewed baseline
checks are explicitly unassessed. A local `ready` result is not complete onboarding or deployment readiness.

The agreed `apex-install` and `apex-bootstrap` guided first-run experiences, remote multi-archetype selection and confirmed
OIDC setup remain under implementation. Their acceptance contract is
[first-time onboarding](../vnext/PRD.md#req-onboarding-001-first-time-install-and-repository-bootstrap).

For a published package, use either a global CLI or a one-shot command. These routes are unavailable until
`@apexops/cli` is published to your approved npm registry. Both routes install the exact APEX CLI as a workspace
`devDependency`, update the npm lockfile, and create one selected client projection.

```bash
npm install -g @apexops/cli
apex bootstrap --client github-copilot-vscode --create-repo --yes
```

```bash
npx --yes @apexops/cli bootstrap --client github-copilot-cli --create-repo --yes
```

Omit `--create-repo` only when the workspace already has a `.git` boundary. Omitting `--project` leaves the workspace
without a project, selected run or workload defaults. `apex status` reports `needs_project`; `doctor` checks workspace
integrity without requiring Azure authentication, a backend or an IaC choice. Open the workspace APEX agent to gather
project details and invoke `projectCreate`. Explicit `apex init` or `project create` remains available for automation
that already knows those details. Use `--file onboarding.json --yes` for validated noninteractive workspace settings.

Repeating `bootstrap --yes` for matching, intact workspace setup returns `resumed: true`, without
reinstalling packages, rewriting managed files or creating another run. Explicitly supplied settings must match the
selected project and client; incompatible packages, manual managed-file edits or damaged state block the rerun.
This only reuses completed local initialization. It does not yet resume interrupted COE, GitHub or OIDC provisioning,
change the selected run, adopt conflicting files or repair partial state automatically.

## Install The VS Code Bootstrap Agent

The optional VS Code profile agent appears before a workspace APEX projection exists. It only guides and launches the
same bootstrap command; it does not own MCP configuration, `.apex` state, approvals, or deployment.

```bash
apex profile install --client github-copilot-vscode --yes
```

In VS Code, select **APEX Bootstrap**, complete its questions, reload the window, and then select the workspace
**APEX** agent. Manage the profile agent explicitly:

```bash
apex profile status --client github-copilot-vscode
apex profile update --client github-copilot-vscode --yes
apex profile uninstall --client github-copilot-vscode --yes
```

The release-blocking end-user lifecycle scenarios are listed in the
[VS Code installation lifecycle matrix](../vnext/CLIENT-QUALIFICATION.md#vs-code-installation-lifecycle). Run them in
a clean supported profile before claiming live VS Code support.

## Update Managed Files

```bash
npx apex version --json
npx apex update --json
npx apex doctor --json
```

APEX performs a three-way update against recorded managed hashes. It reports conflicts and preserves modified files
rather than replacing them silently. Updates install an immutable runtime generation for future projects. Existing runs
remain pinned to their original generation and continue without deleting `.apex` or restarting intake.

Use `--customizations-source /absolute/path` only to test a deliberate local source bundle. Later updates of that
selection require the same source.

## Roll Back Managed Files

```bash
npx apex customizations rollback --json
npx apex doctor --json
```

Rollback restores the prior managed bundle. It does not downgrade persisted contracts, project journals, or deployment
evidence. Restore package and `.apex` state from a matching checkpoint if a package rollback is required.

## Uninstall Or Reinstall

```bash
npx apex customizations uninstall --json
npx apex customizations reinstall --json
```

Uninstall removes unchanged managed files and preserves conflicts, unrelated files, project state, and history. Reinstall
uses the recorded client selection unless a custom source is supplied.

## Manage Capability Packs

```bash
npx apex capability list --json
```

The shipped capability-pack registry is currently empty. Do not install a retired pack or infer availability from
retained lifecycle commands. Governance uses reviewed baseline import, not local discovery or capability-pack execution;
follow the [governance baseline requirements](../vnext/PRD.md#req-gov-001-governance-and-policy).

## Final Distribution Decision

npm remains the current runtime delivery mechanism. Agent Plugins and easy APEX MCP redistribution are evaluated
[at the end of feature delivery](../vnext/ROADMAP.md#phase-6-distribution-last). No plugin installation command is promised
yet. The eventual path must cover both clients, the correct workspace, authentication, runtime dependencies, version
compatibility and safe update/upgrade/rollback/uninstall without a second updater managing the same files.

Plugin removal must not accidentally remove consumer project state. Updating APEX does not automatically migrate
persisted contracts, reconcile consumer design changes, or approve an infrastructure operation.

## Related

- [Prepare Windows 11](prepare-windows-11.md) - install WSL2, Azure, and Copilot prerequisites.
- [WSL2 and VS Code consumer runbook](../tutorials/wsl2-vscode-consumer-runbook.md) - install the published preview.
- [Windows 11 first run](../tutorials/windows-11-first-run.md) - bootstrap an Azure-ready workspace.
- [Complete the first local run](../tutorials/first-run.md)
- [Client support](../reference/client-support.md)
- [Client projections](../explanation/client-projections.md)
