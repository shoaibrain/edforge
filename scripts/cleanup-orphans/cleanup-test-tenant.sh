#!/usr/bin/env bash
# Sprint 0.5 T0.9d — Orchestrator composing T0.9a/b/c with layered safety.
#
# THROWAWAY ops script. Will be productized as Sprint 5 T5.11 with proper integration tests.
#
# Sequence:
#   1. assertNotProduction (Saraswati refuse-list)
#   2. assertWhitelisted (must be one of 3 test tenants)
#   3. verify-sbt-state.sh — confirm SBT job ran successfully on this tenant
#   4. sweep-tenant-rows.ts (dry-run) — show expected delete counts
#   5. typed confirmation
#   6. sweep-tenant-rows.ts --apply
#   7. sweep-tenant-sns.ts --apply
#   8. final scan — should show zero orphans
#
# Usage:
#   ./scripts/cleanup-orphans/cleanup-test-tenant.sh <tenantId>            # dry-run
#   ./scripts/cleanup-orphans/cleanup-test-tenant.sh <tenantId> --apply    # destructive
#
# Tee output to ${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/ per repo convention (caller is responsible for tee).

set -uo pipefail

# ============================================================================
# Safety constants — DO NOT MODIFY
# ============================================================================

SARASWATI_TENANT_ID="34f49822-ae1d-4188-95f0-04e14bc6c662"
ALLOWED_TENANTS=(
  "34392ed6-2e51-4fc8-ae2c-242eb5710e40"  # usbasicfoundationtenant
  "fc9ea1c1-1cc2-45b3-b8c4-7e953e8e30d7"  # rainshoaiborg
  "04ce4a00-c39a-4185-afd4-6e764ef44647"  # prodtestadmin
)

# ============================================================================
# Args
# ============================================================================

tenantId="${1:-}"
apply_flag="${2:-}"

if [ -z "$tenantId" ]; then
  echo "Usage: $0 <tenantId> [--apply]" >&2
  exit 2
fi

if [ "$tenantId" = "$SARASWATI_TENANT_ID" ]; then
  echo "REFUSED: tenantId is Saraswati. Aborting." >&2
  exit 3
fi

found=0
for t in "${ALLOWED_TENANTS[@]}"; do
  if [ "$t" = "$tenantId" ]; then found=1; fi
done
if [ "$found" -ne 1 ]; then
  echo "REFUSED: tenantId $tenantId is not in test tenant whitelist." >&2
  exit 4
fi

apply=""
if [ "$apply_flag" = "--apply" ]; then
  apply="--apply"
fi

cd "$(dirname "$0")/../.."
SCRIPT_DIR="scripts/cleanup-orphans"

# ============================================================================
# Step 1: Verify SBT state
# ============================================================================
echo
echo "===================================================================="
echo "Step 1: Verify SBT job has marked $tenantId as deprovisioned"
echo "===================================================================="
npx ts-node --compiler-options '{"module":"CommonJS","esModuleInterop":true}' --transpile-only "$SCRIPT_DIR/verify-sbt-state.ts" "$tenantId"
if [ $? -ne 0 ]; then
  echo "FAIL: SBT post-deprovision state is not clean. Run SBT deprovision first, then re-run this script." >&2
  exit 5
fi

# ============================================================================
# Step 2: Dry-run row sweep
# ============================================================================
echo
echo "===================================================================="
echo "Step 2: Dry-run row sweep across 5 tenant-data tables"
echo "===================================================================="
npx ts-node --compiler-options '{"module":"CommonJS","esModuleInterop":true}' --transpile-only "$SCRIPT_DIR/sweep-tenant-rows.ts" "$tenantId"
if [ $? -ne 0 ]; then
  echo "FAIL: dry-run row sweep errored." >&2
  exit 6
fi

# ============================================================================
# Step 3: Dry-run SNS topic deletion
# ============================================================================
echo
echo "===================================================================="
echo "Step 3: Dry-run SNS topic deletion"
echo "===================================================================="
npx ts-node --compiler-options '{"module":"CommonJS","esModuleInterop":true}' --transpile-only "$SCRIPT_DIR/sweep-tenant-sns.ts" "$tenantId"
if [ $? -ne 0 ]; then
  echo "FAIL: dry-run SNS sweep errored." >&2
  exit 7
fi

# ============================================================================
# Step 4: Branch on --apply
# ============================================================================
if [ -z "$apply" ]; then
  echo
  echo "===================================================================="
  echo "Dry-run complete. Re-run with --apply to actually delete."
  echo "===================================================================="
  exit 0
fi

# ============================================================================
# Step 5: Typed confirmation
# ============================================================================
echo
echo "===================================================================="
echo "DESTRUCTIVE OPERATION"
echo "===================================================================="
echo "About to delete all DDB rows + SNS topic for tenant: $tenantId"
echo "Type the tenantId exactly to confirm:"
read -r confirmed
if [ "$confirmed" != "$tenantId" ]; then
  echo "Confirmation did not match. Aborting." >&2
  exit 8
fi

# ============================================================================
# Step 6: Apply row sweep
# ============================================================================
echo
echo "===================================================================="
echo "Step 6: APPLYING row sweep"
echo "===================================================================="
npx ts-node --compiler-options '{"module":"CommonJS","esModuleInterop":true}' --transpile-only "$SCRIPT_DIR/sweep-tenant-rows.ts" "$tenantId" --apply
if [ $? -ne 0 ]; then
  echo "FAIL: row sweep --apply errored. Some rows may remain." >&2
  exit 9
fi

# ============================================================================
# Step 7: Apply SNS deletion
# ============================================================================
echo
echo "===================================================================="
echo "Step 7: APPLYING SNS topic deletion"
echo "===================================================================="
npx ts-node --compiler-options '{"module":"CommonJS","esModuleInterop":true}' --transpile-only "$SCRIPT_DIR/sweep-tenant-sns.ts" "$tenantId" --apply
if [ $? -ne 0 ]; then
  echo "FAIL: SNS --apply errored." >&2
  exit 10
fi

# ============================================================================
# Step 8: Final verification scan
# ============================================================================
echo
echo "===================================================================="
echo "Step 8: Final verification scan"
echo "===================================================================="
npx ts-node --compiler-options '{"module":"CommonJS","esModuleInterop":true}' --transpile-only "$SCRIPT_DIR/sweep-tenant-rows.ts" "$tenantId" 2>&1 | tee /tmp/final-verify.txt
# Check for any non-zero row counts in the dry-run output
if grep -E '\] [^0]\d* rows' /tmp/final-verify.txt > /dev/null 2>&1; then
  echo "FAIL: orphans detected after cleanup. Investigate." >&2
  exit 11
fi
echo "✓ No orphans detected. Cleanup complete for $tenantId."
