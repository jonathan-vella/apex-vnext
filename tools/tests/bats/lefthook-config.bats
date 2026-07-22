#!/usr/bin/env bats
# lefthook-config.bats — Structural tests for lefthook.yml

load setup

extract_markdown_lint_hook() {
  awk '
    /^    markdown-lint:/ { in_hook=1 }
    in_hook && /^      run: \|/ { capture=1; next }
    capture && /^    [a-z][a-z0-9-]*:/ { exit }
    capture { sub(/^        /, ""); print }
  ' "$REPO_ROOT/lefthook.yml"
}

extract_hook_block() {
  local hook_name="$1"
  awk -v hook_name="$hook_name" '
    $0 == "    " hook_name ":" { capture=1 }
    capture && $0 != "    " hook_name ":" && /^    [a-z][a-z0-9-]*:/ { exit }
    capture && /^      fail_text:/ { exit }
    capture { print }
  ' "$REPO_ROOT/lefthook.yml"
}

create_markdown_fixture() {
  fixture="$TEST_LOG_DIR/repository"
  fake_bin="$TEST_LOG_DIR/bin"
  mkdir -p "$fixture/docs" "$fake_bin"
  git -C "$fixture" init --quiet
  git -C "$fixture" config user.email "hooks@example.invalid"
  git -C "$fixture" config user.name "Hook Tests"
  printf '## Fixture\n' >"$fixture/docs/fixture.md"
  git -C "$fixture" add docs/fixture.md
  hook_script="$TEST_LOG_DIR/markdown-lint-hook.sh"
  extract_markdown_lint_hook >"$hook_script"
}

@test "post-commit block contains only the allow-listed stamp-sku-manifest hook" {
  # post-commit hooks are normally rejected to keep the commit path
  # blocking-free. The only sanctioned exception is the
  # stamp-sku-manifest hook from the SKU Manifest workflow, which
  # writes commit_sha onto sku-manifest.json revisions and is
  # explicitly best-effort (cannot block a commit).
  if grep -q '^post-commit:' "$REPO_ROOT/lefthook.yml"; then
    # Extract the post-commit block (from "^post-commit:" until next top-level key or EOF).
    local block
    block=$(awk '/^post-commit:/{f=1; next} /^[a-z][a-z-]*:/{f=0} f' "$REPO_ROOT/lefthook.yml")
    # Allow only stamp-sku-manifest as a command name under post-commit.
    local extra
    extra=$(echo "$block" | grep -E '^    [a-z][a-z0-9_-]*:' | grep -v '^    stamp-sku-manifest:' || true)
    if [ -n "$extra" ]; then
      echo "Unexpected post-commit hooks (only stamp-sku-manifest is allow-listed):"
      echo "$extra"
      false
    fi
  fi
}

@test "only generating pre-commit hooks own the serial Git index" {
  local parallel
  local writers
  parallel=$(awk '/^pre-commit:/{in_precommit=1; next} in_precommit && /^  parallel:/{print $2; exit}' "$REPO_ROOT/lefthook.yml")
  writers=$(awk '
    /^    [a-z][a-z0-9-]*:/ { command=$1; sub(/:$/, "", command) }
    /^      stage_fixed: true$/ { print command }
  ' "$REPO_ROOT/lefthook.yml" | sort)
  [ "$parallel" = "false" ]
  [ "$writers" = $'model-catalog-sync\nsku-manifest-render' ]
}

@test "Terraform formatting delegates validator behavior to its canonical npm script" {
  local terraform_hook
  terraform_hook=$(extract_hook_block terraform-fmt)

  [[ "$terraform_hook" == *"npm run lint:terraform-fmt"* ]]
  [[ "$terraform_hook" != *"terraform fmt -check"* ]]
  [[ "$terraform_hook" == *"npm run lint:terraform-fmt failed"* ]]
}

@test "a held Git index lock rejects a concurrent writer" {
  local fixture="$TEST_LOG_DIR/repository"
  mkdir -p "$fixture"
  git -C "$fixture" init --quiet
  printf 'fixture\n' >"$fixture/generated.txt"
  : >"$fixture/.git/index.lock"

  run git -C "$fixture" add generated.txt

  [ "$status" -ne 0 ]
  [[ "$output" == *"index.lock"* ]]
}

@test "markdown lint hook propagates repository command failure" {
  create_markdown_fixture
  printf '#!/usr/bin/env bash\nprintf "simulated lint command failure\\n" >&2\nexit 127\n' >"$fake_bin/npm"
  chmod +x "$fake_bin/npm"

  run env PATH="$fake_bin:$PATH" bash -c 'cd "$1" && bash "$2"' _ "$fixture" "$hook_script"

  [ "$status" -ne 0 ]
  [[ "$output" == *"simulated lint command failure"* ]]
}

@test "markdown lint hook passes staged files to repository command" {
  create_markdown_fixture
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$*" >"$HOOK_ARGS_FILE"\n' >"$fake_bin/npm"
  chmod +x "$fake_bin/npm"

  run env HOOK_ARGS_FILE="$TEST_LOG_DIR/npm-args" PATH="$fake_bin:$PATH" \
    bash -c 'cd "$1" && bash "$2"' _ "$fixture" "$hook_script"

  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_LOG_DIR/npm-args")" = "run lint:md -- --no-globs docs/fixture.md" ]
}

@test "all referenced npm scripts exist in package.json" {
  local scripts
  scripts=$(grep -oP 'npm run \K[a-z0-9:_-]+' "$REPO_ROOT/lefthook.yml" | sort -u)
  local missing=0
  for script in $scripts; do
    if ! grep -q "\"$script\"" "$REPO_ROOT/package.json"; then
      echo "Missing npm script: $script"
      missing=$((missing + 1))
    fi
  done
  [ "$missing" -eq 0 ]
}
