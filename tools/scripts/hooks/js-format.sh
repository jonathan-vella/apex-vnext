#!/usr/bin/env bash
# Pre-commit: check Prettier formatting of the staged JavaScript files.

STAGED_FMT=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|mjs|cjs)$' || true)
if [ -n "$STAGED_FMT" ]; then
  COUNT=$(echo "$STAGED_FMT" | wc -l | tr -d ' ')
  echo "💅 Checking Prettier on $COUNT file(s)..."
  echo "$STAGED_FMT" | xargs npx prettier --check --log-level warn
else
  echo "ℹ️  No JS/MJS files to format-check"
fi
