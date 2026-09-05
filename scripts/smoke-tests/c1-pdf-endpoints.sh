#!/usr/bin/env bash
# Sprint C.1 stacked-deploy live smoke — invoice PDF + receipt PDF endpoints.
#
# Tests the two new endpoints shipped by C.1.5 (PR #201) + C.1.6 (PR #202):
#   GET /finance/schools/{schoolId}/invoices/{invoiceId}/pdf
#   GET /finance/payments/{paymentId}/receipt/pdf?schoolId={schoolId}
#
# Asserts for each:
#   - HTTP 200
#   - Content-Type: application/pdf
#   - Response body starts with the PDF magic bytes (%PDF-)
#   - File size > 1KB (sanity — real invoices/receipts are 5-20KB)
#
# Saves each PDF to /tmp/ so you can open + visually inspect Devanagari
# rendering + BS+AD dual-date + NPR currency for the dev-pabson-primary
# pilot tenant.
#
# Usage:
#   JWT=<bearer-token> \
#   SCHOOL_ID=<sid> \
#   INVOICE_ID=<iid> \
#   PAYMENT_ID=<pid> \
#   ./scripts/smoke-tests/c1-pdf-endpoints.sh

set -euo pipefail

: "${JWT:?Set JWT to a fresh prod token for dev-pabson-primary}"
: "${SCHOOL_ID:?Set SCHOOL_ID (dev-pabson-primary school UUID)}"
: "${INVOICE_ID:?Set INVOICE_ID (an existing invoice on SCHOOL_ID)}"
: "${PAYMENT_ID:?Set PAYMENT_ID (an existing completed payment on SCHOOL_ID)}"

API_BASE="${API_BASE:-https://edforge.app}"
TS=$(date +%Y%m%d-%H%M%S)
INV_PDF="/tmp/smoke-invoice-${INVOICE_ID:0:8}-${TS}.pdf"
RCT_PDF="/tmp/smoke-receipt-${PAYMENT_ID:0:8}-${TS}.pdf"

echo "=== Sprint C.1 PDF endpoints smoke ==="
echo "API base:    $API_BASE"
echo "School ID:   $SCHOOL_ID"
echo "Invoice ID:  $INVOICE_ID"
echo "Payment ID:  $PAYMENT_ID"
echo

PASS=0
FAIL=0

check_pdf() {
  local name="$1" path="$2" status="$3" ctype="$4"
  local size
  size=$(stat -f%z "$path" 2>/dev/null || stat -c%s "$path")
  local magic
  magic=$(head -c 5 "$path" | xxd -p | head -1)
  # %PDF- = 25 50 44 46 2D
  if [[ "$status" == "200" && "$ctype" == "application/pdf"* && "$magic" == "2550444"* && "$size" -gt 1024 ]]; then
    echo "  ✓ PASS $name — status=$status ctype=$ctype size=${size}B magic=%PDF-"
    PASS=$((PASS + 1))
  else
    echo "  ✗ FAIL $name — status=$status ctype=$ctype size=${size}B magic=0x$magic"
    FAIL=$((FAIL + 1))
    # On failure, surface the first 500 bytes of the body (likely a JSON error)
    head -c 500 "$path"
    echo
  fi
}

# Single GET captures both body (to file) AND response headers (to /tmp).
# Previous version used `curl -I` (HEAD request) to fetch content-type
# separately — NestJS doesn't ship a HEAD handler so that approach
# returned empty content-type and the assertion mis-failed. `-D <file>`
# on the same GET captures headers from the actual response body GET.
fetch_pdf() {
  local url="$1" out_pdf="$2" out_hdr="$3"
  curl -s -D "$out_hdr" -o "$out_pdf" -w "%{http_code}" \
    -H "Authorization: Bearer $JWT" -H "Accept: application/pdf" "$url"
}

ctype_from_headers() {
  # `grep` exits 1 on no-match, which under `set -euo pipefail` (line 25)
  # would abort the script before `check_pdf` could surface a useful error.
  # The `|| true` lets the function return an empty string + exit 0 when no
  # Content-Type header is present, so the FAIL path runs and reports the
  # missing header explicitly (per the CodeRabbit finding on PR #203).
  (grep -i "^content-type:" "$1" || true) | tr -d '\r' | sed 's/^[Cc]ontent-[Tt]ype: //;s/^ *//;s/ *$//'
}

echo "--- Test 1: GET /finance/schools/$SCHOOL_ID/invoices/$INVOICE_ID/pdf ---"
INV_HDR="/tmp/smoke-invoice-${INVOICE_ID:0:8}-${TS}.headers"
INV_STATUS=$(fetch_pdf \
  "$API_BASE/api/finance/schools/$SCHOOL_ID/invoices/$INVOICE_ID/pdf" \
  "$INV_PDF" "$INV_HDR")
INV_CTYPE=$(ctype_from_headers "$INV_HDR")
check_pdf "invoice PDF" "$INV_PDF" "$INV_STATUS" "$INV_CTYPE"

echo
echo "--- Test 2: GET /finance/payments/$PAYMENT_ID/receipt/pdf?schoolId=$SCHOOL_ID ---"
RCT_HDR="/tmp/smoke-receipt-${PAYMENT_ID:0:8}-${TS}.headers"
RCT_STATUS=$(fetch_pdf \
  "$API_BASE/api/finance/payments/$PAYMENT_ID/receipt/pdf?schoolId=$SCHOOL_ID" \
  "$RCT_PDF" "$RCT_HDR")
RCT_CTYPE=$(ctype_from_headers "$RCT_HDR")
check_pdf "receipt PDF" "$RCT_PDF" "$RCT_STATUS" "$RCT_CTYPE"

echo
echo "=== Summary: $PASS pass / $FAIL fail ==="
echo "PDFs saved to /tmp for inspection:"
echo "  Invoice: $INV_PDF"
echo "  Receipt: $RCT_PDF"
echo "Open them to verify Devanagari labels + BS+AD dual-date + NPR amounts."

exit $FAIL
