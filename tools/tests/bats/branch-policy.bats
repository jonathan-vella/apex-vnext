#!/usr/bin/env bats

load setup

create_scope_fixture() {
  fixture="$TEST_LOG_DIR/repository"
  mkdir -p "$fixture"
  git -C "$fixture" init --quiet --initial-branch=main
  git -C "$fixture" config user.email "hooks@example.invalid"
  git -C "$fixture" config user.name "Hook Tests"
  printf 'baseline\n' >"$fixture/README.md"
  git -C "$fixture" add README.md
  git -C "$fixture" commit --quiet -m "test: baseline"
  git -C "$fixture" update-ref refs/remotes/origin/main "$(git -C "$fixture" rev-parse HEAD)"
  git -C "$fixture" switch --quiet -c docs/out-of-scope
  mkdir -p "$fixture/tools/scripts"
  printf 'changed\n' >"$fixture/tools/scripts/example.sh"
  git -C "$fixture" add tools/scripts/example.sh
  git -C "$fixture" commit --quiet -m "test: fixture"
}

@test "branch naming accepts the canonical scripts prefix" {
  run env BRANCH=scripts/validator bash "$REPO_ROOT/tools/scripts/validate-branch-naming.sh"
  [ "$status" -eq 0 ]
}

@test "branch naming rejects the retired tools/scripts prefix" {
  run env BRANCH=tools/scripts/validator bash "$REPO_ROOT/tools/scripts/validate-branch-naming.sh"
  [ "$status" -ne 0 ]
}

@test "local branch scope remains advisory" {
  create_scope_fixture
  run env BRANCH=docs/out-of-scope bash -c 'cd "$1" && bash "$2"' _ \
    "$fixture" "$REPO_ROOT/tools/scripts/validate-branch-scope.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Local scope checks are advisory"* ]]
}

@test "CI branch scope blocks the same violation" {
  create_scope_fixture
  run env BRANCH=docs/out-of-scope BRANCH_SCOPE_STRICT=true bash -c 'cd "$1" && bash "$2"' _ \
    "$fixture" "$REPO_ROOT/tools/scripts/validate-branch-scope.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"tools/scripts/example.sh"* ]]
}
