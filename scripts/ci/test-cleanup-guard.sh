#!/bin/bash
# ============================================================================
# Regression test for scripts/cleanup/_safety-guard.sh
#
# Promotes the Sprint 1 demo's "guards refuse under wrong account/profile"
# assertions into a permanent CI test. Run on every PR touching
# scripts/cleanup/* — if a future change weakens the guards, this test fails.
#
# Approach: shim `aws` on PATH with a fake binary that emits canned identity
# and region. Source _safety-guard.sh under each scenario. Assert exit code
# and key strings in output.
#
# Usage:
#   ./scripts/ci/test-cleanup-guard.sh
#
# Exit codes:
#   0 - all scenarios behaved as expected
#   1 - at least one scenario behaved unexpectedly
# ============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
GUARD="$PROJECT_ROOT/scripts/cleanup/_safety-guard.sh"

if [ ! -f "$GUARD" ]; then
    echo "FATAL: guard not found at $GUARD" >&2
    exit 1
fi

# --- Test harness -----------------------------------------------------------

TMP_BIN=$(mktemp -d)
trap 'rm -rf "$TMP_BIN"' EXIT

# Each scenario writes a fake `aws` shim into $TMP_BIN/aws that emits canned
# values for `sts get-caller-identity` and `ec2 describe-availability-zones`.
# Other invocations are passed through to the real aws via $REAL_AWS, but the
# guard never makes other invocations during sourcing so this is moot.
write_aws_shim() {
    local fake_account="$1"
    local fake_region="$2"
    cat > "$TMP_BIN/aws" <<EOF
#!/bin/bash
# Fake aws shim for guard testing.
case "\$1 \$2" in
    "sts get-caller-identity")
        if [ -z "$fake_account" ]; then
            exit 1
        fi
        # Mimic --query Account --output text behavior
        echo "$fake_account"
        ;;
    "ec2 describe-availability-zones")
        if [ -z "$fake_region" ]; then
            exit 1
        fi
        echo "$fake_region"
        ;;
    *)
        echo "fake aws: unhandled invocation: \$*" >&2
        exit 99
        ;;
esac
EOF
    chmod +x "$TMP_BIN/aws"
}

# Run the guard in a fresh subshell with a controlled PATH and AWS_PROFILE.
# Returns: exit-code on stdout line 1; full output on subsequent lines.
run_guard() {
    local fake_account="$1"
    local fake_region="$2"
    local profile="$3"
    write_aws_shim "$fake_account" "$fake_region"
    PATH="$TMP_BIN:$PATH" AWS_PROFILE="$profile" \
        bash -c "source '$GUARD'" 2>&1
    return $?
}

PASS=0
FAIL=0

assert_scenario() {
    local label="$1"
    local expected_exit="$2"   # 0 = pass-through, 1 = refuse
    local expected_substring="$3"
    local actual_output="$4"
    local actual_exit="$5"

    if [ "$actual_exit" = "$expected_exit" ] && \
       echo "$actual_output" | grep -q "$expected_substring"; then
        echo "  PASS  $label"
        PASS=$((PASS + 1))
    else
        echo "  FAIL  $label"
        echo "        expected exit=$expected_exit, actual=$actual_exit"
        echo "        expected substring: $expected_substring"
        echo "        actual output:"
        echo "$actual_output" | sed 's/^/          /'
        FAIL=$((FAIL + 1))
    fi
}

# --- Scenarios --------------------------------------------------------------

echo "Running guard regression test..."
echo ""

# 1. Production account ID -> refuse
output=$(run_guard "257526644020" "ap-south-1" "uat") ; ec=$?
assert_scenario \
    "prod account ID is blocklisted" \
    1 "this is the production account" "$output" "$ec"

# 2. AWS_PROFILE=prod with a non-prod account ID -> refuse
#    (defense-in-depth: profile name "prod" is itself blocklisted)
output=$(run_guard "999999999999" "us-east-2" "prod") ; ec=$?
assert_scenario \
    "AWS_PROFILE=prod is blocklisted regardless of account" \
    1 "AWS_PROFILE=prod is blocklisted" "$output" "$ec"

# 3. Wrong account (not prod, not the allowed UAT) -> refuse
output=$(run_guard "111111111111" "us-east-2" "uat") ; ec=$?
assert_scenario \
    "non-allowlisted account is refused" \
    1 "account not in allowlist" "$output" "$ec"

# 4. Correct UAT account, wrong region -> refuse
output=$(run_guard "715860911762" "ap-south-1" "uat") ; ec=$?
assert_scenario \
    "wrong region is refused even for UAT account" \
    1 "region not in allowlist" "$output" "$ec"

# 5. Correct UAT account + us-east-2 + AWS_PROFILE=uat -> pass through
#    Sourcing the guard returns 0 (no exit) AND prints no REFUSING banner.
output=$(run_guard "715860911762" "us-east-2" "uat") ; ec=$?
if [ "$ec" = "0" ] && ! echo "$output" | grep -q "REFUSING"; then
    echo "  PASS  UAT account + us-east-2 + uat profile passes through"
    PASS=$((PASS + 1))
else
    echo "  FAIL  UAT account + us-east-2 + uat profile passes through"
    echo "        expected exit=0 and no REFUSING banner"
    echo "        actual exit=$ec"
    echo "        actual output:"
    echo "$output" | sed 's/^/          /'
    FAIL=$((FAIL + 1))
fi

# 6. Empty account ID (bad credentials) -> refuse
output=$(run_guard "" "us-east-2" "uat") ; ec=$?
assert_scenario \
    "empty account ID is refused (bad credentials)" \
    1 "could not resolve AWS account ID" "$output" "$ec"

# 7. CloudFront-style call (GUARD_REQUIRE_REGION=false) with empty region
#    + correct account + uat profile -> pass through
write_aws_shim "715860911762" ""
output=$(PATH="$TMP_BIN:$PATH" AWS_PROFILE="uat" GUARD_REQUIRE_REGION="false" \
        bash -c "source '$GUARD'" 2>&1) ; ec=$?
if [ "$ec" = "0" ] && ! echo "$output" | grep -q "REFUSING"; then
    echo "  PASS  GUARD_REQUIRE_REGION=false skips region check (CloudFront use)"
    PASS=$((PASS + 1))
else
    echo "  FAIL  GUARD_REQUIRE_REGION=false skips region check (CloudFront use)"
    echo "        expected exit=0 and no REFUSING banner"
    echo "        actual exit=$ec"
    echo "        actual output:"
    echo "$output" | sed 's/^/          /'
    FAIL=$((FAIL + 1))
fi

# --- Summary ----------------------------------------------------------------

echo ""
echo "Guard test results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi

exit 0
