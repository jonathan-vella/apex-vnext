#!/usr/bin/env bash
# Pre-commit: validate every Terraform project when a .tf file is staged.

STAGED_TF=$(git diff --cached --name-only --diff-filter=ACM | grep '\.tf$' || true)
if [ -n "$STAGED_TF" ]; then
  echo "🔧 Validating Terraform..."
  for dir in infra/terraform/*/; do
    if [ -f "$dir/main.tf" ]; then
      echo "  Validating $dir..."
      (cd "$dir" && terraform init -backend=false -input=false -no-color > /dev/null 2>&1 \
        && terraform validate -no-color) || { echo "❌ Validation failed in $dir"; exit 1; }
    fi
  done
else
  echo "ℹ️  No Terraform project to validate"
fi
