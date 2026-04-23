# Sprint 3 — UAT deploy summary

**Date:** 2026-04-23
**Commit (main):** `f959e56` Merge pull request #22 — Sprint 3 Student demographics + StudentSchoolAssociation (S3.1–S3.3, S3.5, S3.7)
**Operator:** Shoaib (pair-programming with Claude)
**Status:** SUCCESS — shared-types `0.32.0` published, server-side pins bumped, academics ECR rolled, shared-infra-stack redeployed with 3 new API Gateway routes, all routes return `401 Unauthorized` (route wired + auth guard active).

---

## Deliverables landed

| Ticket | Artifact | Status |
|---|---|---|
| S3.1 | Student schema extended with Ed-Fi descriptor fields (sex / language / mother-tongue / disabilities / ethnicity / isTransferred / belowPovertyLine + scholarshipCategory) | live |
| S3.2 | `enrollmentToStudentSchoolAssociation` mapper in shared-types — Ed-Fi projection over existing Enrollment rows (Option B facade, no DDB migration) | live |
| S3.3 | `StudentSchoolAssociationController` with `findByComposite` + `listByStudent` endpoints | live (`listByYear` deferred to Sprint 10) |
| S3.4 | **Skipped** — reuse existing gsi2 on Enrollment per Option B, no new GSI | N/A |
| S3.5 | `academicYearToSchoolYearType` mapper shipped alongside SSA mapper | live |
| S3.6 | Frontend Student detail Demographics section | **pending** — separate PR on edforge-saas-frontend repo |
| S3.7 | `PATCH /academics/students/:id/descriptors` + academics `IemisAuditLogger` + `student.descriptor.edited` audit event (fail-open, notes stripped) | live |

Plus helpers: `deriveDescriptorsFromLegacy()` + `enrichStudentWithDerivedDescriptors()` for non-destructive backfill from legacy `gender` / `primaryLanguage` / `homeLanguage` fields.

## Deploy ladder

1. ✅ `npm version minor` → shared-types 0.31.0 → **0.32.0**; build + 141/141 jest green
2. ✅ `npm publish` — registry serving 0.32.0 (verified via `npm view @aibrains/shared-types version`)
3. ✅ Server-side pin bumps (caret-pin trap from Sprint 1 memory):
   - `server/package.json`: `^0.31.0` → `^0.32.0`
   - `server/application/package.json`: `^0.31.0` → `^0.32.0`
   - `packages/tenant-settings-resolver/package.json`: `^0.31.0` → `^0.32.0`
4. ✅ `npm install` at repo root — root lockfile refreshed with 0.32.0
5. ✅ `./scripts/build-application.sh academics` → `academics:f959e56-20260423222541` pushed to ECR. Log `uat-build-application-academics-20260423-172537-f959e56.log`
6. ✅ `aws ecs update-service academicsbasic --force-new-deployment` → `rolloutState=COMPLETED`, 1/1 on `academics-TaskDef:12`. Log `uat-ecs-roll-academicsbasic-20260423-172649-f959e56.log`
7. ✅ Boot logs confirm Sprint 3 routes mapped:
   - `Mapped {/academics/students/:id/descriptors, PATCH} route`
   - `Mapped {/academics/schools/:schoolId/years/:yearId/students/:studentId/student-school-association, GET} route`
   - `Mapped {/academics/students/:studentId/student-school-associations, GET} route`
8. ⚠️  Initial gateway smoke returned **403 "Missing Authentication Token"** — Sprint 3 plan erroneously noted "no CDK deploy needed," but the new backend routes required 3 new entries in `server/lib/tenant-api-prod.json` + shared-infra-stack redeploy so API Gateway knew about the paths. Scope gap, not regression.
9. ✅ Added 3 new path blocks to tenant-api-prod.json (PATCH + GET + GET with OPTIONS mocks for CORS). JSON validated.
10. ✅ `cdk diff shared-infra-stack` → expected 3 new paths + deployment replaced. Log `uat-cdk-diff-shared-infra-stack-20260423-173313-f959e56.log`
11. ✅ `./scripts/deploy-analytics.sh shared-infra-stack uat` → completed in 429s. Log `analytics-uat-shared-infra-stack-20260423-173806-f959e56.log`
12. ✅ Post-deploy gateway smoke:
    - `PATCH /academics/students/:id/descriptors?schoolId=X` → **401 Unauthorized**
    - `GET /academics/students/:id/student-school-associations?schoolId=X` → **401 Unauthorized**
    - `GET /academics/schools/:a/years/:b/students/:c/student-school-association` → **401 Unauthorized**

All three now behave correctly (route matched, auth guard active). No 403 "Missing Authentication Token" (route not defined) and no 404 (path not found).

## Smoke

