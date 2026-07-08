#!/usr/bin/env bash
# D0a.2 Dress Rehearsal — IEMIS Import Runner
#
# End-to-end exerciser for the IEMIS transformer extension shipped in D0a.2
# (PR #132). Runs against the internal-dev tenant `dev-pabson-primary` on
# prod-account.
#
# Pre-requisites:
#   1. ./scripts/dress-rehearsal/d0a-2-iemis-synth.ts already ran and produced
#      /tmp/dress-rehearsal-d0a-2-<ts>.json
#   2. Fresh dev-pabson-primary TenantAdmin JWT at /private/tmp/c0-c-3-prod-jwt.txt
#
# Usage:
#   ./scripts/dress-rehearsal/d0a-2-iemis-runner.sh [json-file-path]
#
# If no path supplied, picks the newest /tmp/dress-rehearsal-d0a-2-*.json.
#
# Flow:
#   1. POST /academics/students/import/iemis  → 202 + jobId
#   2. Poll  /academics/students/import/iemis/jobs/:jobId every 2s until terminal
#   3. GET   /academics/students/import/iemis/jobs?schoolId=... (D0a.1 LIST — dogfood)
#   4. Sample 5 created students, verify D0a.2 fields populated
#   5. Append findings table to local/private deploy log
#   6. CLEANUP: delete the 15 test students from dev tenant (best-effort)
#
# Output:
#   ${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/dev-dress-rehearsal-d0a-2-<ts>-<sha>.log

set -e

JWT_FILE=/private/tmp/c0-c-3-prod-jwt.txt
JSON_FILE="${1:-$(ls -t /tmp/dress-rehearsal-d0a-2-*.json 2>/dev/null | head -1)}"
DEV_TENANT_ID="21aea5da-511f-4dfa-a6f2-6971f63a719f"
DEV_SCHOOL_ID="4209e3d8-d2e2-4e0e-9961-790341c264f4"
DEV_AY_ID=""   # set below from API if needed
API="https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod"
SHA=$(git rev-parse --short HEAD)
TS=$(date +%Y%m%d-%H%M%S)
LOG_DIR="${EDFORGE_DEPLOY_LOG_DIR:-${TMPDIR:-/tmp}/edforge-deploys}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/dev-dress-rehearsal-d0a-2-${TS}-${SHA}.log"

# ── validate prereqs ──
if [ ! -f "$JWT_FILE" ]; then
  echo "ERROR: JWT file not found at $JWT_FILE" >&2
  exit 1
fi
JWT=$(cat "$JWT_FILE" | tr -d '\n\r ')
if [ -z "$JWT" ]; then
  echo "ERROR: JWT file empty" >&2
  exit 1
fi
if [ -z "$JSON_FILE" ] || [ ! -f "$JSON_FILE" ]; then
  echo "ERROR: synth JSON not found at $JSON_FILE — run synth first" >&2
  exit 1
fi

# ── resolve current AY for enrollment auto-pair ──
AY_RESP=$(curl -sf -H "Authorization: Bearer $JWT" "$API/schools/$DEV_SCHOOL_ID/academic-years/current" 2>/dev/null || echo "{}")
DEV_AY_ID=$(echo "$AY_RESP" | jq -r '.yearId // ""')

exec > >(tee "$LOG") 2>&1

echo "============================================================"
echo "  D0a.2 Dress Rehearsal — IEMIS Import End-to-End"
echo "  Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  Tenant: $DEV_TENANT_ID (dev-pabson-primary)"
echo "  School: $DEV_SCHOOL_ID (Shree Saraswati Eng. Boarding — DEV)"
echo "  Current AY: ${DEV_AY_ID:-<none — students will NOT auto-enroll>}"
echo "  Source JSON: $JSON_FILE"
echo "  Code SHA: $SHA"
echo "============================================================"
echo ""

# ── Step 1: POST the import ──
echo "## Step 1: POST /academics/students/import/iemis"
ROW_COUNT=$(jq 'length' "$JSON_FILE")
echo "  Rows to import: $ROW_COUNT"
BODY=$(jq -n --argjson students "$(cat "$JSON_FILE")" --arg schoolId "$DEV_SCHOOL_ID" --arg ayId "$DEV_AY_ID" '{
  schoolId: $schoolId,
  students: $students
} + (if $ayId == "" then {} else { enrollInAcademicYearId: $ayId } end)')
RESP=$(curl -sf -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d "$BODY" "$API/academics/students/import/iemis" 2>&1 || true)
echo "  Response:"
echo "$RESP" | jq '.'
JOB_ID=$(echo "$RESP" | jq -r '.jobId // ""')
if [ -z "$JOB_ID" ]; then
  echo "ERROR: no jobId returned" >&2
  exit 1
