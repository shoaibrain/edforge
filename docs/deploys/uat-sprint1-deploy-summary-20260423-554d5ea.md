# Sprint 1 — UAT deploy summary

**Date:** 2026-04-23
**Commit (main):** `554d5ea` Merge pull request #20 — Sprint 1 IEMIS Identity, RBAC, Audit primitives (S1.1–S1.10, S1.12)
**Operator:** Shoaib (pair-programming with Claude)
**Status:** SUCCESS — shared-infra + tenant-template-basic deployed; identity + academics rolled; both IEMIS routes live at API Gateway and wired into identity; MetricFilter + Alarm active on identity LogGroup.

---

## Deliverables landed

| Ticket | Artifact | Status |
|---|---|---|
| S1.1 | `iemisSchoolCodeSchema` + `iemisStudentIdSchema` + predicates in `@aibrains/shared-types` 0.31.0 | live |
| S1.2 | Sparse GSI8 on `edforge-identity-basic` (+ academics/finance shared construct; extra capacity is harmless) | live (ACTIVE) |
| S1.3 | Cross-tenant `emisSchoolCode` uniqueness check in `SchoolsService` — 409 without leaking conflicting tenant/school | live |
| S1.4 | Student create PABSON gate — `emisStudentId` required when school has `emisSchoolCode` | live |
| S1.5 | `IemisController` — `GET /iemis/verify-school-code/:code`, `GET /iemis/audit` | live (401 via Cognito guard) |
| S1.6 | `IemisPermission` enum + `TENANT_ADMIN_IEMIS_PERMISSIONS` / `PLATFORM_OPERATOR_IEMIS_PERMISSIONS` grant maps | live |
| S1.7 | `@RequireIemisPermission()` decorator + `IemisPermissionGuard` | live |
| S1.8 | `IemisAuditEvent` Zod + `AUDIT#IEMIS#<iso-ts>#<eventId>` SK builder | live |
| S1.9 | `IemisAuditLogger.emit()` fail-open with `iemis.audit.emit_failure` log line | live |
| S1.10 | Audit list + PII redaction by viewer role | live |
| S1.12 | Identity LogGroup + `IemisAuditEmitFailureFilter` MetricFilter + `edforge-iemis-audit-emit-failures-basic` Alarm (OK) | live |

