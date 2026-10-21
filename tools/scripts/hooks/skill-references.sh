#!/usr/bin/env bash
# Pre-commit: validate staged skill references and SKILL files (canary markers and size).

STAGED_REFS=$(git diff --cached --name-only --diff-filter=ACM \
  | grep -E '^\.github/skills/[^/]+/(references/.*\.md|SKILL\.md)$' || true)
if [ -n "$STAGED_REFS" ]; then
  COUNT=$(echo "$STAGED_REFS" | wc -l | tr -d ' ')
  echo "🔖 Validating $COUNT skill reference/SKILL file(s) (canary markers + size)..."
  npm run validate:skill-checks
else
  echo "ℹ️  No skill references/SKILL files staged"
fi
