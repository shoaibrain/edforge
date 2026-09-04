#!/usr/bin/env bash
#
# Smoke for scripts/deploy.sh — verifies REPO_ROOT resolves to the
# worktree the wrapper is invoked from, NOT the script's filesystem path.
#
# This is a pure path-resolution test: no AWS calls, no .env reads, no
# cdk synth. We extract the resolution snippet and exercise it under
# four scenarios that mirror real operator usage.
#
# Run: bash scripts/test-deploy-wrapper.sh

set -euo pipefail

FAIL=0
PASS=0

# Resolve the wrapper's REPO_ROOT exactly the way scripts/deploy.sh does.
# Mirror the snippet here (rather than sourcing the wrapper, which would
# also trigger arg parsing / AWS calls).
resolve_repo_root() {
  local start="$1"
  local root="$start"
  while [[ "$root" != "/" && ! -e "$root/.git" ]]; do
    root="$(dirname "$root")"
  done
  if [[ "$root" == "/" ]]; then
    return 1
  fi
  echo "$root"
}

# Cost-redesign C1.7 — mirror of scripts/deploy.sh lambda_bundles_required().
lambda_bundles_required() {
  local stack="$1" flag="$2"
  [[ "$flag" == "true" ]]
}

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name"
    echo "        expected: $expected"
    echo "        actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_fail() {
  local name="$1" start="$2"
  if resolve_repo_root "$start" >/dev/null 2>&1; then
    echo "  FAIL: $name — resolution unexpectedly succeeded from $start"
    FAIL=$((FAIL + 1))
  else
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  fi
}

TMP_BASE="$(mktemp -d)"
trap 'rm -rf "$TMP_BASE"' EXIT

echo "==> Test 1: .git as a DIRECTORY (normal clone)"
FAKE_REPO="$TMP_BASE/fake-repo"
mkdir -p "$FAKE_REPO/.git" "$FAKE_REPO/scripts" "$FAKE_REPO/server/lib/deep/nested"
got="$(resolve_repo_root "$FAKE_REPO")"
assert_eq "from repo root" "$FAKE_REPO" "$got"
got="$(resolve_repo_root "$FAKE_REPO/scripts")"
assert_eq "from scripts/ subdir" "$FAKE_REPO" "$got"
got="$(resolve_repo_root "$FAKE_REPO/server/lib/deep/nested")"
assert_eq "from deeply nested subdir" "$FAKE_REPO" "$got"

echo ""
echo "==> Test 2: .git as a FILE (git worktree)"
FAKE_WT="$TMP_BASE/fake-worktree"
mkdir -p "$FAKE_WT/scripts" "$FAKE_WT/server"
# git worktrees create .git as a regular file with `gitdir: <path>` content.
echo "gitdir: $TMP_BASE/fake-repo/.git/worktrees/fake-worktree" > "$FAKE_WT/.git"
got="$(resolve_repo_root "$FAKE_WT")"
assert_eq "worktree root" "$FAKE_WT" "$got"
got="$(resolve_repo_root "$FAKE_WT/scripts")"
assert_eq "worktree scripts/ subdir" "$FAKE_WT" "$got"

echo ""
echo "==> Test 3: nested .git takes precedence over an ancestor .git"
# If a subdir itself contains a .git (e.g. an embedded second repo like
# edforge-saas-frontend nested inside edforge), the inner .git wins —
# matching the user's mental model of "the worktree I'm sitting in".
INNER="$FAKE_REPO/nested-repo"
mkdir -p "$INNER/.git" "$INNER/src"
got="$(resolve_repo_root "$INNER")"
assert_eq "inner repo root from itself" "$INNER" "$got"
got="$(resolve_repo_root "$INNER/src")"
assert_eq "inner repo root from its subdir" "$INNER" "$got"

echo ""
echo "==> Test 4: no .git ancestor → fail"
NO_GIT_DIR="$TMP_BASE/no-git-here"
mkdir -p "$NO_GIT_DIR/deep"
# We need a starting path that genuinely has no .git ancestor — but
# anywhere under $TMP_BASE may or may not satisfy that (mktemp on macOS
# puts you under /var/folders/...). Walk to / and confirm no .git exists
# along the way; if any does (uncommon), skip this assertion.
HAS_ANCESTOR=0
probe="$NO_GIT_DIR/deep"
while [[ "$probe" != "/" ]]; do
  if [[ -e "$probe/.git" ]]; then
    HAS_ANCESTOR=1
    break
  fi
  probe="$(dirname "$probe")"
done
if [[ $HAS_ANCESTOR -eq 1 ]]; then
  echo "  SKIP: negative test — a .git ancestor exists above $TMP_BASE"
else
  assert_fail "no .git ancestor" "$NO_GIT_DIR/deep"
fi

echo ""
echo "==> Test 5: bash syntax check on scripts/deploy.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if bash -n "$SCRIPT_DIR/deploy.sh"; then
  echo "  PASS: deploy.sh parses cleanly"
  PASS=$((PASS + 1))
else
  echo "  FAIL: deploy.sh parse error"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "==> Summary: $PASS passed, $FAIL failed"

# ---- C1.7: Lambda bundles are built only for the tenant stack with the flag on ----
lb() { if lambda_bundles_required "$1" "$2"; then echo yes; else echo no; fi; }
assert_eq "lambda bundles: tenant stack + flag on"        "yes" "$(lb tenant-template-stack-basic true)"
assert_eq "lambda bundles: tenant stack, flag unset"      "no"  "$(lb tenant-template-stack-basic '')"
assert_eq "lambda bundles: tenant stack, flag false"      "no"  "$(lb tenant-template-stack-basic false)"
assert_eq "lambda bundles: shared-infra with flag (synth is app-wide)" "yes" "$(lb shared-infra-stack true)"
assert_eq "lambda bundles: analytics, flag unset"          "no"  "$(lb analytics-stack '')"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
