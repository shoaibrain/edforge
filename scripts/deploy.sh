#!/usr/bin/env bash
#
# EdForge CDK deploy wrapper — dispatches any stack.
#
# Tees every CDK deploy for any stack in the CDK app to
# docs/deploys/deploy-<profile>-<stack>-<timestamp>-<sha>.log so we have
# a durable audit trail and can replay incidents months later.
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

set -euo pipefail

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

LOG_DIR="$REPO_ROOT/docs/deploys"
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

# Pre-flight: reject a service-info.json whose <REGION>/<ACCOUNT_ID> placeholders
# were never substituted (classic bash pitfall: `VAR=x sed "s/<T>/$VAR/g"` expands
# $VAR in the OUTER shell BEFORE the prefix assignment takes effect, producing
# empty substitutions → image URIs like `.dkr.ecr..amazonaws.com/identity` → ECS
# can't pull → stack sits in UPDATE_IN_PROGRESS for 3h before timing out.
# The guardrail below fails fast (exit 2) instead of burning a CFN timeout window.
SVC_INFO="$REPO_ROOT/server/lib/service-info.json"
if [[ -f "$SVC_INFO" ]]; then
  if grep -qE '<REGION>|<ACCOUNT_ID>|\.dkr\.ecr\.\.amazonaws\.com' "$SVC_INFO"; then
    echo "FATAL: $SVC_INFO has unsubstituted placeholders or empty region/account." | tee -a "$LOG_FILE" >&2
    echo "       Regenerate with variables actually EXPORTED, e.g.:" | tee -a "$LOG_FILE" >&2
    echo "         cd $REPO_ROOT/server" | tee -a "$LOG_FILE" >&2
    echo "         source .env.$PROFILE" | tee -a "$LOG_FILE" >&2
    echo "         export REGION=us-east-2 ACCOUNT_ID=<your-account-id>" | tee -a "$LOG_FILE" >&2
    echo "         sed \"s/<REGION>/\$REGION/g; s/<ACCOUNT_ID>/\$ACCOUNT_ID/g\" \\" | tee -a "$LOG_FILE" >&2
    echo "           service-info.txt > lib/service-info.json" | tee -a "$LOG_FILE" >&2
    exit 2
  fi
fi

# R41.A.hotfix — export CDK_DEFAULT_REGION + CDK_DEFAULT_ACCOUNT so synth-
# time constructs that need a literal region/account (notably the
# authorizer URI in shared-infra-stack's Swagger spec — see
# `lib/shared-infra/api-gateway.ts`) get resolved values instead of CDK
# tokens. `app.region` / `app.account` in `bin/ecs-saas-ref-template.ts`
# only return literals when these env vars are set.
PROFILE_REGION="$(aws configure get region --profile "$PROFILE" 2>/dev/null || true)"
PROFILE_ACCOUNT="$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text 2>/dev/null || true)"
if [[ -z "$PROFILE_REGION" || -z "$PROFILE_ACCOUNT" ]]; then
  echo "FATAL: could not resolve region/account for profile '$PROFILE'." | tee -a "$LOG_FILE" >&2
  echo "       Make sure AWS_PROFILE is configured + has valid credentials." | tee -a "$LOG_FILE" >&2
  exit 2
fi
echo "    region:  $PROFILE_REGION" | tee -a "$LOG_FILE"
echo "    account: $PROFILE_ACCOUNT" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

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
