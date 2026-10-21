#!/usr/bin/env bash
# Pre-commit: validate the current document sources when a source file they depend on is staged.

STAGED_SYNC=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^(customizations/(\.github/skills/apex-artifacts/templates/requirements\.md|manifest\.json)|packages/renderers/src/document-registry\.ts|tools/(scripts/validate-artifacts\.mjs|tests/validate-artifacts\.test\.mjs))$' || true)
if [ -n "$STAGED_SYNC" ]; then
  echo "🔄 Checking current document sources..."
  npm run validate:artifacts
else
  echo "ℹ️  No current document-source files to check"
fi
