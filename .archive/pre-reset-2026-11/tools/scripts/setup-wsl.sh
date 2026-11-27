#!/usr/bin/env bash
set -euo pipefail

usage() {
    printf '%s\n' \
        'Usage: bash tools/scripts/setup-wsl.sh [--install|--check|--login|--plan]' \
        '  --install  Install/upgrade latest stable tools and declared repository dependencies (default).' \
        '  --check    Report missing or Windows-resolved tools; do not install or sign in.' \
        '  --login    Interactive GitHub, Azure and Copilot sign-in; no installation or deployment.' \
        '  --plan     Print the Windows/WSL split without changing anything.' \
        'Run inside Ubuntu WSL2 as your normal Linux user, not in a devcontainer.'
}

fail() {
    printf 'ERROR: %s\n' "$*" >&2
    return 1
}

require_wsl() {
    [[ ! -e /.dockerenv && ! -e /run/.containerenv ]] || {
        fail 'Reopen this repository in Remote - WSL, not Dev Containers.'; return 1;
    }
    local kernel
    kernel="$(uname -r)"
    [[ "${kernel,,}" == *microsoft* && "${kernel,,}" == *wsl2* ]] || {
        fail 'Ubuntu on WSL2 is required. Check wsl --list --verbose from Windows.'; return 1;
    }
    [[ "$(id -u)" != 0 ]] || { fail 'Run as your normal Linux user, not root.'; return 1; }
    [[ -r /etc/os-release ]] || { fail 'Cannot identify the Linux distribution.'; return 1; }
    . /etc/os-release
    [[ "${ID:-}" == ubuntu ]] || { fail 'This installer supports Ubuntu only.'; return 1; }
}

download() {
    curl --fail --silent --show-error --location --retry 3 --proto '=https' --tlsv1.2 "$1" --output "$2"
}

github_tool() {
    local repository="$1" asset_pattern="$2" executable="$3" name="$4"
    local metadata asset_url asset_name digest version destination staging
    metadata="$scratch/$name-release.json"
    download "https://api.github.com/repos/$repository/releases/latest" "$metadata"
    jq -e --arg pattern "$asset_pattern" \
        '[.assets[] | select(.name | test($pattern))] | length == 1' "$metadata" >/dev/null || {
        fail "No unique stable $name asset for $architecture. Check upstream release support."; return 1;
    }
    asset_url="$(jq -r --arg pattern "$asset_pattern" '.assets[] | select(.name | test($pattern)) | .browser_download_url' "$metadata")"
    asset_name="$(jq -r --arg pattern "$asset_pattern" '.assets[] | select(.name | test($pattern)) | .name' "$metadata")"
    digest="$(jq -r --arg pattern "$asset_pattern" '.assets[] | select(.name | test($pattern)) | .digest' "$metadata")"
    version="$(jq -r '.tag_name' "$metadata")"
    [[ "$version" =~ ^[A-Za-z0-9._-]+$ && "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || {
        fail "$name release has no valid SHA-256 asset digest; refusing an unverified install."; return 1;
    }
    download "$asset_url" "$scratch/$name-download"
    printf '%s  %s\n' "${digest#sha256:}" "$scratch/$name-download" | sha256sum --check --status
    staging="$scratch/$name-unpacked"
    mkdir -p "$staging"
    case "$asset_name" in
        *.tar.gz) tar -xzf "$scratch/$name-download" -C "$staging" ;;
        *) install -m 0755 "$scratch/$name-download" "$staging/$executable" ;;
    esac
    local -a matches=()
    mapfile -t matches < <(find "$staging" -type f -path "*/$executable")
    [[ "${#matches[@]}" == 1 ]] || { fail "Unexpected $name archive layout."; return 1; }
    chmod u+x "${matches[0]}"
    destination="$tool_root/$name-$version"
    if [[ ! -e "$destination" ]]; then
        mv "$staging" "$destination"
    fi
    ln -sfn "$destination/${matches[0]#"$staging/"}" "$HOME/.local/bin/$name"
    printf 'Installed %s %s\n' "$name" "$version"
}

