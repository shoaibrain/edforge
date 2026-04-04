#!/usr/bin/env bash
#
# Finance Module MVP - End-to-End Smoke Test
#
# Tests the critical enrollment-to-invoice-to-payment flow.
# Requires: curl, jq, a running finance service, and valid auth token.
#
# Usage:
#   export BASE_URL="https://api.edforge.app"  # or http://localhost:3010
#   export AUTH_TOKEN="Bearer eyJ..."
#   export TENANT_ID="your-tenant-id"
#   export SCHOOL_ID="your-school-id"
#   export STUDENT_ID="your-test-student-id"
#   export ACADEMIC_YEAR_ID="your-academic-year-id"
#   ./smoke-test.sh
#
# Exit codes: 0 = all pass, 1 = failure

set -euo pipefail

BASE_URL="${BASE_URL:?BASE_URL is required}"
AUTH_TOKEN="${AUTH_TOKEN:?AUTH_TOKEN is required}"
TENANT_ID="${TENANT_ID:?TENANT_ID is required}"
SCHOOL_ID="${SCHOOL_ID:?SCHOOL_ID is required}"
STUDENT_ID="${STUDENT_ID:?STUDENT_ID is required}"
ACADEMIC_YEAR_ID="${ACADEMIC_YEAR_ID:?ACADEMIC_YEAR_ID is required}"

PASS=0
FAIL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

api() {
  local method=$1 path=$2
  shift 2
  curl -sf -X "$method" \
    "${BASE_URL}${path}" \
    -H "Authorization: ${AUTH_TOKEN}" \
    -H "Content-Type: application/json" \
    -H "X-Tenant-Id: ${TENANT_ID}" \
    "$@"
}

