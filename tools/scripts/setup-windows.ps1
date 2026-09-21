[CmdletBinding()]
param(
    [ValidateSet('Wsl', 'Editor')]
    [string]$Stage = 'Editor',
    [ValidatePattern('^[A-Za-z0-9.-]+$')]
    [string]$Distribution = 'Ubuntu'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -eq 3010) {
        throw 'Windows requires a restart. Restart, then rerun this stage.'
    }
    if ($Executable -eq 'winget.exe' -and $LASTEXITCODE -eq -1978335189) {
        Write-Host 'Package is already current.'
        return
    }
    if ($LASTEXITCODE -ne 0) {
        throw "$Executable failed with exit code $LASTEXITCODE. Resolve the reported error and rerun."
    }
}

if ($env:OS -ne 'Windows_NT') {
    throw 'Run this script in Windows PowerShell, not inside WSL or a container.'
}
if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw 'Install or update App Installer from the Microsoft Store to obtain winget, then rerun.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$administrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($Stage -eq 'Wsl') {
    if (-not $administrator) {
        throw 'Run the Wsl stage from Windows PowerShell as administrator. Run the Editor stage as your normal user.'
    }
    Invoke-Checked 'winget.exe' @('install', '--id', 'Microsoft.WSL', '--exact', '--source', 'winget',
        '--accept-source-agreements', '--accept-package-agreements')
    Invoke-Checked 'wsl.exe' @('--install', '--no-distribution')
    $virtualMachinePlatform = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
    if ($virtualMachinePlatform.State -ne 'Enabled') {
        throw 'WSL virtualization is not ready. Restart Windows, ensure virtualization is enabled, and rerun Wsl.'
    }
    Invoke-Checked 'wsl.exe' @('--update')
    Invoke-Checked 'wsl.exe' @('--set-default-version', '2')
    $distributions = @(& wsl.exe --list --quiet)
    if ($LASTEXITCODE -ne 0) {
        throw 'Cannot list WSL distributions. Restart Windows if requested and rerun Wsl.'
    }
    $distributions = @($distributions | ForEach-Object { ($_ -replace "`0", '').Trim() })
    if ($distributions -notcontains $Distribution) {
        Invoke-Checked 'wsl.exe' @('--install', '--distribution', $Distribution, '--no-launch')
    }
    Write-Host "Restart Windows if requested. Launch $Distribution once to create your Linux username and password."
    Write-Host "Then inspect 'wsl --list --verbose'. For an existing WSL1 distro, back it up before conversion."
    Write-Host 'No existing distribution is unregistered, reset, or automatically converted by this script.'
    return
}

if ($administrator) {
    throw 'Run the Editor stage in a non-elevated Windows PowerShell window for your normal user profile.'
}
Invoke-Checked 'winget.exe' @('install', '--id', 'Microsoft.VisualStudioCode', '--exact', '--source', 'winget',
    '--scope', 'user', '--accept-source-agreements', '--accept-package-agreements')
$code = Get-Command code.cmd -ErrorAction SilentlyContinue
if ($code) {
    $codePath = $code.Source
} else {
    $codePath = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd'
}
if (-not (Test-Path $codePath)) {
    throw 'VS Code is installed but code.cmd was not found. Open a new PowerShell window and rerun Editor.'
}
foreach ($extension in @('ms-vscode-remote.remote-wsl', 'GitHub.copilot', 'GitHub.copilot-chat')) {
    Invoke-Checked $codePath @('--install-extension', $extension, '--force')
}
Write-Host 'Windows editor setup complete. Sign in to GitHub through VS Code Accounts using your Copilot entitlement.'
Write-Host 'Inside Ubuntu WSL2, keep the repository under ~/src, run setup-wsl.sh, then open it with code .'
Write-Host 'Use Remote - WSL, not Reopen in Container. Install language extensions in WSL when VS Code requests them.'
