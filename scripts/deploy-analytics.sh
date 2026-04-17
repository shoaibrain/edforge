#!/usr/bin/env bash
#
# A0.2.T1 — Analytics deploy wrapper
#
# Tees every CDK deploy + image push + ECS roll for an analytics-related
# stack to docs/deploys/analytics-<env>-<stack>-<timestamp>.log so we have
# a durable audit trail and can replay incidents months later.
#
# Usage:
#   ./scripts/deploy-analytics.sh <stack> <profile> [extra cdk args...]
#
# Examples:
#   ./scripts/deploy-analytics.sh analytics-stack uat
#   ./scripts/deploy-analytics.sh tenant-template-stack-basic uat -- --hotswap
#
# Honors the same env vars cdk does (CDK_NAG_ENABLED, CDK_PARAM_*, etc.).
# Stamps git SHA into log filename so a rollback knows the source revision.

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <stack> <profile> [extra cdk args...]" >&2
  echo "  e.g. $0 analytics-stack uat" >&2
  exit 2
fi

STACK="$1"
PROFILE="$2"
shift 2

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$REPO_ROOT/docs/deploys"
mkdir -p "$LOG_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
LOG_FILE="$LOG_DIR/analytics-${PROFILE}-${STACK}-${TS}-${GIT_SHA}.log"

echo "==> Analytics deploy" | tee "$LOG_FILE"
echo "    stack:   $STACK" | tee -a "$LOG_FILE"
echo "    profile: $PROFILE" | tee -a "$LOG_FILE"
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

CDK_NAG_ENABLED="${CDK_NAG_ENABLED:-false}" \
CDK_PARAM_COMMIT_ID="${CDK_PARAM_COMMIT_ID:-$GIT_SHA}" \
AWS_PROFILE="$PROFILE" \
  npx cdk deploy "$STACK" --require-approval never "$@" 2>&1 | tee -a "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}

echo "" | tee -a "$LOG_FILE"
echo "==> Finished" | tee -a "$LOG_FILE"
echo "    exit:    $EXIT_CODE" | tee -a "$LOG_FILE"
echo "    ended:   $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$LOG_FILE"

exit "$EXIT_CODE"
