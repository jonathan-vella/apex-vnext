#!/bin/bash
# Runs on every container start (postStartCommand).
# Keeps fast-moving tools current without a full rebuild.
# Heavy installs (PowerShell modules, system packages) stay in post-create.sh.

set -e
START=$(date +%s)

printf "\n ♻️  Updating lightweight tools...\n"

# ─── Fix hook script permissions (core.fileMode=false loses execute bits) ────
if [ -d .github/hooks ]; then
    find .github/hooks -name '*.sh' -exec chmod +x {} +
    printf "    hook script perms     ✅ fixed\n"
fi

# ─── Deno ─────────────────────────────────────────────────────────────────────
# Deno is upgraded automatically on container rebuild via the devcontainer
# feature (version: latest). No in-container upgrade needed.
if command -v deno &>/dev/null; then
    printf "    deno                  ✅ %s\n" "$(deno --version 2>/dev/null | head -n1)"
else
    printf "    deno                  ⚠️  not installed — rebuild container\n"
fi

# ─── npm local dependencies ──────────────────────────────────────────────────
printf "    npm local deps        "
npm install --loglevel=error 2>&1 | tail -1 \
    && printf "✅ ok\n" \
    || printf "⚠️  npm install failed (continuing)\n"

printf "    site npm deps         "
npm --prefix site install --loglevel=error 2>&1 | tail -1 \
    && printf "✅ ok\n" \
    || printf "⚠️  site npm install failed (continuing)\n"

# ─── Azure Developer CLI (azd) version + auth check ─────────────────────────
# The devcontainer feature only runs at image-build time, so a cached rebuild
# never refreshes azd. Compare installed version to the latest GitHub release
# and run the official installer when behind. Network failures (rate limit,
# offline) downgrade to a non-fatal skip so container start never blocks here.
if command -v azd &>/dev/null; then
    printf "    azd version           "
    AZD_CURRENT=$(azd version 2>/dev/null | head -n1 | awk '{print $3}' | tr -d ',')
    AZD_LATEST=$(curl -fsSL --max-time 5 https://api.github.com/repos/Azure/azure-dev/releases/latest 2>/dev/null \
        | grep '"tag_name"' | head -1 | sed -E 's/.*"azure-dev-cli_([^"]+)".*/\1/')
    if [ -z "$AZD_LATEST" ]; then
        printf "⚠️  latest version lookup failed (have %s) — skipping\n" "${AZD_CURRENT:-unknown}"
    elif [ "$AZD_CURRENT" = "$AZD_LATEST" ]; then
        printf "✅ %s (latest)\n" "$AZD_CURRENT"
    else
        printf "⬆️  upgrading %s → %s ... " "${AZD_CURRENT:-unknown}" "$AZD_LATEST"
        if curl -fsSL --max-time 60 https://aka.ms/install-azd.sh | bash >/dev/null 2>&1; then
            printf "✅ done\n"
        else
            printf "⚠️  upgrade failed (have %s)\n" "${AZD_CURRENT:-unknown}"
        fi
    fi

    printf "    azd auth              "
    if azd auth token --output json &>/dev/null; then
        printf "✅ authenticated\n"
    else
        printf "⚠️  not authenticated — run 'azd auth login'\n"
    fi
else
    printf "    azd                   ⚠️  not installed — rebuild container\n"
fi

# ─── Python tools via uv ─────────────────────────────────────────────────────
UV_BIN=$(command -v uv 2>/dev/null || echo "${HOME}/.local/bin/uv")
if [ -x "$UV_BIN" ]; then
    printf "    python packages      "
    "$UV_BIN" pip install --system --quiet --upgrade checkov ruff diagrams matplotlib pillow 2>&1 \
        && printf "✅ updated\n" \
        || printf "⚠️  update failed (continuing)\n"
else
    printf "    python packages      ⚠️  uv not found — skipping\n"
fi

# ─── apex-recall CLI ─────────────────────────────────────────────────────────
APEX_RECALL_DIR="${WORKSPACE_FOLDER:-$PWD}/tools/apex-recall"
if [ -d "$APEX_RECALL_DIR" ] && [ -x "$UV_BIN" ]; then
    printf "    apex-recall          "
    "$UV_BIN" pip install --system --quiet --upgrade -e "$APEX_RECALL_DIR" 2>&1 \
        && printf "✅ updated\n" \
        || printf "⚠️  update failed (continuing)\n"
fi

ELAPSED=$(( $(date +%s) - START ))
printf " ✅ Tool refresh complete (%ds)\n\n" "$ELAPSED"
