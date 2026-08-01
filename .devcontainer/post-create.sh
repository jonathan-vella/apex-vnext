#!/usr/bin/env bash
# Deterministic vNext development bootstrap for Linux amd64 and arm64.
set -euo pipefail

exec > >(tee "$HOME/.devcontainer-install.log") 2>&1

architecture="$(dpkg --print-architecture)"
case "$architecture" in
    amd64|arm64) ;;
    *)
        printf 'Unsupported architecture: %s (expected amd64 or arm64)\n' "$architecture" >&2
        exit 1
        ;;
esac

printf '\nAPEX vNext devcontainer bootstrap (%s)\n' "$architecture"

# package-lock.json is the only Node dependency authority.
npm ci --loglevel=error

# Python is repository test support only. Capability packs resolve their own
# locked Python dependencies when installed by the vNext runtime.
uv pip install --system --quiet pytest ruff
uv pip install --system --quiet --editable tools/apex-recall

install -d -m 0755 "$HOME/.cache/uv" "$HOME/.config/gh" "$HOME/.terraform.d/plugin-cache"
git config --global --add safe.directory "$PWD"
git config --global core.autocrlf input

az config set extension.use_dynamic_install=yes_without_prompt --only-show-errors
az config set extension.dynamic_install_allow_preview=false --only-show-errors
az config set auto-upgrade.enable=no --only-show-errors || true
az bicep version --only-show-errors >/dev/null 2>&1 || az bicep install --only-show-errors

required_commands=(az azd bicep gh gitleaks node npm pwsh python3 terraform uv)
for command_name in "${required_commands[@]}"; do
    command -v "$command_name" >/dev/null || {
        printf 'Missing required vNext tool: %s\n' "$command_name" >&2
        exit 1
    }
done

node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) process.exit(1)'
python3 -c 'import sys; assert sys.version_info[:2] == (3, 14), sys.version'

npm run validate:vscode
npm run validate:tool-versions

printf 'APEX vNext devcontainer ready (%s)\n' "$architecture"
