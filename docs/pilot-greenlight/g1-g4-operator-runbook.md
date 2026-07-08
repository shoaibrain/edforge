# G1–G4 operator runbook — drain pending gates + close C2

> **Purpose:** One focused ~60-minute operator session to drain the four pending gates left after the 2026-05-16 C0.b sprint completion (PRs #104–#108) and the C2 sprint's harness verdict (PR #100 / #103). After this runbook is executed cleanly, Sprint C0.b is fully live and Sprint C2 is 🟢 internal greenlit — Sprint C3 work can begin.
>
> **Audience:** the operator with prod credentials (AWS_PROFILE=prod) and a fresh Cognito TenantAdmin JWT.
>
> **Last updated:** 2026-05-16

---

## 0. Pre-flight (5 min)

Run these on your workstation before touching any AWS state.

```bash
# 1. Local main is current
cd /Users/shoaibrain/edforge
git checkout main && git pull origin main
SHA=$(git rev-parse --short HEAD)
echo "Operating against main @ $SHA"

# 2. Source the prod profile baseline
source server/.env.prod

# 3. Confirm fresh JWT in place (Cognito TenantAdmin for dev-pabson-primary)
ls -la /private/tmp/c0-c-3-prod-jwt.txt
# Expected: file modified within last hour (Cognito access tokens are 1h-lived)

# 4. Stage the env vars used by C2 smokes
export PILOT_ID=pabson-saraswati-bs-2083
export TENANT_ID=21aea5da-511f-4dfa-a6f2-6971f63a719f   # dev-pabson-primary
export SCHOOL_ID=4209e3d8-d2e2-4e0e-9961-790341c264f4   # Saraswati school in that tenant
# ACADEMIC_YEAR_ID, STAFF_ID, STUDENT_ID — confirm values from prior runs
# (env vars survive across G1-G4 in the same shell session)

# 5. Confirm AWS identity (sanity)
aws sts get-caller-identity --region ap-south-1
# Expected: arn:aws:iam::257526644020:user/edforge-prod-deployer (or your role)
```

**Stop gate:** if any of the above fails, do NOT proceed. Refresh JWT / re-source profile / re-fetch SHA.

---

## G1 — Identity ECR push + ECS roll (~15 min + 7 min monitor)

Picks up **PR #104** (Leave cancel 500 fix) + **PR #106** (shortName uniqueness 409) + **PR #107** (`schoolTypeDescriptor` enum tightening). All three target identity in one combined roll.

### G1.a — Build + push image

```bash
# IMPORTANT: build-application.sh is CWD-sensitive — must be invoked from scripts/
# (per memory `feedback_pr_first_no_more_uat` + the grade-level-fix retro)
cd /Users/shoaibrain/edforge/scripts

LOG="${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-build-application-identity-$(date +%Y%m%d-%H%M%S)-${SHA}.log"
AWS_PROFILE=prod ./build-application.sh identity 2>&1 | tee "$LOG"

# CRITICAL: tee can mask non-zero exits; check exit code explicitly
BUILD_EXIT=${PIPESTATUS[0]}
echo "Build exit code: $BUILD_EXIT"
[ "$BUILD_EXIT" -eq 0 ] || { echo "BUILD FAILED — abort"; exit 1; }
```

**Expected duration:** 2-4 min (Docker build + ECR push).

**On failure:** rerun. If persistent, check Docker daemon, ECR auth (`aws ecr get-login-password ...`), and the script's working-directory assertion.

### G1.b — ECS rolling deploy

```bash
cd /Users/shoaibrain/edforge

LOG="${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-ecs-roll-identitybasic-$(date +%Y%m%d-%H%M%S)-${SHA}.log"
AWS_PROFILE=prod aws ecs update-service \
  --cluster prod-basic --service identitybasic \
  --force-new-deployment --region ap-south-1 2>&1 | tee "$LOG"

# Wait for the new task to be running + the old task drained
AWS_PROFILE=prod aws ecs wait services-stable \
  --cluster prod-basic --services identitybasic \
  --region ap-south-1
echo "ECS services-stable confirmed at $(date)"
```

**Expected duration:** 5-8 min (rolling with `desiredCount=1` means old task drains before new task starts — brief unavailability window of ~30-60s on the `/identity` path; existing connections from rproxy keep working).

**Verify deploy landed:**

```bash
# Latest task definition revision number should have incremented
AWS_PROFILE=prod aws ecs describe-services \
  --cluster prod-basic --services identitybasic --region ap-south-1 \
  --query 'services[0].{deployments:deployments[].{taskDef:taskDefinition,status:status,runningCount:runningCount,desiredCount:desiredCount}}' \
  --output table
# Expected: one PRIMARY deployment, runningCount=1, desiredCount=1
```

### G1.c — Monitor window (7 min, NON-NEGOTIABLE)

Saraswati pilot is live in prod-basic and shares this ECS service. Watch CloudWatch for 5xx spikes or p95 regression before proceeding.

```bash
# Recent 5xx errors on the identity ALB target group (manual eyeball)
AWS_PROFILE=prod aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name HTTPCode_Target_5XX_Count \
  --dimensions Name=TargetGroup,Value=$(aws elbv2 describe-target-groups --region ap-south-1 --query "TargetGroups[?contains(TargetGroupName,'identity')].TargetGroupArn | [0]" --output text | awk -F: '{print $6}') \
  --start-time $(date -u -v-10M +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 --statistics Sum --region ap-south-1
# Expected: Sum=0 across the 10-minute window OR pre-existing baseline (compare to a 24h-ago snapshot if unsure)

# Or open the CloudWatch dashboard manually:
# https://ap-south-1.console.aws.amazon.com/cloudwatch/home?region=ap-south-1
# Watch the "EdForge prod pilot dashboard" for 5xx spikes for 5-7 minutes
```

**Stop gate:** if 5xx > pre-deploy baseline OR p95 latency > 1s sustained → **rollback G1**:

```bash
# Find the prior good task definition revision
AWS_PROFILE=prod aws ecs list-task-definitions --family-prefix identity \
  --sort DESC --max-items 5 --region ap-south-1
# Roll back to revision N-1
PREV_REVISION=<N-1>
AWS_PROFILE=prod aws ecs update-service \
  --cluster prod-basic --service identitybasic \
  --task-definition identity:${PREV_REVISION} \
  --force-new-deployment --region ap-south-1
```

If 5xx clean → **proceed to G2.**

---

## G2 — C0.b.2 cleanup `--apply` (~10 min)

Removes the 4 residual S3.2 smoke artifacts in `dev-pabson-primary` (2 stuck Leave rows + 2 calendar `S32-SMOKE-*` rows). Pure ops — touches `dev-pabson-primary` only (NOT the live Saraswati tenant).

### G2.a — Dry-run inspection (read-only)

```bash
AWS_PROFILE=prod npx ts-node \
  scripts/cleanup-orphans/s3-2-smoke-artifacts.ts \
  --tenant ${TENANT_ID}
# Expected output (must match before --apply):
#   CALENDAR (S32-SMOKE-*) rows: 2
#   LEAVE (reason ~ "S3.2 smoke") rows: 2
#   Total artifacts: 4
```

**Stop gate:** if count > 4 → investigate. The script's marker pattern (`S32-SMOKE-` + `S3.2 smoke`) should be distinctive; an unexpected match could indicate a real operator-created row was mis-marked. **Do not proceed to `--apply` until you understand every candidate.**

### G2.b — Attach temp `DeleteItem` IAM policy

Per the [Sprint 0.5 README](../../scripts/cleanup-orphans/README.md) recipe. One-line inline policy on `edforge-prod-deployer` (or whichever IAM principal you're using):

```bash
POLICY_DOC=$(cat <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["dynamodb:DeleteItem"],
    "Resource": "arn:aws:dynamodb:ap-south-1:257526644020:table/edforge-identity-basic"
  }]
}
EOF
)
AWS_PROFILE=prod aws iam put-user-policy \
  --user-name edforge-prod-deployer \
  --policy-name TempC0b2DeleteItem \
  --policy-document "$POLICY_DOC"
```

### G2.c — Apply

```bash
AWS_PROFILE=prod npx ts-node \
  scripts/cleanup-orphans/s3-2-smoke-artifacts.ts \
  --tenant ${TENANT_ID} --apply
# Expected: Result: deleted=4, errored=0
# Audit log lands at ${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-s3-2-smoke-cleanup-<ts>-APPLY.log
```

### G2.d — Verify + detach policy

```bash
# Re-run dry-run; expect "No artifacts found. Nothing to do."
AWS_PROFILE=prod npx ts-node \
  scripts/cleanup-orphans/s3-2-smoke-artifacts.ts \
  --tenant ${TENANT_ID}

# Keep DeleteItem policy attached for now — we'll need UpdateItem next
# (or detach now and re-attach for G3 if you prefer strict least-privilege)
```

---

## G3 — C0.b.5 migration `--apply` (~10 min)

Rewrites every `testing_day` calendarEvent → `exam_window` across the entire DDB table (all tenants, not just dev-pabson-primary — the schema removal applies globally).

### G3.a — Dry-run scan

```bash
AWS_PROFILE=prod npx ts-node \
  scripts/migrations/testing-day-to-exam-window.ts
# Expected:
#   ⇒ N rows have testing_day events  (N could be 0 if no historical residue)
#   Audit log: ${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-testing-day-migration-<ts>-DRYRUN.log
```

**Note:** if `N=0`, the migration is a no-op. **Skip G3.b/G3.c and proceed to G4.**

### G3.b — Attach temp `UpdateItem` policy

```bash
POLICY_DOC=$(cat <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["dynamodb:UpdateItem"],
    "Resource": "arn:aws:dynamodb:ap-south-1:257526644020:table/edforge-identity-basic"
  }]
}
EOF
)
AWS_PROFILE=prod aws iam put-user-policy \
  --user-name edforge-prod-deployer \
  --policy-name TempC0b5UpdateItem \
  --policy-document "$POLICY_DOC"
```

### G3.c — Apply

```bash
AWS_PROFILE=prod npx ts-node \
  scripts/migrations/testing-day-to-exam-window.ts --apply
# Expected: Result: migrated=N, errored=0
# Audit log: ${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-testing-day-migration-<ts>-APPLY.log
```

### G3.d — Verify idempotency + detach policies

```bash
# Re-run dry-run; expect "0 rows have testing_day events"
AWS_PROFILE=prod npx ts-node \
  scripts/migrations/testing-day-to-exam-window.ts

# Detach both temp policies — least privilege restored
AWS_PROFILE=prod aws iam delete-user-policy \
  --user-name edforge-prod-deployer \
  --policy-name TempC0b2DeleteItem
AWS_PROFILE=prod aws iam delete-user-policy \
  --user-name edforge-prod-deployer \
  --policy-name TempC0b5UpdateItem

# Verify both detached
AWS_PROFILE=prod aws iam list-user-policies \
  --user-name edforge-prod-deployer
# Expected: PolicyNames should NOT include TempC0b2DeleteItem or TempC0b5UpdateItem
```

---

## G4 — Harness 6/6 run (~10 min)

Runs the pilot-greenlight harness (`scripts/smoke-tests/pilot-greenlight.ts`). After PR #103's SETUP step seeds the 3 missing Terms, **expects 🟢 INTERNAL GREENLIGHT — all smokes pass.**

```bash
# Confirm env vars still in shell from pre-flight
echo "PILOT_ID=$PILOT_ID"
echo "TENANT_ID=$TENANT_ID"
echo "SCHOOL_ID=$SCHOOL_ID"
echo "ACADEMIC_YEAR_ID=$ACADEMIC_YEAR_ID"
echo "STAFF_ID=$STAFF_ID"
echo "STUDENT_ID=$STUDENT_ID"

# Run the harness, tee output to deploys/
LOG="${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-smoke-pilot-greenlight-harness-$(date +%Y%m%d-%H%M%S)-${SHA}.log"
AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
  scripts/smoke-tests/pilot-greenlight.ts 2>&1 | tee "$LOG"
```

**Expected final lines:**
```
  ▸ pabson-saraswati-bs-2083: 6 passed, 0 failed, 0 skipped
    ✓ SETUP — pilot term seeder (idempotent) — exit 0
    ✓ C2.0 write-path skeleton — exit 0
    ✓ C2.1 instructional-days count — exit 0
    ✓ C2.2 shift-profile parity — exit 0
    ✓ C2.3 exam-window containment — exit 0
    ✓ C2.4 holiday exclusion — exit 0
    ✓ C2.5 edge cases — exit 0

🟢 INTERNAL GREENLIGHT — all smokes pass.
```

**Note:** the per-pilot block shows 6 verification smokes; the SETUP step counts separately (it's setup, not verification). Verdict line should say "6 passed" or "7 passed depending on SETUP counting".

### G4 contingency — if anything red

| Failure | Likely cause | Action |
| --- | --- | --- |
| SETUP fails | identity not actually deployed; or grading-periods endpoint regression | check `/grading-periods` returns 200 via curl; rollback G1 if so |
| C2.0 fails | identity deploy broke audit-write path | rollback G1; investigate before retry |
| C2.1 fails | seeder did not run OR holiday seed mismatch from C2.1 fixture | re-run `seed-pilot-calendar.ts` (#95) |
| C2.2 / C2.3 fail | SETUP didn't actually create the missing 3 Terms | inspect the harness log's SETUP section; re-run G4 |
| C2.4 fails | academics deploy missing OR student_id env var stale | confirm STUDENT_ID exists; this would be surprising — academics is already deployed |
| C2.5 fails | one of the edge dates regressed | inspect log; usually a fixture issue not a code issue |

**On red:** capture the failing smoke's section from the log + send. Don't retry blindly.

---

## Post-G4 — Close the loop (~5 min)

Once G4 is 🟢:

1. **Tee log already lives in `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}`** — keep it private and add only sanitized notes to `docs/deploys/INDEX.md`. I'll handle the §0.5 close-out doc PR from your sanitized notes.

2. **Detach this runbook from active session** — file is durable; we'll preserve it for the C3 sprint deploy ladder + future operator handoffs.

3. **Notify on internal greenlight** — call me back with "G4 green" and I'll:
   - Open the §0.5 close-out PR (Phase B → ✅; Sprint C2 verdict captured with the harness log link)
   - Cut the C3.7 PR (BS↔AD property test — the first C3 ticket, smallest + highest insurance value)

---

## Rollback summary (per-step)

| Step | If it goes wrong | Rollback |
| --- | --- | --- |
| Pre-flight | JWT stale / env var missing | Re-fetch / re-export. No AWS state touched yet. |
| G1.a | Docker build / ECR push fails | Re-run from `scripts/`. If persistent, see deploy logs. |
| G1.b | ECS rolling deploy fails | CFN auto-rolls back; or manual: `update-service --task-definition identity:N-1` |
| G1.c | 5xx spike detected | `update-service --task-definition identity:N-1` |
| G2 | Unexpected candidate count | Don't `--apply`. Investigate row identities first. |
| G2.c | DeleteItem errors mid-run | Audit log shows which rows failed; re-run is idempotent (already-deleted rows just return) |
| G3 | Unexpected high count | Don't `--apply`. Migration is irreversible from the source-data side — but DDB PITR could restore. **Make sure point-in-time recovery is on first.** |
| G3.c | UpdateItem errors mid-run | Re-run is idempotent (rows already migrated have no `testing_day` events) |
| G4 | Any smoke red | Above table. Do NOT proceed to "C3 work" until green. |

---

## Time budget

| Step | Time |
| --- | --- |
| Pre-flight | 5 min |
| G1 (a+b+c) | 15 min + 7 min monitor = **22 min** |
| G2 (a+b+c+d) | 10 min |
| G3 (a+b+c+d) | 10 min |
| G4 | 10 min |
| Post-G4 + commit logs | 5 min |
| **Total** | **~60 min** focused operator time |
