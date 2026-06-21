#!/usr/bin/env bash
#
# rbac-personas.sh — Persona-driven RBAC/ABAC smoke for the EdForge identity API.
#
# Validates the authorization changes from the RBAC/ABAC epic against a live
# deployment, scoped to ONE tenant (use the internal-dev tenant). It proves the
# guard decisions by hitting real endpoints with each persona's JWT and asserting
# the HTTP authorization outcome — NOT the business result.
#
# It is SIDE-EFFECT-FREE for the core matrix: guard-enforced write routes run the
# guard BEFORE body validation, so we send an empty body — a denied persona gets
# 403, an authorized persona gets 400 (validation), and nothing is ever created.
# Reads are GETs. The optional "in-handler" section only exercises the DENY side
# (requests are rejected before any mutation).
#
# ──────────────────────────────────────────────────────────────────────────────
# HOW TO RUN
#
#   1. In the internal-dev tenant, create one account per persona and capture a
#      fresh Cognito *access token* (JWT) for each. Personas (school roles):
#        - TenantAdmin (globalRole=TenantAdmin)
#        - Principal, VicePrincipal, Teacher  (staff-type school roles)
#        - Parent, Student                    (portal accounts)
#
#   2. Grab a couple of IDs from that tenant (any school + any staff member):
#        SCHOOL_ID, STAFF_ID  (and TARGET_USER_ID for the optional section).
#
#   3. Run with the values inline (tokens never need to touch a file):
#
#        API_BASE_URL="https://<tenant-api-host>" \
#        SCHOOL_ID="<uuid>" STAFF_ID="<uuid>" \
#        JWT_TENANT_ADMIN="<jwt>" JWT_PRINCIPAL="<jwt>" \
#        JWT_VICE_PRINCIPAL="<jwt>" JWT_TEACHER="<jwt>" \
#        JWT_PARENT="<jwt>" JWT_STUDENT="<jwt>" \
#        bash scripts/smoke/rbac-personas.sh
#
#   Missing persona tokens or IDs are SKIPPED, not failed — provide what you have.
#   Exit code is non-zero if any assertion FAILs.
#
# Auth: Cognito access tokens are sent as `Authorization: Bearer <jwt>`. They are
# short-lived (~1h); re-mint if the run reports unexpected 401s across the board.
# ──────────────────────────────────────────────────────────────────────────────

set -uo pipefail

API_BASE_URL="${API_BASE_URL:?set API_BASE_URL, e.g. https://api.internal-dev.example.com}"
SCHOOL_ID="${SCHOOL_ID:-}"
STAFF_ID="${STAFF_ID:-}"
TARGET_USER_ID="${TARGET_USER_ID:-}"

PASS=0; FAIL=0; SKIP=0
FAILED_ROWS=()

token_for() {
  case "$1" in
    admin)     printf '%s' "${JWT_TENANT_ADMIN:-}";;
    principal) printf '%s' "${JWT_PRINCIPAL:-}";;
    vp)        printf '%s' "${JWT_VICE_PRINCIPAL:-}";;
    teacher)   printf '%s' "${JWT_TEACHER:-}";;
    parent)    printf '%s' "${JWT_PARENT:-}";;
    student)   printf '%s' "${JWT_STUDENT:-}";;
    *)         printf '';;
  esac
}

# req <persona> <METHOD> <PATH> <DENY|ALLOW> [json-body]
#   DENY  → expect HTTP 403 (guard/handler rejected the caller)
#   ALLOW → expect HTTP not in {401,403} (authorized; 200/201/400/404/409 all fine)
req() {
  local persona="$1" method="$2" path="$3" expect="$4" body="${5:-}"
  local token; token="$(token_for "$persona")"
  local label; label="$(printf '%-9s %-6s %s' "$persona" "$method" "$path")"

  if [ -z "$token" ]; then
    SKIP=$((SKIP+1)); printf '  SKIP  %s  (no token)\n' "$label"; return
  fi
  if printf '%s' "$path" | grep -q '//\|/$'; then
    SKIP=$((SKIP+1)); printf '  SKIP  %s  (missing id)\n' "$label"; return
  fi

  local code
  if [ -n "$body" ]; then
    code=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
      --data "$body" "$API_BASE_URL$path")
  else
    code=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -X "$method" \
      -H "Authorization: Bearer $token" "$API_BASE_URL$path")
  fi

  local result
  case "$expect" in
    DENY)  [ "$code" = "403" ] && result=PASS || result=FAIL ;;
    ALLOW) case "$code" in 401|403|000) result=FAIL ;; *) result=PASS ;; esac ;;
    *)     result=FAIL ;;
  esac

  if [ "$result" = PASS ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILED_ROWS+=("$label  expect=$expect got=$code"); fi
  printf '  %-5s %s  expect=%-5s got=%s\n' "$result" "$label" "$expect" "$code"
}

echo "RBAC persona smoke → $API_BASE_URL"
echo

# ── StaffReadGuard (PR #313) — portal accounts denied staff HR reads ──────────
echo "[1] StaffReadGuard — staff HR reads"
for p in admin principal vp teacher; do req "$p" GET "/staff"                ALLOW; done
for p in parent student;            do req "$p" GET "/staff"                DENY;  done
for p in admin principal teacher;   do req "$p" GET "/credentials/expiring" ALLOW; done
for p in parent student;            do req "$p" GET "/credentials/expiring" DENY;  done
if [ -n "$SCHOOL_ID" ]; then
  for p in admin teacher; do req "$p" GET "/schools/$SCHOOL_ID/staff" ALLOW; done
  for p in parent student; do req "$p" GET "/schools/$SCHOOL_ID/staff" DENY;  done
fi
if [ -n "$STAFF_ID" ]; then
  for r in leave credentials trainings employment-history; do
    for p in admin principal teacher; do req "$p" GET "/staff/$STAFF_ID/$r" ALLOW; done
    for p in parent student;          do req "$p" GET "/staff/$STAFF_ID/$r" DENY;  done
  done
fi
echo

# ── Scheduling permission (batch 5) — create is Principal+, view is everyone ──
echo "[2] scheduling:create vs scheduling:view (academic-years)"
if [ -n "$SCHOOL_ID" ]; then
  # create: empty body → authorized persona 400 (validation), denied 403. No write.
  for p in admin principal;        do req "$p" POST "/schools/$SCHOOL_ID/academic-years" ALLOW '{}'; done
  for p in vp teacher parent student; do req "$p" POST "/schools/$SCHOOL_ID/academic-years" DENY  '{}'; done
  # view: everyone with a role may read
  for p in admin principal vp teacher parent student; do req "$p" GET "/schools/$SCHOOL_ID/academic-years" ALLOW; done
fi
echo

# ── Global-role write gating (batch 6) — staff writes are TenantAdmin-only ────
echo "[3] TenantAdmin-only staff writes (empty body → admin 400, others 403)"
req admin     POST "/staff" ALLOW '{}'
for p in principal teacher parent student; do req "$p" POST "/staff" DENY '{}'; done
echo

# ── Self-service reads (allowlisted, in-handler) — every role sees its own ────
echo "[4] Self-service — own sessions / own profile"
for p in admin principal teacher parent student; do req "$p" GET "/sessions"  ALLOW; done
for p in admin principal teacher parent student; do req "$p" GET "/users/me"  ALLOW; done
echo

# ── OPTIONAL in-handler DENY checks (need TARGET_USER_ID != caller) ───────────
# Valid bodies so the request reaches the in-handler check; only the DENY side is
# exercised (rejected before any mutation). Skipped unless TARGET_USER_ID is set.
if [ -n "$TARGET_USER_ID" ] && [ -n "$SCHOOL_ID" ]; then
  echo "[5] In-handler delegation/self-scope (DENY side only — no mutation)"
  # Only TenantAdmin may assign Principal — a Principal/Teacher caller is rejected.
  for p in principal teacher; do
    req "$p" POST "/users/$TARGET_USER_ID/roles" DENY "{\"schoolId\":\"$SCHOOL_ID\",\"role\":\"Principal\"}"
  done
  # change-password is strictly self — even TenantAdmin cannot change another's.
  for p in admin teacher parent; do
    req "$p" POST "/users/$TARGET_USER_ID/security/change-password" DENY \
      '{"currentPassword":"x","newPassword":"NotARealP@ss123"}'
  done
  # PATCH another user's profile — non-admin, non-self is rejected.
  for p in teacher parent; do
    req "$p" PATCH "/users/$TARGET_USER_ID" DENY '{"firstName":"smoke"}'
  done
  echo
fi

echo "──────────────────────────────────────────"
printf 'RESULT  PASS=%d  FAIL=%d  SKIP=%d\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  echo "FAILURES:"
  for r in "${FAILED_ROWS[@]}"; do echo "  $r"; done
  exit 1
fi
echo "All assertions passed."
