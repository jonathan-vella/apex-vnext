#!/usr/bin/env bash
# Pre-commit: validate staged agent and prompt files.

STAGED=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(agent|prompt)\.md$' || true)
if [ -n "$STAGED" ]; then
  COUNT=$(echo "$STAGED" | wc -l | tr -d ' ')
  echo "🤖 Validating $COUNT agent/prompt file(s)..."
  npm run validate:agents
else
  echo "ℹ️  No agent/prompt files to validate"
fi
