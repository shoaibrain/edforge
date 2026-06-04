# GB2 deploy prompt — board-exam seeding + curriculum default + exam-pattern

Filled instantiation of [`REPEATABLE-app-code-deploy-prompt.md`](./REPEATABLE-app-code-deploy-prompt.md),
**extended for the infra leg** (this deploy is NOT app-only — see below). Hand to
the deploy agent on the operator Mac (`server/.env.prod`, AWS creds, Docker).

## Params

| Param | Value |
|---|---|
| Sprint / PRs | GB2.1–2.5 — #249, #250, #251 |
| Merge commit on `main` | `<sha — git rev-parse --short HEAD on main after pull>` |
| shared-types publish | **none** (no `packages/shared-types` change) |
| Service(s) to roll | **academics** (only) |
| **Infra** (`cdk diff`) | **`shared-infra-stack` is NON-EMPTY** — `tenant-api-prod.json` added 2 API GW paths. `tenant-template-stack-basic` MUST be empty. |
| Smoke script | `scripts/smoke-tests/gb2-seeding.ts` |
| Smoke tenant archetype | `PABSON` (use **dev-pabson-primary** first) |

> ⚠️ **Why this is two-stack, not app-only:** GB2.3 + GB2.5 added
> `/academics/board-exams` and `/academics/exams/exam-pattern` to
> `server/lib/tenant-api-prod.json`. Per the CLAUDE.md change-to-deploy matrix,
> API Gateway routes deploy via **`shared-infra-stack`**. If you only roll
> academics, both endpoints return **403 SigV4** (API GW falls through to its IAM
> default). Deploy order: **shared-infra-stack (infra, order 1) → academics ECR
> push + ECS roll (app, order 2)**.

## Steps

**Do not run any `aws` / `cdk deploy` command until the diffs are reviewed and the prod deploy is explicitly authorized.** Tee every command to `docs/deploys/prod-<action>-<target>-$TS-$SHA.log`.

### 0 · Sync + LOCAL gates (read-only)
```bash
cd ~/edforge && git checkout main && git pull origin main
SHA=$(git rev-parse --short HEAD); TS=$(date -u +%Y%m%d-%H%M%S)
cd server/application && npx nest build academics   # typecheck
npm run lint                                          # lint (CLAUDE.md local gates)
npx jest board-exams.service exams.service.spec courses.service.spec   # unit tests
cd ../../server && source .env.prod
CDK_NAG_ENABLED=false npx cdk diff tenant-template-stack-basic   # expect EMPTY
CDK_NAG_ENABLED=false npx cdk diff shared-infra-stack            # expect ONLY +/academics/board-exams, +/academics/exams/exam-pattern (GET+OPTIONS)
```
`tenant-template-stack-basic` non-empty → STOP (unexpected DDB/IAM). `shared-infra-stack` showing anything beyond the two new paths → STOP.

### 1 · Cross-stack export pre-flight (shared-infra-stack has exports)
```bash
aws cloudformation list-exports \
  --query "Exports[?contains(ExportingStackId,'shared-infra-stack')].{Name:Name,Value:Value}" > /tmp/exports-before.json
```
Adding API GW **paths** (operations on the existing API resource) does not change
the API GW id/URL export **value** — expect a no-op. If any export VALUE changes
AND has importers (`aws cloudformation list-imports --export-name <name>`) → STOP
(CLAUDE.md cross-stack pre-flight).

### 2 · Deploy — infra first, then app (after authorization)
```bash
cd ~/edforge/server
# (1) API Gateway routes — via the wrapper (repo-wide despite the name), NOT raw cdk deploy
./scripts/deploy-analytics.sh shared-infra-stack prod 2>&1 | tee ../docs/deploys/prod-deploy-shared-infra-$TS-$SHA.log

# (2) academics image + ECS roll
source .env.prod
./scripts/build-application.sh academics 2>&1 | tee ../docs/deploys/prod-build-application-academics-$TS-$SHA.log
export CDK_BASIC_CLUSTER="$CDK_PARAM_STAGE-$CDK_PARAM_TIER"   # prod-basic
SVC=$(aws ecs list-services --cluster "$CDK_BASIC_CLUSTER" --query "serviceArns[?contains(@,'academics')]" --output text); SVC=${SVC##*/}
aws ecs update-service --cluster "$CDK_BASIC_CLUSTER" --service "$SVC" --force-new-deployment \
  2>&1 | tee ../docs/deploys/prod-ecs-roll-academics-$TS-$SHA.log
```
Verify the roll the way the retros say (NOT `rolloutState: COMPLETED`): new task
`healthStatus: HEALTHY`, image digest matches the push, academics log group shows
a clean Nest bootstrap (no `Cannot resolve dependencies` / `MODULE_NOT_FOUND`).

### 3 · Smoke (prod) — dev-pabson first
```bash
export GB2_JWT_FILE=/path/to/dev-pabson-jwt.txt
export GB2_SCHOOL_ID=<existing PABSON schoolId in that tenant>
export GB2_BASE_URL=https://<prod-api-gw>/prod
TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' \
  npx ts-node scripts/smoke-tests/gb2-seeding.ts 2>&1 | tee docs/deploys/prod-smoke-gb2-$TS-$SHA.log
```
Checks: board-exams seed-on-empty (BLE+SEE, idempotent), exam-pattern (PABSON
5-key set), course curriculumRef defaults to `CDC_NCF_2076` (smoke course
soft-deleted). A `403` on board-exams/exam-pattern → the shared-infra route
didn't register (re-check step 2.1). On any FAIL: STOP, don't flip INDEX, capture
the request/response + service log line — no code fix in the deploy session.

### 4 · Record + rollback
Write `docs/deploys/prod-gb2-deploy-summary-$TS-$SHA.md`, flip INDEX.md 🟢,
capture the **prior academics ECR digest** as the rollback target. Rollback:
re-tag prior academics `:latest` + `--force-new-deployment`; `shared-infra`
rollback is a re-deploy of the prior `tenant-api-prod.json`. **No data heal
needed** — board-exam seeding is purely additive; curriculum default only fills
an otherwise-unset field on new courses.

## Notes
- **GB2.6 (re-seed CloudWatch alarm) is deferred** — it's an additional
  `tenant-template-stack-basic` change. Not in this deploy; rides a later roll.
- **GB2.9 backfill not required for this deploy** — board-exam seeding is
  self-healing on first list-view, so already-provisioned schools seed on demand.
