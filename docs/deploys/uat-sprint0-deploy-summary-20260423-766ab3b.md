# Sprint 0 — UAT deploy summary

**Date:** 2026-04-23
**Commit (main):** `766ab3b` chore(shared-types): bump 0.29.0 → 0.30.0
**Operator:** Shoaib (pair-programming with Claude)
**Status:** SUCCESS — all 4 ECS services rolled; AdminWeb bundle live; live traffic flowing through new code.

---

## Deliverables landed

| Ticket | Artifact | Status |
|---|---|---|
| S0.1 | `uuid()` for guardian IDs in student.mapper.ts | live |
| S0.2 | DataTable `serverPagination` in @edforge/ui + wired into StudentTable / EnrollmentTable | live (Vercel auto-deploy) |
| S0.3 | `DynamoDBClientService.atomicIncrement` primitive | live |
| S0.4 | `StudentIdService` refactored onto atomicIncrement | live |
| S0.5 | `RequestScopedSchoolCache` in IdentityClientService + wired into IEMIS import path | live |
| S0.6 | `FEATURE_FLAG_KEYS` + `featureFlagsSchema` + `isFeatureEnabled` (shared-types 0.30.0) + WorkspaceSettings.features PATCH path + academics IdentityClient.isFeatureEnabled with 30s cache | live |
| S0.7 | CLAUDE.md publish-gate checklist + platform plan + post-mortem docs | committed |

## Deploy ladder

1. ✅ `cd packages/shared-types && npm version minor --no-git-tag-version` → 0.30.0
2. ✅ `npm publish` (2FA completed, registry serving 0.30.0)
3. ✅ `npm view @aibrains/shared-types version` → `0.30.0`
4. ✅ `npm install` at repo root → lockfile refreshed with 0.30.0
5. ✅ `cd client/AdminWeb && rm -rf node_modules/.cache build && npm run build` → `main.23fab66b.js`
6. ✅ jsdom bundle sim local build → OK, 1056 chars mounted at `#root`
7. ✅ `git commit` version bump + `git push origin main` → `766ab3b`
8. ✅ `cdk diff controlplane-stack` → only AdminWeb source zip changed; log `uat-cdk-diff-controlplane-stack-20260423-131102-766ab3b.log`
9. ✅ `./scripts/deploy-analytics.sh controlplane-stack uat` → `analytics-uat-controlplane-stack-20260423-131227-766ab3b.log`
10. ✅ CodePipeline AdminWebUi re-triggered (initial run raced S3 consistency) → `Succeeded`
11. ✅ Live bundle served at `main.c0264844.js` (CodeBuild-produced hash; different from local build because CodeBuild installs fresh from npm registry)
12. ✅ jsdom sim on live bundle → OK, 1026 chars mounted
13. ✅ `./scripts/build-application.sh identity` → image `identity:766ab3b-20260423183138`; log `uat-build-application-identity-20260423-133133-766ab3b.log`
14. ✅ `aws ecs update-service identitybasic --force-new-deployment` → `rolloutState=COMPLETED`, 2/2 tasks running on `identity-TaskDef:12`; log `uat-ecs-roll-identitybasic-20260423-133326-766ab3b.log`
15. ✅ `./scripts/build-application.sh academics` → image `academics:766ab3b-20260423183911`; log `uat-build-application-academics-20260423-133907-766ab3b.log`
16. ✅ `aws ecs update-service academicsbasic --force-new-deployment` → `rolloutState=COMPLETED`, 1/1 tasks on `academics-TaskDef:12`; log `uat-ecs-roll-academicsbasic-20260423-134139-766ab3b.log`

## Smoke

**Log:** `docs/deploys/uat-smoke-sprint0-20260423-134637-766ab3b.log`

| Check | Result |
|---|---|
| All 4 ECS services `rolloutState=COMPLETED` | ✅ identitybasic 2/2, academicsbasic 1/1, financebasic 1/1, rproxybasic 2/2 |
| AdminWeb served from CloudFront | ✅ `main.c0264844.js` (976K) |
| AdminWeb jsdom sim on live bundle | ✅ mounts React, 1026 chars |
| Identity service Nest startup | ✅ "Nest application successfully started", "Identity Service running on port 3010" |
| Identity service error-free since deploy | ✅ zero ERROR lines in 15-min window |
| Academics service IdentityClient init | ✅ "Identity Client initialized with URL: http://identity-api.basic.sc:3010" |
| Academics service error-free since deploy | ✅ zero ERROR lines in 15-min window |
| Live user traffic | ✅ JWT validation for `shoaib.rain@outlook.com` in live logs |

## What's NOT yet tested (deferred to pilot tenant dress-rehearsal)

- 779-row IEMIS import commit-phase latency improvement (requires pilot tenant + real data — Sprint 15)
- `PATCH /tenants/:id/settings { features: { ... } }` happy path (requires UAT tenant with TenantAdmin role)
- StudentTable server-pagination end-to-end (requires UAT tenant with >20 students)

These are intentionally deferred — Sprint 0 is foundational plumbing; the behaviors it unlocks are validated in the sprints that build on it.

## Prod promotion

**NOT YET.** Per [CLAUDE.md deploy ladder](../../CLAUDE.md), prod deploy requires explicit operator authorization. Sprint 0 is safe to promote whenever ready — it's additive (new DDB attribute, new shared-types exports, no schema breakage, no behavior change by default). Recommend holding prod promotion until after Sprint 1 lands and we promote both together.

## Rollback plan

- **ECS**: `aws ecs update-service --task-definition identity:11` (revert to revision 11 for identity; revision 11 for academics) → drains to old image.
- **shared-types**: 0.30.0 is additive. No consumer behavior changes if we downgrade to 0.29.0 — all new methods are additive + opt-in via call site. Keep 0.30.0 on npm; downgrade consumer pins only if rollback is actually needed.
- **CDK controlplane-stack**: revert to prior stack version via `cdk deploy` from a worktree pinned at `fdc4718`. AdminWeb CodePipeline rebuild will serve the prior bundle.

## Next

Sprint 1 — IEMIS Identity, RBAC, Audit primitives — starts on new branch `sprint/iemis-s1-identity-rbac-audit`. First ticket: **S1.1 (IEMIS code format Zod validators)**.
