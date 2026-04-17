#!/usr/bin/env bash
#
# Exports the deployed tenant API Gateway's OpenAPI spec (OAS 3.0), runs
# spectral against it, and writes a typed TS client using openapi-typescript.
#
# Why this exists (S3.T7): the frontend SDK must track the *deployed*
# contract, not the hand-written `docs/api/analytics.yaml`. This script
# is the single command to regenerate the SDK when the Lambda's API
# surface changes.
#
# Pre-reqs:
#   - AWS_PROFILE set (defaults to `uat`)
#   - jq, aws CLI, npx
#
# Output:
#   - tmp/openapi-analytics-<timestamp>.json  (raw export)
#   - packages/shared-analytics-types/generated/api.d.ts  (typed client)
#
# Idempotent. Re-running overwrites the generated file and writes a fresh
# timestamped JSON. Commit only the .d.ts.

set -euo pipefail

PROFILE="${AWS_PROFILE:-uat}"
REGION="${AWS_REGION:-us-east-2}"
STAGE="${API_STAGE:-prod}"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

echo "==> Resolving tenant API Gateway ID from CloudFormation export"
API_ID="$(aws cloudformation list-exports \
  --profile "$PROFILE" --region "$REGION" \
  --query "Exports[?Name=='TenantApiRestApiId'].Value" \
  --output text)"

if [[ -z "$API_ID" || "$API_ID" == "None" ]]; then
  echo "ERROR: TenantApiRestApiId CFN export not found in $PROFILE/$REGION"
  exit 1
fi
echo "    API: $API_ID (stage=$STAGE)"

TS="$(date +%Y%m%d-%H%M%S)"
OUT_JSON="tmp/openapi-analytics-$TS.json"
mkdir -p tmp packages/shared-analytics-types/generated

echo "==> Exporting OAS 3.0 to $OUT_JSON"
aws apigateway get-export \
  --profile "$PROFILE" --region "$REGION" \
  --rest-api-id "$API_ID" \
  --stage-name "$STAGE" \
  --export-type oas30 \
  --accepts application/json \
  "$OUT_JSON" >/dev/null

# API Gateway exports include every route on the API, not just /analytics/*.
# Filter to analytics paths only so the generated SDK is tight.
FILTERED="tmp/openapi-analytics-filtered-$TS.json"
echo "==> Filtering to /analytics/* paths → $FILTERED"
jq '
  . as $root
  | .paths |= (with_entries(select(.key | startswith("/analytics"))))
' "$OUT_JSON" > "$FILTERED"

echo "==> Linting the filtered spec with spectral"
npx --yes @stoplight/spectral-cli lint --fail-severity=error "$FILTERED" || {
  echo "WARN: spectral returned a non-zero status. Review above."
}

echo "==> Generating TS client → packages/shared-analytics-types/generated/api.d.ts"
npx --yes openapi-typescript "$FILTERED" \
  -o packages/shared-analytics-types/generated/api.d.ts

echo "==> Done."
echo "    Generated: packages/shared-analytics-types/generated/api.d.ts"
echo "    Raw export: $OUT_JSON"
