#!/usr/bin/env bash
#
# EdForge CDK deploy wrapper — dispatches any stack.
#
# Tees every CDK deploy for any stack in the CDK app to a local/private log
# directory. Raw deploy output often contains operator-specific identifiers and
# must not be committed. Add only sanitized summaries to docs/deploys/INDEX.md.
#
# Usage:
#   ./scripts/deploy.sh <stack> <profile> [extra cdk args...]
#
# Examples:
#   ./scripts/deploy.sh analytics-stack uat
#   ./scripts/deploy.sh tenant-template-stack-basic uat -- --hotswap
#   ./scripts/deploy.sh shared-infra-stack prod
#
# Honors the same env vars cdk does (CDK_NAG_ENABLED, CDK_PARAM_*, etc.).
# Stamps git SHA into log filename so a rollback knows the source revision.
# Override the local evidence directory with EDFORGE_DEPLOY_LOG_DIR.
#
# REPO_ROOT resolution
# --------------------
# The wrapper synthesizes from the worktree YOU ARE SITTING IN, not the
# script's filesystem location. It walks up from `pwd` until it finds the
# closest enclosing `.git` (directory OR file — the latter is how git
# worktrees mark their root). This is robust against:
#   - invoking from the repo root: `./scripts/deploy.sh ...`
#   - invoking from a worktree's root: `./scripts/deploy.sh ...`
#   - invoking by absolute path from anywhere inside the worktree
#   - invoking from a nested subdirectory (server/, scripts/, etc.)
#
# The 2026-06-28 incident: the wrapper used to compute REPO_ROOT from
# `dirname "$0"`, so invoking `/Users/shoaibrain/edforge/scripts/deploy-analytics.sh`
# while sitting on a different worktree (`/Users/shoaibrain/ef-wt-deploy`)
# synthesized from the PARENT's stale HEAD — a silent no-op deploy. The
# pwd-walk + the `repo:` startup log line below close that trap.
#
# service-info.json regeneration
# ------------------------------
# lib/service-info.json is a GENERATED, gitignored artifact. The wrapper
# rebuilds it from server/service-info.txt on every run (issue #431: a stale
# artifact — generated before a service-info.txt change — used to silently
# deploy outdated task sizes / env vars / IAM policies). Any drift between
# the on-disk artifact and the fresh render is printed into the deploy log.

set -euo pipefail

# Cost-redesign C1.7/C8.5 — `cdk synth` of ANY stack constructs the tenant
# stack (the CDK app is synthesized whole), and that construction reads the
# service function bundles from disk. The functions are the only path since
# Sprint 6, so the bundles are required for every deploy. Kept as a function
# so scripts/test-deploy-wrapper.sh keeps exercising the contract.
lambda_bundles_required() {
  return 0
}

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <stack> <profile> [extra cdk args...]" >&2
  echo "  e.g. $0 shared-infra-stack prod" >&2
  exit 2
fi

STACK="$1"
PROFILE="$2"
shift 2

# Walk up from pwd until we hit a .git (dir OR file — git worktrees use a
# regular file pointing to .git/worktrees/<name>) → that's the worktree root.
REPO_ROOT="$(pwd)"
while [[ "$REPO_ROOT" != "/" && ! -e "$REPO_ROOT/.git" ]]; do
  REPO_ROOT="$(dirname "$REPO_ROOT")"
done
if [[ "$REPO_ROOT" == "/" ]]; then
  echo "FATAL: could not find a .git ancestor from $(pwd)" >&2
  echo "       Invoke the wrapper from inside a git worktree." >&2
  exit 2
fi

LOG_DIR="${EDFORGE_DEPLOY_LOG_DIR:-${TMPDIR:-/tmp}/edforge-deploys}"
mkdir -p "$LOG_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
LOG_FILE="$LOG_DIR/deploy-${PROFILE}-${STACK}-${TS}-${GIT_SHA}.log"

echo "==> EdForge CDK deploy" | tee "$LOG_FILE"
echo "    stack:   $STACK" | tee -a "$LOG_FILE"
echo "    profile: $PROFILE" | tee -a "$LOG_FILE"
echo "    repo:    $REPO_ROOT" | tee -a "$LOG_FILE"
echo "    git:     $GIT_SHA" | tee -a "$LOG_FILE"
echo "    started: $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$LOG_FILE"
echo "    log:     $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

cd "$REPO_ROOT/server"

# R41.A.hotfix — export CDK_DEFAULT_REGION + CDK_DEFAULT_ACCOUNT so synth-
# time constructs that need a literal region/account (notably the
# authorizer URI in shared-infra-stack's Swagger spec — see
# `lib/shared-infra/api-gateway.ts`) get resolved values instead of CDK
# tokens. `app.region` / `app.account` in `bin/ecs-saas-ref-template.ts`
# only return literals when these env vars are set. Resolved BEFORE the
# service-info render below (which needs the same values); the non-empty
# check makes the classic empty-$VAR sed pitfall (image URIs like
# `.dkr.ecr..amazonaws.com/identity` → ECS can't pull → stack sits in
# UPDATE_IN_PROGRESS for 3h before timing out) structurally impossible.
PROFILE_REGION="$(aws configure get region --profile "$PROFILE" 2>/dev/null || true)"
PROFILE_ACCOUNT="$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text 2>/dev/null || true)"
if [[ -z "$PROFILE_REGION" || -z "$PROFILE_ACCOUNT" ]]; then
  echo "FATAL: could not resolve region/account for profile '$PROFILE'." | tee -a "$LOG_FILE" >&2
  echo "       Make sure AWS_PROFILE is configured + has valid credentials." | tee -a "$LOG_FILE" >&2
  exit 2
