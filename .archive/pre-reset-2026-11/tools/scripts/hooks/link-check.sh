#!/usr/bin/env bash
# Pre-commit: check links in the staged user-guide Markdown files.

# Get staged user-guide Markdown files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM) || exit $?
STAGED_DOCS=$(printf '%s\n' "$STAGED_FILES" | grep -E '^docs/(tutorials|how-to|explanation|reference)/.*\.md$' || true)
if [ -n "$STAGED_DOCS" ]; then
  COUNT=$(echo "$STAGED_DOCS" | wc -l | tr -d ' ')
  echo "🔗 Checking links in $COUNT doc file(s)..."
  # Use npx to run from local node_modules (avoids Node.js 24 global install bug)
  echo "$STAGED_DOCS" | xargs -I {} npx markdown-link-check {} --config .markdown-link-check.json --quiet
else
  echo "ℹ️  No docs to check links"
fi
