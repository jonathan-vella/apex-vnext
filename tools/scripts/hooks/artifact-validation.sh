#!/usr/bin/env bash
# Pre-commit: validate artifact sources and the mandatory challenger-review presence for staged artifact changes.

STAGED_ARTIFACTS=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^agent-output/.*\.md$|^customizations/(\.github/skills/apex-artifacts/templates/requirements\.md|manifest\.json)$|^packages/renderers/src/document-registry\.ts$|^tools/(scripts/validate-artifacts\.mjs|tests/validate-artifacts\.test\.mjs)$' || true)
if [ -n "$STAGED_ARTIFACTS" ]; then
  COUNT=$(echo "$STAGED_ARTIFACTS" | wc -l | tr -d ' ')
  echo "📋 Validating current artifact sources for $COUNT staged path(s)..."
  if ! npm run validate:artifacts; then
    echo ""
    echo "❌ Current artifact source validation failed!"
    echo ""
    echo "🔧 To fix:"
    echo "   1. Check customizations/.github/instructions/apex-artifact-contracts.instructions.md"
    echo "   2. Repair the registered template and source binding"
    echo "   3. Run: npm run validate:artifacts"
    echo "   4. Re-stage and commit"
    echo ""
    exit 1
  fi
  # Mandatory challenger-findings presence gate (Steps 1, 2, 3.5, 4).
  # Primary enforcement is through the kernel's typed review completion;
  # this is the commit-time fallback so the same drift cannot land
  # via direct edits.
  if ! npm run validate:challenger-presence --silent; then
    echo ""
    echo "❌ Mandatory challenger review missing for one or more steps."
    echo "   Run the kernel-issued rubber-duck review for the current artifact"
    echo "   (apex-next: exact reviewRequest.prompt, then apex/reviewComplete)."
    exit 1
  fi
else
  echo "ℹ️  No artifact-source changes to validate"
fi
