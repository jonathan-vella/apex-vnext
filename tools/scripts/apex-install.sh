#!/usr/bin/env bash
set -euo pipefail

usage() {
    printf '%s\n' \
        'Usage: bash apex-install.sh --version EXACT_APEX_VERSION [--plan|--install --yes]' \
        '  --plan                   Inspect both clients and IaC tracks without writes or network (default).' \
        '  --install --yes          Apply the displayed installation plan.' \
        '  --allow-system           Separately approve Ubuntu package/repository changes using sudo -n.' \
        '  --replace-incompatible   Permit a user-local tool to shadow an incompatible installed version.' \
        'Requires ready Ubuntu WSL2; does not install Windows/WSL, sign in, initialize repos or change Azure.'
}

fail() { printf 'ERROR: %s\n' "$*" >&2; }

require_host() {
    local kernel
    kernel="$(uname -r)"
    [[ "${kernel,,}" == *microsoft* && "${kernel,,}" == *wsl2* ]] || {
        fail 'Ubuntu WSL2 is required; prepare the Windows host first.'; return 1;
    }
    [[ "$(id -u)" != 0 ]] || { fail 'Run as your normal WSL user, not root.'; return 1; }
    [[ ! -e /.dockerenv && ! -e /run/.containerenv ]] || { fail 'Use WSL2 without a container.'; return 1; }
    [[ -r /etc/os-release ]] || { fail 'Linux distribution is unavailable.'; return 1; }
    # shellcheck disable=SC1091
    . /etc/os-release
    [[ "${ID:-}" == ubuntu ]] || { fail 'Only Ubuntu is supported.'; return 1; }
    case "$(uname -m)" in x86_64|aarch64) ;; *) fail 'Only x86_64 and aarch64 are supported.'; return 1 ;; esac
}

valid_version() { [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[A-Za-z0-9]+([.-][A-Za-z0-9]+)*)?$ ]]; }

tool_version() {
    local tool="$1" output
    # shellcheck disable=SC2016
    case "$tool" in
        pwsh) output="$(timeout 15 pwsh -NoLogo -NoProfile -Command '$PSVersionTable.PSVersion.ToString()' 2>/dev/null)" || return 1 ;;
        apex) output="$(timeout 15 apex version --json 2>/dev/null)" || return 1
            printf '%s' "$output" | jq -er '.result.version | select(type == "string")'; return ;;
        copilot) output="$(timeout 15 copilot --no-auto-update --version 2>/dev/null)" || return 1 ;;
        *) output="$(timeout 15 "$tool" --version 2>/dev/null)" || return 1 ;;
    esac
    [[ "$output" =~ ([0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?) ]] || return 1
    printf '%s\n' "${BASH_REMATCH[1]}"
}

minimum_version() {
    case "$1" in
        node) printf '%s' '__APEX_NODE_VERSION__' ;;
        npm) printf '%s' '__APEX_NPM_VERSION__' ;;
        copilot) printf '%s' '__APEX_COPILOT_VERSION__' ;;
        code) printf '%s' '__APEX_VSCODE_VERSION__' ;;
        *) printf '0.0.0' ;;
    esac
}

