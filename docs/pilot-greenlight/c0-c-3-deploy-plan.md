# C0.c.3 — Deploy + End-to-End Test Plan

> **Status:** ready for operator sign-off. No `aws --profile prod ...` commands have been executed. Each phase below has explicit go/no-go gates; nothing proceeds without the operator's authorization.
>
> **What's being deployed:** PR [#76](https://github.com/shoaibrain/edforge/pull/76) — runtime payload validation gate in [`EventServiceBase`](../../server/application/libs/events/src/event-service.base.ts). All three microservices that extend it (identity / academics / finance) need the new image.
>
> **Risk profile (low):**
> - No infrastructure change. No CDK deploy. No DDB schema change. No IAM change.
> - The validation gate currently sees **only legacy PascalCase events** in prod (the registry's 25 snake-dotted event types have zero emit-site callers yet — they land in Sprints C5 / C7 / C9). So the runtime effect is: **every existing emit logs one new `Emitting unregistered eventType` warning**, then proceeds as before. No INVALID_PAYLOAD path is exercised by current traffic.
> - The risky failure mode would be a bug in `validateBeforeEmit` itself; the 14/14 spec coverage in [`event-service.base.spec.ts`](../../server/application/libs/events/src/event-service.base.spec.ts) is the defense.
> - Rollback is fast (re-tag prior ECR image as `:latest`, force-new-deployment — <5 min).

---

## 1. Pre-deploy gates

All must pass on the operator's machine before Phase 1 starts. Each gate is read-only or local; nothing here touches prod.

### 1.1 Sync + freshness checks

```bash
cd /Users/shoaibrain/edforge
git checkout main
git pull --ff-only origin main
git log -1 --oneline    # MUST show PR #76 in the recent merge chain
```

**Pass criterion:** the merge commit for PR #76 ("C0.c.3 runtime event validation") appears in `git log main..HEAD` against the operator's recollection of recent merges.

### 1.2 npm registry confirms the shared-types pin resolves

```bash
npm view @aibrains/shared-types version
# expected: 0.43.0

grep '@aibrains/shared-types' server/application/package.json
# expected: "@aibrains/shared-types": "^0.43.0"
```

**Why this matters:** the Dockerfile build does `npm install --legacy-peer-deps --no-optional` and resolves shared-types from the registry. If 0.43.0 is missing from npm OR the pin is stale, the Docker build will resolve the wrong version and `validateEvent` won't exist.

**Pass criterion:** both lines match the expected values.

### 1.3 Local jest + tsc green on main

```bash
cd server/application
npx jest libs/events --no-coverage
# expected: Test Suites: 1 passed / Tests: 14 passed

npx tsc --noEmit
# expected: clean (no output)
```

**Pass criterion:** both green.

### 1.4 AWS profile + region verification

```bash
AWS_PROFILE=prod aws sts get-caller-identity --query Account --output text
# expected: 257526644020   (per CLAUDE.md prod account)

AWS_PROFILE=prod aws configure get region
# expected: ap-south-1     (per CLAUDE.md prod region)
```

**Pass criterion:** both match. **Stop here if either deviates** — running the wrong profile against the wrong account is exactly the failure mode the env-profile section of CLAUDE.md exists to prevent.

### 1.5 `service-info.json` substitution check

```bash
grep -E '<REGION>|<ACCOUNT_ID>' server/lib/service-info.json
# expected: NO matches (substitution already done for prod)
```

If matches appear, the wrapper substitutes them. See [`scripts/deploy.sh:56-67`](../../scripts/deploy.sh) for the pre-flight. For an ECR-only push without a CDK deploy this is less critical (`service-info.json` is consumed at synth time, not at `docker build` time), but worth confirming so we don't carry forward a stale artifact.

**Pass criterion:** no placeholder matches, OR operator confirms the wrapper will handle them on a subsequent CDK invocation.

### 1.6 Operator JWT for the smoke test

Per memory [`feedback_just_ask_for_a_prod_token`](../../memory): the only safe way to validate the deployed service end-to-end is a **real prod JWT** for a dev tenant. ECR digest + ECS stable + Vercel last-modified is theatre.

**The operator provides** before Phase 1 starts:
- Prod TenantAdmin JWT for the **`dev-pabson-primary` tenant** (per memory `project_dev_tenant_system_sprint_3_shipped` — already provisioned, has `tenantTag=internal-dev`, safe for smoke testing).
- File the JWT into `/private/tmp/c0-c-3-prod-jwt.txt` (per memory `project_grade_level_fix_T4_shipped` retro: never hand-paste JWTs into heredocs; use a file).

**Pass criterion:** JWT file exists, readable, decodes to a TenantAdmin role for the expected tenantId.

### 1.7 ECR lifecycle sanity check

```bash
AWS_PROFILE=prod aws ecr describe-images \
  --repository-name identity \
  --query 'reverse(sort_by(imageDetails,& imagePushedAt))[:5].{tags:imageTags,pushed:imagePushedAt}' \
  --output table --region ap-south-1
```

**Why:** confirm the **current `:latest`** image's gitsha tag (we need this for the rollback path). Note it down — call it `IDENTITY_ROLLBACK_TAG`.

**Pass criterion:** the operator records the prior `<gitsha>-<timestamp>` tag for identity (and later, academics + finance).

---

## 2. Phase 1 — Identity (canary)

Identity carries the most events in prod (~30 publishers across schools/users/roles/IEMIS). Roll it first; verify; only then proceed to the other services.

### 2.1 Build + push identity to ECR

```bash
cd /Users/shoaibrain/edforge
TS=$(date +%Y%m%d-%H%M%S)
SHA=$(git rev-parse --short HEAD)
LOG="docs/deploys/prod-build-application-identity-${TS}-${SHA}.log"

AWS_PROFILE=prod ./scripts/build-application.sh identity 2>&1 | tee "$LOG"
```

**Important:** invoke from the repo root, not from `scripts/`. Per memory `project_grade_level_fix_T4_shipped` retro: `build-application.sh` is CWD-fragile; running from `scripts/` produces a confusing fail.

**Pass criterion:**
- Exit code 0 (the script's `set -euo pipefail` will abort on any docker/aws error).
- Log shows `Pushed: <account>.dkr.ecr.ap-south-1.amazonaws.com/identity:latest`.
- Log shows `Pushed: <account>.dkr.ecr.ap-south-1.amazonaws.com/identity:<sha>-<ts>`.
- **Stop here if either tag failed to push.**

### 2.2 Force ECS service to pull the new image

```bash
TS=$(date +%Y%m%d-%H%M%S)
SHA=$(git rev-parse --short HEAD)
LOG="docs/deploys/prod-ecs-roll-identitybasic-${TS}-${SHA}.log"

AWS_PROFILE=prod aws ecs update-service \
  --cluster prod-basic \
  --service identitybasic \
  --force-new-deployment \
  --region ap-south-1 2>&1 | tee "$LOG"
```

**Pass criterion:** API returns a service descriptor with `desiredCount: 1`, `runningCount` may still be 1 (the old task) at this instant. ECS is now provisioning a new task.

### 2.3 Wait for ECS service stable

```bash
AWS_PROFILE=prod aws ecs wait services-stable \
  --cluster prod-basic --services identitybasic --region ap-south-1
```

Typical duration: 3-5 minutes (one task replaced). The command blocks until both:
- New task `RUNNING` with health checks passing
- Old task `STOPPED`

**Pass criterion:** the command exits 0 within 10 minutes. If it times out, see Section 4 (Rollback).

### 2.4 Confirm the new task is on the new image

```bash
TASK_ARN=$(AWS_PROFILE=prod aws ecs list-tasks \
  --cluster prod-basic --service-name identitybasic \
  --desired-status RUNNING --region ap-south-1 \
  --query 'taskArns[0]' --output text)

AWS_PROFILE=prod aws ecs describe-tasks \
  --cluster prod-basic --tasks "$TASK_ARN" --region ap-south-1 \
  --query 'tasks[0].containers[*].{name:name,image:image}' --output table
```

**Pass criterion:** the `image` column for the identity container ends in `:<sha>-<ts>` matching the tag we just pushed in 2.1 — confirms ECS is running the new code, not a stale cached image.

---

## 3. Phase 2 — CloudWatch verification window (~10 min)

After identity is stable, **before** rolling academics/finance, watch CloudWatch for ~10 minutes to confirm the new validation gate behaves as designed.

### 3.1 Tail the identity log group

```bash
# Find the identity log group
AWS_PROFILE=prod aws logs describe-log-groups \
  --log-group-name-prefix '/ecs/prod-basic' --region ap-south-1 \
  --query 'logGroups[?contains(logGroupName, `identity`)].logGroupName' --output text

# Tail it (substitute the log group name from above)
AWS_PROFILE=prod aws logs tail '/ecs/prod-basic/identitybasic' \
  --follow --region ap-south-1 --since 5m
```

### 3.2 What to look for (success vs. failure signals)

| Pattern | Expected count | Interpretation |
|---|---|---|
| `Emitting unregistered eventType` | **>0** (one per emit) | ✅ **GOOD** — legacy PascalCase branch is firing. This is the proof that C0.c.3's validation gate runs without breaking the live event flow. |
| `Event payload validation failed — skipping emit` | **0** | ✅ GOOD — no current publisher emits a snake-dotted eventType with a malformed payload (because no current publisher emits snake-dotted at all). |
| `EventService initialized with bus:` | **=1** per task | ✅ GOOD — the new code constructed correctly. |
| `CRITICAL: EVENT_BUS_NAME environment variable is not set` | **0** | If >0: **STOP** — the task did not receive the env var. Investigate `service-info.txt` substitution. |
| 5xx in API Gateway response logs | **no spike** vs. prior 10-min baseline | If spike: **STOP** — initiate rollback (Section 4). |
| `Error publishing event to EventBridge` | **no spike** vs. baseline | A handful per hour is normal (transient EventBridge throttling); a flood indicates something broken. |

### 3.3 Cross-check audit log writes

The new validation gate must NOT have broken the `auditedWrite` path. Audit rows are the source of truth for write operations; if the event emission failure-mode regressed and started throwing instead of skipping, audit writes would back up.

Pick a recent audit row via DDB query and confirm `createdAt` is post-deploy:

```bash
AWS_PROFILE=prod aws dynamodb query \
  --table-name edforge-identity-basic \
  --key-condition-expression 'tenantId = :t AND begins_with(entityKey, :sk)' \
  --expression-attribute-values "$(cat <<EOF
{":t":{"S":"21aea5da-..."},":sk":{"S":"AUDIT#"}}
EOF
)" \
  --limit 5 --scan-index-forward false --region ap-south-1 \
  --query 'Items[*].{eventType:eventType.S,createdAt:createdAt.S}' --output table
```

(Replace `21aea5da-...` with the dev-pabson-primary tenantId.)

**Pass criterion:** the most-recent audit row's `createdAt` is post-deploy timestamp, confirming writes still flow.

### 3.4 Go/No-Go decision at end of monitoring window

| Outcome | Action |
|---|---|
| All ✅ in 3.2 + 3.3 | **GO** for Phase 4 (academics + finance) |
| 5xx spike OR EventBridge publish flood OR audit writes back up | **NO-GO** — execute Section 4 rollback |
| Borderline (small uptick, unclear) | **HOLD** — extend the monitoring window another 10 min; do not roll academics/finance yet |

---

## 4. Rollback (Phase 1 only — abort before academics/finance)

If Phase 2 verification fails, roll identity back to the prior good image. This is fast; total downtime is the ECS rolling-update window (~3-5 min) plus the time to issue the commands.

### 4.1 Re-tag the prior digest as `:latest`

`IDENTITY_ROLLBACK_TAG` was recorded in step 1.7.

```bash
AWS_PROFILE=prod aws ecr batch-get-image \
  --repository-name identity --image-ids imageTag="${IDENTITY_ROLLBACK_TAG}" \
  --region ap-south-1 --query 'images[].imageManifest' --output text > /tmp/identity-rollback-manifest.json

AWS_PROFILE=prod aws ecr put-image \
  --repository-name identity --image-tag latest \
  --image-manifest "$(cat /tmp/identity-rollback-manifest.json)" --region ap-south-1
```

### 4.2 Force ECS to pull the re-tagged `:latest`

```bash
LOG="docs/deploys/prod-ecs-roll-identitybasic-ROLLBACK-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD).log"

AWS_PROFILE=prod aws ecs update-service \
  --cluster prod-basic --service identitybasic --force-new-deployment \
  --region ap-south-1 2>&1 | tee "$LOG"

AWS_PROFILE=prod aws ecs wait services-stable \
  --cluster prod-basic --services identitybasic --region ap-south-1
```

### 4.3 Document the failure

- Capture relevant CloudWatch log excerpts under `docs/deploys/prod-failure-c0-c-3-identity-<ts>-<sha>.log`.
- File a follow-up ticket against `EventServiceBase` with the failure signal.

---

## 5. Phase 3 — Academics + Finance (only after Phase 2 GREEN)

Once identity has been stable on the new image for ≥10 minutes with no anomalies, repeat the build + roll + wait + verify cycle for academics and finance.

### 5.1 Parallel build + push

```bash
# In two parallel terminals or backgrounded:
TS=$(date +%Y%m%d-%H%M%S)
SHA=$(git rev-parse --short HEAD)

AWS_PROFILE=prod ./scripts/build-application.sh academics 2>&1 | tee "docs/deploys/prod-build-application-academics-${TS}-${SHA}.log"
AWS_PROFILE=prod ./scripts/build-application.sh finance   2>&1 | tee "docs/deploys/prod-build-application-finance-${TS}-${SHA}.log"
```

### 5.2 Roll both services (parallel)

```bash
TS=$(date +%Y%m%d-%H%M%S)
SHA=$(git rev-parse --short HEAD)

AWS_PROFILE=prod aws ecs update-service --cluster prod-basic --service academicsbasic \
  --force-new-deployment --region ap-south-1 2>&1 | tee "docs/deploys/prod-ecs-roll-academicsbasic-${TS}-${SHA}.log"

AWS_PROFILE=prod aws ecs update-service --cluster prod-basic --service financebasic \
  --force-new-deployment --region ap-south-1 2>&1 | tee "docs/deploys/prod-ecs-roll-financebasic-${TS}-${SHA}.log"

AWS_PROFILE=prod aws ecs wait services-stable \
  --cluster prod-basic --services academicsbasic financebasic --region ap-south-1
```

### 5.3 Verify both services on new images

Repeat Section 2.4 against academicsbasic and financebasic. Both image tags should end in the new `<sha>-<ts>`.

### 5.4 Tail CloudWatch for both, same 10-min window, same signals

Same patterns as Section 3.2 — `Emitting unregistered eventType` warnings expected for legacy events; zero `INVALID_PAYLOAD`; no 5xx spike.

---

## 6. Phase 4 — End-to-end smoke testing

After all three services are stable on the new image, run the comprehensive smoke suite to validate that **no live functionality regressed**.

### 6.1 Smoke selection

These three smokes collectively exercise every microservice that uses `EventServiceBase`:

| Smoke | Covers | Why it matters for C0.c.3 |
|---|---|---|
| [`scripts/smoke-tests/identity-service-flow.ts`](../../scripts/smoke-tests/identity-service-flow.ts) | identity service end-to-end (schools, users, roles) | Exercises ~15 emit sites — proves legacy-warning branch + audited writes still flow |
| [`scripts/smoke-tests/academics-full-flow.ts`](../../scripts/smoke-tests/academics-full-flow.ts) | academics service (students, enrollments, attendance) | Exercises ~20 emit sites including bulk attendance batching — validates `publishEvents` batch path under new gate |
| [`scripts/smoke-tests/finance-e2e-comprehensive.ts`](../../scripts/smoke-tests/finance-e2e-comprehensive.ts) | finance service (invoices, payments, ledger) | Exercises ~14 emit sites including the recent C2.B-T4 atomic payment transaction |

Plus the most-recent baseline:

| Smoke | Covers | Why |
|---|---|---|
| [`scripts/smoke-tests/s3-2-gsi-casing-roundtrip.ts`](../../scripts/smoke-tests/s3-2-gsi-casing-roundtrip.ts) | StaffTraining + Leave + Calendar + Credential GSI1 write-path | Latest known-green prod smoke (32/33 on 2026-05-14); re-run gives us an apples-to-apples regression signal |

### 6.2 Run order + criteria

```bash
export ADMIN_TOKEN="$(tr -d '\n\r ' < /private/tmp/c0-c-3-prod-jwt.txt)"
export API_BASE="https://w5ulch7iyf.execute-api.ap-south-1.amazonaws.com/prod"
export TENANT_ID="<dev-pabson-primary tenantId>"

TS=$(date +%Y%m%d-%H%M%S)
SHA=$(git rev-parse --short HEAD)

AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
  scripts/smoke-tests/identity-service-flow.ts \
  2>&1 | tee "docs/deploys/prod-smoke-identity-c0-c-3-${TS}-${SHA}.log"

AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
  scripts/smoke-tests/academics-full-flow.ts \
  2>&1 | tee "docs/deploys/prod-smoke-academics-c0-c-3-${TS}-${SHA}.log"

AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
  scripts/smoke-tests/finance-e2e-comprehensive.ts \
  2>&1 | tee "docs/deploys/prod-smoke-finance-c0-c-3-${TS}-${SHA}.log"

# The S3.2 GSI smoke needs additional env vars (STAFF_ID, SCHOOL_ID,
# ACADEMIC_YEAR_ID); operator sets them from prior dev-tenant state
# before running.
AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
  scripts/smoke-tests/s3-2-gsi-casing-roundtrip.ts \
  2>&1 | tee "docs/deploys/prod-smoke-s3-2-roundtrip-c0-c-3-${TS}-${SHA}.log"
```

### 6.3 Pass criteria for Phase 4

- All four smoke scripts exit 0.
- No new `5xx` responses captured in their logs.
- Each smoke's audited operations (typically 5-15 writes) produce the same audit-row count post-deploy as the smoke documents pre-deploy.
- CloudWatch tail (still running) shows `Emitting unregistered eventType` warnings tracking the smoke's emit count — confirms validation gate is firing for each event.
- Zero `INVALID_PAYLOAD` log lines anywhere.

### 6.4 What we are NOT testing (and why)

- **No smoke for the snake-dotted registered-event path.** No current production emit site uses `school.created` / `attendance.recorded` / etc. — they're the C0.c.2 target taxonomy that lands in C5 / C7 / C9. A synthetic call to `publishValidatedEvent({eventType: 'school.created', ...})` from a test endpoint would prove the validated path works, but we don't have such an endpoint. The 14/14 spec coverage is the next-best evidence; Phase 4 confirms the legacy branch + the no-regression invariant.
- **No INVALID_PAYLOAD smoke.** Same reason — no production traffic exercises it. The spec at `event-service.base.spec.ts` is the canonical evidence that the skip + DLQ path works.

---

## 7. Post-deploy bookkeeping

Once Phase 4 passes:

1. **Update `docs/deploys/INDEX.md`** (does not exist yet — create as part of this deploy). Add a section for the C0.c.3 deploy with links to:
   - `prod-build-application-identity-...log`
   - `prod-build-application-academics-...log`
   - `prod-build-application-finance-...log`
   - `prod-ecs-roll-identitybasic-...log`
   - `prod-ecs-roll-academicsbasic-...log`
   - `prod-ecs-roll-financebasic-...log`
   - `prod-smoke-{identity,academics,finance,s3-2-roundtrip}-c0-c-3-...log`

2. **Append to [`sprint-closeouts.md`](sprint-closeouts.md)** — under the C0.c entry, add a "Deployed: 2026-MM-DD" line referencing the deploy logs.

3. **No memory updates required** — the deploy doesn't change any of the durable architecture facts already captured.

---

## 8. Operator deliverables — what I need from you before Phase 1

Before any `aws --profile prod ...` command runs:

- [ ] Confirm pre-deploy gate 1.4 (account = 257526644020, region = ap-south-1).
- [ ] Confirm `IDENTITY_ROLLBACK_TAG` (latest known-good identity image tag) — recorded for the rollback path.
- [ ] Provide prod TenantAdmin JWT for `dev-pabson-primary` tenant, written to `/private/tmp/c0-c-3-prod-jwt.txt`.
- [ ] Authorize me to execute Section 2 (Phase 1 identity deploy). I will not proceed past Phase 1 without an explicit "academics + finance: GO" after the Phase 2 verification window.

Once authorized, my execution sequence is:
**1.1 → 1.5 (all pre-flight) → 2.1 (build) → 2.2 (roll) → 2.3 (wait) → 2.4 (verify image) → 3.1 (tail) → 10-min watch → GO/NO-GO →** if GO: 5 (academics + finance) → 6 (smokes) → 7 (bookkeeping).

If anything fails along the way, I stop and report — I do not improvise.