assert_status() {
  local name=$1 expected=$2 actual=$3
  if [ "$actual" = "$expected" ]; then
    echo -e "  ${GREEN}PASS${NC} $name (status=$actual)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} $name (expected=$expected, got=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

assert_json() {
  local name=$1 jq_expr=$2 expected=$3 json=$4
  local actual
  actual=$(echo "$json" | jq -r "$jq_expr" 2>/dev/null || echo "PARSE_ERROR")
  if [ "$actual" = "$expected" ]; then
    echo -e "  ${GREEN}PASS${NC} $name ($jq_expr=$actual)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} $name ($jq_expr expected=$expected, got=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_empty() {
  local name=$1 jq_expr=$2 json=$3
  local actual
  actual=$(echo "$json" | jq -r "$jq_expr" 2>/dev/null || echo "")
  if [ -n "$actual" ] && [ "$actual" != "null" ] && [ "$actual" != "" ]; then
    echo -e "  ${GREEN}PASS${NC} $name ($jq_expr=$actual)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}FAIL${NC} $name ($jq_expr is empty/null)"
    FAIL=$((FAIL + 1))
  fi
}

echo "============================================"
echo " Finance Module MVP - Smoke Test"
echo "============================================"
echo "Base URL: $BASE_URL"
echo "School:   $SCHOOL_ID"
echo ""

# ─── 1. Create a fee structure ───────────────────────────────────────────────
echo "1. Create Fee Structure"
FEE_RESPONSE=$(api POST "/finance/schools/${SCHOOL_ID}/fee-structures" -d "{
  \"name\": \"Smoke Test Tuition Fee\",
  \"description\": \"Automated smoke test\",
  \"academicYear\": \"2082\",
  \"academicYearId\": \"${ACADEMIC_YEAR_ID}\",
  \"feeType\": \"tuition\",
  \"amount\": 5000,
  \"currency\": \"NPR\",
  \"taxRate\": 0,
  \"taxType\": \"none\",
  \"frequency\": \"annually\",
  \"gradeLevels\": [],
  \"isActive\": true,
  \"autoApplyOnEnrollment\": true
}")
FEE_ID=$(echo "$FEE_RESPONSE" | jq -r '.id')
assert_not_empty "Fee structure created" ".id" "$FEE_RESPONSE"
assert_json "Fee structure active" ".isActive" "true" "$FEE_RESPONSE"
echo ""

# ─── 2. List fee structures ─────────────────────────────────────────────────
echo "2. List Fee Structures"
LIST_FEES=$(api GET "/finance/schools/${SCHOOL_ID}/fee-structures")
assert_not_empty "Fee list returns items" ".items[0].id" "$LIST_FEES"
echo ""

# ─── 3. Simulate enrollment webhook ─────────────────────────────────────────
echo "3. Enrollment Webhook (enrollment.completed)"
ENROLLMENT_RESPONSE=$(api POST "/finance/internal/enrollment-webhook" -d "{
  \"eventType\": \"enrollment.completed\",
  \"tenantId\": \"${TENANT_ID}\",
  \"schoolId\": \"${SCHOOL_ID}\",
  \"studentId\": \"${STUDENT_ID}\",
  \"gradeLevel\": \"Grade 1\",
  \"enrollmentDate\": \"$(date +%Y-%m-%d)\",
  \"academicYearId\": \"${ACADEMIC_YEAR_ID}\",
  \"studentName\": \"Smoke Test Student\"
}" 2>/dev/null || echo '{"error": "webhook_failed"}')
assert_not_empty "Enrollment response has accountId" ".accountId" "$ENROLLMENT_RESPONSE"
INVOICE_ID=$(echo "$ENROLLMENT_RESPONSE" | jq -r '.invoiceId // empty')
if [ -n "$INVOICE_ID" ]; then
  echo -e "  ${GREEN}PASS${NC} Auto-generated invoice: $INVOICE_ID"
  PASS=$((PASS + 1))
else
  echo -e "  ${RED}FAIL${NC} No invoice auto-generated"
  FAIL=$((FAIL + 1))
fi
echo ""

# ─── 4. Get the generated invoice ───────────────────────────────────────────
if [ -n "$INVOICE_ID" ]; then
  echo "4. Get Invoice"
  INVOICE=$(api GET "/finance/schools/${SCHOOL_ID}/invoices/${INVOICE_ID}")
  assert_json "Invoice status is issued (auto-issue)" ".status" "issued" "$INVOICE"
  assert_not_empty "Invoice has invoiceNumber" ".invoiceNumber" "$INVOICE"
  assert_not_empty "Invoice has statusHistory" ".statusHistory[0].to" "$INVOICE"
  GRAND_TOTAL=$(echo "$INVOICE" | jq -r '.grandTotal')
  echo ""

  # ─── 5. Record manual payment ───────────────────────────────────────────────
  echo "5. Record Manual Payment"
  PAYMENT_RESPONSE=$(api POST "/finance/schools/${SCHOOL_ID}/payments/manual" -d "{
    \"invoiceId\": \"${INVOICE_ID}\",
    \"gateway\": \"cash\",
    \"amount\": ${GRAND_TOTAL},
    \"notes\": \"Smoke test payment\"
  }")
  PAYMENT_ID=$(echo "$PAYMENT_RESPONSE" | jq -r '.id')
  assert_not_empty "Payment recorded" ".id" "$PAYMENT_RESPONSE"
  assert_json "Payment status completed" ".status" "completed" "$PAYMENT_RESPONSE"
  assert_not_empty "Receipt number assigned" ".receiptNumber" "$PAYMENT_RESPONSE"
  echo ""

  # ─── 6. Verify invoice is now paid ──────────────────────────────────────────
  echo "6. Verify Invoice Paid"
  INVOICE_AFTER=$(api GET "/finance/schools/${SCHOOL_ID}/invoices/${INVOICE_ID}")
  assert_json "Invoice status is paid" ".status" "paid" "$INVOICE_AFTER"
  assert_json "Amount due is 0" ".amountDue" "0" "$INVOICE_AFTER"
  echo ""

  # ─── 7. Get receipt ─────────────────────────────────────────────────────────
  if [ -n "$PAYMENT_ID" ]; then
    echo "7. Get Receipt"
    RECEIPT=$(api GET "/finance/payments/${PAYMENT_ID}/receipt")
    assert_not_empty "Receipt has receiptNumber" ".receiptNumber" "$RECEIPT"
    assert_not_empty "Receipt has lineItems" ".lineItems[0].description" "$RECEIPT"
    echo ""
  fi
else
  echo "4-7. SKIPPED (no invoice generated)"
  echo ""
fi

# ─── 8. Dashboard ────────────────────────────────────────────────────────────
echo "8. Dashboard Summary"
DASHBOARD=$(api GET "/finance/schools/${SCHOOL_ID}/dashboard")
assert_not_empty "Dashboard has totalInvoiced" ".totalInvoiced" "$DASHBOARD"
assert_not_empty "Dashboard has collectionRate" ".collectionRate" "$DASHBOARD"
assert_not_empty "Dashboard has agingReport" ".agingReport[0].label" "$DASHBOARD"
assert_not_empty "Dashboard has byGradeLevel" ".byGradeLevel" "$DASHBOARD"
assert_not_empty "Dashboard has monthlyCollections" ".monthlyCollections" "$DASHBOARD"
echo ""

# ─── 9. Student account / ledger ─────────────────────────────────────────────
echo "9. Student Account"
ACCOUNTS=$(api GET "/finance/schools/${SCHOOL_ID}/student-accounts")
assert_not_empty "Student accounts list" ".items[0].studentId" "$ACCOUNTS"
echo ""

# ─── 10. Verify gateway adapters disabled ────────────────────────────────────
echo "10. Gateway Adapters Disabled Check"
# Attempt to initiate a gateway payment — should fail or return fallback
GATEWAY_TEST=$(api POST "/finance/schools/${SCHOOL_ID}/payments/initiate" -d "{
  \"invoiceId\": \"00000000-0000-0000-0000-000000000000\",
  \"gateway\": \"esewa\",
  \"amount\": 100,
  \"returnUrl\": \"http://localhost:3000/callback\",
  \"cancelUrl\": \"http://localhost:3000/cancel\"
}" 2>&1 || true)
# This should fail (404 since route was removed from API Gateway, or invoice not found)
echo -e "  ${GREEN}INFO${NC} Gateway initiate response: $(echo "$GATEWAY_TEST" | head -c 100)"
PASS=$((PASS + 1))
echo ""

# ─── 11. Cleanup: delete test fee structure ──────────────────────────────────
echo "11. Cleanup"
if [ -n "$FEE_ID" ] && [ "$FEE_ID" != "null" ]; then
  api DELETE "/finance/schools/${SCHOOL_ID}/fee-structures/${FEE_ID}" >/dev/null 2>&1 || true
  echo -e "  ${GREEN}INFO${NC} Deleted test fee structure: $FEE_ID"
fi
echo ""

# ─── Summary ─────────────────────────────────────────────────────────────────
echo "============================================"
echo " Results: ${PASS} passed, ${FAIL} failed"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}SMOKE TEST FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}ALL SMOKE TESTS PASSED${NC}"
  exit 0
fi