install_node() {
    local version archive digest destination
    download https://nodejs.org/dist/index.json "$scratch/node-index.json"
    version="$(jq -r '[.[] | select(.version | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$"))][0].version' "$scratch/node-index.json")"
    [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { fail 'Invalid Node release metadata.'; return 1; }
    archive="node-$version-linux-$node_arch.tar.xz"
    download "https://nodejs.org/dist/$version/SHASUMS256.txt" "$scratch/node-checksums"
    digest="$(awk -v filename="$archive" '$2 == filename {print $1}' "$scratch/node-checksums")"
    [[ "$digest" =~ ^[a-f0-9]{64}$ ]] || { fail 'Missing Node checksum.'; return 1; }
    download "https://nodejs.org/dist/$version/$archive" "$scratch/$archive"
    printf '%s  %s\n' "$digest" "$scratch/$archive" | sha256sum --check --status
    destination="$tool_root/node-$version-linux-$node_arch"
    if [[ ! -d "$destination" ]]; then
        tar -xJf "$scratch/$archive" -C "$tool_root"
    fi
    ln -sfn "$destination" "$tool_root/node-current"
    export PATH="$tool_root/node-current/bin:$PATH"
    npm install --global --prefix "$destination" npm@latest
}

install_terraform() {
    local version archive digest destination
    download https://checkpoint-api.hashicorp.com/v1/check/terraform "$scratch/terraform-release.json"
    version="$(jq -r '.current_version' "$scratch/terraform-release.json")"
    [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { fail 'Invalid Terraform stable version.'; return 1; }
    archive="terraform_${version}_linux_${architecture}.zip"
    download "https://releases.hashicorp.com/terraform/$version/terraform_${version}_SHA256SUMS" "$scratch/terraform-checksums"
    digest="$(awk -v filename="$archive" '$2 == filename {print $1}' "$scratch/terraform-checksums")"
    [[ "$digest" =~ ^[a-f0-9]{64}$ ]] || { fail 'Missing Terraform checksum.'; return 1; }
    download "https://releases.hashicorp.com/terraform/$version/$archive" "$scratch/$archive"
    printf '%s  %s\n' "$digest" "$scratch/$archive" | sha256sum --check --status
    mkdir -p "$scratch/terraform"
    unzip -q "$scratch/$archive" -d "$scratch/terraform"
    destination="$tool_root/terraform-v$version"
    if [[ ! -d "$destination" ]]; then
        mv "$scratch/terraform" "$destination"
    fi
    chmod u+x "$destination/terraform"
    ln -sfn "$destination/terraform" "$HOME/.local/bin/terraform"
}

check_tools() {
    local name location missing=0
    for name in node npm git python3 uv az bicep terraform gh copilot pwsh azd \
        gitleaks bats shellcheck actionlint vale yamllint rg make; do
        location="$(command -v "$name" || true)"
        if [[ -z "$location" || "$location" == /mnt/* || "$location" == *.exe ]]; then
            printf 'MISSING/LINUX REQUIRED: %s\n' "$name"
            missing=1
        else
            printf '%-12s %s\n' "$name" "$location"
        fi
    done
    if [[ ! -x "$repo_root/.venv/bin/python3" || ! -d "$repo_root/node_modules" ]]; then
        printf 'Repository dependencies missing; run --install.\n'
        missing=1
    else
        "$repo_root/.venv/bin/python3" -c 'import pytest, ruff'
    fi
    return "$missing"
}

login() {
    [[ -t 0 && -t 1 ]] || { fail 'Sign-in requires a terminal; secrets must never be supplied as script arguments.'; return 1; }
    for name in gh az copilot; do
        command -v "$name" >/dev/null || { fail "Install $name first."; return 1; }
    done
    if [[ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}${COPILOT_GITHUB_TOKEN:-}" ]]; then
        fail 'Token environment variables override interactive login. Unset them yourself to use this sign-in flow.'
        return 1
    fi
    gh auth status >/dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web
    gh auth setup-git --hostname github.com
    az account show --output none 2>/dev/null || az login --use-device-code --output none
    printf '%s\n' 'Verify your Azure subscription with az account show; no subscription or role is changed here.'
    printf '%s\n' 'Copilot will now open. Use /login if needed, complete browser sign-in, then /exit.'
    copilot
}

install_tools() {
    [[ -f "$repo_root/package-lock.json" && -f "$repo_root/packages/cli/package.json" ]] || {
        fail 'Run the script from an APEX source checkout.'; return 1;
    }
    [[ "$repo_root" != /mnt/* ]] || { fail 'Move the source checkout to the WSL Linux filesystem (for example ~/src).'; return 1; }
    sudo -n true || { fail 'In your own terminal run sudo -v, then rerun this script. Do not run the script with sudo.'; return 1; }
    sudo -n apt-get update
    sudo -n apt-get install -y --no-install-recommends ca-certificates curl jq unzip xz-utils build-essential \
        software-properties-common libicu-dev libssl-dev pkg-config libffi-dev libsecret-1-0
    sudo -n add-apt-repository -y ppa:git-core/ppa
    sudo -n apt-get update
    sudo -n apt-get install -y git bats shellcheck ripgrep
    download https://aka.ms/InstallAzureCLIDeb "$scratch/install-azure.sh"
    sudo -n bash "$scratch/install-azure.sh"
    install_node
    download https://astral.sh/uv/install.sh "$scratch/install-uv.sh"
    UV_INSTALL_DIR="$HOME/.local/bin" UV_NO_MODIFY_PATH=1 sh "$scratch/install-uv.sh"
    local python_version
    python_version="$(uv python list --only-downloads --output-format json | jq -r \
        '[.[] | select(.implementation == "cpython" and .variant == "default" and (.version | test("^[0-9]+\\.[0-9]+\\.[0-9]+$")))] | sort_by(.version | split(".") | map(tonumber)) | last.version')"
    [[ "$python_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { fail 'Cannot resolve latest stable Python.'; return 1; }
    uv python install "$python_version"
    if [[ -e "$repo_root/.venv" && ! -f "$repo_root/.venv/pyvenv.cfg" ]]; then
        fail '.venv exists but is not a Python virtual environment; refusing to replace it.'; return 1
    fi
    uv venv --allow-existing --python "$python_version" "$repo_root/.venv"
    uv pip install --python "$repo_root/.venv/bin/python3" --upgrade pytest ruff setuptools yamllint
    github_tool cli/cli "^gh_.*_linux_${architecture}\\.tar\\.gz$" bin/gh gh
    github_tool github/copilot-cli "^copilot-linux-${node_arch}\\.tar\\.gz$" copilot copilot
    github_tool Azure/bicep "^bicep-linux-${node_arch}$" bicep bicep
    github_tool Azure/azure-dev "^azd-linux-${architecture}\\.tar\\.gz$" "azd-linux-${architecture}" azd
    github_tool PowerShell/PowerShell "^powershell-.*-linux-${node_arch}\\.tar\\.gz$" pwsh pwsh
    github_tool gitleaks/gitleaks "^gitleaks_.*_linux_${gitleaks_arch}\\.tar\\.gz$" gitleaks gitleaks
    github_tool errata-ai/vale "^vale_.*_Linux_${vale_arch}\\.tar\\.gz$" vale vale
    github_tool rhysd/actionlint "^actionlint_.*_linux_${architecture}\\.tar\\.gz$" actionlint actionlint
    install_terraform
    az bicep install
    cd "$repo_root"
    npm ci
    local path_line='export PATH="$HOME/.local/share/apex-wsl/node-current/bin:$HOME/.local/bin:$PATH"'
    touch "$HOME/.bashrc"
    grep -Fqx "$path_line" "$HOME/.bashrc" || printf '\n%s\n' "$path_line" >> "$HOME/.bashrc"
    export PATH="$repo_root/.venv/bin:$PATH"
    check_tools
    printf '\nSetup complete. In each new WSL terminal:\n  source ~/.bashrc\n  source "%s/.venv/bin/activate"\n' "$repo_root"
    printf '%s\n' 'Then run this script with --login for interactive sign-in, and npm run qualify:vnext to test.'
    printf '%s\n' 'Latest tools may differ from release-qualified versions; setup does not rewrite toolchain locks.'
}

main() {
    [[ $# -le 1 ]] || { usage; return 2; }
    local mode="${1:---install}"
    case "$mode" in
        --help|-h) usage; return ;;
        --plan)
            printf '%s\n' 'Windows: WSL2 + Ubuntu, VS Code, WSL/Copilot extensions and VS Code account sign-in.' \
                'WSL2: latest stable Node/npm, Python/uv, Git, Azure/Bicep/Terraform, gh/Copilot and validation tools.' \
                'Repository: npm ci (existing lock), isolated .venv with latest Python test tools.' \
                'Sign-in: separate interactive --login. No credentials copied from Windows or a container.'
            return ;;
        --install|--check|--login) ;;
        *) usage; return 2 ;;
    esac
    require_wsl
    local repo_root tool_root architecture node_arch gitleaks_arch vale_arch
    repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
    tool_root="$HOME/.local/share/apex-wsl"
    export PATH="$repo_root/.venv/bin:$tool_root/node-current/bin:$HOME/.local/bin:$PATH"
    case "$(uname -m)" in
        x86_64) architecture=amd64; node_arch=x64; gitleaks_arch=x64; vale_arch=64-bit ;;
        aarch64) architecture=arm64; node_arch=arm64; gitleaks_arch=arm64; vale_arch=arm64 ;;
        *) fail 'Only x86_64 and aarch64 are supported.'; return 1 ;;
    esac
    case "$mode" in
        --check) check_tools ;;
        --login) login ;;
        --install)
            mkdir -p "$tool_root" "$HOME/.local/bin"
            scratch="$(mktemp -d)"
            trap 'rm -rf -- "$scratch"' EXIT
            install_tools ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
