# Prepare Windows 11

> [Current Version](../../VERSION.md) | Prepare native Windows for VS Code or the Copilot app, or WSL2 for Copilot CLI.

This guide assumes Windows 11 25H2 or 24H2, an existing Azure subscription, and a GitHub account with an active Copilot
entitlement. Choose your host first: VS Code with the Copilot harness or the GitHub Copilot app on native Windows, or
GitHub Copilot CLI in WSL2. [Manage installation](manage-installation.md#choose-one-host-per-workspace) compares them.
Use one host per workspace.

Docker, a devcontainer and a clone of the APEX development repository are not consumer prerequisites. Install tools for
the selected host and requested stage; cloud credentials are not needed merely to inspect local project state. Both
workload profiles follow the [PRD boundary](../vnext/PRD.md#workload-boundary). Check the
[release status](manage-installation.md) before you install: the APEX plugin has no published release yet.

## Prepare Native Windows For VS Code Or The App

Run these commands in PowerShell. App Installer (`winget`) must be available.

### Update Windows

Install current Windows updates from **Settings** > **Windows Update**. Client local sandboxing needs the September
2026 Windows security update or later; the GitHub Copilot app documents Windows 11 25H2 with KB5124010 or later.

### Install The Client

For VS Code, install it and check that the version is 1.140 or later:

```powershell
winget install Microsoft.VisualStudioCode
code --version
```

Open VS Code and sign in through **Accounts** with your Copilot-enabled GitHub account. APEX runs in the Copilot
harness: set the chat session target to **Copilot**. The **Local** harness is not supported.

For the GitHub Copilot app, install it and sign in with the same account. Add the workspace folder as a local project.

Then turn on local sandboxing for your client as described in
[Manage installation](manage-installation.md#turn-on-local-sandboxing).

### Install Git, Node.js And Copilot CLI

Install Git and Node.js 24.21.0 (LTS) or later, then verify them:

```powershell
winget install Git.Git
winget install OpenJS.NodeJS.LTS
git --version
node --version
npm --version
```

Install GitHub Copilot CLI, which needs PowerShell 6 or later on Windows. On Windows it only manages the plugin store
that VS Code and the app read; do not run APEX sessions in it.

```powershell
winget install Microsoft.PowerShell
winget install GitHub.Copilot
copilot --version
```

Then [install the plugin](manage-installation.md#windows-vs-code-or-the-app).

### Install Azure Tooling On Windows

Install Azure CLI and the IaC tool for each project, Bicep or Terraform:

```powershell
winget install Microsoft.AzureCLI
winget install Microsoft.Bicep
winget install Hashicorp.Terraform
```

Open a new PowerShell window so the updated PATH applies, then continue with
[Sign In To Azure](#sign-in-to-azure).

## Prepare WSL2 For Copilot CLI

Run Linux commands from an Ubuntu WSL terminal unless a step says PowerShell.

> [!IMPORTANT]
> Use a Linux workspace under your WSL home directory, such as `~/src`. Do not create the APEX workspace under
> `/mnt/c`; WSL filesystem performance and file permission behavior are more reliable inside the Linux filesystem.

### Install WSL2 And Ubuntu

For APEX repository development, use the [automated setup](#automated-repository-setup) below instead of repeating the
manual installation sections. The manual path remains available for consumers who need fewer tools.

Open PowerShell as an administrator and install WSL with Ubuntu if it is not already present:

```powershell
wsl --install -d Ubuntu
```

Restart Windows when prompted. Then open **Ubuntu** from the Start menu, create your Linux user, and update packages:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl git
```

Verify the environment. The distribution must run as WSL version 2:

```bash
wsl.exe --status
wsl.exe --list --verbose
git --version
```

### Install Node.js And npm

Install Node.js 24.21.0 (LTS) or later. The Node Version Manager keeps the Linux runtime independent of Windows:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
source ~/.bashrc
nvm install 24
nvm use 24
node --version
npm --version
```

### Install Copilot CLI And Sandbox Tools

Install GitHub Copilot CLI and the tools its local sandbox needs, then sign in:

```bash
npm install -g @github/copilot
sudo apt install -y bubblewrap slirp4netns
copilot --version
copilot login
```

Turn on local sandboxing as described in [Manage installation](manage-installation.md#turn-on-local-sandboxing), then
[install the plugin](manage-installation.md#linux-or-wsl2-copilot-cli).

### Install Azure Tooling On Ubuntu

Install Azure CLI in Ubuntu:

```bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
az version
```

APEX supports Bicep and Terraform. Choose one for each APEX project.

Install the Bicep CLI through Azure CLI:

```bash
az bicep install
az bicep version
```

Or install HashiCorp Terraform for Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y gnupg software-properties-common
wget -O- https://apt.releases.hashicorp.com/gpg | gpg --dearmor | \
  sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg > /dev/null
sudo chmod go+r /usr/share/keyrings/hashicorp-archive-keyring.gpg
  codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
  echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] \
  https://apt.releases.hashicorp.com $codename main" | \
  sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt-get update
sudo apt-get install -y terraform
terraform version
```

## Sign In To Azure

Sign in to the existing subscription and select it. These commands are the same in PowerShell and Ubuntu:

```bash
az login
az account list --output table
az account set --subscription "SUBSCRIPTION_NAME_OR_ID"
az account show --output table
```

Use the least-privilege access granted for the intended workload operations. ALZ consumers must not require blanket
subscription Owner access just to start APEX; supplied identity/networking/monitoring references may have separate read
and use permissions. Labs may need additional rights to create workload-owned support resources, but do not assume or
grant those rights automatically. Inspect the signed-in user's direct assignments as one input. In Ubuntu:

```bash
az role assignment list \
  --assignee "$(az ad signed-in-user show --query id --output tsv)" \
  --scope "/subscriptions/$(az account show --query id --output tsv)" \
  --query "[].roleDefinitionName" \
  --output tsv
```

In PowerShell:

```powershell
$userId = az ad signed-in-user show --query id --output tsv
$subscriptionId = az account show --query id --output tsv
az role assignment list --assignee $userId --scope "/subscriptions/$subscriptionId" `
  --query "[].roleDefinitionName" --output tsv
```

> [!CAUTION]
> This listing is not a complete effective-permission proof: group membership, inheritance, deny assignments and
> conditions can affect access. Ask the platform owner to resolve missing permissions; do not elevate access or
> replace shared resources to bypass a boundary. Service-principal identities need their own permission assessment.

## Configure A Private npm Registry

If your organization publishes APEX through a private npm registry, obtain the registry URL and a read-only package
token from your administrator. Store the token outside the project repository:

```bash
npm config set @apexops:registry "https://NPM_REGISTRY_URL/"
npm login --scope=@apexops --registry="https://NPM_REGISTRY_URL/"
npm whoami --registry="https://NPM_REGISTRY_URL/"
```

Do not commit `.npmrc` files containing tokens. Prefer your user-level npm configuration or your organization-approved
credential helper.

## Verify Readiness

Run these checks before starting a workspace, in PowerShell for VS Code or the app and in Ubuntu for Copilot CLI:

```bash
node --version
npm --version
git --version
copilot --version
az account show --output table
```

For VS Code, `code --version` must report 1.140 or later. Confirm that local sandboxing is on for your client and that
`copilot plugin list` shows one `apex` plugin once a release is published. After you install the CLI, `apex doctor`
checks the same prerequisites for your host; see [Verify a clean host](manage-installation.md#verify-a-clean-host).

## Automated Repository Setup

This automation prepares an APEX development checkout in WSL2 for repository contributors. It does not prepare a
consumer host or an Azure deployment. Use the scripts from the reviewed checkout; they do not clone repositories, remove
a devcontainer, copy credentials, grant Azure roles or change subscriptions.

| Install location         | Contents                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Windows                  | WSL2/Ubuntu, VS Code, WSL and Copilot extensions                                           |
| Ubuntu WSL2              | Node/npm, Git, Python/uv, Azure CLI, Bicep, Terraform, GitHub CLI and Copilot CLI          |
| Ubuntu development tools | PowerShell, azd, Gitleaks, Vale, actionlint, Bats, ShellCheck, ripgrep and build utilities |
| Repository               | Declared npm dependencies and an isolated Python `.venv` with test/lint tools              |

No Windows Node, Python, Azure CLI, Terraform or Git installation is required for Linux development. VS Code runs on
Windows and connects to the Linux workspace; install language extensions on the WSL side when VS Code requests them.

### Windows Stages

Run [setup-windows.ps1](../../tools/scripts/setup-windows.ps1) from Windows PowerShell using its Windows-accessible path
in your checkout. A Linux checkout can be reached through `\\wsl.localhost\<distribution>\<Linux path>` after WSL exists.
For a new machine, obtain the reviewed script on Windows first. App Installer/WinGet must already be available.

In an administrator PowerShell window:

```powershell
.\tools\scripts\setup-windows.ps1 -Stage Wsl -Distribution Ubuntu
```

Use your existing distribution's exact name when different, such as `Ubuntu-26.04`. Restart when requested, rerun the
stage if needed, then launch the distribution to create its Linux username/password. Check `wsl --list --verbose`;
existing WSL1 distributions are not automatically converted or reset. Back up before any deliberate conversion.

In a normal, non-administrator PowerShell window:

```powershell
.\tools\scripts\setup-windows.ps1 -Stage Editor
```

Sign in through VS Code Accounts with your Copilot-enabled account. If execution policy blocks a script, follow your
organization's approved policy; the automation does not change execution policy or bypass it.

### Ubuntu Stages

Open the checkout in Ubuntu's Linux filesystem, outside the container, then run:

```bash
bash tools/scripts/setup-wsl.sh --plan
sudo -v
bash tools/scripts/setup-wsl.sh --install
source ~/.bashrc
source .venv/bin/activate
bash tools/scripts/setup-wsl.sh --check
bash tools/scripts/setup-wsl.sh --login
code .
```

Enter your sudo password directly in your terminal. The installer uses non-interactive sudo and stops if authorization
expires; refresh it yourself and rerun. Never launch the full installer as root. In VS Code use **Remote - WSL**, not
**Reopen in Container**. The script rejects containers, non-WSL2 systems and checkouts under `/mnt`.

`--login` checks existing GitHub/Azure sessions before starting browser/device authentication, configures GitHub's Git
credential helper, and opens Copilot CLI. Use `/login` there if needed, then `/exit`. Token environment overrides cause
the script to stop rather than overwrite them. VS Code sign-in is separate; no tokens are printed or copied by APEX.
Review any credential-storage warnings from GitHub CLI; desktop keyring availability depends on your WSL setup.

### Updates And Verification

Rerun the installer to resolve current stable upstream releases, not fixed versions. Node uses the latest stable Current
release, not an LTS pin. Python excludes prereleases. Git comes from the Git stable PPA; Ubuntu utilities use the latest
candidates in configured apt repositories, which can lag upstream. Unsupported Ubuntu vendor repositories or missing
release digests stop installation; the script does not downgrade silently. No Ubuntu distribution upgrade is performed.

Release binaries are checksum-verified using upstream metadata. Official Azure/uv installers run from HTTPS downloads.
These operations modify user tool directories, append one PATH entry to `.bashrc`, configure package repositories and
install system packages. Existing user-owned tool links at the installed names are replaced; old version directories
remain available. This is not a transactional OS rollback tool.

As agreed, `npm ci` preserves repository dependency declarations and the lockfile. Latest Python validation tools are
installed in `.venv`, not into Ubuntu's system Python. Activate `.venv` in each development terminal. Latest host tools
can differ from release-qualified toolchain versions; run tests and address compatibility failures rather than changing
release locks automatically.

```bash
node --test tools/tests/wsl-setup.test.mjs
npm run build:vnext
npm run validate:all
npm run qualify:vnext
```

Offline setup tests cover guards, parsing, routing, checksum failures and repeat installation. A successful clean Windows
and WSL2 installation still needs a real host trial; those tests do not establish live installation or sign-in success.

## Related

- [Windows 11 first run](../tutorials/windows-11-first-run.md) - start APEX in VS Code or the app on native Windows.
- [Copilot CLI on WSL2 runbook](../tutorials/wsl2-vscode-consumer-runbook.md) - start APEX in Copilot CLI.
- [Manage installation](manage-installation.md) - install, update and reset the plugin and workspace files.
- [Client support](../reference/client-support.md) - understand client support and qualification boundaries.