Sprint 1 frontend (PR #31) — `IemisCodeBadge` — already live on Vercel.

## Deploy ladder

1. ✅ `cd packages/shared-types && npm version` → 0.31.0 (bumped, built, 65/65 tests green)
2. ✅ `npm publish` (2FA completed, registry serving 0.31.0)
3. ✅ `npm view @aibrains/shared-types version` → `0.31.0`
4. ✅ `npm install` at repo root → lockfile refreshed
5. ✅ CDK diff `shared-infra-stack` → only 2 new API Gateway routes (`/iemis/audit`, `/iemis/verify-school-code/{code}`) + deployment replaced. Log `uat-cdk-diff-shared-infra-stack-20260423-151012-554d5ea.log`
6. ✅ `./scripts/deploy-analytics.sh shared-infra-stack uat` → completed in 426s. Log `analytics-uat-shared-infra-stack-20260423-151012-554d5ea.log`
7. ⚠️  First `cdk diff tenant-template-stack-basic` showed `us-east-2:715860911762` → `ap-south-1:257526644020` on finance/rproxy task defs — **service-info.json had stale prod values baked in**. Regenerated with UAT substitution (`REGION=us-east-2 ACCOUNT_ID=715860911762`). Second diff clean. Log `uat-cdk-diff-tenant-template-stack-basic-20260423-152532-554d5ea.log`
8. ✅ `./scripts/deploy-analytics.sh tenant-template-stack-basic uat` → 5.5 min. GSI8 added to identity/academics/finance tables (shared construct), IdentityLogGroup created, IemisAuditEmitFailureFilter + IemisAuditEmitFailuresAlarm created. Identity TaskDef replaced (LogGroup ref change) — rolled by CFN automatically.
9. ✅ GSI8 on `edforge-identity-basic` → `IndexStatus=ACTIVE` (confirmed via `describe-table`)
10. ⚠️  First `build-application.sh identity` **failed** — `IemisAuditEventType` missing at compile time. Root cause: `server/application/package.json` pinned `@aibrains/shared-types: "^0.30.0"` which npm resolves as `>=0.30.0 <0.31.0` (caret rule for 0.x versions). Bumped pins to `^0.31.0` in `server/package.json`, `server/application/package.json`, `packages/tenant-settings-resolver/package.json`. Academics build succeeded the first time because academics doesn't import `IemisAuditEventType`.
11. ✅ Identity + academics rebuilt:
    - `identity:554d5ea-20260423204733`
    - `academics:554d5ea-20260423204000`
12. ✅ `aws ecs update-service --force-new-deployment` on both → `rolloutState=COMPLETED`, identity 2/2 on `identity-TaskDef:14`, academics 1/1 on `academics-TaskDef:12`
13. ✅ IEMIS module boot confirmed in new identity LogGroup (`IemisModule dependencies initialized`, `Mapped {/iemis/verify-school-code/:code, GET} route`, `Mapped {/iemis/audit, GET} route`, `Nest application successfully started`)

## Smoke

| Check | Result |
|---|---|
| API Gateway `/iemis/verify-school-code/12345678` without auth | ✅ HTTP 401 (not 404 — route wired, auth guard active) |
| API Gateway `/iemis/audit` without auth | ✅ HTTP 401 |
| Identity LogGroup receiving logs | ✅ both replicas booted at 20:50:42 and 20:51:30 |
| `IemisModule dependencies initialized` | ✅ both tasks |
| `IemisController {/iemis}` routes mapped | ✅ both routes on both tasks |
| `edforge-iemis-audit-emit-failures-basic` alarm | ✅ `state=OK` (expected: no audit emits yet) |
| GSI8 ACTIVE on `edforge-identity-basic` | ✅ `IndexStatus=ACTIVE`, `Backfilling=false` |

## Known gaps / follow-ups

1. **`edforge-iemis-audit-emit-failures-basic` alarm has no SNS action wired** — `CDK_PARAM_OPERATOR_TOPIC_ARN` not set in `.env.uat`. Matches the optional-wiring pattern in [services.ts](../../server/lib/tenant-template/services.ts). Pre-Saraswati go-live: wire this alarm to the operator SNS topic (same pattern the Phase 4 paging alarms use per memory `project_midnight_lockin_phase_4`).
2. **End-to-end auth smoke deferred** — hitting `/iemis/verify-school-code/12345678` with a real tenant-admin JWT (expecting `{valid:true}`) and confirming an `AUDIT#IEMIS#<ts>#<eventId>` row landed in DDB requires either a live Cognito login or pasted JWT. Matches the pattern of other smoke tests (`identity-service-flow.ts`). Deferred until Saraswati dress rehearsal.
3. **Cross-tenant 409 uniqueness test deferred** — requires two UAT tenants each creating a school with the same `emisSchoolCode`. Needs actual multi-tenant UAT setup.
4. **Student PABSON gate test deferred** — requires UAT school with `emisSchoolCode` set and a student-create call.
5. **Service-info.json stale prod values** — this repo keeps `server/lib/service-info.json` committed with whatever was last substituted. Safer path forward: gitignore the artifact, treat `service-info.txt` as the only source of truth, let the deploy wrapper regenerate per env. Tracked as `B0.1.T2` follow-up.
6. **Pin bumps not yet committed** — `server/package.json`, `server/application/package.json`, `packages/tenant-settings-resolver/package.json`, and `package-lock.json` have uncommitted pin bumps. Need user approval per CLAUDE.md before committing to main.

## Prod promotion

**NOT YET.** Per [CLAUDE.md deploy ladder](../../CLAUDE.md), prod deploy requires explicit operator authorization. Sprint 1 is additive — new Zod validators, new module, new decorator/guard, new endpoint, new DDB GSI, new LogGroup/MetricFilter/Alarm. No existing behavior altered. Safe to promote whenever ready.

**Prod-specific prep before promote:**
- Regenerate `service-info.json` with `REGION=ap-south-1 ACCOUNT_ID=257526644020` (the wrapper pre-flight catches `<REGION>/<ACCOUNT_ID>` but not wrong substituted values — eyeball-check the file first).
- Set `CDK_PARAM_OPERATOR_TOPIC_ARN` in `.env.prod` before the `tenant-template-stack-basic` prod redeploy so the IEMIS audit emit-failure alarm pages on day 1.
- Prod GSI8 build will take noticeably longer than UAT due to existing data — plan for 10–30 min of GSI `Backfilling=true` before the identity ECR roll.

## Rollback plan

- **ECS**: `aws ecs update-service --task-definition identity:13` (identity), `academics:11` (academics) → drains to prior image.
- **shared-types 0.31.0**: additive. Downgrade consumer pins to `^0.30.0` if rollback needed; package stays on npm.
- **GSI8 on identity table**: CDK-managed. Rolling back tenant-template-stack-basic would drop GSI8, which is safe — no prod data relies on it yet. Data in the table with `gsi8pk`/`gsi8sk` attrs stays; just no longer indexed.
- **API Gateway routes**: revert shared-infra-stack to prior deploy — routes disappear.

## Next

Sprint 2 — Ed-Fi descriptor catalog + resolver — starts on new branch. First ticket planned: Ed-Fi `AcademicSubjectDescriptor` seed + resolver service.