compatible() {
    local tool="$1" actual="$2" minimum
    if [[ "$tool" == apex ]]; then [[ "$actual" == "$release" ]]; return; fi
    minimum="$(minimum_version "$tool")"
    [[ "$actual" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$minimum" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
    [[ "$(printf '%s\n%s\n' "$minimum" "$actual" | sort -V | head -n 1)" == "$minimum" ]]
}

plan() {
    local tool location version state
    actions=()
    blocked=0
    printf 'APEX installation plan: %s; both Copilot clients and both IaC tracks\n' "$release"
    for tool in git node npm gh copilot az bicep terraform pwsh azd code apex; do
        location="$(command -v "$tool" || true)"
        version='not available'
        state=install
        if [[ -n "$location" ]]; then
            if [[ "$tool" != code && ( "$location" == /mnt/* || "$location" == *.exe ) ]]; then
                state=conflict
            elif version="$(tool_version "$tool")" && compatible "$tool" "$version"; then
                state=preserve
            else
                state=conflict
            fi
        fi
        if [[ "$tool" == code && "$state" != preserve ]]; then
            state=host-action
            blocked=1
        elif [[ "$state" == conflict && "$replace" != true ]]; then
            blocked=1
        elif [[ "$state" != preserve ]]; then
            actions+=("$tool")
        fi
        printf '%-12s %-12s %s\n' "$tool" "$state" "$version"
    done
    printf '%s\n' 'VS Code host, WSL/Copilot extensions, account access and interactive login require separate verification.'
    printf '%s\n' 'Downloads: pinned Node/npm/Copilot; other missing tools use official stable releases with integrity checks.'
    printf '%s\n' 'System prerequisites if missing: ca-certificates, curl, jq, Python 3, xz-utils, gnupg and Git.'
    printf '%s\n' 'Missing Azure CLI adds its Microsoft signed-package repository for this Ubuntu release; unsupported releases fail.'
    printf '%s\n' 'No cloud permissions, repositories, OIDC configuration or deployment approval are created by this plan.'
}

download() {
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
        --connect-timeout 15 --max-time 300 --retry 2 "$1" --output "$2"
}

verify_download() {
    [[ "$2" =~ ^[a-f0-9]{64}$ ]] || { fail 'No valid SHA-256 digest; refusing download.'; return 1; }
    printf '%s  %s\n' "$2" "$1" | sha256sum --check --status
}

extract_archive() {
    python3 - "$1" "$2" <<'PY'
import pathlib
import stat
import sys
import tarfile
import zipfile

archive, destination = sys.argv[1:]
root = pathlib.Path(destination).resolve()
def check(name):
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name:
        raise ValueError("Unsafe archive path")
if zipfile.is_zipfile(archive):
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            check(entry.filename)
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError("Archive symlink is unsupported")
        source.extractall(root)
else:
    with tarfile.open(archive) as source:
        for entry in source.getmembers():
            check(entry.name)
        source.extractall(root, filter="data")
PY
}

link_tool() {
    local source="$1" name="$2" destination="$HOME/.local/bin/$2"
    if [[ -e "$destination" || -L "$destination" ]]; then
        [[ -L "$destination" && "$(readlink -f "$destination")" == "$tool_root/"* ]] || {
            fail "Preserve existing $destination; resolve its ownership before installing."; return 1;
        }
    fi
    ln -sfn "$source" "$destination" || return 1
    printf 'Installed user-local %s\n' "$name"
}

github_tool() {
    local repository="$1" pattern="$2" executable="$3" name="$4" tag="${5:-latest}"
    local metadata url digest asset destination
    metadata="$scratch/$name.json"
    if [[ "$tag" == latest ]]; then download "https://api.github.com/repos/$repository/releases/latest" "$metadata" || return 1
    else download "https://api.github.com/repos/$repository/releases/tags/$tag" "$metadata" || return 1; fi
    jq -e --arg pattern "$pattern" '[.assets[] | select(.name | test($pattern))] | length == 1' "$metadata" >/dev/null || return 1
    url="$(jq -er --arg pattern "$pattern" '.assets[] | select(.name | test($pattern)) | .browser_download_url' "$metadata")" || return 1
    digest="$(jq -er --arg pattern "$pattern" '.assets[] | select(.name | test($pattern)) | .digest' "$metadata")" || return 1
    asset="$(jq -er --arg pattern "$pattern" '.assets[] | select(.name | test($pattern)) | .name' "$metadata")" || return 1
    [[ "$url" == "https://github.com/$repository/releases/download/"* && "$digest" == sha256:* ]] || {
        fail "Invalid official release metadata for $name"; return 1;
    }
    download "$url" "$scratch/$name.download" || return 1
    verify_download "$scratch/$name.download" "${digest#sha256:}" || return 1
    destination="$(mktemp -d "$tool_root/$name.XXXXXXXX")" || return 1
    case "$asset" in
        *.tar.gz|*.zip) extract_archive "$scratch/$name.download" "$destination" || return 1 ;;
        *) install -m 0755 "$scratch/$name.download" "$destination/$executable" || return 1 ;;
    esac
    local -a matches=()
    mapfile -t matches < <(find "$destination" -type f -path "*/$executable")
    [[ "${#matches[@]}" == 1 ]] || { fail "Unexpected $name archive layout"; return 1; }
    chmod u+x "${matches[0]}" || return 1
    link_tool "${matches[0]}" "$name"
}

install_node() {
    local version archive digest destination
    version="$(minimum_version node)"
    valid_version "$version" || { fail 'Use the generated release installer, not its source template.'; return 1; }
    archive="node-v$version-linux-$node_arch.tar.xz"
    download "https://nodejs.org/dist/v$version/SHASUMS256.txt" "$scratch/node.checksums" || return 1
    digest="$(awk -v filename="$archive" '$2 == filename {print $1}' "$scratch/node.checksums")"
    download "https://nodejs.org/dist/v$version/$archive" "$scratch/node.download" || return 1
    verify_download "$scratch/node.download" "$digest" || return 1
    destination="$(mktemp -d "$tool_root/node.XXXXXXXX")" || return 1
    extract_archive "$scratch/node.download" "$destination" || return 1
    link_tool "$destination/node-v$version-linux-$node_arch/bin/node" node || return 1
    if [[ " ${actions[*]} " == *' npm '* ]]; then
        for executable in npm npx; do link_tool "$destination/node-v$version-linux-$node_arch/bin/$executable" "$executable" || return 1; done
    fi
}

install_terraform() {
    local version archive digest destination
    download https://checkpoint-api.hashicorp.com/v1/check/terraform "$scratch/terraform.json" || return 1
    version="$(jq -er '.current_version' "$scratch/terraform.json")" || return 1
    valid_version "$version" || { fail 'Invalid Terraform release'; return 1; }
    archive="terraform_${version}_linux_${architecture}.zip"
    download "https://releases.hashicorp.com/terraform/$version/terraform_${version}_SHA256SUMS" "$scratch/terraform.checksums" || return 1
    digest="$(awk -v filename="$archive" '$2 == filename {print $1}' "$scratch/terraform.checksums")"
    download "https://releases.hashicorp.com/terraform/$version/$archive" "$scratch/terraform.download" || return 1
    verify_download "$scratch/terraform.download" "$digest" || return 1
    destination="$(mktemp -d "$tool_root/terraform.XXXXXXXX")" || return 1
    extract_archive "$scratch/terraform.download" "$destination" || return 1
    chmod u+x "$destination/terraform" || return 1
    link_tool "$destination/terraform" terraform
}

system_packages() {
    [[ "$system" == true ]] || { fail 'Ubuntu packages require separate --allow-system approval.'; return 1; }
    sudo -n true || { fail 'Run sudo -v yourself in the terminal, then rerun. Never send a password to an agent.'; return 1; }
    sudo -n apt-get update || return 1
    sudo -n apt-get install -y --no-install-recommends "$@"
}

install_azure_cli() {
    [[ "$system" == true ]] || { fail 'Azure CLI repository setup requires --allow-system.'; return 1; }
    local VERSION_CODENAME=''
    # shellcheck disable=SC1091
    . /etc/os-release
    [[ "$VERSION_CODENAME" =~ ^[a-z]+$ ]] || { fail 'Unsupported Ubuntu release'; return 1; }
    sudo -n true || { fail 'Run sudo -v yourself before continuing.'; return 1; }
    download https://packages.microsoft.com/keys/microsoft.asc "$scratch/microsoft.asc" || return 1
    gpg --batch --yes --dearmor --output "$scratch/microsoft.gpg" "$scratch/microsoft.asc" || return 1
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/apex-microsoft.gpg] https://packages.microsoft.com/repos/azure-cli/ %s main\n' "$architecture" "$VERSION_CODENAME" > "$scratch/azure-cli.list"
    for spec in 'microsoft.gpg:/etc/apt/keyrings/apex-microsoft.gpg' 'azure-cli.list:/etc/apt/sources.list.d/apex-azure-cli.list'; do
        local source="${spec%%:*}" destination="${spec#*:}"
        if [[ -e "$destination" || -L "$destination" ]]; then
            if [[ -L "$destination" ]] || ! cmp -s "$scratch/$source" "$destination"; then
                fail "Preserve conflicting $destination"; return 1
            fi
        else
            sudo -n install -D -m 0644 "$scratch/$source" "$destination" || return 1
        fi
    done
    system_packages azure-cli
}

install_bootstrap_launcher() {
    local apex_path launcher="$tool_root/apex-bootstrap" launcher_content
    apex_path="$(type -P apex)" || { fail 'Verified APEX executable is not on PATH.'; return 1; }
    [[ "$apex_path" == /* && -f "$apex_path" && -x "$apex_path" ]] || { fail 'APEX launcher requires an absolute executable path.'; return 1; }
    # shellcheck disable=SC2016
    launcher_content="$(printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail'; printf 'exec %q bootstrap "$@"\n' "$apex_path")"
    if [[ -e "$launcher" || -L "$launcher" ]]; then
        if [[ -L "$launcher" ]] || ! cmp -s <(printf '%s\n' "$launcher_content") "$launcher"; then
            fail 'Bootstrap launcher was modified or its APEX binding changed; preserve it for review.'; return 1
        fi
    else
        printf '%s\n' "$launcher_content" > "$launcher" || return 1
        chmod u+x "$launcher" || return 1
    fi
    link_tool "$launcher" apex-bootstrap
}

install_plan() {
    local dependency missing=false tool actual prefix
    for dependency in curl jq python3 tar xz sha256sum gpg; do command -v "$dependency" >/dev/null || missing=true; done
    if [[ "$missing" == true ]]; then system_packages ca-certificates curl jq python3 xz-utils gnupg || return 1; fi
    for tool in "${actions[@]}"; do
        case "$tool" in
            git) system_packages git || return 1 ;;
            node) install_node || return 1 ;;
            npm) prefix="$(mktemp -d "$tool_root/npm.XXXXXXXX")" || return 1
                npm install --global --prefix "$prefix" --ignore-scripts --no-audit --no-fund "npm@$(minimum_version npm)" || return 1
                link_tool "$prefix/bin/npm" npm || return 1; link_tool "$prefix/bin/npx" npx || return 1 ;;
            gh) github_tool cli/cli "^gh_.*_linux_${architecture}\\.tar\\.gz$" bin/gh gh || return 1 ;;
            copilot) github_tool github/copilot-cli "^copilot-linux-${node_arch}\\.tar\\.gz$" copilot copilot "v$(minimum_version copilot)" || return 1 ;;
            az) install_azure_cli || return 1 ;;
            bicep) github_tool Azure/bicep "^bicep-linux-${node_arch}$" bicep bicep || return 1 ;;
            terraform) install_terraform || return 1 ;;
            pwsh) github_tool PowerShell/PowerShell "^powershell-.*-linux-${node_arch}\\.tar\\.gz$" pwsh pwsh || return 1 ;;
            azd) github_tool Azure/azure-dev "^azd-linux-${architecture}\\.tar\\.gz$" "azd-linux-${architecture}" azd || return 1 ;;
            apex) prefix="$(mktemp -d "$tool_root/apex-$release.XXXXXXXX")" || return 1
                npm install --global --prefix "$prefix" --ignore-scripts --no-audit --no-fund "@apexops/cli@$release" || return 1
                link_tool "$prefix/bin/apex" apex || return 1 ;;
        esac
        hash -r
        actual="$(tool_version "$tool")" || { fail "Unable to verify installed $tool"; return 1; }
        compatible "$tool" "$actual" || { fail "Post-install verification failed for $tool"; return 1; }
    done
    install_bootstrap_launcher || return 1
    printf 'Local tool installation verified. Add %s/.local/bin to PATH in new terminals.\n' "$HOME"
    printf '%s\n' 'Pending: verify VS Code WSL/Copilot extensions and account access, then use apex bootstrap plan.'
}

main() {
    local mode=plan release='' yes=false system=false replace=false blocked=0 tool
    local -a actions=()
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --help|-h) usage; return ;;
            --version) [[ $# -gt 1 ]] || { fail 'Missing --version value'; return 2; }; release="$2"; shift ;;
            --plan) mode=plan ;;
            --install) mode=install ;;
            --yes) yes=true ;;
            --allow-system) system=true ;;
            --replace-incompatible) replace=true ;;
            *) fail "Unknown argument: $1"; return 2 ;;
        esac
        shift
    done
    valid_version "$release" || { fail 'An exact APEX release version is required, not a tag or command.'; return 2; }
    if [[ "$mode" == install && "$yes" != true ]]; then fail 'Installation requires --yes after reviewing the plan.'; return 2; fi
    if [[ "$mode" == install ]]; then
        for tool in node npm copilot code; do
            valid_version "$(minimum_version "$tool")" || { fail 'Use a generated release installer, not the source template.'; return 2; }
        done
    fi
    require_host || return 1
    local tool_root="$HOME/.local/share/apex-install" scratch architecture node_arch
    case "$(uname -m)" in x86_64) architecture=amd64; node_arch=x64 ;; aarch64) architecture=arm64; node_arch=arm64 ;; esac
    export PATH="$HOME/.local/bin:$PATH"
    plan || return 1
    if [[ "$mode" == plan ]]; then return 0; fi
    [[ "$blocked" == 0 ]] || { fail 'Resolve host actions or explicitly approve incompatible-tool replacement.'; return 1; }
    [[ ! -L "$HOME/.local" && ! -L "$HOME/.local/share" && ! -L "$tool_root" && ! -L "$HOME/.local/bin" ]] || { fail 'Installer paths must not be symlinks.'; return 1; }
    mkdir -p "$tool_root" "$HOME/.local/bin"
    mkdir "$tool_root/install.lock" 2>/dev/null || { fail 'Another install or an interrupted install lock exists; inspect it before retrying.'; return 1; }
    # shellcheck disable=SC2064
    trap "$(printf 'rmdir -- %q' "$tool_root/install.lock")" EXIT
    scratch="$(mktemp -d "$tool_root/download.XXXXXXXX")"
    # shellcheck disable=SC2064
    trap "$(printf 'rm -rf -- %q; rmdir -- %q' "$scratch" "$tool_root/install.lock")" EXIT
    install_plan
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi