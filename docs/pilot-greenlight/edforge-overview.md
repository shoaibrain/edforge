# EdForge — Technical Reference

> Source-grounded snapshot of the platform as of 2026-05-16 (`main` at `e96f2a1`).
> Built by six parallel read-only audits of the codebase. Every assertion is cited file:line.
> Authoritative over `OVERVIEW.md`, `DEVELOPER_GUIDE.md`, `MIDNIGHT_LOCKIN_*.md`, and `SARASWATI_PILOT_REVISED_ROADMAP.md` (all superseded — see §13).

---

## 0. What EdForge is

EdForge is a multi-tenant, multi-region SaaS Education Management Information System (EMIS) for K-12 schools, built on AWS using the **SaaS Builder Toolkit (SBT)** + **ECS Fargate** reference architecture. The platform pairs an **archetype-agnostic Ed-Fi v6 core** with **region/archetype edge layers** so a single codebase serves operationally divergent school systems (Nepal PABSON private schools, US Common Core schools, future CBSE/NAIS/GEMS) without forking.

- **First pilot:** *PABSON Saraswati BS 2083* (Shree Saraswati Sec. Eng. Boarding School, Dhanusha, Nepal). Go-live mid-April 2026 (BS 2083 Baisakh 1).
- **V1 scope (locked):** BASIC tier only; PABSON + GENERIC archetypes runtime-valid; UAT **sunset** — only prod is live (see [docs/infrastructure-sunset/](docs/infrastructure-sunset/)). Advanced/Premium tier code is intentional `V1_DEFERRED`, synthesized but rejected at provisioning.
- **AWS accounts:** Production `257526644020` in `ap-south-1` (Mumbai) is the only live environment. UAT account `715860911762`/`us-east-2` exists historically but is no longer the validation environment (see §13).

---

## 1. Architecture at a glance

```
              ┌────────────────────────────────────────────────────────────────┐
              │           shared-infra-stack (foundation)                      │
              │   VPC + ALB + NLB + API Gateway (SpecRestApi)                  │
              │   AdminWeb CloudFront distro · TenantMapping DDB · Layers      │
              └────────────────────────────────────────────────────────────────┘
                                       │
              ┌────────────────────────┼─────────────────────────────┐
              ▼                        ▼                              ▼
   ┌──────────────────────┐  ┌──────────────────────┐    ┌──────────────────────────┐
   │ controlplane-stack    │  │ tenant-template-     │    │ tenant-template-stack-   │
   │ (SBT ControlPlane)    │  │   stack-basic        │    │   advanced (V1_DEFERRED) │
   │  · System-admin       │  │  · ECS cluster        │    │   synthesized only       │
   │    Cognito pool       │  │    prod-basic        │    └──────────────────────────┘
   │  · SBT EventBus       │  │  · identitybasic /   │
   │  · TenantSeeder λ     │  │    academicsbasic /  │
   │  · AdminWeb CodePip.  │  │    financebasic /    │
   │  · EventDLQ           │  │    rproxybasic       │
   └──────────┬────────────┘  │  · Tenant Cognito    │
              │               │  · Per-svc DDB tables│
              ▼               │  · ABAC roles        │
   ┌──────────────────────┐   └──────────┬───────────┘
   │ analytics-stack       │              │
   │  · Aggregator λ       │              │
   │  · Read-path λ        │              │
   │  · analytics DDB      │              │
   │  · Rollup + IEMIS     │              │
   │    Janitor crons      │              │
   │  · Operator alarms    │              │
   └──────────┬────────────┘              │
              ▼                            │
   ┌──────────────────────┐                │
   │ core-appplane-stack   │                │
   │  · SBT ApplicationPlane                │
   │  · ProvisioningScriptJob (CodeBuild)   │
   │  · DeprovisioningScriptJob             │
   │  · CodeBuild-failure alarms (ISSUE-008)│
   └────────────────────────────────────────┘
```

