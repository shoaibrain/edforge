#!/usr/bin/env bash
#
# Invoke the analytics-api Lambda locally without deploying. Uses
# `sam local invoke` against the CDK-synthesized CloudFormation template.
#
# Usage:
#   ./scripts/analytics/local/invoke-local.sh <event-fixture.json>
#
# If no argument is given, invokes with events/fleet.json (fleet summary
# as SystemAdmin).
#
# Prerequisites:
#   - AWS SAM CLI installed (`brew install aws-sam-cli`)
#   - Docker running (SAM invokes the Lambda runtime in a container)
#   - server/ already cdk-synthed (run `cd server && npx cdk synth analytics-stack`)
#   - DDB credentials available — either set AWS_PROFILE or pass them in
#     --parameter-overrides. The Lambda hits *real* UAT DDB by default.
#
# Why this exists (S3.T8): lets a developer iterate on handler.ts,
# router.ts, validation.ts, and authz.ts without the 3-4 minute CDK
# deploy cycle.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

EVENT="${1:-scripts/analytics/local/events/fleet.json}"

if [[ ! -f "$EVENT" ]]; then
  echo "ERROR: event fixture not found: $EVENT"
  echo "Available fixtures:"
  ls scripts/analytics/local/events/ 2>/dev/null || echo "  (none yet — see scripts/analytics/local/events/)"
  exit 1
fi

SYNTH_DIR="server/cdk.out"
TEMPLATE="$SYNTH_DIR/analytics-stack.template.json"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "==> Synthesizing analytics-stack (CDK)"
  (cd server && npx cdk synth analytics-stack -o cdk.out >/dev/null)
fi

# Resolve the logical resource id for ApiLambda from the synthesized template.
LAMBDA_LOGICAL_ID="$(jq -r '.Resources | to_entries[] | select(.value.Type=="AWS::Lambda::Function" and (.value.Properties.FunctionName=="edforge-analytics-api" or (.key | startswith("ApiLambda")))) | .key' "$TEMPLATE" | head -1)"

if [[ -z "$LAMBDA_LOGICAL_ID" ]]; then
  echo "ERROR: could not find ApiLambda in $TEMPLATE"
  exit 1
fi

echo "==> Invoking $LAMBDA_LOGICAL_ID with event: $EVENT"
sam local invoke "$LAMBDA_LOGICAL_ID" \
  --template "$TEMPLATE" \
  --event "$EVENT" \
  --profile "${AWS_PROFILE:-prod}" \
  --region "${AWS_REGION:-ap-south-1}"
