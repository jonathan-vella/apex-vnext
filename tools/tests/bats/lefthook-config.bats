#!/usr/bin/env bats
# lefthook-config.bats — Structural tests for lefthook.yml and the hook scripts it runs

load setup

HOOK_SCRIPTS_DIR="$REPO_ROOT/tools/scripts/hooks"

create_markdown_fixture() {
  fixture="$TEST_LOG_DIR/repository"
  fake_bin="$TEST_LOG_DIR/bin"
  mkdir -p "$fixture/docs" "$fake_bin"
  git -C "$fixture" init --quiet
  git -C "$fixture" config user.email "hooks@example.invalid"
  git -C "$fixture" config user.name "Hook Tests"
  printf '## Fixture\n' >"$fixture/docs/fixture.md"
  git -C "$fixture" add docs/fixture.md
  hook_script="$HOOK_SCRIPTS_DIR/markdown-lint.sh"
}

@test "post-commit has no retired SKU manifest stamp hook" {
  ! grep -q '^post-commit:' "$REPO_ROOT/lefthook.yml"
}

@test "no generating pre-commit hook remains after SKU manifest retirement" {
  local parallel
  local writers
  parallel=$(awk '/^pre-commit:/{in_precommit=1; next} in_precommit && /^  parallel:/{print $2; exit}' "$REPO_ROOT/lefthook.yml")
  writers=$(awk '
    /^    [a-z][a-z0-9-]*:/ { command=$1; sub(/:$/, "", command) }
    /^      stage_fixed: true$/ { print command }
  ' "$REPO_ROOT/lefthook.yml" | sort)
  [ "$parallel" = "true" ]
  [ -z "$writers" ]
}

@test "Terraform formatting delegates validator behavior to its canonical npm script" {
  local terraform_hook
  terraform_hook=$(cat "$HOOK_SCRIPTS_DIR/terraform-fmt.sh")

  [[ "$terraform_hook" == *"npm run lint:terraform-fmt"* ]]
  [[ "$terraform_hook" != *"terraform fmt -check"* ]]
  [[ "$terraform_hook" == *"npm run lint:terraform-fmt failed"* ]]
}

@test "every lefthook command runs a bash script that exists" {
  local runs missing=0 script
  runs=$(awk '/^      run:/ { sub(/^      run: */, ""); print }' "$REPO_ROOT/lefthook.yml")
  [ -n "$runs" ]
  while IFS= read -r line; do
    case "$line" in
      "bash "*)
        script="${line#bash }"
        if [ ! -f "$REPO_ROOT/$script" ]; then
          echo "Missing hook script: $script"
          missing=$((missing + 1))
        fi
        ;;
    esac
  done <<<"$runs"
  [ "$missing" -eq 0 ]
}

@test "Gitleaks configuration retains default secret detectors" {
  grep -q '^\[extend\]' "$REPO_ROOT/.gitleaks.toml"
  grep -q '^useDefault = true' "$REPO_ROOT/.gitleaks.toml"
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
  scripts=$(grep -ohP 'npm run \K[a-z0-9:_-]+' "$REPO_ROOT/lefthook.yml" "$HOOK_SCRIPTS_DIR"/*.sh | sort -u)
  local missing=0
  for script in $scripts; do
    if ! grep -q "\"$script\"" "$REPO_ROOT/package.json"; then
      echo "Missing npm script: $script"
      missing=$((missing + 1))
    fi
  done
  [ "$missing" -eq 0 ]
}
