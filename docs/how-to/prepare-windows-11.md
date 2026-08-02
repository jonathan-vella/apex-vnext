# Prepare Windows 11

> [Current Version](../../VERSION.md) | Prepare Windows 11, WSL2, Azure, and GitHub Copilot for APEX onboarding.

This guide assumes Windows 11, WSL2 with Ubuntu, an existing Azure subscription, and a GitHub account with an active
Copilot entitlement. Run Linux commands from an Ubuntu WSL terminal unless a step explicitly says PowerShell.

> [!IMPORTANT]
> Use a Linux workspace under your WSL home directory, such as `~/src`. Do not create the APEX workspace under
> `/mnt/c`; WSL filesystem performance and file permission behavior are more reliable inside the Linux filesystem.

## Install WSL2 And Ubuntu

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

Verify the environment:

```bash
wsl.exe --status
git --version
```

## Install VS Code And Copilot

Install VS Code from PowerShell:

```powershell
winget install Microsoft.VisualStudioCode
```

From the Ubuntu terminal, install the WSL and GitHub Copilot extensions into the VS Code host:

```bash
code --install-extension ms-vscode-remote.remote-wsl
code --install-extension GitHub.copilot
code --install-extension GitHub.copilot-chat
```

Open VS Code, sign in to GitHub, and confirm that GitHub Copilot Chat is available. APEX requires a Copilot-enabled
GitHub account for agent-led onboarding.

## Install Node.js And npm

Install Node.js 24 or later. The Node Version Manager keeps the Linux runtime independent of Windows:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
source ~/.bashrc
nvm install 24
nvm use 24
node --version
npm --version
```

> [!NOTE]
> APEX uses npm as its distribution authority. Use the npm that ships with the selected Node release.

## Install Azure Tooling

Install Azure CLI in Ubuntu:

```bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
az version
```

Sign in to the existing subscription and select it:

```bash
az login
az account list --output table
az account set --subscription "SUBSCRIPTION_NAME_OR_ID"
az account show --output table
```

This onboarding path requires **Owner** access on the selected subscription. Verify it before beginning a workload:

```bash
az role assignment list \
  --assignee "$(az ad signed-in-user show --query id --output tsv)" \
  --scope "/subscriptions/$(az account show --query id --output tsv)" \
  --query "[].roleDefinitionName" \
  --output tsv
```

> [!CAUTION]
> The Owner role can assign access and change subscription resources. Use the requested subscription only, and use a
> lower-privilege operational role after organization policy and deployment ownership are established.

## Choose An IaC Tool

APEX supports Bicep and Terraform. Choose one for each APEX project.

### Bicep

Install the Bicep CLI through Azure CLI:

```bash
az bicep install
az bicep version
```

### Terraform

Install HashiCorp Terraform for Ubuntu:

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

## Configure A Private npm Registry

If your organization publishes APEX through a private npm registry, obtain the registry URL and a read-only package
token from your administrator. Store the token outside the project repository:

```bash
npm config set @apex:registry "https://NPM_REGISTRY_URL/"
npm login --scope=@apex --registry="https://NPM_REGISTRY_URL/"
npm whoami --registry="https://NPM_REGISTRY_URL/"
```

Do not commit `.npmrc` files containing tokens. Prefer your user-level npm configuration or your organization-approved
credential helper.

## Verify Readiness

Run these checks before starting a workspace:

```bash
node --version
npm --version
git --version
az account show --output table
code --version
```

For Copilot CLI users, also install and authenticate the GitHub Copilot CLI according to the GitHub CLI documentation,
then verify its version and sign-in status.

## Related

- [Windows 11 first run](../tutorials/windows-11-first-run.md) - create and bootstrap an APEX workspace.
- [Manage installation](manage-installation.md) - update, roll back, or remove APEX-managed files.
- [Client support](../reference/client-support.md) - understand VS Code and Copilot CLI capability boundaries.
