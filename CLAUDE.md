# EdForge — Claude Code project rules

Durable rules for working in this repo. Loaded automatically by every Claude Code session, so keep it tight.

**Scope in V1 MVP:** `BASIC` tier only, `PABSON` (Nepal) archetype as first pilot, single AWS region per environment, UAT and prod as the two live profiles. Advanced/Premium tiers + multi-region are intentional `V1_DEFERRED` — don't mistake the dormant code for dead code.

---

## Architecture at a glance

EdForge is an AWS SBT (SaaS Builder Toolkit) + ECS Fargate multi-tenant SaaS for K-12 schools. NestJS microservices on the backend, React MFE on the frontend, DynamoDB for persistence, EventBridge for event-driven fan-out.

### CDK stack topology (deploy order)

```
shared-infra-stack           ← VPC, ALB, NLB, API Gateway, tenant-mapping DDB, CloudFront (AdminWeb),
                               Lambda layers, EventDLQ sub-stack
   └── controlplane-stack    ← Cognito User Pool (system-admin), SBT EventBus, Control Plane API,
                               AdminWeb S3 bucket + CloudFront, tenant-seeder Lambda
         └── analytics-stack       ← write-path + read-path Lambdas, analytics DDB (RETAIN),
                                     API routes, dashboards, SNS operator alert topic
               └── core-appplane-stack ← SBT ApplicationPlane, ProvisioningScriptJob + DeprovisioningScriptJob
                                         (CodeBuild jobs), CloudWatch alarms for CodeBuild failures
   └── tenant-template-stack-basic ← ECS cluster `prod-basic`, services (identity/academics/finance/rproxy),
                                     per-service DDB tables (RETAIN), Cognito tenant pool,
                                     ECS task roles, ABAC roles, post-auth trigger
   └── tenant-template-stack-advanced (V1_DEFERRED — synthesized but should NOT be deployed)
```

Declared in [server/bin/ecs-saas-ref-template.ts](server/bin/ecs-saas-ref-template.ts). Explicit dependencies: `controlplane → shared-infra`, `analytics → controlplane`, `core-appplane → analytics` (via `addDependency`), `tenant-template-basic → shared-infra`.

**Important:** the tenant-seeder Lambda lives in **`controlplane-stack`**, not `core-appplane-stack`. Its inline handler code is stringified at CDK synth time from [packages/shared-types/src/locale/tenant-locale-defaults.ts](packages/shared-types/src/locale/tenant-locale-defaults.ts) — changing the locale data requires bumping + publishing `@aibrains/shared-types`, then `controlplane-stack` redeploy.

### ECR images (pushed by `scripts/build-application.sh`)

`identity`, `academics`, `finance`, `rproxy`. Consumed by ECS services in `tenant-template-stack-basic`. Service names: `identitybasic`, `academicsbasic`, `financebasic`, `rproxybasic` in cluster `prod-basic`.

### Frontends

- **AdminWeb** ([client/AdminWeb/](client/AdminWeb/)) — system-admin UI. Built to `build/`, served by CloudFront distribution created in `shared-infra-stack` (`sharedInfraStack.adminSiteDistro`). Deploy via S3 sync + CloudFront invalidation.
- **edforge-saas-frontend** ([edforge-saas-frontend/](edforge-saas-frontend/)) — tenant-facing shell + MFEs. Deployed via **Vercel** ([vercel.json](edforge-saas-frontend/vercel.json), [.vercel/project.json](edforge-saas-frontend/.vercel/project.json)) — not CDK. Git push to `main` triggers Vercel prod; PRs get previews.

### Environment profiles