fi
echo "    region:  $PROFILE_REGION" | tee -a "$LOG_FILE"
echo "    account: $PROFILE_ACCOUNT" | tee -a "$LOG_FILE"

# Regenerate lib/service-info.json from service-info.txt (issue #431).
# The artifact is gitignored and used to persist across deploys, so a
# service-info.txt change (task size, env vars, IAM policy) silently did NOT
# reach the next deploy from a checkout holding a stale artifact. Rebuilding
# here makes the artifact a pure function of (service-info.txt, region,
# account) on every run. Remaining placeholders (<NAMESPACE>, <EVENT_BUS_NAME>,
# <INTERNAL_API_KEY>, <TIER>, <USER_POOL_ID>) are substituted at synth time
# inside tenant-template-stack.ts — same artifact shape scripts/install.sh
# produces.
SVC_INFO_SRC="$REPO_ROOT/server/service-info.txt"
SVC_INFO="$REPO_ROOT/server/lib/service-info.json"
if [[ ! -f "$SVC_INFO_SRC" ]]; then
  echo "FATAL: $SVC_INFO_SRC not found — cannot generate service-info.json." | tee -a "$LOG_FILE" >&2
  exit 2
fi
sed "s/<REGION>/$PROFILE_REGION/g; s/<ACCOUNT_ID>/$PROFILE_ACCOUNT/g" "$SVC_INFO_SRC" > "$SVC_INFO.tmp"
if [[ -f "$SVC_INFO" ]] && ! diff -q "$SVC_INFO" "$SVC_INFO.tmp" >/dev/null 2>&1; then
  echo "==> STALE service-info.json — drift vs fresh render of service-info.txt:" | tee -a "$LOG_FILE"
  { diff -u "$SVC_INFO" "$SVC_INFO.tmp" || true; } | head -80 | tee -a "$LOG_FILE"
fi
mv "$SVC_INFO.tmp" "$SVC_INFO"
echo "    svcinfo: regenerated from service-info.txt" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Defense-in-depth on the freshly rendered artifact: catch a malformed
# service-info.txt (mangled placeholder, broken JSON) here with a clear
# message instead of an opaque synth failure inside tenant-template-stack.
if grep -qE '<REGION>|<ACCOUNT_ID>|\.dkr\.ecr\.\.amazonaws\.com' "$SVC_INFO"; then
  echo "FATAL: freshly rendered $SVC_INFO still has <REGION>/<ACCOUNT_ID> or an empty ECR host." | tee -a "$LOG_FILE" >&2
  echo "       service-info.txt is malformed — fix the source template." | tee -a "$LOG_FILE" >&2
  exit 2
fi
if ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$SVC_INFO" 2>/dev/null; then
  echo "FATAL: freshly rendered $SVC_INFO is not valid JSON." | tee -a "$LOG_FILE" >&2
  echo "       service-info.txt is malformed — fix the source template." | tee -a "$LOG_FILE" >&2
  exit 2
fi

# Lambda bundles (cost-redesign C1.7)
# ------------------------------------
# Every synth reads server/application/dist-lambda/<svc>/index.js (and the
# sharp layer). Build them here, from THIS worktree's source, and record their
# hashes in the deploy log so a rollback knows exactly which bundle shipped.
# scripts/ci/check-lambda-bundle.sh refuses a bundle that lost its decorator
# metadata or inlined a native module.
if lambda_bundles_required "$STACK"; then
  echo "==> Lambda bundles" | tee -a "$LOG_FILE"
  for svc in identity academics finance; do
    bash "$REPO_ROOT/scripts/build-lambda.sh" "$svc" 2>&1 | grep -E "^==>|error TS|FATAL" | tee -a "$LOG_FILE"
    bash "$REPO_ROOT/scripts/ci/check-lambda-bundle.sh" "$svc" 2>&1 | grep -vE "DeprecationWarning|trace-deprecation" | tee -a "$LOG_FILE"
  done
  bash "$REPO_ROOT/scripts/build-sharp-layer.sh" 2>&1 | grep -E "^==>|FAIL|FATAL" | tee -a "$LOG_FILE"
  for svc in identity academics finance; do
    echo "    bundle:  $svc $(shasum -a 256 "$REPO_ROOT/server/application/dist-lambda/$svc/index.js" | cut -c1-16)" | tee -a "$LOG_FILE"
  done
  echo "" | tee -a "$LOG_FILE"
fi

CDK_NAG_ENABLED="${CDK_NAG_ENABLED:-false}" \
CDK_PARAM_COMMIT_ID="${CDK_PARAM_COMMIT_ID:-$GIT_SHA}" \
CDK_DEFAULT_REGION="$PROFILE_REGION" \
CDK_DEFAULT_ACCOUNT="$PROFILE_ACCOUNT" \
AWS_PROFILE="$PROFILE" \
  npx cdk deploy "$STACK" --require-approval never "$@" 2>&1 | tee -a "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}

echo "" | tee -a "$LOG_FILE"
echo "==> Finished" | tee -a "$LOG_FILE"
echo "    exit:    $EXIT_CODE" | tee -a "$LOG_FILE"
echo "    ended:   $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$LOG_FILE"

exit "$EXIT_CODE"
