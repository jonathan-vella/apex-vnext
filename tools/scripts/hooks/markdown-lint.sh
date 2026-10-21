#!/usr/bin/env bash
# Pre-commit: lint the staged Markdown files with the repository markdownlint command.
# Run through `bash <path>` from lefthook.yml; keep the logic here, not inline, so it also runs on native Windows.

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM) || exit $?
STAGED_MD=$(printf '%s\n' "$STAGED_FILES" | grep '\.md$' || true)
if [ -n "$STAGED_MD" ]; then
  COUNT=$(echo "$STAGED_MD" | wc -l | tr -d ' ')
  echo "📝 Validating $COUNT markdown file(s)..."
  # Lint staged files only, suppress verbose Finding: output
  RESULT=$(
    printf '%s\n' "$STAGED_MD" |
      xargs npm run lint:md -- --no-globs 2>&1
  )
  STATUS=$?
  # Show only Summary and errors, skip Finding/Linting lines
  printf '%s\n' "$RESULT" | grep -v -E '^(Finding:|Linting:)' || true
  exit "$STATUS"
else
  echo "ℹ️  No markdown files to validate"
fi