Loader: [server/bin/ecs-saas-ref-template.ts:19-25](server/bin/ecs-saas-ref-template.ts#L19-L25). `EDFORGE_ENV` (explicit) or `AWS_PROFILE` (implicit) selects `.env.<profile>`; `.env` is the shared baseline.

Active profiles: `uat`, `prod`. Files: [server/.env.uat](server/.env.uat), [server/.env.prod](server/.env.prod). Shell vars set before `ts-node` starts always win — standard unix precedence.

**UAT and prod are in different AWS accounts AND different regions:**

| | UAT | Prod |
|---|---|---|
| AWS account | 715860911762 | 257526644020 |
| Region | `us-east-2` | `ap-south-1` (Mumbai) |
| Tenant-facing frontend | `https://uat.edforge.app` | `https://edforge.app` + `https://www.edforge.app` |
| CORS origins | `https://uat.edforge.app,http://localhost:3000` | `https://edforge.app,https://www.edforge.app` |
| `CDK_PARAM_ANALYTICS_ENABLED` | `false` (default) | `true` |
| `CDK_NAG_ENABLED` at rest | `true` (prefix with `=false` per-call) | `true` (prefix with `=false` per-call) |

Never cross-contaminate. A `cdk diff prod` sourced against UAT's `.env` (or vice versa) produces a destructive diff — the wrapper's pre-flight check for unsubstituted placeholders catches one flavor of this, but it is not exhaustive. Always `source server/.env.<profile>` before running any CDK command.

**`service-info.json` caveat:** [server/lib/service-info.json](server/lib/service-info.json) is a generated artifact from `service-info.txt` — the checked-in baseline carries prod-shaped `<REGION>` / `<ACCOUNT_ID>` values that must be substituted per-env before deploy. The wrapper pre-flights this ([scripts/deploy-analytics.sh:56-67](scripts/deploy-analytics.sh#L56-L67)); if you ever see `.dkr.ecr..amazonaws.com` in the URI, stop — ECS will sit in `UPDATE_IN_PROGRESS` for 3 hours before CFN times out.

**Required env vars (hard-fails if missing):**
- `CDK_PARAM_SYSTEM_ADMIN_EMAIL` — tenant-admin fallback email
- `CDK_PARAM_TIER` — `basic` in V1 (hard-rejected otherwise by [provision-tenant.sh:63-67](server/lib/provision-scripts/provision-tenant.sh#L63))
- `CDK_PARAM_COMMIT_ID` — git sha (auto-set by deploy wrapper)
- `CDK_PARAM_CORS_ALLOWED_ORIGINS` — **no silent default** (prior incident — see the env loader comment at [server/bin/ecs-saas-ref-template.ts:103-109](server/bin/ecs-saas-ref-template.ts#L103))
- `CDK_PARAM_CLIENT_APP_URL` — tenant-facing frontend URL (per profile)
- `AWS_PROFILE` — must match `.env.<profile>` suffix

**CDK Nag:** enabled in `.env` (`CDK_NAG_ENABLED=true`) but blocks every deploy on pre-existing warnings. **Every deploy must prefix `CDK_NAG_ENABLED=false`** (the wrapper does this automatically). CDK Nag technical debt is tracked separately.

---

## Dependency pins that must not drift

Some package versions are pinned tighter than semver would suggest because a newer "compatible" release actually breaks a downstream bundler or runtime. Don't widen these pins — don't let dependabot / npm-audit-fix / an overzealous upgrade raise them without an explicit human decision.

### `zod` → `~3.24.4` (repo-wide)

**Why it's pinned:** zod `3.25+` ships a "v4 preview" at the main export via circular ESM re-exports through `./v4/classic/external.js`. The re-export chain can't be statically analyzed by webpack (as used by AdminWeb's CRA build / CodeBuild pipeline). The runtime symptom is silent and severe: a `TypeError: Cannot read properties of undefined (reading 'string')` fires synchronously at module init on the AdminWeb bundle, before React can call `createRoot` — browser tab stays white, nothing in the HTML shows.

We confirmed the bug end-to-end during the Midnight Lockin UAT deploy (2026-04-19). See the incident writeup in [docs/deploys/INDEX.md](docs/deploys/INDEX.md). The monorepo uses **zero** v4-only APIs (`z.iso.*`, `z.looseObject`, `z.treeifyError`, etc. — grep the tree before you consider upgrading).

**Rule:**
- [package.json](package.json) root: `"zod": "~3.24.4"`
- [server/package.json](server/package.json): `"zod": "~3.24.4"`
- [packages/shared-types/package.json](packages/shared-types/package.json): `"zod": "~3.24.4"` (dep) + `">=3.22.0 <3.25.0"` (peer) — the `<3.25.0` upper bound is the bugfence.
- New workspace packages that use zod: use the same `~3.24.4` pin.
- **Never** pin `"zod": "^3.23.x"` or `"^3.24.x"` — `^` with minor 3.25.0 available on the registry will resolve to the broken version.
- **Never** pin `"zod": "^4.x"` in this repo — an earlier accidental `^4.3.5` on the root broke AdminWeb silently for weeks. The entire monorepo is v3-compatible; keep it that way until a coordinated v4 migration happens.

When upgrading to zod v4 eventually (coordinated, not drift), the migration needs:
1. Update shared-types + every consumer's v4-specific API usage explicitly.
2. Verify AdminWeb's webpack/CRA build produces a working bundle (the blocker today).
3. End-to-end jsdom simulation of the AdminWeb bundle before deploy (`node /tmp/simulate.js` — see the incident writeup for the script) to catch silent init-time crashes.

### General rule — silent browser-bundle failures

When a frontend package changes (`@aibrains/shared-types`, anything AdminWeb imports) or its transitive dep graph shifts (lockfile changes, npm-audit-fix), run this **before** deploying `controlplane-stack`:

```bash
# 1. Clean rebuild of AdminWeb locally
cd client/AdminWeb && rm -rf node_modules/.cache build && npm run build

# 2. Simulate the bundle execution in jsdom — catches init-time TypeErrors
#    that webpack's build step cannot detect
npm install -g jsdom  # one-time, or in a scratch dir
node -e "const {JSDOM}=require('jsdom');const d=new JSDOM('<!DOCTYPE html><body><div id=root></div>',{url:'https://djbcgz3fusj2e.cloudfront.net/',runScripts:'outside-only'});const w=d.window;Object.assign(global,{window:w,document:w.document,navigator:w.navigator,location:w.location,HTMLElement:w.HTMLElement,Element:w.Element,crypto:require('crypto').webcrypto,fetch:()=>Promise.reject(),requestAnimationFrame:cb=>setTimeout(cb,0)});const main=require('fs').readFileSync('./build/static/js/main.'+require('fs').readdirSync('./build/static/js').find(f=>/^main\..*\.js$/.test(f)).slice(5).replace('.js',''),'utf8');try{new w.Function('window','document','location','navigator',main)(w,w.document,w.location,w.navigator);console.log('OK — bundle inits');setTimeout(()=>{console.log('root HTML:',w.document.getElementById('root').innerHTML.length,'chars');process.exit(0)},1000);}catch(e){console.log('FAIL:',e.message);process.exit(1)}"
```

A passing sim means the bundle at least mounts React. A failing sim means the AdminWeb deploy will produce a white screen — **do not** redeploy `controlplane-stack` until the sim passes.

TODO: `scripts/verify-adminweb-bundle.sh` — wrap the above, add to CI.

---

## Deploy pipeline — the golden path

Every change to AWS runtime state follows this ladder. Skipping a rung is a red flag; document why in the deploy log if unavoidable.

```
┌────────────────────────────────────────────────────────────────────┐
│  1. LOCAL                                                           │
│     typecheck → lint → unit tests → cdk synth                      │
│                                                                     │
│  2. UAT                                                             │
│     cdk diff (logged) → review → cdk deploy (logged) →             │
│     build-application (logged) → ecs rolling update (logged) →     │
│     smoke tests (logged) → runtime validation                      │
│                                                                     │
│  3. HUMAN APPROVAL GATE — Shoaib reviews UAT evidence               │
│                                                                     │
│  4. PROD                                                            │
│     cdk diff (logged, must match UAT modulo env vars) →            │
│     cdk deploy (logged) → build-application (logged) →             │
│     ecs rolling update (logged) → smoke tests (logged) →           │
│     30-min monitor window                                          │
└────────────────────────────────────────────────────────────────────┘
```

**Never deploy straight to prod.** Even one-line fixes go via UAT unless Shoaib explicitly authorizes a prod-only hotfix with a documented reason in the deploy log.

---

## Change-to-deploy matrix

What to deploy when, based on what you changed. If your change hits multiple rows, deploy in the order listed (infra before app code; CDK owns IAM, so IAM must be in place before new code that uses it runs).

| You changed… | Deploy… | Order | Wrapper to use |
|---|---|---|---|
| DDB schema / GSI ([ecs-dynamodb.ts](server/lib/tenant-template/ecs-dynamodb.ts)) | `tenant-template-stack-basic` | 1 (infra) | `./scripts/deploy-analytics.sh` |
| ABAC DDB action (same file) | `tenant-template-stack-basic` | 1 | wrapper |
| IAM policy (non-DDB) in [service-info.txt](server/service-info.txt) | `tenant-template-stack-basic` | 1 | wrapper |
| Task def env var in `service-info.txt` | `tenant-template-stack-basic` | 1 | wrapper |
| API Gateway route ([tenant-api-prod.json](server/lib/tenant-api-prod.json)) | `shared-infra-stack` | 1 | wrapper |
| NestJS controller / service code (identity/academics/finance) | ECR push + ECS rolling update | 2 (app) | `./scripts/build-application.sh` |
| Reverse proxy route ([nginx.template](server/application/reverseproxy/nginx.template)) | ECR push + ECS rolling update for rproxy | 2 | same |
| Analytics Lambda code ([server/lib/analytics/lambda/](server/lib/analytics/lambda/)) | `analytics-stack` | 1 (CDK bundles Lambdas) | wrapper |
| tenant-seeder Lambda ([tenant-seeder-lambda.ts](server/lib/bootstrap-template/tenant-seeder-lambda.ts)) | **`controlplane-stack`** (lambda is instantiated inside ControlPlane, not core-appplane) | 1 | wrapper |
| Provisioning script ([provision-tenant.sh](server/lib/provision-scripts/provision-tenant.sh)) | `core-appplane-stack` (script is read from disk at synth via `fs.readFileSync` and embedded in SBT ScriptJob) **PLUS** upload source tarball via [scripts/utils/update-provision-source.sh](scripts/utils/update-provision-source.sh) (CodeBuild downloads it at runtime) | 0 (source tarball first) then 1 | wrapper + update-provision-source.sh |
| CORS config | `shared-infra-stack` | 1 | wrapper |
| Cognito config | `controlplane-stack` | 1 | wrapper |
| AdminWeb React code | S3 sync + CloudFront invalidation (deploy script TBD) | 2 | see [Frontend deploys](#frontend-deploys) |
| edforge-saas-frontend React code | Vercel (automatic on git push to main) | 2 | N/A — Vercel |
| Shared types ([packages/shared-types/](packages/shared-types/)) — adding exports consumed by **AdminWeb** | **`npm publish`** the new version, then redeploy `controlplane-stack` so CodePipeline rebuilds AdminWeb. See "AdminWeb publish-gate gotcha" below — workspace symlinks are invisible to CodeBuild. | 0 (publish) then 1 (redeploy) | `npm publish` from `packages/shared-types/`, then wrapper |
| Shared types ([packages/shared-types/](packages/shared-types/)) — ECS-services-only consumers | None (workspace symlink resolves at local `nest build`; no publish needed) | 0 | `nest build <service>` downstream |
| Tenant locale defaults ([packages/shared-types/src/locale/tenant-locale-defaults.ts](packages/shared-types/src/locale/tenant-locale-defaults.ts)) | Bump + `npm publish` `@aibrains/shared-types`, then **`controlplane-stack`** redeploy (synth-time JSON inlined into tenant-seeder Lambda) + identity ECR push (entity has hand-duplicated copy). | 0 (publish) then 1 (redeploy) then 2 (ECS) | `npm publish` + wrapper + `build-application.sh` |

**Rule of thumb:** when in doubt, run `npx cdk diff <stack>` first. If the diff is empty, no CDK deploy needed — just the ECR push + ECS rolling update.

---

## Deploy log convention (repo-wide, V1)

Every change that mutates AWS runtime state **MUST** tee its output to `docs/deploys/` with a filename that embeds env, target, timestamp, and git SHA. Without this:
- Incident replay requires CloudWatch StackEvents (slow, lossy).
- Prior sprint deploys have been lost, recovered only by best-effort backfill.
- No SHA-to-artifact mapping for rollback.

### Log filename pattern

```
<env>-<target>-<YYYYMMDD-HHMMSS>-<gitsha-or-tag>.log
```

- `<env>` — `uat`, `prod`
- `<target>` — stack name for CDK ops (`analytics-stack`, `tenant-template-stack-basic`), `build-application` for ECR pushes, `ecs-roll-<service>` for ECS rolls, `cdk-diff-<stack>` for diff-only runs, `frontend-<site>` for frontend deploys, `tenant-provision-<tenantId>` for prod tenant onboards
- `<gitsha>` — `git rev-parse --short HEAD` at the time of deploy

Examples from [docs/deploys/](docs/deploys/):
- `uat-cdk-diff-tenant-template-stack-basic-20260418-121530-abc1234.log`
- `uat-tenant-template-stack-basic-20260418-122045-abc1234.log`
- `prod-analytics-stack-20260417-151201-016e931.log`
- `uat-build-application-20260418-123010-abc1234.log`
- `prod-ecs-roll-academicsbasic-20260418-125500-abc1234.log`

### The wrapper

Use [scripts/deploy-analytics.sh](scripts/deploy-analytics.sh) for every CDK deploy, regardless of stack. **Despite its historical name, the wrapper is repo-wide** — it works for any stack in the CDK app and provides the standard guardrails (service-info.json substitution check, git SHA stamping, CDK_NAG_ENABLED=false, log tee'ing).

```bash
# Any CDK deploy:
./scripts/deploy-analytics.sh <stack> <profile> [extra cdk args]

# Examples:
./scripts/deploy-analytics.sh tenant-template-stack-basic uat
./scripts/deploy-analytics.sh shared-infra-stack prod
./scripts/deploy-analytics.sh core-appplane-stack uat -- --hotswap   # UAT-only, use sparingly
```

**Never run `npx cdk deploy` directly.** If you find yourself reaching for raw `cdk` commands, stop and use the wrapper. The only exceptions are `cdk synth` (read-only, for local validation) and `cdk diff` (captured by the diff convention below).

**TODO B0.1:** rename `scripts/deploy-analytics.sh` → `scripts/deploy.sh` and drop the `analytics-` prefix from log filenames. Wrapper is already generic; the name is a historical accident.

### CDK diff convention

Always diff before deploy. Always log the diff.

```bash
# Manual one-liner (until scripts/cdk-diff.sh lands):
cd server && AWS_PROFILE=uat CDK_NAG_ENABLED=false npx cdk diff <stack> 2>&1 | \
  tee ../docs/deploys/uat-cdk-diff-<stack>-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD).log
```

**TODO B0.1:** add `scripts/cdk-diff.sh <stack> <profile>` wrapper mirroring the deploy one.

The prod diff must match the UAT diff (modulo account IDs, domain names, and other per-env config). Any unexpected resource delta at the prod step is a red flag — stop and investigate.

### ECR push + ECS roll convention

Every `scripts/build-application.sh` invocation MUST be tee'd. The script accepts an optional service name argument to build a single image:

```bash
# Full build (all 4 services):
LOG="docs/deploys/uat-build-application-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD).log"
AWS_PROFILE=uat ./scripts/build-application.sh 2>&1 | tee "$LOG"

# Single-service build (faster):
LOG="docs/deploys/uat-build-application-identity-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD).log"
AWS_PROFILE=uat ./scripts/build-application.sh identity 2>&1 | tee "$LOG"
```

Images are tagged both `:latest` and `:<gitsha>-<timestamp>`. Prior versions stay in ECR; lifecycle policy is "keep last 10 tagged, expire untagged after 7 days." Rollback ops rely on this — don't change the lifecycle policy without a replacement strategy.

Every `aws ecs update-service --force-new-deployment` MUST be tee'd. Use the correct region per profile (UAT is `us-east-2`, prod is `ap-south-1`):

```bash
SERVICE=academicsbasic
REGION=us-east-2   # uat
LOG="docs/deploys/uat-ecs-roll-${SERVICE}-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD).log"
AWS_PROFILE=uat aws ecs update-service \
  --cluster prod-basic --service "$SERVICE" \
  --force-new-deployment --region "$REGION" 2>&1 | tee "$LOG"
```

**TODO B0.1:** fold these into `scripts/deploy-app.sh <service> <profile>` that does build + roll + log + wait-for-stable in one command.

### Smoke test logging

Smoke test runs against live environments ([scripts/smoke-tests/](scripts/smoke-tests/)) that validate a feature should also be tee'd — they are part of the deploy evidence:

```bash
LOG="docs/deploys/uat-smoke-nepal-school-e2e-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD).log"
AWS_PROFILE=uat npx ts-node scripts/smoke-tests/nepal-school-e2e.ts 2>&1 | tee "$LOG"
```

Failed smoke tests stay in the repo — they are post-mortem fuel.

### Index

[docs/deploys/INDEX.md](docs/deploys/INDEX.md) is the historical map, organized by sprint + env. When a sprint ships, add a section with links to the relevant logs (diff, deploy, build, ecs-roll, smoke).

### Rotation

Deploy logs accumulate. Quarterly rotation plan:
1. Archive logs older than 90 days to `s3://edforge-deploy-logs-archive/`
2. Keep last 10 successful deploys per stack+env in repo
3. Keep all failure logs — they're post-mortem gold

**TODO B0.1:** `scripts/rotate-deploy-logs.sh`.

---

## Local validation gates — required before UAT deploy

Do all of these locally before touching UAT. Each gate takes seconds to minutes; skipping them means you'll discover the problem in the 3-hour CFN rollback window instead.

### Typecheck

```bash
# Backend NestJS service (identity example — substitute academics/finance/rproxy)
cd server/application && npx nest build identity
```

### Lint

```bash
cd server/application && npm run lint
```

### Unit tests (scoped where possible)

```bash
cd server/application && npx jest <path-to-affected-spec>
# Or full suite:
cd server/application && npx jest
```

**Gotcha:** Jest's `moduleFileExtensions: ['js', 'json', 'ts']` resolves `.js` files first. If you see stale test results, check for `.js` / `.d.ts` artifacts next to `.ts` source under `microservices/` and delete them (they're gitignored but can mask code changes):

```bash
find server/application/microservices -name "*.js" -not -name "jest.config.js" -delete
find server/application/microservices -name "*.d.ts" -delete
find server/application/microservices -name "*.js.map" -delete
```

### Shared package rebuild

If you changed [packages/shared-types/](packages/shared-types/), rebuild it or consumers will see stale dist/:

```bash
cd packages/shared-types && npm run build
```

### CDK synth (infra changes only)

```bash
cd server && source .env.uat && AWS_PROFILE=uat CDK_NAG_ENABLED=false npx cdk synth <stack>
```

Catches stack-definition errors offline. Zero AWS calls.

### CDK diff (required for every infra deploy — see convention above)

---

## Rollback

Every deploy log filename embeds the git SHA. Rollback = re-deploy the prior good SHA from a worktree.

### CDK stack rollback

```bash
# 1. Find the most recent successful log for stack+env
ls -t docs/deploys/uat-<stack>-*.log | head -5

# 2. Note the prior-good SHA from the filename
PREV_SHA=<sha>

# 3. Deploy from a worktree pinned at that SHA
git worktree add /tmp/rollback "$PREV_SHA"
cd /tmp/rollback
./scripts/deploy-analytics.sh <stack> <profile>

# 4. Cleanup
git worktree remove /tmp/rollback
```

### ECS service rollback (task definition revision)

Prior task defs stay in ECS. Roll back without ECR rebuild:

```bash
# List recent task def revisions
aws ecs list-task-definitions --family-prefix identity --sort DESC --max-items 10 --region us-east-2

# Roll to a specific revision
aws ecs update-service \
  --cluster prod-basic --service identitybasic \
  --task-definition identity:<N> \
  --force-new-deployment --region us-east-2
```

### ECR image rollback (to prior digest)

Images are tagged both `:latest` and `:<gitsha>-<timestamp>`. Prior versions remain in ECR indexed by gitsha tag. Tag the prior digest as `latest` and force a roll:

```bash
# Find the prior-good image tag
AWS_PROFILE=uat aws ecr describe-images --repository-name identity \
  --query 'sort_by(imageDetails,& imagePushedAt)[*].{tags:imageTags,pushed:imagePushedAt}' \
  --output table --region us-east-2

PRIOR_TAG=<gitsha-timestamp>   # e.g. abc1234-20260417-151200

# Re-tag prior image as :latest
aws ecr batch-get-image --repository-name identity --image-ids imageTag="$PRIOR_TAG" \
  --region us-east-2 --query 'images[].imageManifest' --output text > /tmp/manifest.json
AWS_PROFILE=uat aws ecr put-image --repository-name identity --image-tag latest \
  --image-manifest "$(cat /tmp/manifest.json)" --region us-east-2
# Then force a new deployment (as above)
```

**ECR lifecycle warning:** the policy keeps only the last 10 tagged images per repo. If the prior-good SHA is older than that, the image is gone and you must rebuild from git. This makes the "build + push from worktree pinned at prior SHA" flow below the more robust default.

### CloudFormation auto-rollback

For a failed `cdk deploy`, CloudFormation auto-rolls back. No action needed unless the stack gets stuck in `UPDATE_ROLLBACK_FAILED` — see [AWS_CLI_OPERATIONS_GUIDE.md](docs/AWS_CLI_OPERATIONS_GUIDE.md) for recovery.

---

## Frontend deploys

### AdminWeb (S3 + CloudFront)

The `StaticSiteDistro` CloudFront is created in [shared-infra-stack.ts:257](server/lib/shared-infra/shared-infra-stack.ts#L257) as `adminSiteDistro`; the `AdminSite` S3 source is plumbed into it via control-plane-stack ([control-plane-stack.ts:116](server/lib/bootstrap-template/control-plane-stack.ts#L116)). Only `adminSiteUrl` is a direct CFN output today — the S3 bucket name and CloudFront distribution ID must be discovered at deploy time.

```bash
REGION=us-east-2
LOG="docs/deploys/uat-frontend-adminweb-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD).log"

cd client/AdminWeb
npm run build 2>&1 | tee "../../$LOG"

# Resolve the CloudFront distribution ID from the exported adminSiteUrl (shared-infra)
ADMIN_URL=$(AWS_PROFILE=uat aws cloudformation describe-stacks --stack-name shared-infra-stack \
  --query "Stacks[0].Outputs[?OutputKey=='adminSiteUrl'].OutputValue" --output text --region "$REGION")
DIST_ID=$(AWS_PROFILE=uat aws cloudfront list-distributions \
  --query "DistributionList.Items[?DomainName=='${ADMIN_URL#https://}'].Id | [0]" \
  --output text --region "$REGION")

# Resolve the S3 bucket by listing CloudFront distribution config and extracting origin domain
BUCKET=$(AWS_PROFILE=uat aws cloudfront get-distribution-config --id "$DIST_ID" \
  --query "DistributionConfig.Origins.Items[0].DomainName" --output text \
  | sed 's/\.s3\..*\.amazonaws\.com//' )

# Sync + invalidate (both logged)
AWS_PROFILE=uat aws s3 sync build/ "s3://$BUCKET/" --delete --region "$REGION" 2>&1 | tee -a "../../$LOG"
AWS_PROFILE=uat aws cloudfront create-invalidation \
  --distribution-id "$DIST_ID" --paths "/*" --region "$REGION" 2>&1 | tee -a "../../$LOG"
```

**TODO B0.1:** add a `AdminSiteBucketName` + `AdminSiteDistroId` CFN output so the above becomes a two-line script instead of a discovery dance. Then wrap in `scripts/deploy-adminweb.sh <profile>`.

### edforge-saas-frontend (Vercel)

Deploys automatically on git push to `main` (Vercel watches the repo). PR commits get preview URLs.

- Prod: `https://edforge.app` (or whatever `CDK_PARAM_CLIENT_APP_URL` points at in `.env.prod`)
- Preview: auto-assigned by Vercel per PR

**No CDK involvement** — but backend `CDK_PARAM_CORS_ALLOWED_ORIGINS` must include the Vercel URL, or API calls fail CORS. When adding a new Vercel env (e.g. `staging.edforge.app`), update both `.env.uat`/`.env.prod` AND deploy `shared-infra-stack` to update API Gateway CORS.

### AdminWeb publish-gate gotcha — workspace-only packages break CodeBuild

**If AdminWeb imports anything from a workspace-only (private, unpublished) package, the CodePipeline rebuild silently fails and CloudFront keeps serving the last successful build.**

Why: the [StaticSite construct](server/lib/bootstrap-template/static-site.ts) zips `client/AdminWeb/` as source and ships it to CodeBuild, which runs `npm install --legacy-peer-deps --no-optional` in isolation. CodeBuild has no visibility into the monorepo's workspace symlinks — every dependency in AdminWeb's `package.json` must resolve from the npm **registry**. A `"private": true` workspace package (historically `@edforge/tenant-locale-defaults`, retired in shared-types 0.27.0) returns 404 and the build aborts in the `INSTALL` phase.

**Rules for AdminWeb:**

1. AdminWeb may only import from **npm-published** packages. `@aibrains/shared-types` is the canonical shared package — publish new exports there.
2. When you add a shared-types export consumed by AdminWeb, you MUST `npm publish` before deploying `controlplane-stack`:
   ```bash
   cd packages/shared-types
   # version bump already done in package.json
   npm publish   # 2FA prompt
   # verify registry
   npm view @aibrains/shared-types version
   cd ../..
   npm install   # refresh node_modules symlinks
   ```
3. Then `./scripts/deploy-analytics.sh controlplane-stack <profile>` — CDK re-bundles the AdminWeb source, CodePipeline rebuilds.
4. **Verify the pipeline succeeded** — `aws codepipeline list-pipeline-executions --pipeline-name <name> --max-items 1`. If the last run is `Failed`, the bundle in S3 is stale. Fetch the CodeBuild logs to see the reason (most common: an import that doesn't resolve from npm).
5. Sanity check by curling the main bundle for expected strings:
   ```bash
   MAIN=$(curl -sS https://djbcgz3fusj2e.cloudfront.net/ | grep -oE '/static/js/main\.[^"]+\.js' | head -1)
   curl -sS "https://djbcgz3fusj2e.cloudfront.net${MAIN}" | grep -oE "<your-new-symbol>"
   ```

**Never direct-sync `build/` to the CloudFront origin bucket** — it bypasses the pipeline's audit trail, can drift from CDK state, and hides failure modes (the pipeline stays broken while the bundle "mysteriously works"). If you're tempted, fix the pipeline instead.

**Workspace-only packages are still fine** for consumers that run via **local** `cdk synth` (tenant-seeder Lambda, tenant-settings-resolver, identity entity) because those resolve from repo-root `node_modules` at synth time. The CodeBuild constraint is unique to AdminWeb's StaticSite deploy model.

### Per-sprint shared-types publish checklist

If a sprint's PR changes anything under [packages/shared-types/src/](packages/shared-types/src/), walk this list **before** merging the backend PR that consumes the new exports. Skipping step 2 is the exact mode that broke AdminWeb silently during the Midnight Lockin UAT deploy.

1. **Bump the version.** Edit `packages/shared-types/package.json` to the next minor (feature) or patch (bugfix). Never re-use an already-published version.
2. **Publish to npm.** `cd packages/shared-types && npm publish` (2FA prompt). If CI publishes automatically on tag, push the tag; otherwise run manually.
3. **Verify registry.** `npm view @aibrains/shared-types version` must return the new version. If it returns the old one, wait 30s and retry — npm's CDN has a short propagation window.
4. **Refresh lockfile.** From repo root: `npm install` to re-resolve the new version into `package-lock.json`. Commit the lockfile change with the PR.
5. **Rebuild AdminWeb locally.** `cd client/AdminWeb && rm -rf node_modules/.cache build && npm run build`. Warnings are fine; a compile error here means the AdminWeb CodeBuild will also fail.
6. **Run the jsdom bundle sim.** The one-liner in [CLAUDE.md § General rule — silent browser-bundle failures](#general-rule--silent-browser-bundle-failures). A passing sim proves the bundle at least boots React. A failing sim means **do not redeploy `controlplane-stack`.**
7. **Deploy identity + academics ECR** (they consume the new types at runtime).
8. **Deploy `controlplane-stack`** — CDK re-bundles AdminWeb source, CodePipeline rebuilds. Watch for Pipeline `Succeeded` before assuming the deploy is complete.
9. **Post-deploy sanity curl.** `curl` the AdminWeb bundle for a string unique to the new exports (e.g. a new component name or descriptor URI fragment). If the string is missing, the old bundle is still being served — investigate the CodeBuild logs.

Each backend sprint that touches shared-types should have a PR checklist (GitHub template) that mirrors the first four steps; the deploy steps live in the deploy log for that sprint.

---

## Tenant provisioning (prod operational)

### Flow

1. Admin submits AdminWeb Create Tenant form → POST `https://<controlplane-api>/tenants` with `{ tenantId, tenantName, tier, email, country, archetype, useFederation }`.
2. SBT ControlPlane writes registration DDB row → emits `sbt_aws_onboardingRequest` to SBT EventBridge bus.
3. Core-app-plane SBT `ProvisioningScriptJob` runs CodeBuild job with env vars from event.
4. CodeBuild downloads source tarball from S3 (`saas-reference-architecture-ecs-<account>-<region>/source.tar.gz`) — this is why [scripts/utils/update-provision-source.sh](scripts/utils/update-provision-source.sh) must run before any provision-script change takes effect.
5. CodeBuild runs [provision-tenant.sh](server/lib/provision-scripts/provision-tenant.sh) → substitutes `service-info.json` → `cdk deploy tenant-template-stack-basic` → creates Cognito admin user → creates per-tenant SNS alert topic → exports tenantId/tier/country/archetype.
6. SBT emits `sbt_aws_provisionSuccess` → [tenant-seeder-lambda.ts](server/lib/bootstrap-template/tenant-seeder-lambda.ts) writes METADATA + SETTINGS#WORKSPACE rows to identity DDB with archetype-first regional defaults.
7. Admin receives Cognito invite email (template configured in [identity-provider.ts](server/lib/tenant-template/identity-provider.ts)).

### Known gotcha — SBT ISSUE-008

SBT's Step Function `Catch` block converts CodeBuild failures to success events. Provisioning can "succeed" at the Step Function level while the CodeBuild job actually failed. Mitigation: a CloudWatch alarm on CodeBuild `FailedBuilds` ([core-appplane-stack.ts:133-144](server/lib/bootstrap-template/core-appplane-stack.ts#L133)) fires SNS to the operator alert topic. Watch the SNS subscription for provisioning attempts; do not trust the Step Function's green checkmark alone.

### Logging (prod operational)

Every **prod** tenant provisioning MUST be captured in a log:

```bash
TENANT_ID=<uuid>
LOG="docs/deploys/prod-tenant-provision-${TENANT_ID}-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD).log"
# Collect: AdminWeb network request, CodeBuild build ID + final log URL, SBT Step Function
# execution ARN, tenant-seeder Lambda invocation ID, and post-provision DDB MD/SETTINGS rows
# (aws dynamodb get-item on both SKs). Append all to the log.
```

**TODO B0.1:** `scripts/provision-capture.sh <tenantId> <profile>` — captures CodeBuild logs, SBT events, and DDB rows for a single tenant provisioning.

---

## Shared types (A0.1)

Cross-codebase contract types live in `packages/`. One package per shared domain — never one giant `shared-types` blob.

Active packages:
- [packages/shared-types/](packages/shared-types/) (`@aibrains/shared-types`) — **published to npm** (public). Cross-service Zod schemas, Ed-Fi mappers, utilities (BS↔AD converter, currency formatter, date-format). As of 0.26.0 also carries the tenant locale defaults (country + archetype) that AdminWeb imports — see `src/locale/tenant-locale-defaults.ts`.
- `@edforge/tenant-locale-defaults` — **RETIRED in shared-types 0.27.0**. Content moved to [packages/shared-types/src/locale/tenant-locale-defaults.ts](packages/shared-types/src/locale/tenant-locale-defaults.ts) and re-exported from `@aibrains/shared-types`. The `packages/tenant-locale-defaults/` directory no longer exists. The retirement resolved the "workspace-only package breaks AdminWeb CodeBuild" incident — see "AdminWeb publish-gate gotcha" below for the general principle.

Rules:
- npm workspaces, **not** npm publish — `prepare: tsc` ensures consumers get built `dist/` on cold install.
- If you change a response shape in a service, change it in the shared package too — `tsc` fails in consumers if you forget.
- The identity workspace-settings entity duplicates `COUNTRY_DEFAULTS` + `ARCHETYPE_DEFAULTS` inline. Canonical source is [packages/shared-types/src/locale/tenant-locale-defaults.ts](packages/shared-types/src/locale/tenant-locale-defaults.ts). If you change one, change both.

**Note:** an earlier draft of this doc referenced `packages/shared-analytics-types/` — that package was never created; analytics contract types live in `packages/shared-types/src/schemas/analytics/` and re-exports in AdminWeb.

---

## Archetype model (first-class concept)

EdForge builds for **archetypes** (umbrella operational patterns) — not individual schools.

- `Tenant.archetype` is a first-class field, write-once at provisioning, immutable afterward (classified in [field-governance.ts](packages/shared-types/src/identity/field-governance.ts)).
- V1 archetype enum: `'PABSON' | 'GENERIC'`. Reserved (type only, not runtime-valid): `'CBSE_IN' | 'NAIS_US' | 'GEMS_UAE'`.
- Archetype defaults override country defaults when both are set. PABSON + NPL → PABSON wins (NPR, Asia/Kathmandu, bikram_sambat, Sun-Fri week, south-asian numbers, ne-NP locale).
- Regional settings (currency, timezone, calendar, locale, number format, week start) live ONLY on `WorkspaceSettings` at the tenant level. School entities MUST NOT override them.
- Don't branch on `country === 'NPL'` for PABSON-specific logic — branch on `archetype === 'PABSON'` so the codebase scales to future archetypes without rewrites.

---

## Bikram Sambat (BS) calendar

A BS↔AD converter already exists: [packages/shared-types/src/utils/bikram-sambat.ts](packages/shared-types/src/utils/bikram-sambat.ts) (313 lines, BS 2000–2090, exported from `@aibrains/shared-types`). Used by the analytics Lambda ([server/lib/analytics/lambda/api/analytics-service.ts](server/lib/analytics/lambda/api/analytics-service.ts)) and the [BsDatePicker UI component](edforge-saas-frontend/packages/ui/src/components/BsDatePicker.tsx).

**Do NOT build a second BS converter.** Import `gregorianToBs` / `bsToGregorian` from `@aibrains/shared-types`.

---

## Finance currency

Finance entities currently type `currency: 'NPR'` as a TypeScript literal in invoice/payment/fee-structure/credit-note/refund-request — an artifact from the Nepal-first pilot. Being widened to `string` sourced from `WorkspaceSettings.regional.defaultCurrency` in Project Midnight Lockin (task P0.12). Existing NPR DDB rows stay valid; no data migration.

Until P0.12 ships, **do not harden new finance code against the literal type**. Widen as you touch.

---

## House rules

- **Don't skip hooks.** `git commit --no-verify` is forbidden unless Shoaib explicitly asks.
- **Don't amend published commits.** Prefer new commits.
- **Don't run `aws --profile prod ...`** without explicit authorization in the conversation. Prod deploys always go through the UAT → human-review → prod ladder.
- **Don't delete `docs/deploys/*` logs.** They're the audit trail.
- **Don't modify `.gitignore`** to hide generated artifacts — fix the generator instead.
- **Don't widen pins in "Dependency pins that must not drift"** above. `zod@~3.24.4` is there because `3.25.x` ships a v4 preview that silently white-screens AdminWeb. Any upgrade needs an explicit coordinated migration and jsdom bundle-sim evidence — never a drive-by bump.
- **Don't `npm audit fix --force`** without reviewing every version change it proposes. It has a history (in this repo) of widening pins past the bug-fences documented above.
- **Two-repo git hygiene (avoid wrong-repo branches and stash mishaps).** The frontend at `edforge-saas-frontend/` is a separate git repository nested inside the backend repo, **not** a submodule. Bash invocations retain `cwd` across calls, so a `cd` from one tool call leaks into the next. Three rules that prevent the failure mode (2026-05-13 incident: `git checkout -b sprint/s0-api-bug-fixes` accidentally ran in the frontend repo because a prior chained `cd edforge-saas-frontend` had stuck):
  1. **Every `git` command starts with an explicit `cd <repo-root>` in the same invocation.** Even if the previous call ended in the right repo. Even within a single chained `&&` line. Backend = `cd /Users/shoaibrain/edforge`. Frontend = `cd /Users/shoaibrain/edforge/edforge-saas-frontend`. Never rely on inherited cwd.
  2. **Don't use `git stash` to inspect state.** Stash mutates the worktree (and silently picks up untracked files in some flag combos), then you have to remember to pop. To compare against `main` use `git diff main`, `git diff main --stat`, or `git log main..HEAD --oneline` — all read-only. To check what's modified, use `git status --short`. Reserve stash for real worktree-saves between branch switches.
  3. **Verify branch with `git branch --show-current` immediately before every commit**, especially after multi-step sequences. If the commit lands on the wrong branch, recover with `git branch -f <intended-branch> HEAD && git reset --keep HEAD~1 && git checkout <intended-branch>` — non-destructive when there are no uncommitted changes (the commit preserves on the new branch, the reset only moves the wrong-branch's pointer back).
- **Stacked PRs don't auto-rebase their base when the parent merges.** GitHub leaves `base = sprint/<parent>` on the child PR; if the operator just clicks "Merge" on the child, it merges into the (now-stale) parent feature branch instead of `main`. Incident 2026-05-13: PRs #55 + #56 merged into their feature-branch bases, not `main`, and the work had to be re-targeted via a follow-up PR #57. Two ways to avoid:
  1. **After each parent merges to `main`, manually retarget every downstream child PR:** `gh pr edit <child-pr-num> --base main`. Then GitHub recomputes the diff against `main` and the child merges cleanly.
  2. **Or open stacked PRs with `--base main` from the start** (head=stacked-branch, base=main). The diff will include the parent's commits until the parent merges — review noisier, but no retargeting needed.
- **Three-way route handoff: every new API route touches THREE files in lockstep, not one.** When you add a new endpoint to a NestJS controller, you ALSO need to register it in:
  1. The NestJS controller method (`@Get/@Post/@Patch/@Delete` decorator) — what most engineers think of first.
  2. **`server/lib/tenant-api-prod.json`** — the API Gateway OpenAPI spec is **hand-maintained**, NOT auto-derived from the NestJS controllers. A missing route here gives `403 SigV4` on the smoke (because API GW falls through to its IAM auth default rather than reaching the Cognito-authed identity service).
  3. **`server/application/reverseproxy/nginx.template`** — only if the path prefix is NEW (e.g. a new top-level resource like `/parents`). Existing prefixes (`/schools`, `/users`, `/tenants`, …) auto-cover sub-paths via their `location ~ ^/<prefix>` block. A missing route here gives `404` from nginx.
  4. **Symptom diagnosis post-deploy:** `403 SigV4` = API GW missing. `404` from `nginx/...` server header = rproxy missing. `404` JSON body from identity = NestJS controller missing or path typo'd. (See memory `edforge_api_gateway_route_registration`.) The follow-up route-drift linter in `scripts/check-route-drift.ts` enforces this at build time.
- **Bumping `@aibrains/shared-types` minor requires bumping consumer pins in `server/` package.json files in the SAME PR.** npm's `^0.X.0` for 0.x semver means `>=0.X.0 <0.(X+1).0` — so `^0.40.0` does NOT auto-pick up `0.41.0`. Workspace symlinks make this look like it works locally, but Docker builds (which copy only `server/application/package.json` and resolve from the registry) break with TS2305 / TS2741 errors. Incident 2026-05-14: identity Docker build failed in prod after S0.6 because `server/application/package.json` still pinned `^0.40.0`. Always update at minimum:
  - `server/application/package.json` (gates Dockerfile.identity)
  - `server/package.json` (CDK deploy scripts)
  - Root `package-lock.json` (refresh via `npm install` at repo root)
  AdminWeb / frontend / tenant-settings-resolver pins can stay stale unless that specific consumer needs a new export — bumping them forces a controlplane redeploy that's usually unnecessary.
- **Cross-stack export change pre-flight: every CDK deploy must audit changing exports for active importers.** Incident 2026-05-23 (R41.A attempt 2): renaming the authorizer Lambda changed the `TenantApiAuthorizerArn` Output ARN value; CFN refused to update the export mid-deploy because `analytics-stack` actively imports it → `Cannot update export ... as it is in use by analytics-stack` → rollback. The cdk diff DOES surface Output deltas, but it does NOT tell you which Outputs are imported by other stacks — that information has to be cross-referenced explicitly. **Run this check before any `cdk deploy` of a stack whose Outputs are exported (`exportName` set):**

  1. List the stack's exports and snapshot current resolved values:

     ```bash
     STACK=shared-infra-stack
     REGION=ap-south-1
     aws cloudformation list-exports --region "$REGION" --profile "$PROFILE" \
       --query "Exports[?contains(ExportingStackId, '$STACK')].{Name:Name,Value:Value}" > /tmp/exports-before.json
     ```

  2. Synth the new template + diff Output values vs the snapshot. For each export whose VALUE changes, list its importers — capture stdout + exit code separately and parse JSON, so AWS CLI errors are distinguishable from "no importers":

     ```bash
     for export_name in $(jq -r '.[].Name' /tmp/exports-before.json); do
       importers_json=$(aws cloudformation list-imports --export-name "$export_name" \
         --region "$REGION" --profile "$PROFILE" --output json 2>/tmp/list-imports.err)
       rc=$?
       if [[ $rc -ne 0 ]]; then
         err=$(cat /tmp/list-imports.err)
         # AWS CLI returns 255 + ValidationError when the export has no importers
         # — that's the "safe" case. Anything else is a real CLI/auth/network error.
         if echo "$err" | grep -q "is not imported by any stack"; then
           echo "$export_name: (no importers)"
         else
           echo "$export_name: AWS CLI ERROR ($rc): $err" >&2
         fi
       else
         count=$(echo "$importers_json" | jq -r '.Imports | length')
         if [[ "$count" -eq 0 ]]; then
           echo "$export_name: (no importers)"
         else
           echo "$export_name: $(echo "$importers_json" | jq -r '.Imports | join(", ")')"
         fi
       fi
     done
     ```

  3. If any export's VALUE will change AND it has importers, the deploy WILL fail with `Cannot update export ... as it is in use by <stack>`. Resolve by one of:
     - **(a) Don't trigger the change** — keep the upstream resource's property value byte-identical so CFN sees "no change."
       - **Safe when:** the resource's property is already explicitly set in the template, and you can keep using that same literal value. Confirm the deployed value with `aws <service> describe-* / list-* --query "...physical-name..."` first.
       - **NOT safe for `AWS::Lambda::Function.FunctionName`** (or any other "Update requires: Replacement" property) where the resource previously relied on CFN-generated names. **Adding `FunctionName` to a Lambda that didn't have it set is itself a property change → CFN replaces the function regardless of whether the literal value matches the existing physical name.** Empirical confirmation: R41.A attempted both "explicit new name" and "pin to existing physical name" — both triggered replacement at cdk diff. For Lambda function names specifically, you cannot use this pattern to avoid replacement; jump to option (b).
     - **(b) Decouple via SSM** — move the cross-stack handoff from CFN export to SSM Parameter; consumer reads via `StringParameter.fromStringParameterName`. 2-PR coordinated migration: consumer first switches to SSM, then producer can mutate the export safely. **This is the right migration path for Lambda renames and any other replacement-triggering changes.**
     - **(c) Coordinated multi-stack deploy** — temporarily hardcode the value in the importer, deploy producer, then re-link. Use sparingly; leaves a hardcoded-value period.

  **What CFN's "Cannot update export" check actually does:** CFN compares the export's NEW resolved value to the deployed value. Same-value updates (e.g., `Fn::Join` template form change → identical string output) pass. Different-value updates with active importers are rejected. Same-NAME exports added or removed are not the trigger — VALUE changes are.

  **Common exports in shared-infra-stack that have importers** (audit 2026-05-23):
  - `TenantApiAuthorizerArn`, `TenantApiRestApiId`, `TenantApiRootResourceId` → consumed by `analytics-stack`
  - `EcsVpcId`, `PrivateSubnetIds`, `AlbSgId`, `ListenerArn`, `ALBArn` → likely consumed by `tenant-template-stack-basic`
  - `AvailabilityZones`, `ApiGatewayUrl`, `adminSiteUrl` → currently no importers (safe to mutate)

  TODO B0.1.T*: wrap this audit into `scripts/cdk-export-preflight.sh <stack> <profile>`.

- **TODOs in this file are tracked as `B0.1.T*`** (Backlog 0.1 — deploy hygiene). When implementing one, remove the TODO and link the PR in `INDEX.md`.
