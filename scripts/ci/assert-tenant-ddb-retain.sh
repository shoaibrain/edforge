#!/bin/bash
# ============================================================================
# Synth-time assertion: tenant-template-stack DDB tables MUST be RETAIN.
#
# Pilot tenant data lives in the per-tenant DynamoDB tables created by
# tenant-template-stack-basic. Those tables carry RemovalPolicy.RETAIN so
# they survive a CloudFormation stack delete. A future PR could break this
# in several ways:
#
#   - Apply DestroyPolicySetter aspect to tenant-template-stack
#   - Change RemovalPolicy.RETAIN -> .DESTROY on a table directly
#   - Refactor that re-introduces a per-table DESTROY aspect
#   - Aliased import of DestroyPolicySetter that defeats grep checks
#
# A grep-only check is trivially defeatable. This script is the strong
# version: it actually synthesizes the stack and inspects the resulting
# CloudFormation JSON. Every AWS::DynamoDB::Table in tenant-template-stack-*
# MUST have DeletionPolicy=Retain AND UpdateReplacePolicy=Retain.
#
# Usage:
#   ./scripts/ci/assert-tenant-ddb-retain.sh
#
# Exit codes:
#   0 - all DDB tables in tenant-template stacks have Retain policy
#   1 - one or more violations found
#   2 - synth failed (toolchain / env problem, not a policy violation)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"
CDK_OUT="$SERVER_DIR/cdk.out-assert-retain"

if [ ! -d "$SERVER_DIR" ]; then
    echo "ERROR: server directory not found at $SERVER_DIR" >&2
    exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq is required (brew install jq)" >&2
    exit 2
fi

cd "$SERVER_DIR"

# Provide synthetic env values so the CDK app boots without a profile.
# These values are NEVER deployed — they exist only to satisfy required-env
# guards in bin/ecs-saas-ref-template.ts so synth can run offline.
export CDK_PARAM_SYSTEM_ADMIN_EMAIL="ci-assert-retain@example.invalid"
export CDK_PARAM_CORS_ALLOWED_ORIGINS="http://localhost:3000"
export CDK_PARAM_COMMIT_ID="ci-assert-retain"
export CDK_PARAM_TIER="basic"
export CDK_PARAM_TENANT_ID="basic"
export CDK_PARAM_TENANT_NAME="basic"
export CDK_PARAM_STAGE="prod"
export CDK_PARAM_USE_FEDERATION="true"
export CDK_PARAM_USE_EC2_BASIC="false"
export CDK_PARAM_USE_RPROXY="true"
export CDK_NAG_ENABLED="false"
export EDFORGE_ENV="ci-assert-retain"  # Falls through to .env (no .env.ci-assert-retain exists)

echo "[assert-retain] synthesizing tenant-template stacks..."
if ! npx cdk synth \
        tenant-template-stack-basic \
        tenant-template-stack-advanced \
        --output "$CDK_OUT" \
        --quiet 2>&1 | sed 's/^/[cdk] /'; then
    echo "[assert-retain] cdk synth FAILED (toolchain / env, not a policy issue)" >&2
    exit 2
fi

VIOLATIONS=0
TABLES_CHECKED=0

for template in "$CDK_OUT"/tenant-template-stack-*.template.json; do
    if [ ! -f "$template" ]; then
        echo "[assert-retain] WARNING: no template files found at $template" >&2
        continue
    fi
    stack_name=$(basename "$template" .template.json)

    # Walk every AWS::DynamoDB::Table in the synthesized template. For each,
    # extract DeletionPolicy and UpdateReplacePolicy. Both MUST be "Retain".
    # If either is missing or any other value, treat as a violation.
    while IFS=$'\t' read -r logical_id deletion_policy update_replace_policy table_name; do
        TABLES_CHECKED=$((TABLES_CHECKED + 1))
        if [ "$deletion_policy" != "Retain" ] || [ "$update_replace_policy" != "Retain" ]; then
            VIOLATIONS=$((VIOLATIONS + 1))
            echo ""
            echo "[assert-retain] VIOLATION in $stack_name:"
            echo "  LogicalId:             $logical_id"
            echo "  TableName:             $table_name"
            echo "  DeletionPolicy:        $deletion_policy   (expected: Retain)"
            echo "  UpdateReplacePolicy:   $update_replace_policy   (expected: Retain)"
        fi
    done < <(jq -r '
        .Resources
        | to_entries[]
        | select(.value.Type == "AWS::DynamoDB::Table")
        | [
            .key,
            (.value.DeletionPolicy // "<missing>"),
            (.value.UpdateReplacePolicy // "<missing>"),
            (.value.Properties.TableName // "<unknown>")
          ]
        | @tsv
    ' "$template")
done

echo ""
echo "[assert-retain] tables checked: $TABLES_CHECKED"
echo "[assert-retain] violations:     $VIOLATIONS"

# Cleanup the temp synth output. Comment out for debugging.
rm -rf "$CDK_OUT"

if [ "$TABLES_CHECKED" -eq 0 ]; then
    echo "[assert-retain] FAIL — no AWS::DynamoDB::Table resources found in tenant-template stacks." >&2
    echo "[assert-retain] This is suspicious. Either the stacks didn't synthesize, or the DDB tables were removed." >&2
    exit 1
fi

if [ "$VIOLATIONS" -gt 0 ]; then
    echo ""
    echo "[assert-retain] FAIL — at least one DDB table is not Retain in tenant-template-stack." >&2
    echo "[assert-retain] Pilot tenant data is irrecoverable. This MUST be fixed before merge." >&2
    exit 1
fi

echo "[assert-retain] PASS — all tenant-template DDB tables synthesize as Retain."
exit 0