| Check | Result |
|---|---|
| `@aibrains/shared-types@0.32.0` on npm registry | ✅ |
| Root lockfile has 3× `^0.32.0` refs, 0× stale `^0.31.0` | ✅ |
| Academics Docker build successful; pushed to ECR with dual-tag (SHA + latest) | ✅ |
| academicsbasic ECS rollout COMPLETED, 1/1 tasks on `academics-TaskDef:12` | ✅ |
| Academics Nest boot: 3 new Sprint 3 routes mapped | ✅ |
| Academics Nest boot: zero ERROR lines in 5-min window | ✅ |
| API Gateway routes: all 3 new paths return 401 (not 403/404) | ✅ |

## Known gaps / follow-ups (documented, not blocking)

1. **Plan erratum — API Gateway step missed.** Sprint 3 PR body stated "no CDK deploy needed." Incorrect: any new backend route exposed to tenants needs a corresponding tenant-api-prod.json entry + shared-infra-stack deploy. Memory `edforge_service_info_build.md` already flags the service-info trap; added note in post-mortem below about the API Gateway registration trap.
2. **Audit federation.** `student.descriptor.edited` rows land in `edforge-academics-basic`; identity `/iemis/audit` endpoint (S1.10) only reads `edforge-identity-basic`. Descriptor-edit audits are currently retrievable via CloudWatch Logs Insights on the academics log group or direct DDB query against `AUDIT#IEMIS#` SK prefix. Federation deferred to Sprint 13 (DSAR / PII access logging).
3. **Academics MetricFilter + Alarm not wired.** Identity has the Sprint 1 pattern (S1.12) via `services.ts`. Academics needs a parallel pair in `tenant-template-stack-basic`. Batch this with the Saraswati pre-go-live SNS wiring (deferred per 2026-04-23 decision about CloudWatch cost beyond 10 alarms).
4. **`ethnicityDescriptor` URI-shape only.** Sprint 6 ships the 125+ CBS caste catalog and tightens the validator.
5. **`listByYear` SSA endpoint deferred to Sprint 10.** Export sprint designs paging semantics.
6. **Frontend S3.6 not yet started.** Separate PR on edforge-saas-frontend — branch after backend is verified live.

## Post-mortem

**Gap:** Sprint 3 added three new backend routes but I originally scoped out the API Gateway step on the assumption that "no CDK changes" meant the shared-infra-stack was untouched. In reality, new backend routes are NOT backed by a proxy+ wildcard — tenant-api-prod.json enumerates every path, so every new endpoint needs a corresponding entry.

**Discovery:** Post-academics-roll gateway smoke returned 403 "Missing Authentication Token" (API Gateway's default when a route isn't defined). Correct distinction: 401 = route defined, auth failed; 403 with that message = route undefined. Caught before declaring success.

**Fix time:** ~15 minutes to add the 3 path blocks + CDK diff + shared-infra-stack deploy.

**Memory update proposed:** add a line to the repo conventions for "any new backend route under `/academics/*` / `/identity/*` / etc. must also add a corresponding path block in `server/lib/tenant-api-prod.json` + a shared-infra-stack deploy before the gateway smoke succeeds." The deploy-matrix row in CLAUDE.md already covers this (`API Gateway route (tenant-api-prod.json) → shared-infra-stack`) but didn't click for me on the first pass — will add a memory entry to make the implicit "new backend route = API Gateway update" rule explicit.

## Prod promotion

**NOT YET.** Per CLAUDE.md, prod deploy requires explicit operator authorization. Sprint 3 is additive:
- shared-types 0.32.0 is additive (new schemas + new mapper + new event type + new helpers — no breaking changes)
- academics gets one new PATCH endpoint + two new GET endpoints
- shared-infra-stack adds 3 new API Gateway paths
- No DDB schema changes, no GSI additions, no ECS cluster changes

Safe to promote whenever ready.

**Prod-specific prep before promote:**
- Regenerate `server/lib/service-info.json` with `REGION=ap-south-1 ACCOUNT_ID=257526644020` (deploy wrapper pre-flight catches placeholder-empty but NOT cross-env-substituted — eyeball-check).
- The tenant-api-prod.json additions are env-agnostic (no region/account literals); diff will show the same 3 path additions against prod API Gateway.

## Rollback plan

- **shared-types 0.32.0**: additive. Consumers can pin down to `^0.31.0` and rebuild; 0.32.0 stays on npm untouched.
- **academics ECS**: `aws ecs update-service academicsbasic --task-definition academics:11 --force-new-deployment` rolls back to the pre-Sprint-3 image.
- **shared-infra-stack API routes**: `cdk deploy shared-infra-stack` from a worktree pinned at `f959e56`'s parent removes the 3 new paths.

## Next

- **Frontend Sprint 3 S3.6** — new branch on edforge-saas-frontend, Student detail Demographics section.
- **Sprint 4** — Staff + StaffQualification + StaffTraining (per IEMIS platform plan).
