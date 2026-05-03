#!/bin/bash
# ============================================================================
# Shared safety guard for EdForge cleanup scripts.
#
# Sourced by cleanup.sh, cleanup-cloudfront.sh, and cleanup-cognito.sh.
# Refuses to proceed unless the resolved AWS account, region, and profile match
# the EdForge UAT teardown target. Production is hard-blocklisted.
#
# Usage (from any cleanup script):
#
#   GUARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$GUARD_DIR/_safety-guard.sh"
#
# After sourcing, $RESOLVED_ACCOUNT, $RESOLVED_REGION, $RESOLVED_PROFILE are
# available for display in any subsequent confirmation prompt.
#
# DO NOT BYPASS. SKIP_CONFIRM does not bypass these checks. If you need to
# extend the allowlist (e.g., to point at a future replacement UAT account),
# edit ALLOWED_ACCOUNT / ALLOWED_REGION below and document the change in the
# deploy log.
# ============================================================================

ALLOWED_ACCOUNT="715860911762"   # EdForge UAT (Blender_021021)
ALLOWED_REGION="us-east-2"
BLOCKLIST_ACCOUNT="257526644020" # EdForge production — NEVER run cleanup here
BLOCKLIST_PROFILE="prod"

RESOLVED_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
# CloudFront is global — region resolution may be a no-op for the cloudfront
# script, so we still resolve it if available but only enforce equality below.
RESOLVED_REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]' 2>/dev/null || echo "")
RESOLVED_PROFILE="${AWS_PROFILE:-<unset>}"

# Allow the calling script to opt out of the region check (e.g., CloudFront
# operations are global). Default is to enforce.
GUARD_REQUIRE_REGION="${GUARD_REQUIRE_REGION:-true}"

_guard_refuse() {
    local title="$1"
    local body="$2"
    echo ""
    echo -e "\033[0;31m\033[1m=============================================="
    echo -e " ** REFUSING — $title **"
    echo -e "==============================================\033[0m"
    echo "Resolved account:  $RESOLVED_ACCOUNT"
    echo "Resolved region:   $RESOLVED_REGION"
    echo "Resolved profile:  $RESOLVED_PROFILE"
    echo ""
    echo "$body"
    exit 1
}

if [ -z "$RESOLVED_ACCOUNT" ]; then
    _guard_refuse "could not resolve AWS account ID" \
        "aws sts get-caller-identity returned empty. Check your credentials."
fi

if [ "$GUARD_REQUIRE_REGION" = "true" ] && [ -z "$RESOLVED_REGION" ]; then
    _guard_refuse "could not resolve AWS region" \
        "aws ec2 describe-availability-zones returned empty."
fi

if [ "$RESOLVED_ACCOUNT" = "$BLOCKLIST_ACCOUNT" ]; then
    _guard_refuse "this is the production account" \
        "This script destroys EdForge resources. It must NEVER run against
the production account ($BLOCKLIST_ACCOUNT). If you intended to run
against UAT, set AWS_PROFILE=uat in your shell and re-run."
fi

if [ "$RESOLVED_PROFILE" = "$BLOCKLIST_PROFILE" ]; then
    _guard_refuse "AWS_PROFILE=prod is blocklisted" \
        "Even though the resolved account is not the production account ID,
the profile name 'prod' is blocklisted as a defense-in-depth measure
against misconfigured profiles."
fi

if [ "$RESOLVED_ACCOUNT" != "$ALLOWED_ACCOUNT" ]; then
    _guard_refuse "account not in allowlist" \
        "Expected account $ALLOWED_ACCOUNT (EdForge UAT). Resolved $RESOLVED_ACCOUNT.
This script is hard-coded to teardown the EdForge UAT deployment. To run it
against a different account, edit ALLOWED_ACCOUNT in scripts/cleanup/_safety-guard.sh
(and document why in the deploy log)."
fi

if [ "$GUARD_REQUIRE_REGION" = "true" ] && [ "$RESOLVED_REGION" != "$ALLOWED_REGION" ]; then
    _guard_refuse "region not in allowlist" \
        "Expected region $ALLOWED_REGION. Resolved $RESOLVED_REGION."
fi