fi
echo "  jobId: $JOB_ID"
echo ""

# ── Step 2: poll until terminal ──
echo "## Step 2: poll /jobs/$JOB_ID until terminal"
for i in $(seq 1 60); do
  JOB=$(curl -sf -H "Authorization: Bearer $JWT" "$API/academics/students/import/iemis/jobs/$JOB_ID")
  STATUS=$(echo "$JOB" | jq -r '.status')
  echo "  [$i] status=$STATUS  studentsCreated=$(echo "$JOB" | jq -r '.studentsCreated')  findings=$(echo "$JOB" | jq -r '.findings | length')"
  if [ "$STATUS" = "succeeded" ] || [ "$STATUS" = "failed" ]; then break; fi
  sleep 2
done
echo ""
echo "  Final job record:"
echo "$JOB" | jq '{status, totalRows, studentsCreated, studentsEnrolled, failed, skipped, durationMs, findingsCount: (.findings | length), duplicatesCount: (.duplicates | length)}'
echo ""

# ── Step 3: D0a.1 LIST dogfood ──
echo "## Step 3: GET /jobs?schoolId=... (D0a.1 LIST — dogfood)"
curl -sf -H "Authorization: Bearer $JWT" "$API/academics/students/import/iemis/jobs?schoolId=$DEV_SCHOOL_ID&limit=10" \
  | jq '{ totalItems: (.items | length), latest: .items[0] | { jobId, status, createdAt, studentsCreated, findingsCount: (.findings | length) } }'
echo ""

# ── Step 4: findings breakdown ──
echo "## Step 4: Findings breakdown (expect ~6 distinct warning types)"
echo "$JOB" | jq -r '.findings // [] | group_by(.field + "|" + .level) | map({ field: .[0].field, level: .[0].level, count: length, sample: .[0].message }) | .[] | "  \(.level | ascii_upcase) [\(.count)] field=\(.field): \(.sample)"'
echo ""

# ── Step 5: sample created students, verify D0a.2 fields ──
echo "## Step 5: Verify D0a.2 fields on created students"
# Pull all students from this school created in this run (by createdAt window approximate).
# Use the school-students LIST endpoint.
STUDENTS=$(curl -sf -H "Authorization: Bearer $JWT" "$API/academics/students?schoolId=$DEV_SCHOOL_ID&limit=200")
TEST_STUDENT_IDS=$(echo "$STUDENTS" | jq -r '.items[]? | select(.emisStudentId | tostring | startswith("8888888885050")) | .studentId')
echo "  Test students found (emisStudentId 8888888885050xxx): $(echo "$TEST_STUDENT_IDS" | wc -l | tr -d ' ')"
echo ""
SAMPLE_COUNT=0
for SID in $TEST_STUDENT_IDS; do
  S=$(curl -sf -H "Authorization: Bearer $JWT" "$API/academics/students/$SID?schoolId=$DEV_SCHOOL_ID")
  echo "  --- $(echo "$S" | jq -r '.firstName + " " + .lastName') (emis=$(echo "$S" | jq -r '.emisStudentId')) ---"
  echo "$S" | jq '{
    sexDescriptor,
    motherTongueDescriptor,
    disabilities,
    isTransferred,
    gender,
    currentGradeLevel
  }'
  SAMPLE_COUNT=$((SAMPLE_COUNT + 1))
  if [ $SAMPLE_COUNT -ge 5 ]; then break; fi
done
echo ""

# ── Step 6: cleanup ──
# Set SKIP_CLEANUP=1 to preserve the 15 test students for UI inspection.
# (UI test flow: user logs into dev-pabson-primary, navigates to Students,
#  clicks into any student with emisStudentId 8888888889900xxx, verifies
#  the Demographics tab shows the Ed-Fi descriptor fields.)
if [ "${SKIP_CLEANUP:-0}" = "1" ]; then
  echo "## Step 6: CLEANUP — SKIPPED (SKIP_CLEANUP=1)"
  echo "  Test students preserved for UI inspection."
  echo "  emisStudentId range: 8888888885050001 - 8888888885050015"
  echo "  Re-run with: SKIP_CLEANUP=0 (default) to delete them later."
else
  echo "## Step 6: CLEANUP — delete the test students"
  DELETED=0
  for SID in $TEST_STUDENT_IDS; do
    if curl -sf -X DELETE -H "Authorization: Bearer $JWT" "$API/academics/students/$SID?schoolId=$DEV_SCHOOL_ID" -o /dev/null; then
      DELETED=$((DELETED + 1))
    else
      echo "  WARN: failed to delete $SID"
    fi
  done
  echo "  Deleted $DELETED test students"
fi
echo ""

echo "============================================================"
echo "  Run complete. Log archived: $LOG"
echo "============================================================"
