#!/usr/bin/env bash
# Pre-commit: check the IaC security baseline when a Bicep or Terraform file is staged.

STAGED_IAC=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(bicep|tf)$' || true)
if [ -n "$STAGED_IAC" ]; then
  echo "🔒 Checking IaC security baseline..."
  npm run validate:iac-security-baseline
else
  echo "ℹ️  No IaC files to security-check"
fi
