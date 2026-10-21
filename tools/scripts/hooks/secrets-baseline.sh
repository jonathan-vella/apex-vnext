#!/usr/bin/env bash
# Pre-commit: scan the staged changes for secrets when gitleaks is installed.

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks protect --staged --redact --no-banner
else
  echo "⚠️  gitleaks not installed — secret scan skipped. Install gitleaks (see tools/scripts/setup-wsl.sh) to enable."
fi
