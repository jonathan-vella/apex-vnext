#!/usr/bin/env bash
# Pre-commit: lint the staged JavaScript files with no warnings allowed.

STAGED_JS=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|mjs|cjs)$' || true)
if [ -n "$STAGED_JS" ]; then
  COUNT=$(echo "$STAGED_JS" | wc -l | tr -d ' ')
  echo "🧹 Linting $COUNT JS/MJS file(s) (--max-warnings=0)..."
  echo "$STAGED_JS" | xargs npx eslint --cache --cache-location node_modules/.cache/eslint/ --quiet --format=compact --max-warnings=0
else
  echo "ℹ️  No JS/MJS files to lint"
fi
