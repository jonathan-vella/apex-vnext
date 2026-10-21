#!/usr/bin/env bash
# Pre-commit: check Terraform formatting when a .tf file is staged.

STAGED_TF=$(git diff --cached --name-only --diff-filter=ACM | grep '\.tf$' || true)
if [ -n "$STAGED_TF" ]; then
  echo "🔧 Checking Terraform formatting..."
  npm run lint:terraform-fmt || {
    echo "❌ npm run lint:terraform-fmt failed. Fix with: terraform fmt -recursive infra/terraform/"
    exit 1
  }
else
  echo "ℹ️  No Terraform files to format-check"
fi
