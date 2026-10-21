#!/usr/bin/env bash
# Pre-commit: validate staged instruction, agent and SKILL files.

STAGED=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(instructions|agent)\.md$|SKILL\.md$' || true)
if [ -n "$STAGED" ]; then
  COUNT=$(echo "$STAGED" | wc -l | tr -d ' ')
  echo "📋 Validating $COUNT instruction/reference file(s)..."
  npm run validate:instruction-checks
else
  echo "ℹ️  No instruction files to validate"
fi