**Six stacks total** ([server/bin/ecs-saas-ref-template.ts:119-230](server/bin/ecs-saas-ref-template.ts#L119)). Deploy order (set via `addDependency` + implicit prop wiring):

```
shared-infra → controlplane → analytics → core-appplane
shared-infra → tenant-template-basic
shared-infra → tenant-template-advanced (V1_DEFERRED, synthesized but never deployed)
```

Note that `core-appplane.addDependency(analytics)` ([:172](server/bin/ecs-saas-ref-template.ts#L172)) is intentional — SBT bus rules must be attached **before** services that emit to them come online, even though analytics conceptually consumes events from services that will be provisioned later.

### Frontends

- **AdminWeb** ([client/AdminWeb/](client/AdminWeb/)) — system-admin React UI, deployed via CodeBuild + S3 + CloudFront from `shared-infra-stack.adminSiteDistro`.
- **edforge-saas-frontend** ([edforge-saas-frontend/](edforge-saas-frontend/)) — tenant-facing Rsbuild + Module Federation shell with 4 production MFEs (academics, people, finance, analytics), deployed via **Vercel** on push to `main` (no CDK).

---

## 2. Infrastructure layer

### 2.1 CDK app entrypoint ([server/bin/ecs-saas-ref-template.ts](server/bin/ecs-saas-ref-template.ts))

**Env loader** (lines 19-25). Precedence is `shell > .env.<profile> > .env`. `dotenv` is invoked without `override:true`, so per-profile files win over the baseline but shell vars win over both.

**Hard-fail required env vars:**

| Var | Where | Notes |
|---|---|---|
| `CDK_PARAM_SYSTEM_ADMIN_EMAIL` | line 46-48 | tenant-admin fallback email |
| `CDK_PARAM_TIER` | via `getEnv()` line 65 | `basic` in V1 |
| `CDK_PARAM_COMMIT_ID` | line 66, auto-set by wrapper | git sha |
| `CDK_PARAM_CORS_ALLOWED_ORIGINS` | lines 110-116 | **no silent default** — prior incident |

**CDK Nag** (lines 40-43). Added as an Aspect **only** when `CDK_NAG_ENABLED === 'true'`. The default in `.env` is `true` but [scripts/deploy-analytics.sh:69](scripts/deploy-analytics.sh#L69) forces it to `false` for every wrapper-driven deploy. The suppression catalog ([server/lib/cdknag/](server/lib/cdknag/), 7 files) is incomplete enough that running with Nag on blocks deploys — it's effectively informational.

**`isProdAccount()` gate** ([server/lib/utilities/account-guards.ts:21-24](server/lib/utilities/account-guards.ts#L21)): `PROD_ACCOUNT_ID = '257526644020'`. Used to gate `deletionProtection` on every DDB table and Cognito pool. The check uses `CDK_DEFAULT_ACCOUNT` (resolved from AWS credentials chain), not `EDFORGE_ENV` — intentional fail-closed pattern.

### 2.2 shared-infra-stack

[server/lib/shared-infra/shared-infra-stack.ts](server/lib/shared-infra/shared-infra-stack.ts).

- **VPC** (lines 73-98): `10.0.0.0/16`, 3 AZs (hardcoded), `natGateways: 1` (reduced from 3 to save ~$66/mo in T6.6). VPC Flow Logs disabled at pilot (T5.1). Gateway Endpoints for S3 + DynamoDB on private subnets (T5.4).
- **ALB**: internal-facing, in private subnets, HTTP-80 listener.
- **NLB**: internal, cross-zone, fronts the ALB via `AlbListenerTarget`. API Gateway `VpcLink` attaches to the NLB so traffic flows API Gateway → NLB → ALB → ECS.
- **API Gateway** ([api-gateway.ts](server/lib/shared-infra/api-gateway.ts)): `SpecRestApi` built from the **hand-maintained** [server/lib/tenant-api-prod.json](server/lib/tenant-api-prod.json) OpenAPI spec (21,295 lines). Placeholders `{{stage}}`, `{{connection_id}}`, `{{integration_uri}}`, `{{region}}`, `{{account_id}}`, `{{authorizer_function}}`, `{{CORS_ALLOWED_ORIGIN}}` are substituted at synth.
- **Python Lambda authorizer** (`tenant_authorizer.py` in [server/lib/shared-infra/Resources/](server/lib/shared-infra/Resources/)) is the API Gateway's token authorizer — apiKeySource is `AUTHORIZER` so the authorizer returns the right tier API key.
- **Tenant-mapping DDB** (lines 317-324): single attribute `tenantId` PK, no sort key, PITR on, RETAIN, deletionProtection prod-only. No GSIs.
- **AdminWeb CloudFront**: `StaticSiteDistro` exposed as `this.adminSiteDistro` (line 299-307); ControlPlaneStack reuses both bucket + distro.
- **EventDLQ sub-stack** ([event-dlq-stack.ts](server/lib/shared-infra/event-dlq-stack.ts)) is *defined* under shared-infra but is **instantiated inside ControlPlaneStack** at [control-plane-stack.ts:113](server/lib/bootstrap-template/control-plane-stack.ts#L113), with `environment: 'prod'` hardcoded. Two-tier SQS (`edforge-event-dlq-prod` + `edforge-event-final-dlq-prod`, 14-day retention), processor Lambda (max 3 retries), alarm + dashboard.
- **CFN outputs** include `ApiGatewayUrl`, `TenantApiRestApiId`, `TenantApiAuthorizerArn`, `adminSiteUrl` (no `exportName`), `ALBDnsName`, `ListenerArn`, `EcsVpcId`. **Missing**: `AdminSiteBucketName` and `AdminSiteDistroId` — CLAUDE.md flags this; bucket + distro ID must be discovered at deploy time via `list-distributions`.

### 2.3 controlplane-stack

[server/lib/bootstrap-template/control-plane-stack.ts](server/lib/bootstrap-template/control-plane-stack.ts).

- **System-admin Cognito pool** via `sbt.CognitoAuth` (lines 41-43). `deletionProtection` set via L1 escape hatch when `isProdAccount()` (SBT 0.9.1 doesn't expose it as a prop).
- **SBT ControlPlane** (`@cdklabs/sbt-aws`, line 60) — owns the `/tenants` (list), `/tenant-registrations` (create) REST routes; EdForge does not declare them. Configures CORS to merge `CDK_PARAM_CORS_ALLOWED_ORIGINS` with the AdminWeb CloudFront URL and to allow EdForge multi-tenant headers (`x-tenant-id`, `x-school-id`, `x-request-id`, `x-user-role`, `x-correlation-id`).
- **Tenant-seeder Lambda** ([tenant-seeder-lambda.ts](server/lib/bootstrap-template/tenant-seeder-lambda.ts)) — inline NodeJS 22, 30s/256MB. EventBridge rule `edforge-provisioning-success-seeder` subscribes to `source=sbt.application.plane, detailType=sbt_aws_provisionSuccess`. **The handler code is stringified at CDK synth time** (lines 112-118, 130-136), interpolating `COUNTRY_DEFAULTS` and `ARCHETYPE_DEFAULTS` from `@aibrains/shared-types` via `JSON.stringify`. This is why a locale-defaults change requires `npm publish @aibrains/shared-types` → `controlplane-stack` redeploy. IAM scoped to `dynamodb:PutItem|UpdateItem|GetItem` on three hardcoded ARNs (basic/premium/advanced — the latter two are wasted permission surface for V1).
- **AdminWeb StaticSite** ([static-site.ts](server/lib/bootstrap-template/static-site.ts)) — versioned S3 source bucket + `BucketDeployment` that zips `client/AdminWeb/` + CodeBuild PipelineProject (NodeJS 22, `npm install --legacy-peer-deps --no-optional` + `npm run build`) + CodePipeline V2 that deploys to the CloudFront origin bucket from shared-infra. The buildspec inlines `src/config/environment.ts` at synth with the resolved Cognito + API URLs.
- A comment at lines 125-130 records that the Cognito PostAuthentication trigger was **moved out** of this stack into tenant-template (so it attaches to the tenant pool, not the system-admin pool).

### 2.4 analytics-stack

[server/lib/analytics/analytics-stack.ts](server/lib/analytics/analytics-stack.ts) (1024 lines).

- **SNS operator topic** `edforge-alerts-operator` (lines 95-101), email-subscribed.
- **Three DDB tables** (all PAY_PER_REQUEST, PITR, RETAIN, deletionProtection-on-prod): `edforge-analytics` (PK/SK + GSI1), `edforge-analytics-landing` (idempotency store keyed on `eventId`), `edforge-user-session-events`.
- **Aggregator Lambda** `edforge-analytics-aggregator` (NodeJS 20, 512MB, 60s) consumes EventBridge with dedicated DLQ. Two EventBridge rules: `edforge-analytics-native` (`source=edforge.analytics`) and `edforge-domain-events` (`source ∈ {edforge.academics-service, edforge.finance-service, edforge.identity-service}`).
- **API Lambda** `edforge-analytics-api` attaches to the **shared tenant REST API** via `cdk.Fn.importValue('TenantApiRestApiId')` — new construct ID `SharedTenantTokenAuthorizer` because changing an existing Authorizer's `Type` is forbidden by CFN. Routes: `/analytics/tenants/{tenantId}/adoption-report`, `/analytics/tenants/{tenantId}/export-csv-url`, `/analytics/tenants/{tenantId}`, `/analytics/fleet`, `/analytics/me/session-history`.
- **Rollup Lambda** `edforge-analytics-rollup` — cron `0 1 * * ? *` Asia/Kathmandu (daily 01:00 KTM) via `ScheduledLambda` (EventBridge Scheduler + NodejsFunction).
- **IEMIS Job Janitor** `edforge-iemis-job-janitor` — cron `*/5 * * * ? *` UTC, scans `edforge-academics-basic` for stale jobs (`STALE_THRESHOLD_MIN=30`). EventBridge Scheduler-based, so **does NOT appear in Lambda console's Triggers tab** (this is correct; same pattern as the rollup).
- **Alarms** all route to the operator SNS topic: aggregator DLQ depth, aggregator throttles, landing-table WCU burst, aggregator errors, tenant-seeder errors, ALB 5xx surge, rollup heartbeat, IEMIS janitor errors.
- **Dashboards**: `edforge-analytics-health` (internals) and `edforge-pilot` (operator at-a-glance).
- **WorkspaceSettingsUpdated rule** routes `source=edforge.identity-service, detailType=WorkspaceSettingsUpdated` to the API Lambda for cache invalidation.

### 2.5 core-appplane-stack

[server/lib/bootstrap-template/core-appplane-stack.ts](server/lib/bootstrap-template/core-appplane-stack.ts).

- **SBT ApplicationPlane** wired to two SBT script jobs.
- **ProvisioningScriptJob** (lines 38-104): `script: fs.readFileSync('./lib/provision-scripts/provision-tenant.sh', 'utf8')` — embedded at synth. Wildcard `*:*` IAM (lines 42-48) because CodeBuild must `cdk deploy` arbitrary CFN. Incoming string vars from event: `tenantId, tier, tenantName, email, country, archetype, tenantTag, useFederation, useEc2, useRProxy`. Outgoing `tenantData`: `tenantId, tenantS3Bucket, tenantConfig, prices, tenantName, email, tier, country, archetype, tenantTag`.
- **DeprovisioningScriptJob** (lines 75-98): reads `./lib/provision-scripts/deprovision-tenant.sh`.
- **Source tarball location**: `s3://saas-reference-architecture-ecs-<account>-<region>/source.tar.gz` (created lazily by [scripts/utils/update-provision-source.sh](scripts/utils/update-provision-source.sh)).
- **SNS** `edforge-provisioning-alerts` (lines 123-149) — email-subscribed via `operatorAlertEmail` (Phase 4 fix; previously had no subscriber).
- **SBT ISSUE-008 safety net** (lines 151-175): `edforge-provisioning-codebuild-failures` + `edforge-deprovisioning-codebuild-failures` alarms on raw `FailedBuilds` metric. SBT's Step Function `Catch` masks CodeBuild failures as success; these alarms bypass that mask.

### 2.6 tenant-template-stack-basic

[server/lib/tenant-template/](server/lib/tenant-template/).

- **ECS cluster** `prod-basic` ([ecs-cluster.ts](server/lib/tenant-template/ecs-cluster.ts)). Fargate-only (BASIC uses `useEc2=false`).
- **Service registration** ([tenant-template-stack.ts:155-176](server/lib/tenant-template/tenant-template-stack.ts#L155)) reads `lib/service-info.json` (produced by `sed`-substituting `service-info.txt` at provision time), then replaces `<NAMESPACE>`, `<EVENT_BUS_NAME>`, and a **per-tenant deterministic `<INTERNAL_API_KEY>`** = `SHA256('edforge-internal-api-key:' + tenantName)`.
- **Four services** in cluster `prod-basic` (per [service-info.txt](server/service-info.txt)):
  - `identitybasic` (port 3010, 512MB/256CPU)
  - `academicsbasic` (port 3010, 1024MB/512CPU)
  - `financebasic` (port 3010)
  - `rproxybasic` (port 80, 512MB/256CPU, no DDB)

  All run `desiredCount: 1` at pilot scale ([services.ts:135-143](server/lib/tenant-template/services.ts#L135)). Note that desiredCount=1 means rolling deploys briefly have zero healthy tasks — explicitly accepted at pilot scale.
- **Per-service DDB tables** ([ecs-dynamodb.ts](server/lib/tenant-template/ecs-dynamodb.ts)): `edforge-<service>-basic`, all PAY_PER_REQUEST, PK=`tenantId`/SK=`entityKey`, PITR, RETAIN, deletionProtection-on-prod, TTL on `ttl`. **Eight GSIs** (gsi1pk/sk through gsi8pk/sk, all ALL projection); GSI9-12 commented out (DDB allows one GSI mutation per update).
- **ABAC IAM policy** ([ecs-dynamodb.ts:204-226](server/lib/tenant-template/ecs-dynamodb.ts#L204)): main table reads constrained by `dynamodb:LeadingKeys = ['${aws:PrincipalTag/tenant}']`. **GSI queries have NO LeadingKeys condition** — explicit comment says tenant filtering happens at the app layer because GSIs use `gsi*pk`, not `tenantId`. Architectural decision; security-review-relevant.
- **Task role construction** ([tenant-template-stack.ts:364-494](server/lib/tenant-template/tenant-template-stack.ts#L364)): one `ecsTaskRole` per service + an `${name}-ABACRole` per DDB-backed service. Task role can `sts:AssumeRole` + `sts:TagSession` on the ABAC role under condition `aws:RequestTag/tenant` matches. **Token Vending Machine pattern.**
- **Per-tenant Cognito user pool** ([identity-provider.ts](server/lib/tenant-template/identity-provider.ts)) with custom attributes `tenantId, userRole, apiKey, tenantTier, tenantName`. Welcome email is a hand-built HTML template.
- **PostAuthentication Lambda trigger** attached to the **tenant pool** (not control plane), emits `LoginSuccess` events to the SBT bus.

### 2.7 Environment profiles (the real state)

Only **two** env files exist on disk: [server/.env](server/.env) (baseline) and [server/.env.prod](server/.env.prod). **`server/.env.uat` does NOT exist** — confirmed by directory listing. CLAUDE.md's reference to UAT is stale; UAT was sunset under [docs/infrastructure-sunset/](docs/infrastructure-sunset/) and the team is now PR-first → prod (see §13).

| | Prod (`.env.prod`) |
|---|---|
| AWS account | 257526644020 |
| Region | ap-south-1 (Mumbai) |
| Tenant frontend | https://edforge.app, https://www.edforge.app |
| `CDK_PARAM_CORS_ALLOWED_ORIGINS` | `https://edforge.app,https://www.edforge.app` |
| `CDK_PARAM_CLIENT_APP_URL` | `https://edforge.app` |
| `CDK_PARAM_ANALYTICS_ENABLED` | `true` |
| `CDK_NAG_ENABLED` | `false` |
| `CDK_PARAM_SYSTEM_ADMIN_EMAIL` | aws-prod@edforge.app |
| `CDK_PARAM_OPERATOR_ALERT_EMAIL` | shoaib@edforge.app |

---

## 3. Backend services

All three NestJS services run on Express, listen on port 3010, have **no global API prefix** (routes match API Gateway directly), use global `ZodValidationPipe` from `nestjs-zod`, and emit structured logs via `@app/logger`.

### 3.1 identity service

[server/application/microservices/identity/](server/application/microservices/identity/) — largest backend service.

**Module composition** ([identity.module.ts](server/application/microservices/identity/src/identity.module.ts)): `Auth, Users, Roles, Sessions, Schools, EducationOrganizations, Tenants, AcademicYears, SchoolYears, Security, Staff, Credentials, StaffTrainings, Leave, Admin, Calendar` (Ed-Fi Calendar Domain), `MasterSchedule` (Ed-Fi ClassPeriod + Location), `Iemis`. Global `FeatureUsageInterceptor` emits `feature.usage` events on every non-GET request.

**Authentication** ([jwt.strategy.ts](server/application/libs/auth/src/jwt.strategy.ts)): Passport + `passport-jwt` + `jwks-rsa` against Cognito JWKS. Strips claims into `TenantContext { userId, tenantId, tenantTier, tenantName, email, globalRole, userPoolId, appClientId }`.

**Guard chain** (per route): `JwtAuthGuard` → `GlobalRoleGuard` (`@RequireGlobalRole`) → `PermissionGuard` (`@RequirePermission({resource, action})`, with `verifyDynamoRole: true` escape hatch to catch recently-demoted admins) → `IemisPermissionGuard` (`@RequireIemisPermission`) → `TenantValidationGuard` (defense-in-depth).

**Dual-layer ABAC:**
1. *Application layer*: [permission-matcher.ts](server/application/microservices/identity/src/common/utils/permission-matcher.ts) evaluates `resource:action`, `resource:*`, `*:*` patterns against the role's allowed permissions. `DEFAULT_ROLE_PERMISSIONS` per SchoolRole at [role-assignment.entity.ts:145-211](server/application/microservices/identity/src/common/entities/role-assignment.entity.ts#L145).
2. *IAM layer*: `DynamoDBClientService.getClient(tenantId, jwt)` assumes the per-tenant ABAC role via STS using the Token Vending Machine — the returned creds carry a `dynamodb:LeadingKeys = {{tenant}}` condition so even a buggy controller can't read another tenant's rows.

**Tenant entity** ([tenant.entity.ts:24-79](server/application/microservices/identity/src/common/entities/tenant.entity.ts#L24)): PK=`TENANT#{tenantId}`, SK=`METADATA`. `archetype?: 'PABSON' | 'GENERIC' | 'CBSE_IN' | 'NAIS_US' | 'GEMS_UAE'` — only PABSON/GENERIC pass runtime validation in V1. `tenantTag` is **NOT** in the entity type — written to DDB by the seeder Lambda but invisible to the NestJS runtime (see §13 drift).

**WorkspaceSettings entity** ([workspace-settings.entity.ts](server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts)): SK=`SETTINGS#WORKSPACE`. Carries `regional` (timezone, locale, dateFormat, timeFormat, weekStartsOn, currency, calendarSystem `gregorian|bikram_sambat`, enableDualDateDisplay, numberFormat), `branding`, `policies`, `features`, and `isLocked`+`lockReason`. `isLocked` flips to true once any AY transitions to active (P0.16); no system-admin force-unlock endpoint (P1 follow-up).

**COUNTRY_DEFAULTS + ARCHETYPE_DEFAULTS** are hand-duplicated inline ([lines 121-190](server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts#L121)). The header comment (lines 1-27) names all three triplication sites (this entity, the synth-inlined seeder Lambda, AdminWeb) and explains the duplication: Dockerfile uses flat `npm install` from the registry without workspace symlinks. The contract spec `workspace-settings-contract.spec.ts` is the drift guard.

**School entity** ([school.entity.ts](server/application/microservices/identity/src/common/entities/school.entity.ts)): SK=`SCHOOL#{schoolId}`. Carries `emisSchoolCode?: string` (Nepal IEMIS, **required for PABSON**, immutable after creation). **GSI8** is the *sparse* cross-tenant uniqueness index (`gsi8pk = emisSchoolCode`). CLAUDE.md's IEMIS Sprint 1 memory note that "audit log uses GSI8" is **stale** — audit events use the primary table with `entityKey = AUDIT#IEMIS#{ts}#{eventId}`.

**SchoolConfiguration story** ([schools.service.ts:1051-1145](server/application/microservices/identity/src/schools/schools.service.ts#L1051)): `getConfiguration` and `updateConfiguration` now throw `NotFoundException` on missing config row (T4 fix); previously they lazy-created US-defaults orphan rows. Config row is created eagerly by `createSchool` with country-merged defaults. `CONFIG_LOCKED_FIELDS = ['gradingScale','schoolDays','startTime','endTime','periodDuration','academicCalendarType']` are locked when AY is active; force-overridable with `forceOverride:true + overrideReason`.

**Education organizations** ([education-organizations.controller.ts](server/application/microservices/identity/src/education-organizations/education-organizations.controller.ts)): full Ed-Fi EdOrg hierarchy (`STATE_EDUCATION_AGENCY | LOCAL_EDUCATION_AGENCY | EDUCATION_SERVICE_CENTER | EDUCATION_ORG_NETWORK | NETWORK_ASSOCIATION`).

**Role taxonomy:**
- `GlobalRole = TenantAdmin | TenantUser` only.
- `SchoolRole = Principal | VicePrincipal | Teacher | Accountant | Staff | Counselor | Nurse | Student | Parent`.
- Role assignment is per-school. P0.14 multi-role: one row can carry `roles: SchoolRole[]` with `role` being the primary. Seniority ladder hardcoded at [roles.service.ts:39-50](server/application/microservices/identity/src/roles/roles.service.ts#L39) (Principal=100 down to Parent=10). Non-`TenantAdmin` callers can't assign at or above their own seniority.
- `PlatformOperator` is referenced by `IemisPermissionGuard` but **not declared** in `GlobalRole`; a JWT with that role would be coerced to `TenantUser` (see §13).

**Staff/Credentials/StaffTrainings/Leave** — all GSI1 keys use lowercase `gsi1pk/gsi1sk` field names (S3.2 fix). `TrainingType` is a CEHRD-aligned vocab. **Open**: `Leave PATCH /cancel` returns 500 — only recurring smoke regression on prod, tracked as deferred work `C0.b.1`.

**IEMIS module** (identity-side only): `GET /iemis/verify-school-code/:code` (format-only validation, 8-10 digits) and `GET /iemis/audit` (paginated reverse-chronological, PII-redacted for non-admins, emits `audit.viewed` event). The async **import** flow lives in **academics**, not identity.

**Academic years vs sessions** ([academic-years.controller.ts](server/application/microservices/identity/src/academic-years/academic-years.controller.ts)): C4 decoupled AY from session auto-creation. Creating an AY no longer auto-creates sessions; template picker on Sessions step.

**Notable open issues** in identity:
- `AuthService.login`, `getCurrentUser`, `refreshToken`, `logout`, `invalidateAllUserSessions` all use `getSystemClient()` (unscoped credentials) with an explicit `TODO` at [auth.service.ts:119](server/application/microservices/identity/src/auth/auth.service.ts#L119). Login can't easily use TVM (no JWT yet); the rest could.
- User creation defaults tier to `'basic'` ([users.service.ts:126](server/application/microservices/identity/src/users/users.service.ts#L126)) when tenant metadata is missing — flagged `TODO` as a latent bug.
- `IdempotencyService` exists but no consumer adopts it yet; foundation only.
- CORS env var name is `CORS_ORIGINS` ([main.ts:61](server/application/microservices/identity/src/main.ts#L61)) but the CDK env var is `CDK_PARAM_CORS_ALLOWED_ORIGINS` — task definition must map between the two.

### 3.2 academics service

[server/application/microservices/academics/](server/application/microservices/academics/). Nine feature modules + analytics-events. Global ZodValidationPipe, 5 MB body parser (for bulk IEMIS imports), every controller class-level `JwtAuthGuard`.

**DDB key model** is a single-table per service with PK=`tenantId`/SK=`entityKey`. Five GSIs reused: GSI1 (school scope), GSI2 (student-centric), GSI3 (attendance-date), GSI7 (sparse EMIS).

**Students** ([students.controller.ts](server/application/microservices/academics/src/students/students.controller.ts)) — student entity carries canonical Ed-Fi-shaped fields (`sexDescriptor`, `languageDescriptor`, `motherTongueDescriptor`, `disabilities[]`, `ethnicityDescriptor`, `isTransferred`, `belowPovertyLine`, `scholarshipCategory`), an `emisStudentId` for the sparse GSI7 index, and Nepal-aware Address fields (`wardNumber`, `municipality`, `district`, `province`). Routes include `POST /academics/students`, bulk CSV `POST /academics/students/import`, and the **IEMIS async importer** `POST /academics/students/import/iemis` — `dryRun:true` returns sync preview; `dryRun:false` returns **202+jobId** and fires `executeIemisImportAsync` via `setImmediate`. 1000-row cap. Optional `enrollInAcademicYearId` triggers auto-enrollment in the same worker (C4's "Enroll all into AY" mechanism — solved the 779 manual-click problem).

**Enrollment** ([enrollment.service.ts](server/application/microservices/academics/src/enrollment/enrollment.service.ts)) has two creation paths:
- `createEnrollment` (heavyweight): full data-scope check, identity HTTP fetch, overlap-primary check, audit trail.
- `createEnrollmentForImport` (fast path, lines 295-457): explicitly documents 3 deliberate cost cuts (skip getAcademicYears HTTP, skip data-scope resolution, skip overlap check) and takes a `sharedClient` so the worker only acquires DDB creds once for the whole batch. **This is what makes 779-row pilot imports tractable.**

State transitions through `validateTransition` ([common/utils/enrollment-state-machine.ts](server/application/microservices/academics/src/common/utils/enrollment-state-machine.ts)). Withdrawal/transfer `cascadeDeactivateSectionEnrollments` and `POST /internal/webhooks/student-withdrawn` on finance.

[`StudentSchoolAssociationController`](server/application/microservices/academics/src/enrollment/student-school-association.controller.ts) is an **Ed-Fi read projection** over the internal Enrollment entity. Writes stay on the Enrollment controller.

**Dashboard** ([dashboard.controller.ts](server/application/microservices/academics/src/dashboard/dashboard.controller.ts)) — single endpoint `GET /academics/dashboard/overview?schoolId=&academicYearId=&date=`, `@CacheTTL(60)` + 60s in-memory cache. Three sub-queries in `Promise.all`: enrollment summary (with `byGradeLevel: Record<string,number>` — **this is what the Curriculum tab reads since T6**), active sections count, today's attendance.

**Grades** — **policy-based**, not hardcoded. Default policy ([grading-policy.service.ts:198-244](server/application/microservices/academics/src/grades/grading-policy.service.ts#L198)) is **US-style A-F with 4.0 GPA**: A 90-100/4.0, B 80-89.99/3.0, etc., default category weights tests/quizzes/homework/participation/projects = 30/20/20/10/20. Schools can replace via `POST /academics/grading-policies`; validation enforces contiguous non-overlapping scale ranges + category weights summing to 100. GPA calculator supports unweighted, weighted, honors (+0.5/cap 4.5), AP (+1.0/cap 5.0). **No NEB/CEHRD-aligned Nepal grading scale is shipped** — PABSON schools must configure it themselves.

**Course `subjectArea` enum is US/CCSS-shaped** (`mathematics | english_language_arts | world_languages | …`) and standards are `Common Core | NGSS | State Standard`. Doesn't match Nepal CEHRD subject taxonomy. T7 in the grade-level retro was deferred.

**Attendance / Section-attendance** ([attendance.controller.ts](server/application/microservices/academics/src/attendance/attendance.controller.ts)) — three caches (calendar 5min, overview 60s, student-name 5min). Cross-service `validateInstructionalDay` against identity (graceful-degrades to "allow" if identity is down).

**`F-PERF-1` root cause is concrete and large**: `getAttendanceAlerts` ([attendance.service.ts:963-1106](server/application/microservices/academics/src/attendance/attendance.service.ts#L963)) does N students × 3 GSI-range queries each (full window + first half + second half for trend), batched 10 at a time. At 779 students × 3 × ~90-day GSI range that's ~2,340 ops behind a 30s API Gateway timeout. 60s overview cache mitigates warm path; cold path will time out at PABSON scale.

**Ed-Fi alignment is strong on entity shape, weaker on descriptor values**: SSA projection, descriptor URIs everywhere, Ed-Fi entry/exit fields canonical, course/section maps cleanly to Ed-Fi Course/Section/StudentSectionAssociation/StaffSectionAssociation. But descriptor *values* are still US/Ed-Fi-canonical strings — no `CEHRD`-namespace descriptor catalog yet (Sprint 6 reserved for the Nepal ethnicity/caste catalog).

### 3.3 finance service

[server/application/microservices/finance/](server/application/microservices/finance/). 11 feature modules. `TenantSettingsService` is provided centrally.

**Payments — atomic transaction work is the headliner** ([payments.service.ts](server/application/microservices/finance/src/payments/payments.service.ts)). Both `recordManualPayment` (lines 49-223) and `completePayment` (lines 694-848) collapse four writes into a single `TransactWriteItems`:
1. Put new `Payment` or Update existing pending Payment to `completed` (conditional on `attribute_not_exists(entityKey)` or `#v = :currentVersion`).
2. Update Invoice — built by `InvoicesService.buildApplyPaymentTransactItem` (decrements `amountDue`, increments `amountPaid`, transitions status to `partially_paid`/`paid`, with `ConditionExpression: '#v = :currentVersion AND #status IN (…)'`).
3. Put `LedgerEntry` (conditional on `attribute_not_exists(entityKey)`).
4. Update `BillingAccount` balance + totalPaid + lastPaymentDate, optimistic-locked on version.

`TransactionCanceledException` → 409 `CONCURRENT_UPDATE` with parsed per-op detail (e.g. `payment_put=OK, invoice_apply=ConditionalCheckFailed, ledger_put=None, account_update=None`). Helpers `buildLedgerEntryTransactItems` and `buildApplyPaymentTransactItem` are reusable; standalone `recordLedgerEntry/applyPayment` kept for void/refund/invoice-issue paths. Receipt-number sequence is advanced *before* the transaction; wasted numbers on rollback explicitly accepted.

**Currency status (C2.A):**
- `Payment` and `Invoice` are **fully widened to `currency: string`**, sourced from `WorkspaceSettings.regional.defaultCurrency` via `TenantSettingsService`. Mismatch enforcement: if `dto.currency` is present and ≠ `invoice.currency`, throw 400 `PAYMENT_CURRENCY_MISMATCH`.
- **CreditNote/FeeStructure/RefundRequest are widened in TS but still runtime-default to `'NPR'`**: `currency: data.currency || 'NPR'` in `createCreditNoteEntity` ([credit-note.entity.ts:78](server/application/microservices/finance/src/common/entities/credit-note.entity.ts#L78)), `createFeeStructureEntity` ([fee-structure.entity.ts:91](server/application/microservices/finance/src/common/entities/fee-structure.entity.ts#L91)), `createRefundRequestEntity` ([refund-request.entity.ts:65](server/application/microservices/finance/src/common/entities/refund-request.entity.ts#L65)). RefundRequest pulls from `payment.currency` in practice, so it inherits correctly *only when the originating payment was widened-currency*.

**Student accounts — `BILLING_ACCOUNT_LOOKUP` mirror row** (C2.B-T3, [billing-account.entity.ts:97-129](server/application/microservices/finance/src/common/entities/billing-account.entity.ts#L97)) keyed `ACCOUNT#<accountId>` gives O(1) GetItem lookup-by-account-id. Written transactionally with the canonical row. Legacy GSI1+filter scan retained as fallback with warn-log.

**Payment gateways** — eSewa (Nepal HMAC-SHA256 form POST) and Khalti (Nepal server-to-server REST, paisa-denominated) adapters are **fully implemented** at [adapters/esewa.adapter.ts](server/application/microservices/finance/src/payment-gateways/adapters/esewa.adapter.ts) and [adapters/khalti.adapter.ts](server/application/microservices/finance/src/payment-gateways/adapters/khalti.adapter.ts) — **but the registry constructor does NOT call `this.register(...)`** ([gateway-adapter-registry.service.ts:18-29](server/application/microservices/finance/src/payment-gateways/adapters/gateway-adapter-registry.service.ts#L18)): "Gateway adapters disabled for MVP pilot — online payments not in scope." **Pilot is manual-payment-only** (cash, bank_transfer, cheque). Any `POST /payments/initiate` against eSewa/Khalti takes a fallback synthetic-redirect path.

**Webhooks — enrollment→billing bridge** ([enrollment-webhook.controller.ts](server/application/microservices/finance/src/webhooks/enrollment-webhook.controller.ts)) at `/internal/webhooks/*`, protected by `InternalApiKeyGuard` (service-to-service shared secret, separate from JWT). Two endpoints: `enrollment-completed` (with academics→finance enum normalization `'new' → 'new_admission'`) and `student-withdrawn`. **Drift risk**: this normalization happens only on the synchronous HTTP webhook, not on the EventBridge event — any future third consumer sees the original `'new'`.

**Discount rules** are configuration-not-engine: fixed taxonomy `{sibling, early_payment, scholarship, staff_child, manual}`, consuming services evaluate inline.

### 3.4 rproxy

[server/application/reverseproxy/](server/application/reverseproxy/). Base image `public.ecr.aws/nginx/nginx:1.27-alpine`. Entrypoint does `envsubst '${NAMESPACE}' < /etc/nginx/nginx.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'` — **only `$NAMESPACE` is substituted**.

**Routing topology** ([nginx.template](server/application/reverseproxy/nginx.template)):
- Path prefix → service via ECS Service Connect DNS `{service-name}.{namespace}.sc:3010`.
- Identity (`identity-api.${NAMESPACE}.sc:3010`): `/auth, /users, /schools, /tenants, /school-years, /education-organizations, /staff, /credentials, /admin, /sessions, /iemis`. (The `/iemis` block was added 2026-04-23 after Sprint 1 S1.5+S1.10 smoke revealed it missing.)
- Academics: catch-all `^/academics`.
- Finance: catch-all `^/finance`.
- Stub `^/parents` returns hardcoded `501` `{error: 'Not Implemented', service: 'parent-portal', message: 'Parent portal is planned for Phase 3'}`.

**Health check** `GET /health` returns hardcoded `200 {"status":"ok"}` — does **NOT** probe upstream. ALB target health is "is rproxy alive," not "are services healthy." Worth knowing for incident triage.

**No JWT validation, no rate limit, no body-size limit, no CORS injection at rproxy.** Every backend service runs its own `JwtAuthGuard` + `app.enableCors()`. CORS is per-service, not centralized.

**Three-way route handoff rule** (CLAUDE.md): when adding a new endpoint, the controller decorator + `tenant-api-prod.json` API Gateway spec + nginx.template (only if new top-level prefix) **must all be updated**. Symptom diagnosis: `403 SigV4` = API GW missing; `404` from nginx server header = rproxy missing; Nest `404` JSON body = controller missing or typo'd.

---

## 4. Frontends

### 4.1 AdminWeb ([client/AdminWeb/](client/AdminWeb/))

**CRA v5 (webpack 5)** + React 18 + MUI 5 + `react-oidc-context` + `oidc-client-ts` (not Amplify, despite the declared `aws-amplify` deps).

**Routes** ([App.tsx:94-99](client/AdminWeb/src/App.tsx#L94)): `/dashboard`, `/tenants`, `/tenants/create`, `/tenants/:id`, `/auth/info`, `/callback`. Entire surface. **No Workspace Settings page in AdminWeb** — that lives in the tenant-facing shell.

**Create Tenant form** ([TenantCreate.tsx](client/AdminWeb/src/pages/Tenants/TenantCreate.tsx)) — POSTs to `${apiUrl}/tenant-registrations` (the SBT control-plane endpoint), **not** `/tenants` (CLAUDE.md's "POST /tenants" wording is loose).
- Tier hard-locked to BASIC; Advanced/Premium tier cards rendered but disabled.
- `tenantTag` dropdown defaults to `internal-dev`. Choosing `production` reveals an inline warning + confirmation checkbox; submit blocked until the checkbox is ticked.
- Compile-time `Exclude<TenantTag, ...> extends never` assertion guarantees the UX list covers every enum value.
- `tenantName` validated against `/^[a-z][a-z0-9-]*$/`.

**Tenant List** ([TenantList.tsx](client/AdminWeb/src/pages/Tenants/TenantList.tsx)) — card grid with infinite scroll. **TenantTag filter persisted in URL** (`?tag=all|production-only|internal-only`), defaults to `production-only` so dev tenants don't clutter the operator view.

**zod is NOT in AdminWeb's `package.json`** — pulled transitively via `@aibrains/shared-types`. The repo-wide `~3.24.4` pin is the bugfence; 3.25+ ships a v4-preview circular ESM re-export that webpack 5 can statically traverse but produces a `TypeError: Cannot read properties of undefined (reading 'string')` at module init, before React's `createRoot` runs — silent white-screen on the CloudFront bundle. Confirmed end-to-end during the Midnight Lockin UAT deploy on 2026-04-19.

### 4.2 edforge-saas-frontend ([edforge-saas-frontend/](edforge-saas-frontend/))

**pnpm workspaces + Turbo + Rsbuild + Rspack**, Node ≥22, pnpm ≥10. Supply-chain hardening: `minimumReleaseAge: 10080` (7 days) on all non-`@edforge/*` packages; `strictDepBuilds: true` with allowlist of just `esbuild` + `msw`.

**Module Federation host = shell**; 4 production remotes:

| Remote | Port | Bootstrap |
|---|---|---|
| `academics` | 3002 | `apps/academics/src/bootstrap.tsx` — students, teachers, enrollment, sections, curriculum, IEMIS import |
| `people` | 3006 | `apps/people/src/bootstrap.tsx` — staff, departments, roles, HR |
| `finance` | 3003 | `apps/finance/src/bootstrap.tsx` — invoices, payments, accounts, fee structures, gateways |
| `analytics` | 3008 | `apps/analytics/src/bootstrap.tsx` — dashboard, enrollment/attendance/performance/finance reports |

**Parked MFEs** (declared but excluded from prod build): `edfi`, `messages`, `special-programs`. [scripts/build-deploy.sh:45-49](edforge-saas-frontend/scripts/build-deploy.sh#L45) FATALs if any leak into `output/remotes/`.

**MF singleton list — `@edforge/config/mf-shared`** ([packages/config/src/mf-shared.ts:23-79](edforge-saas-frontend/packages/config/src/mf-shared.ts#L23)) is the load-bearing list. All entries `singleton: true, eager: true`. Includes: `aws-amplify, @edforge/auth, react, react-dom, @tanstack/react-query, @tanstack/react-router, @tanstack/react-table, zustand, @edforge/ui, @edforge/abac, @edforge/types, @edforge/theme, @edforge/config, @edforge/forms, @edforge/i18n, i18next, react-i18next, @edforge/date-utils, react-hook-form, @hookform/resolvers, zod, framer-motion, @react-spring/web, sonner`.

The `@edforge/config` singleton is critical — `school-context-channel.ts` keeps tenant context in a module-level `_lastPayload` variable that every MFE reads via `useTenantContext`. Without `singleton: true` each MFE bundles its own copy and cross-MFE state never syncs (this was the Sprint A.12/A.13 archetype-blind forms incident).

**The `analytics` MFE does NOT use the shared MF config** — it inlines its own. Any new singleton added to `getMFSharedConfig` will silently skip the analytics remote. Latent bug, same failure mode as the A.12/A.13 incident.

**Shell routing** ([apps/shell/src/router.tsx](edforge-saas-frontend/apps/shell/src/router.tsx)) covers public landing (`/`, `/about`, etc.), auth (`/login`, `/forgot-password`, `/auth/callback`, `/onboarding`), and protected app — `/home`, `/settings/*` (14 child routes including `/settings/workspace` → `WorkspaceSettingsPage`), `/academics/$`, `/finance/$`, `/people/$`, `/analytics/$` (splat MFE mounts), `/student-portal/{grades,attendance,schedule}`, `/parent-portal/{grades,attendance,schedule,fees}` (non-federated, in-shell), `/payments/callback`, `/payments/$paymentId/receipt`.

**API client** ([packages/api-client/src/index.ts](edforge-saas-frontend/packages/api-client/src/index.ts)): baseURL `/api`. The request interceptor stamps `X-Correlation-Id`, adds `Authorization: Bearer <idToken>`, **decodes the JWT to extract `custom:tenantId` and sets `X-Tenant-Id` header**.

**Auth** ([packages/auth/src/](edforge-saas-frontend/packages/auth/src/)) — AWS Amplify v6, OAuth2 authorization code + PKCE, scopes `openid email profile`. Single Cognito User Pool ID per environment (set via Vercel env). Tenant scoping is via the `custom:tenantId` claim, which the post-auth Lambda trigger writes.

**ABAC** ([packages/abac/src/](edforge-saas-frontend/packages/abac/src/)) — client-side mirror of server ABAC. `TenantAdmin` always true; `StandardUser` keys on per-school role assignments + a `ROLE_PERMISSIONS` matrix. React hooks `usePermission`, `useCanAccess`, etc. Server enforces the real ABAC.

**BS calendar** ([packages/ui/src/components/BsDatePicker.tsx](edforge-saas-frontend/packages/ui/src/components/BsDatePicker.tsx)) imports `gregorianToBs`, `bsToGregorian`, `getBsMonthDays`, etc. **directly from `@aibrains/shared-types`** — same canonical converter the backend analytics Lambda uses. Always emits Gregorian ISO from `onChange`; displays BS when `i18n.language === 'ne'`.

**Forms** — built on `react-hook-form` + zod. The `setValueAs: v => v === '' ? undefined : v` pattern for `.url().optional()` (CLAUDE.md memory) is applied inline at ~10 call sites in `LEAForm.tsx` and `EditStaffModal.tsx` — **not encapsulated in `TextField`**. Future contributors will likely forget this and the bug will recur.

**i18n**: `en` + `ne` (नेपाली). 10 namespaces (common, auth, nav, settings, dashboard, errors, academics, people, payments, portal).

**Vercel config** ([vercel.json](edforge-saas-frontend/vercel.json)) — `remoteEntry.js` + `mf-manifest.json` are `no-cache`; other remotes/static assets are `immutable` for 1 year. `/api/(.*)` rewrite proxies to `${API_BASE_URL}/$1` → same-origin in prod, **no CORS for the Vercel domain**. Backend CORS list still matters for direct API Gateway access (curl, localhost dev).

**React Query rule** (CLAUDE.md memory): `refetchInterval` only for clock-driven or conditional job-status polling. Sole legitimate use: `useIemisImportJob` polls every 2s only while job is queued/running, returns `false` on terminal, invalidates `studentKeys.lists()` on success.

---

## 5. Shared packages and data model

### 5.1 `@aibrains/shared-types` (v0.43.0, npm-published)

[packages/shared-types/](packages/shared-types/). Single source of truth for cross-codebase contracts.

- **zod pin** `~3.24.4` (dep) + peer `>=3.22.0 <3.25.0` — the `<3.25.0` upper bound is the bugfence (§4.1).
- **Schemas** ([packages/shared-types/src/schemas/](packages/shared-types/src/schemas/)): identity (30+ files), academics (student/course/section/classwork/assignment/grade/grading-policy/attendance/section-attendance), enrollment (separate), finance, analytics, common.
- **Events** ([packages/shared-types/src/events/](packages/shared-types/src/events/)) — including IEMIS audit events. 25 schemas registered for runtime validation (C0.c).
- **Locale defaults** ([src/locale/tenant-locale-defaults.ts](packages/shared-types/src/locale/tenant-locale-defaults.ts)):
  - `COUNTRY_DEFAULTS`: `NPL`, `USA`, `IND`; `FALLBACK_DEFAULTS = USA`.
  - `Archetype = 'PABSON' | 'GENERIC' | 'CBSE_IN' | 'NAIS_US' | 'GEMS_UAE'`; `ACTIVE_ARCHETYPES = ['PABSON','GENERIC']` only.
  - `resolveArchetypeDefaults(archetype, country)`: archetype wins over country. PABSON: NPR, Asia/Kathmandu, bikram_sambat, dual-date on, south_asian, ne-NP, DD/MM/YYYY, 24h, Sunday week-start.
- **BS calendar** ([src/utils/bikram-sambat.ts](packages/shared-types/src/utils/bikram-sambat.ts)): BS years 2000-2090 (91 years), 313 LOC. Exports `gregorianToBs`, `bsToGregorian`, `formatBsDate`, `parseBsDate`, `getCurrentBsYear`, `getBsMonthName(s)`, `getBsMonthDays`, `getBsYearDays`, `isBsYearSupported`, `getBsSupportedRange`.
- **Currency** ([src/utils/currency.ts](packages/shared-types/src/utils/currency.ts)) — `formatCurrency` + Nepal-specific `formatNPR`.
- **Field governance** ([src/identity/field-governance.ts](packages/shared-types/src/identity/field-governance.ts)):
  - *Immutable*: `schoolCode, archetype, emisSchoolCode, tenantTag`.
  - *Locked during active AY*: `academicCalendarType, calendarSystem, gradeRange, gradeLevels, gradingScale, schoolDays, startTime, endTime, periodDuration` + nested workspace-settings paths (`regional.defaultCurrency` etc.).
  - `classifyWorkspaceUpdate(dto, hasActiveAY)` is consumed by backend PATCH handlers and the frontend preview.
- **Ed-Fi mappers** ([src/mappers/edfi/](packages/shared-types/src/mappers/edfi/)) — `staff, credential, calendar, education-org, student-school-association` + `student-descriptor-backfill`. Target Ed-Fi v6.0. Produces `EdFiSchool`, `EdFiLocalEducationAgency`, `EdFiStateEducationAgency`, `EdFiStaff` with `_ext` envelopes for EdForge-specific fields.
- **Descriptor catalog** ([src/ed-fi/descriptors/](packages/shared-types/src/ed-fi/descriptors/)) — 5 catalogs (Sex, Language, Disability, GradeLevel, ExitWithdrawType) emitting canonical Ed-Fi URIs like `uri://ed-fi.org/GradeLevelDescriptor#EarlyChildhoodDevelopment`. **Validated at module load**; malformed URI fails on import. IEMIS bands `ECD`/`PPC` are catalog extensions (not canonical Ed-Fi).

### 5.2 `@edforge/edfi-ts-models` (v1.0.0)

[packages/edfi-ts-models/](packages/edfi-ts-models/). **Generated** from Ed-Fi v6 swagger.json via `json-schema-to-typescript`. Build requires `--max-old-space-size=8192` (large generated tree). AJV runtime validator at [src/utils/validator.ts](packages/edfi-ts-models/src/utils/validator.ts). 16 domain barrels exported.

**Dead code in production today** — zero imports from `server/application/` or `edforge-saas-frontend/`. Likely future-use placeholder for IEMIS / Flash I/II export pipeline. README claims 17 domains; code exports 16.

### 5.3 `@edforge/tenant-settings-resolver` (v0.1.0, workspace-private)

[packages/tenant-settings-resolver/](packages/tenant-settings-resolver/). Resolver abstract class with LRU+TTL caching, in-flight dedup, normalized errors. Three backends: `DdbTenantSettingsResolver` (in-VPC), `HttpTenantSettingsResolver` (ECS services), `InMemoryTenantSettingsResolver` (tests).

**Consumed by analytics Lambdas only** ([analytics/lambda/aggregator/handler.ts](server/lib/analytics/lambda/aggregator/handler.ts), [analytics/lambda/api/handler.ts](server/lib/analytics/lambda/api/handler.ts)). **Finance has its own duplicate** ([finance/src/common/services/tenant-settings.service.ts](server/application/microservices/finance/src/common/services/tenant-settings.service.ts)) — Sprint C2 expedience; should be refactored to `HttpTenantSettingsResolver`.

### 5.4 Retired: `@edforge/tenant-locale-defaults`

Directory **does not exist**. Content was hoisted into `@aibrains/shared-types` in v0.27.0 after a workspace-only package broke AdminWeb's CodeBuild (npm install 404, silent white-screen).

### 5.5 DynamoDB access pattern

**Per-service tables, single-table design per service.** Each microservice owns one DDB table:

- `edforge-identity-basic`
- `edforge-academics-basic`
- `edforge-finance-basic`

(Per [server/service-info.txt](server/service-info.txt); `<TIER>` is `basic` in V1.) All PAY_PER_REQUEST, PK=`tenantId`, SK=`entityKey`, TTL on `ttl`, PITR, RETAIN, deletionProtection-on-prod.

**Eight GSIs per table** ([ecs-dynamodb.ts:51-151](server/lib/tenant-template/ecs-dynamodb.ts#L51)), all `ALL` projection, all lowercase keys (`gsi1pk/gsi1sk` through `gsi8pk/gsi8sk` — S3.2 fix). Intended division of labor per comment:

- GSI1-2: identity (school, departments, AY, configs)
- GSI3-6: academics (grades, attendance, assignments)
- GSI7: students (sparse EMIS lookup)
- GSI8: **sparse cross-tenant IEMIS school code uniqueness** (PABSON only)

**Common SK patterns:**

| Entity | SK |
|---|---|
| Tenant metadata | `METADATA` |
| User | `USER#{userId}` |
| Role assignment | `USER#{userId}#ROLE#{schoolId}` |
| School | `SCHOOL#{schoolId}` |
| Academic year | `SCHOOL#{schoolId}#YEAR#{yearId}` |
| Workspace settings | `SETTINGS#WORKSPACE` |
| Identity audit log | `SCHOOL#{schoolId}#AUDIT#{timestamp}#{auditId}` |
| IEMIS audit event | `AUDIT#IEMIS#{timestamp}#{eventId}` |
| Invoice (finance) | `INVOICE#{schoolId}#{invoiceId}` |
| Billing account lookup mirror | `ACCOUNT#{accountId}` |
| Payment session lookup | `PAYMENT_SESSION#{sessionId}` (24h TTL) |

### 5.6 Ed-Fi v6 alignment — calibrated claim

EdForge **mirrors Ed-Fi Data Standard v6.0 shapes** in its entity definitions and provides hand-written mappers for export. It is **not a full Ed-Fi server.**

- **Strong alignment**: EducationOrganization hierarchy (SEA/LEA/ESC/Network), Staff entity, Student descriptors, descriptor URIs validated at module load.
- **Partial**: Course/Section/Enrollment shapes map cleanly to Ed-Fi but expose internal naming; SSA is a read-only projection over EdForge's Enrollment.
- **Gaps**: 11 of 16 Ed-Fi domains in `@edforge/edfi-ts-models` have no live mappers (assessment, discipline, intervention, program, special-education, attendance-as-Ed-Fi, bell-schedule, teaching-and-learning, finance, student-academic-record). Default grading scale and course `subjectArea` enum are US/CCSS-shaped, not Nepal CEHRD.

---

## 6. Tenant provisioning lifecycle

**End-to-end flow** (read [server/lib/provision-scripts/provision-tenant.sh](server/lib/provision-scripts/provision-tenant.sh) and [server/lib/bootstrap-template/tenant-seeder-lambda.ts](server/lib/bootstrap-template/tenant-seeder-lambda.ts) for ground truth):

1. **AdminWeb → Control Plane**. Operator submits Create Tenant form ([client/AdminWeb/src/pages/Tenants/TenantCreate.tsx](client/AdminWeb/src/pages/Tenants/TenantCreate.tsx)) → `POST ${controlPlaneApi}/tenant-registrations` with body containing `tenantId: uuid()` + `tenantData: { tenantName, email, tier:'BASIC', country, archetype, tenantTag, prices: [], useFederation:'false', useEc2:'false', useRProxy:'true' }`.

2. **SBT ControlPlane → EventBridge**. Writes the registration row in DDB and emits `sbt_aws_onboardingRequest` to the SBT EventBus.

3. **EventBridge → CodeBuild**. `ProvisioningScriptJob` ([core-appplane-stack.ts:38-104](server/lib/bootstrap-template/core-appplane-stack.ts#L38)) consumes the event. Env vars passed: `tenantId, tier, tenantName, email, country, archetype, tenantTag, useFederation, useEc2, useRProxy, prices, EVENT_BUS_NAME`.

4. **CodeBuild runs `provision-tenant.sh`**:
   - Downloads latest version of `s3://saas-reference-architecture-ecs-<account>-<region>/source.tar.gz`.
   - `sed`-substitutes `<REGION>`, `<ACCOUNT_ID>`, `<EVENT_BUS_NAME>` in `service-info.txt` → `lib/service-info.json`.
   - Defaults archetype to `GENERIC`; hard-rejects if not `PABSON`/`GENERIC`.
   - Defaults `tenantTag` to `production`; unknown values fall back to `production` with a WARN (deliberate — a typo must not accidentally tag a real customer as `internal-dev`).
   - **Hard-rejects `tier != BASIC`** (V1_DEFERRED).
   - **For BASIC, performs NO per-tenant CDK deploy** (the shared `tenant-template-stack-basic` is already up; the script only reads stack outputs). Per-tenant `cdk deploy` path exists in the script for Premium/Advanced (lines 118-171) but is dormant in V1. This is why BASIC provisioning takes seconds, not minutes.
   - Creates Cognito admin user with custom attributes; creates per-tenant Cognito Group; adds user to group.
   - Creates per-tenant SNS topic `edforge-alerts-tenant-<tenantId>`, subscribes admin email; polls 4×15s to attach `alertTopicArn` to the METADATA DDB row.
   - Builds `tenantConfig` JSON ({userPoolId, appClientId, apiGatewayUrl}) — packed into outgoing event.

5. **SBT emits `sbt_aws_provisionSuccess`** → consumed by the **tenant-seeder Lambda**:
   - Two event-shape branches (SBT-native + legacy EdForge).
   - Validates archetype + tenantTag again (defense-in-depth).
   - **Tier guard**: non-BASIC → log "V1_DEFERRED" + return 200.
   - Writes METADATA row to `edforge-identity-basic` (conditional `attribute_not_exists` → idempotent on retry).
   - Writes SETTINGS#WORKSPACE row with `US_DEFAULTS ← countryOverrides ← archetypeOverrides` precedence. For PABSON+NPL this yields NPR / Asia/Kathmandu / bikram_sambat / Sun-Fri / south_asian / ne-NP.

6. **Cognito sends welcome email** (template configured in [identity-provider.ts](server/lib/tenant-template/identity-provider.ts)).

**SBT ISSUE-008 safety net**: SBT's Step Function `Catch` block converts CodeBuild failures to success events. Mitigation: CloudWatch alarm `edforge-provisioning-codebuild-failures` on raw `FailedBuilds` metric, routed via SNS `edforge-provisioning-alerts` (email-subscribed via `CDK_PARAM_OPERATOR_ALERT_EMAIL`). **Don't trust the Step Function's green checkmark alone.**

**Deprovisioning** ([deprovision-tenant.sh](server/lib/provision-scripts/deprovision-tenant.sh)): for BASIC, deletes Cognito users + group, runs `delete_items_if_exists` queries by `tenantId` against all three DDB tables. **The shared `tenant-template-stack-basic` is NEVER destroyed** — only per-tenant rows + Cognito artifacts go. `RemovalPolicy.RETAIN` matters only if an operator runs `cdk destroy` against the shared stack manually.

**`tenantTag` defaults silently to `production` in two server-side places** (provision script + seeder Lambda) when missing from the payload. AdminWeb defaults to `internal-dev` with a confirmation gate. So the silent `production` default only affects callers that bypass AdminWeb (CLI scripts) — deliberate (avoids accidentally tagging a customer as internal-dev) but a landmine.

---

## 7. Multi-tenancy and security model

- **Tenant identity** propagates as a `custom:tenantId` Cognito custom attribute, written by the post-auth Lambda trigger (in the **tenant** user pool, attached at tenant-template-stack synth). The JWT carries it as a claim; the frontend api-client decodes the JWT and stamps `X-Tenant-Id`; backend `JwtAuthGuard` strips it into `TenantContext`.

- **Two Cognito pools per environment**:
  1. *System-admin pool* in controlplane-stack, for AdminWeb operators.
  2. *Tenant pool* in tenant-template-stack-basic, shared across all BASIC-tier tenants (per-tenant Cognito Group disambiguates).

- **Token Vending Machine** ([dynamodb-client.service.ts:47-69](server/application/microservices/identity/src/common/services/dynamodb-client.service.ts#L47)): `DynamoDBClientService.getClient(tenantId, jwt)` assumes a per-tenant ABAC IAM role via STS using the JWT. The returned STS credentials carry a `dynamodb:LeadingKeys = {{tenant}}` condition pinning the partition key. IAM is the second line of defense behind application-layer permission checks.

- **GSI ABAC gap**: GSI queries have **no** `LeadingKeys` condition because GSIs use `gsi*pk`, not `tenantId`. Tenant isolation on indexed reads depends entirely on application-layer filtering. Documented in code but worth flagging for security review.

- **Role taxonomy**: `GlobalRole = TenantAdmin | TenantUser`. `SchoolRole = Principal | VicePrincipal | Teacher | Accountant | Staff | Counselor | Nurse | Student | Parent`. `PlatformOperator` is referenced in `IemisPermissionGuard` but not in the `GlobalRole` union — cross-pool aspirational, unreachable in V1.

- **No JWT validation at rproxy** — every backend service runs its own `JwtAuthGuard`. Internal service-to-service auth (`/internal/webhooks/*`) uses a per-tenant deterministic API key = `SHA256('edforge-internal-api-key:' + tenantName)`, enforced by `InternalApiKeyGuard`.

---

## 8. Archetype + region model

The **core/edge separation** is mostly upheld. Tenant-wide archetype branching happens at exactly 5 backend/shared call sites and 6 frontend call sites — all in clear "edge" code (input form, importer transform, validator, governance gate).

**Backend/shared archetype branches:**

| File:line | What it gates |
|---|---|
| [packages/shared-types/src/locale/phone-format.ts:83](packages/shared-types/src/locale/phone-format.ts#L83) | PABSON → Nepal mobile format (two-step waterfall: archetype first, then country) |
| [server/application/microservices/identity/src/schools/schools.service.ts:176](server/application/microservices/identity/src/schools/schools.service.ts#L176) | Hard-rejects School create if PABSON + `emisSchoolCode` missing |
| [server/application/microservices/identity/src/schools/schools.service.ts:326](server/application/microservices/identity/src/schools/schools.service.ts#L326) | Log enrichment |
| [server/application/microservices/academics/src/students/iemis-transform.ts:163](server/application/microservices/academics/src/students/iemis-transform.ts#L163) | IEMIS importer: PABSON → parse DOB as BS via `parseBsDate`; else Gregorian YYYY-MM-DD |

**Frontend archetype branches** ([packages/forms/src/sections/AddressFields.tsx](edforge-saas-frontend/packages/forms/src/sections/AddressFields.tsx), `PhoneInput.tsx`, `useTenantContext.ts`, `SchoolWizard.tsx`, `BasicInfoStep.tsx`, `school-wizard.schemas.ts`) — address variant selection, phone format, school wizard country/emisSchoolCode gating.

**`country === 'NPL'` branches** all sit downstream of an archetype check, so a GENERIC tenant in Nepal still gets Nepal-shaped inputs. Only suspicious case: [edforge-saas-frontend/apps/academics/src/components/students/profile/ProfileTab.tsx:82,108](edforge-saas-frontend/apps/academics/src/components/students/profile/ProfileTab.tsx#L82) checks `address.country === 'NPL' || address.country === 'Nepal'` — mixes ISO code with human label, hints at historic data shape drift.

**Tenant Tag taxonomy** (added in dev-tenant Sprints 1-3, 2026-05-07/08):
- `production` — real customers
- `internal-dev` — engineering dev tenants
- `internal-dev-rehearsal` — pre-pilot rehearsals
- Default UI is filter-to-production. Pre-Sprint-1 tenants without a `tenantTag` are defensively treated as `production`.

---

## 9. Deploy pipeline and operational model

**One wrapper for every CDK deploy** ([scripts/deploy-analytics.sh](scripts/deploy-analytics.sh)) — name is legacy; it's universal. Flow:

```
./scripts/deploy-analytics.sh <stack> <profile> [extra cdk args]
```

1. Argv check (`<stack> <profile>` required).
2. Build log filename `analytics-<profile>-<stack>-<YYYYMMDD-HHMMSS>-<gitsha>.log`. (The `analytics-` prefix is hardcoded; TODO `B0.1.T*` calls for renaming.)
3. **Pre-flight `service-info.json` check**: greps for `<REGION>`, `<ACCOUNT_ID>`, or `.dkr.ecr..amazonaws.com` and exits 2 if found, with the exact `sed` fix command (lines 55-67). If you skip this and the URI has the empty region, ECS sits in `UPDATE_IN_PROGRESS` for 3 hours before CFN times out.
4. `npx cdk deploy "$STACK" --require-approval never` with `CDK_NAG_ENABLED=false` (default) + `CDK_PARAM_COMMIT_ID=<gitsha>` (auto-stamp) + `AWS_PROFILE=<profile>`.
5. `2>&1 | tee -a "$LOG_FILE"`; exit code is `${PIPESTATUS[0]}` (so wrapper exits with cdk's exit code, not tee's).

**Never run raw `npx cdk deploy`.** The only exceptions are read-only `cdk synth` and `cdk diff` (the diff should also be tee'd per the convention).

**App image build** ([scripts/build-application.sh](scripts/build-application.sh)) — `set -euo pipefail`. Services: `identity, academics, finance, rproxy`. Optional single-service argument. Images tagged `:latest` + `:<gitsha>-<YYYYMMDDHHMMSS>`. ECR lifecycle policy: rule 1 keeps last 10 images with prefix `nogit`/`latest` (note: gitsha-prefixed tags are NOT actively pruned by rule 1 — they age out via rule 2 untagged expiry after 7 days, which only applies if they lose the gitsha tag).

**ECS rolling roll**:
```bash
AWS_PROFILE=prod aws ecs update-service \
  --cluster prod-basic --service <service>basic \
  --force-new-deployment --region ap-south-1
```
Tee everything to `docs/deploys/`.

**Deploy log convention**: filename embeds env + target + timestamp + gitsha. All logs accumulate in [docs/deploys/](docs/deploys/) (310 entries as of 2026-05-16). `INDEX.md` referenced in CLAUDE.md **does not exist** — closest substitute is [docs/pilot-greenlight/sprint-closeouts.md](docs/pilot-greenlight/sprint-closeouts.md) + per-sprint READMEs.

**Rollback paths** (CLAUDE.md):
- Worktree-checkout to prior gitsha → re-run wrapper.
- `aws ecs update-service --task-definition <family>:<N>` to roll task def.
- ECR re-tag `<PRIOR_TAG> → :latest` + `--force-new-deployment` (bounded by 10-tag lifecycle limit).
- CFN auto-rollback on failed deploy.

---

## 10. Change-to-deploy matrix

| You changed… | Deploy… | Order | Wrapper |
|---|---|---|---|
| DDB schema/GSI ([ecs-dynamodb.ts](server/lib/tenant-template/ecs-dynamodb.ts)) | tenant-template-stack-basic | infra first | wrapper |
| ABAC DDB policy | tenant-template-stack-basic | infra first | wrapper |
| IAM policy in [service-info.txt](server/service-info.txt) | tenant-template-stack-basic | infra first | wrapper |
| API Gateway route ([tenant-api-prod.json](server/lib/tenant-api-prod.json)) | shared-infra-stack | infra first | wrapper |
| NestJS controller code | ECR push + ECS roll | app second | build-application.sh |
| Reverse proxy route ([nginx.template](server/application/reverseproxy/nginx.template)) | ECR push + ECS roll for rproxy | app second | build-application.sh |
| Analytics Lambda code | analytics-stack | infra (CDK bundles Lambdas) | wrapper |
| tenant-seeder Lambda | controlplane-stack | infra (synth-inline) | wrapper |
| Provisioning script ([provision-tenant.sh](server/lib/provision-scripts/provision-tenant.sh)) | upload source tarball **first**, then core-appplane-stack | source first | update-provision-source.sh + wrapper |
| CORS config | shared-infra-stack | infra | wrapper |
| Cognito config | controlplane-stack | infra | wrapper |
| AdminWeb React code | S3 sync + CloudFront invalidation (via CodePipeline) | — | redeploy controlplane-stack to trigger CodePipeline |
| edforge-saas-frontend React code | Vercel (automatic on push to main) | — | none |
| `@aibrains/shared-types` (AdminWeb consumes) | `npm publish` THEN controlplane-stack | publish first | npm + wrapper |
| `@aibrains/shared-types` (ECS-only consumers) | None (workspace symlink) | — | `nest build <service>` |
| Tenant locale defaults | publish shared-types + controlplane-stack + identity ECR push | publish first | npm + wrapper + build-application.sh |

**AdminWeb publish-gate gotcha**: AdminWeb's CodeBuild has no monorepo visibility (`npm install --legacy-peer-deps --no-optional` runs in isolation). Every dep in AdminWeb's `package.json` must resolve from the npm **registry**. A workspace-only `"private": true` package would 404 and silently break the build, serving the last successful bundle. This is why `@edforge/tenant-locale-defaults` was retired in 0.27.0.

**Per-sprint shared-types publish checklist:**
1. Bump version in `packages/shared-types/package.json`.
2. `cd packages/shared-types && npm publish` (2FA).
3. `npm view @aibrains/shared-types version` to verify (30s CDN propagation).
4. From repo root: `npm install` to refresh lockfile; commit.
5. Rebuild AdminWeb locally; run jsdom bundle sim.
6. Deploy identity + academics ECR (runtime consumers).
7. Deploy `controlplane-stack` to trigger AdminWeb CodePipeline rebuild.
8. Verify CodePipeline `Succeeded`; curl bundle for a new-export symbol.

**`^0.X.0` caret-pin pitfall**: npm's `^0.X.0` for 0.x semver means `>=0.X.0 <0.(X+1).0`. Every minor bump requires updating every consumer pin in the same PR. At minimum: `server/application/package.json` (gates Dockerfile.identity), `server/package.json` (CDK deploy scripts), repo-root `package-lock.json`.

---

## 11. Current state and active roadmap

### Active plan: `docs/pilot-greenlight/sprint-plan.md`

14-sprint plan with 9 phases A-I. Critical path:
```
C0.a → C0.c → C1 → C2 → C3 → C5 → C7 → C9 → C12 → C13
```

Two starred gates:
- **C2** — internal greenlight (write smoke + 5 read tests against deployed dev tenant)
- **C12** — external greenlight (operator rehearsal + prod-shadow rehearsal)

**13 architecture invariants** in §4. The load-bearing one is **invariant 13**: no pilot-specific names in code (parametric `packages/pilot-fixtures/` pattern, no `saraswati`/`pabson-saraswati` literals in `src/`/`tests/`/`smokes/`). Verified clean.

### Sprint state (per [docs/pilot-greenlight/sprint-closeouts.md](docs/pilot-greenlight/sprint-closeouts.md))

- **C0.a — Calendar-Blocking Verifications**: shipped 2026-05-15 (PRs #70, #71 server, #59 frontend).
- **C0.c — Event Emission Foundation**: shipped 2026-05-16 (PRs #73-#76, shared-types 0.43.0 publish + pin bumps). Closeout reframes the sprint — SBT bus + EventServiceBase already existed; the gap was Zod runtime payload validation. 25 schemas registered, 444 tests green. ~110 legacy PascalCase publishers stay on backward-compat (warning log) and migrate per-domain.
- **Next**: either **C0.e** (compliance declarations — needs legal/ops lead time) or **C1** (pilot fixture engine — engineering critical path).
- **C0.c.3 deploy plan** ([docs/pilot-greenlight/c0-c-3-deploy-plan.md](docs/pilot-greenlight/c0-c-3-deploy-plan.md)) is operator-ready (PR #78).

### Pilot dossier

[docs/pilots/pabson-saraswati-bs-2083/dossier.md](docs/pilots/pabson-saraswati-bs-2083/dossier.md) — the only registered pilot.

| | |
|---|---|
| Status | `registered` (fixture extraction pending C1.2+) |
| archetype/country | PABSON / NPL |
| Calendar | bikram_sambat / Asia/Kathmandu / ne-NP / NPR / Sun start / Sun-Fri |
| Primary AY | BS 2083 (Apr 2026 → Apr 2027) |
| School | Shree Saraswati Sec. Eng. Boarding School |
| Grades | ECD, PPC, Class 1 → Class 10 |
| Grading | 32-pass PABSON archetype default (verify with admin at C13.2) |
| Bell schedule | 2 shifts (boarding morning routine non-academic + day academic 8×45min) |

### Recent deploy activity

- 2026-05-16: C0.c.3 trial roll — identity/academics/finance rolled (identity TaskDef:3, others :2). Post-roll smoke green except the recurring Leave-cancel 500 (`C0.b.1` deferred).
- 2026-05-14: S3.2 GSI1 casing fix shipped to identity; 5 historical rows backfilled.
- 2026-05-13: shared-infra-stack redeploy; identity ECR roll; S1 exam-window + tier2 seed smokes.
- 2026-05-12: grade-level-fix sprint T1-T6 shipped in one day. Server PRs #46/#49/#50/#51/#52/#53; frontend PRs #45/#48/#49/#50.

**Single open prod regression**: `Leave PATCH /cancel` returns 500. Tracked as deferred work `C0.b.1`.

---

## 12. Recent doc inventory

Recently added (since 2026-04-15):

| Path | Purpose |
|---|---|
| [docs/pilot-greenlight/](docs/pilot-greenlight/) | The active plan, closeouts, deferred-work, C0.c.3 deploy plan, event infrastructure, agent-bootstrap onboarding |
| [docs/pilots/pabson-saraswati-bs-2083/](docs/pilots/pabson-saraswati-bs-2083/) | The only registered pilot dossier |
| [docs/validation/](docs/validation/) | Pilot greenlight decision (2026-05-14 w/ P1 follow-up F-V2-CALENDAR-PAGINATION), academic-setup-lifecycle, field-findings |
| [docs/architecture/core-edge-categorization.md](docs/architecture/core-edge-categorization.md) | Core/Edge classification framing — Nepal-first, archetype-many, Ed-Fi v6 anchored. Living doc |
| [docs/saraswati-evidence-2026-05-13/](docs/saraswati-evidence-2026-05-13/) | 18 JSON captures from `dev-pabson-primary` tenant |
| [docs/infrastructure-sunset/](docs/infrastructure-sunset/) | UAT teardown + prod cost-optimization (desiredCount 2→1, NAT 3→1, etc.). UAT now sunset |
| [docs/grade-level-audit/](docs/grade-level-audit/) | 8 deliverables + 11-fix list (F-LEGACY-1, F-IEMIS-1, F-CONFIG-1a/2, F-CURRICULUM-2) |
| [docs/grade-level-fix/](docs/grade-level-fix/) | T1-T6 shipped 2026-05-12 (one-day sprint) |
| [docs/dev-tenant-system/](docs/dev-tenant-system/) | Dev tenant system sprints 0-3 shipped; 4-9 paused 2026-05-08 |
| [docs/champion-kit/](docs/champion-kit/) | Field-sales kit for Champion-led principal meetings in Dhanusha |
| [docs/platform-audit/](docs/platform-audit/) | Multi-deliverable platform audit (2026-05-10): architecture/data/modules/security/test-quality/Saraswati gap |

### Stale docs at repo root

| File | Status |
|---|---|
| `DEVELOPER_GUIDE.md` | **Stale** (upstream SBT residue) — ignore for EdForge facts |
| `OVERVIEW.md` | **Partially stale** (pre-dates pilot-greenlight pivot, UAT sunset, dev-tenant system, grade-level fix). Useful as one-shot orientation; roadmap claims stale |
| `SARASWATI_PILOT_REVISED_ROADMAP.md` | **Superseded** by [docs/pilot-greenlight/sprint-plan.md](docs/pilot-greenlight/sprint-plan.md) |
| `MIDNIGHT_LOCKIN_*.md` (4 files) | **Superseded** — design-time docs; shipped state lives in memory + `docs/Sprints/` + `docs/deploys/` |
| `v1_basic_only_tier_deferral_sprint_plan.md` | **Still describes current state** — canonical reasoning for V1 BASIC-only scope; treat sprint structure as historical |
| `EDFORGE_V1_DEVELOPER_DOCUMENT.md` | **Authoritative** per memory, but pre-pilot-greenlight; mtime in mind |
| `CLAUDE.md` | Active. Some references stale (UAT, `INDEX.md`, "POST /tenants") — see §13 |

---

## 13. Known drift, gotchas, and tech debt

### Drift between CLAUDE.md and reality

1. **UAT is sunset.** CLAUDE.md still describes the UAT→prod ladder as authoritative; memory `feedback_pr_first_no_more_uat` and [docs/infrastructure-sunset/](docs/infrastructure-sunset/) confirm UAT teardown. `server/.env.uat` does not exist on disk.
2. **`docs/deploys/INDEX.md` does not exist.** CLAUDE.md treats it as the historical map; closest substitute is [docs/pilot-greenlight/sprint-closeouts.md](docs/pilot-greenlight/sprint-closeouts.md).
3. **CLAUDE.md says "POST `/tenants`"** for tenant creation. Actual endpoint is `/tenant-registrations` ([tenantService.ts:41,99](client/AdminWeb/src/services/tenantService.ts#L41)). `/tenants` is the **list** endpoint.
4. **CLAUDE.md says BASIC provisions create a per-tenant CDK stack.** Actually BASIC is a **shared (pool) stack** — `provision-tenant.sh` only reads outputs for BASIC; per-tenant `cdk deploy` is dormant Premium/Advanced path. Provisioning takes seconds, not minutes.
5. **CLAUDE.md memory says GSI8 is the IEMIS audit log GSI** (Sprint 1). Actually GSI8 is the sparse cross-tenant IEMIS school code uniqueness index. IEMIS audit events live on the primary table with `entityKey = AUDIT#IEMIS#…`.
6. **CDK deploy order**: `core-appplane.addDependency(analytics)` is intentional (SBT bus rules attached before emitters), but visually inverted from the topology diagram.

### Architectural surprises

7. **EventDLQ sub-stack** lives under `server/lib/shared-infra/` but is **instantiated inside controlplane-stack** with `environment: 'prod'` hardcoded. A hypothetical UAT deploy would still create `edforge-event-dlq-prod` resources.
8. **AdminWeb's CloudFront resource discovery is two hops** — only `adminSiteUrl` is exported, not bucket or distro ID. Operators must `list-distributions` + `get-distribution-config` to find them.
9. **GSI ABAC has no `LeadingKeys` constraint** — tenant isolation on indexed reads is application-layer-only.
10. **rproxy is pure path-routing** — no auth, no rate-limit, no CORS injection. Health check returns 200 without probing upstream, so ALB target health = "rproxy alive."
11. **`COUNTRY_DEFAULTS` is triplicated**, not duplicated: (1) `@aibrains/shared-types` canonical, (2) hand-duplicated in identity workspace-settings entity, (3) AdminWeb `TenantDetail.tsx` has its own `COUNTRY_SETTINGS` table for the preview pane.
12. **The analytics MFE does NOT use the shared MF config** — inlines its own. Any new MF singleton silently skips analytics. Latent bug, same failure mode as the Sprint A.12/A.13 incident.
13. **`@edforge/edfi-ts-models` is dead code** — zero imports. Generated 16-domain Ed-Fi v6 model package, AJV validator, all unused. Future-use placeholder or orphaned.
14. **`HttpTenantSettingsResolver` is not adopted by finance** — finance ships its own duplicate `TenantSettingsService`.
15. **Payment gateway adapters (eSewa, Khalti) are fully implemented but commented-out at registration** — pilot is manual-payment-only. `POST /payments/initiate` against either falls back to a synthetic redirect URL.

### Known issues

16. **`Leave PATCH /cancel` returns 500** on prod — only recurring smoke failure. Tracked as `C0.b.1`.
17. **Attendance overview can 504** at PABSON scale (~779 students × 3 GSI queries each × ~90-day range, batched 10 at a time, behind 30s API GW timeout). Mitigations in place (60s overview cache, pre-fetched enrollments) but cold path will time out. `F-PERF-1` open.
18. **Default grading scale is US A-F** — no NEB/CEHRD Nepal scheme shipped. PABSON schools must configure via `POST /academics/grading-policies`.
19. **Course `subjectArea` enum is US/CCSS-shaped** — no Nepal CEHRD subject taxonomy yet.
20. **CreditNote/FeeStructure/RefundRequest still runtime-default `currency: 'NPR'`** — TS type is widened but `data.currency || 'NPR'` defaults. Fast-follow before a second non-NPR tenant.
21. **enrollmentType enum mismatch** between academics (`'new'`) and finance (`'new_admission'`). Webhook controller silently rewrites at the boundary; **any third EventBridge consumer would see the original**.
22. **`tenantTag` is not in the identity `Tenant` interface** — written by seeder Lambda, blind to NestJS runtime. AdminWeb reads via raw DDB shape.
23. **`PlatformOperator` global role** referenced in `IemisPermissionGuard` but not declared in `GlobalRole` union — unreachable in V1.
24. **`AuthService` uses unscoped DDB credentials** for `login`, `getCurrentUser`, `refreshToken`, `logout`, `invalidateAllUserSessions`. Login can't easily use TVM (no JWT yet); the others could.
25. **`setValueAs: v => v === '' ? undefined : v`** for `.url().optional()` is applied at 10 inline call sites, not encapsulated in `TextField`. Will recur.
26. **CORS env-var name mismatch**: NestJS reads `CORS_ORIGINS`; CDK exports `CDK_PARAM_CORS_ALLOWED_ORIGINS`. Task definition must map between the two.
27. **ECR lifecycle policy `tagPrefixList: ["nogit","latest"]`** does NOT match gitsha-prefixed tags — gitsha tags age out only via 7-day untagged expiry.
28. **Hard-coded `provisioning` IAM `*:*` wildcard** on both CodeBuild jobs. Documented in `docs/iam_production_deployer_policy.md` but unaddressed.

### Operator-discipline rules (from CLAUDE.md memory + recent incidents)

29. **Two-repo git hygiene**: backend (`/Users/shoaibrain/edforge`) and frontend (`/Users/shoaibrain/edforge/edforge-saas-frontend`) are **two independent git repos** (not a submodule). Every git command must start with explicit `cd <repo-root>` in the same bash invocation. Inherited cwd will silently run the wrong git.
30. **Stacked PRs**: GitHub leaves `base = sprint/<parent>` on child PRs after parent merges. Either retarget every downstream child to `main` after parent merges, or open stacked PRs with `--base main` from the start.
31. **Three-way route handoff**: every new API endpoint touches NestJS controller + `tenant-api-prod.json` (API Gateway spec) + `nginx.template` (only for new top-level prefixes). 403 SigV4 = API GW missing; 404 from nginx server header = rproxy missing; Nest 404 = controller typo'd.

---

## 14. Reference index — where to start reading

### For "how does X work"

- **CDK app entrypoint**: [server/bin/ecs-saas-ref-template.ts](server/bin/ecs-saas-ref-template.ts)
- **API Gateway routes**: [server/lib/tenant-api-prod.json](server/lib/tenant-api-prod.json) (hand-maintained)
- **rproxy routes**: [server/application/reverseproxy/nginx.template](server/application/reverseproxy/nginx.template)
- **Identity module wiring**: [server/application/microservices/identity/src/identity.module.ts](server/application/microservices/identity/src/identity.module.ts)
- **JWT validation strategy**: [server/application/libs/auth/src/jwt.strategy.ts](server/application/libs/auth/src/jwt.strategy.ts)
- **Token Vending Machine**: [server/application/microservices/identity/src/common/services/dynamodb-client.service.ts](server/application/microservices/identity/src/common/services/dynamodb-client.service.ts)
- **Provisioning script**: [server/lib/provision-scripts/provision-tenant.sh](server/lib/provision-scripts/provision-tenant.sh)
- **Tenant seeder Lambda**: [server/lib/bootstrap-template/tenant-seeder-lambda.ts](server/lib/bootstrap-template/tenant-seeder-lambda.ts)
- **Locale defaults (canonical)**: [packages/shared-types/src/locale/tenant-locale-defaults.ts](packages/shared-types/src/locale/tenant-locale-defaults.ts)
- **Workspace settings (entity, hand-duplicated)**: [server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts](server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts)
- **BS calendar**: [packages/shared-types/src/utils/bikram-sambat.ts](packages/shared-types/src/utils/bikram-sambat.ts)
- **Field governance**: [packages/shared-types/src/identity/field-governance.ts](packages/shared-types/src/identity/field-governance.ts)
- **DDB table + GSI definition**: [server/lib/tenant-template/ecs-dynamodb.ts](server/lib/tenant-template/ecs-dynamodb.ts)
- **ECS service definitions**: [server/lib/tenant-template/services.ts](server/lib/tenant-template/services.ts) + [server/service-info.txt](server/service-info.txt)
- **Module Federation singleton list**: [edforge-saas-frontend/packages/config/src/mf-shared.ts](edforge-saas-frontend/packages/config/src/mf-shared.ts)
- **School context channel (load-bearing module-level state)**: [edforge-saas-frontend/packages/config/src/school-context-channel.ts](edforge-saas-frontend/packages/config/src/school-context-channel.ts)
- **Frontend API client**: [edforge-saas-frontend/packages/api-client/src/index.ts](edforge-saas-frontend/packages/api-client/src/index.ts)

### For "what's going on right now"

- **Active sprint plan**: [docs/pilot-greenlight/sprint-plan.md](docs/pilot-greenlight/sprint-plan.md)
- **Sprint closeouts**: [docs/pilot-greenlight/sprint-closeouts.md](docs/pilot-greenlight/sprint-closeouts.md)
- **Deferred work register**: [docs/pilot-greenlight/](docs/pilot-greenlight/)
- **Pilot dossier**: [docs/pilots/pabson-saraswati-bs-2083/dossier.md](docs/pilots/pabson-saraswati-bs-2083/dossier.md)
- **Recent deploys**: `ls -lt docs/deploys/ | head -30`
- **Core/Edge classification framing**: [docs/architecture/core-edge-categorization.md](docs/architecture/core-edge-categorization.md)
- **House rules + load-bearing gotchas**: [CLAUDE.md](CLAUDE.md) (active, with the drift items noted in §13)
