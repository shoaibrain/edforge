# Prod — Sprint 4 S4.1 + S4.6 deploy summary

**Date:** 2026-04-24 (same day as Sprint 0-3 prod promote; incremental)
**Commit (main):** `e4ff44e` Merge pull request #24 from shoaibrain/feat/sprint4-staff-iemis-fields
**Region / Account:** `ap-south-1` / `257526644020`
**Operator:** Shoaib (pair-programming with Claude)
**Status:** ✅ **SUCCESS** — additive Staff schema fields live on prod, UAT + prod smokes both 19/19 green, mapper round-trip lesson verified.

This is the narrowest of Sprint 4's four planned slices. The three remaining slices (S4.2 decision doc, S4.7 audit events, S4.3 StaffTraining) follow as separate PRs.

---

## Deliverables landed (this PR)

| Ticket | Artifact | Location |
|---|---|---|
| S4.1 | 5 IEMIS-specific optional fields on `Staff` — `emisStaffId`, `nationality`, `maritalStatus`, `appointmentType`, `appointmentDate` | `packages/shared-types/src/schemas/identity/staff.schema.ts` + `server/application/microservices/identity/src/common/entities/staff.entity.ts` |
| S4.1 | `maritalStatusSchema` + `appointmentTypeSchema` enums | `packages/shared-types/src/schemas/identity/staff.schema.ts` |
| S4.6 | `iemisStaffIdSchema` + `IEMIS_STAFF_ID_REGEX` + `isValidIemisStaffId` helper (16-digit placeholder; Sprint 11 tightens per real CEHRD spec) | `packages/shared-types/src/identity/iemis-codes.ts` |
| S4.1 | `staffEntityToDto` extracted from `StaffService.toStaffResponse` into a module-level pure function (matches the 2026-04-24 student-mapper hotfix refactor — enables unit-testable round-trip without DI) | `server/application/microservices/identity/src/staff/staff.service.ts` |
| S4.1 | `StaffService.createStaff` + `updateStaff` write paths persist the 5 new fields | same |
| S4.1 | `staff.mapper.spec.ts` — 4 regression tests locking round-trip contract (same class of bug the student mapper had) | `server/application/microservices/identity/src/staff/staff.mapper.spec.ts` |
| S4.6 | 11 new unit tests for `iemisStaffIdSchema` + `isValidIemisStaffId` | `packages/shared-types/src/identity/iemis-codes.spec.ts` |

shared-types published as **`@aibrains/shared-types@0.33.0`** on npm before the PR merged. Consumer pins bumped to `^0.33.0` in `server/package.json`, `server/application/package.json`, `packages/tenant-settings-resolver/package.json`.

---

## Deliberately NOT in this PR

Sprint 4 is split into 4 narrow PRs per the "Option B" sequencing decided with the user 2026-04-24:

| Ticket | Status | Rationale for split |
|---|---|---|
| S4.2 — Credentials-vs-Qualifications decision doc | follows in the same-day docs PR | Non-code artefact; ships immediately alongside this summary |
| S4.7 — IemisAuditLogger emits `staff.credential.edited` + new event types in the enum | next backend PR | Needs shared-types 0.34.0; own test sweep; touches the S4.2 decision surface (credentialCategory in metadata) |
| S4.3 — `StaffTraining` entity + service + controller + CRUD + API Gateway + NGINX | separate PR | New entity + 3-way route registration rule (`edforge_api_gateway_route_registration` memory); own migration + smoke |
| Frontend — extend EditStaffModal + Trainings tab | separate frontend PR | `edforge-saas-frontend` repo; needs shared-types 0.33.0 pin bump (then 0.34.0 after S4.7) |

---

## Deploy ladder — actual sequence

| # | Step | Time (UTC) | Duration | Log |
|---|---|---|---|---|
| 1 | `npm publish` `@aibrains/shared-types@0.33.0` from `packages/shared-types` (2FA) | 2026-04-24 ~22:55 | <30s | npm registry confirmation |
| 2 | `git push -u origin feat/sprint4-staff-iemis-fields` + `gh pr create` → PR #24 | 23:00 | <5s | GitHub |
| 3 | User review + merge PR #24 → `e4ff44e` on `main` | — | — | — |
| 4 | `./scripts/build-application.sh identity` (UAT) | 23:01 → 23:01 | ~90s | `uat-build-application-identity-sprint4-20260424-180122-e4ff44e.log` |
| 5 | Roll identitybasic (UAT) + wait-stable | 23:03 → 23:07 | 4:23 | `uat-ecs-roll-identitybasic-sprint4-20260424-180305-e4ff44e.log` |
| 6 | UAT smoke — 19 checks against testtenant007 (school RAS) | 23:09 | ~2s | `uat-smoke-sprint4-s4.1-s4.6-<ts>-e4ff44e.log` — **19/19 GREEN** |
| 7 | `./scripts/build-application.sh identity` (prod) | 23:15 → 23:16 | ~90s | `prod-build-application-identity-sprint4-20260424-181540-e4ff44e.log` |
| 8 | Roll identitybasic (prod ap-south-1) + wait-stable | 23:18 → 23:22 | 4:07 | `prod-ecs-roll-identitybasic-sprint4-20260424-181814-e4ff44e.log` |
| 9 | Prod smoke — 19 checks against prodtestadmin tenant (school `816c1535-…`) | 23:28 | ~2s | `prod-smoke-sprint4-s4.1-s4.6-<ts>-e4ff44e.log` — **19/19 GREEN** |

**Total wall-clock for the code change:** ~30 min UAT (merge → build → roll → smoke) + ~15 min prod (same). No CDK, no DDB, no API Gateway, no NGINX changes — strictly an ECS roll.

### ECR images pushed

| Env | Repository | Tag | Digest |
|---|---|---|---|
| UAT | `715860911762.dkr.ecr.us-east-2.amazonaws.com/identity` | `e4ff44e-20260424230130` + `:latest` | `sha256:e96c13ee0503ff55761e56e20fb69a8bccd2b3c733a08740aabef9dfbd903554` |
| Prod | `257526644020.dkr.ecr.ap-south-1.amazonaws.com/identity` | `e4ff44e-20260424231552` + `:latest` | `sha256:28b63fa2820c067cbf4f3a54c68461aafa16c7c271b1a28b71839cf9c2bb4623` |

No CDK changes → neither `shared-infra-stack` nor `tenant-template-stack-basic` touched. Task-definition revision unchanged (image-only roll).

---

## Smoke evidence

`scripts/smoke-tests/sprint4-staff-iemis-fields-smoke.ts` — 19 checks covering:

1. POST `/staff` with all 5 IEMIS fields → 200/201 response including all 5 (write-path verification)
2. GET `/staff/:id` round-trip → response includes all 5 (**the 2026-04-24 mapper-lesson check** — locked in after the student mapper hotfix)
3. PATCH `/staff/:id` with one field (`nationality`) → response reflects update AND the other 4 fields survive untouched (partial-update correctness)
4. DELETE `/staff/:id` → cleanup (zero residue on tenant)

Both environments passed 19/19:

**UAT** (testtenant007, `us-east-2`): ✓ all 19 checks green
**Prod** (prodtestadmin `04ce4a00-…`, `ap-south-1`): ✓ all 19 checks green

The prod smoke used a non-Saraswati test tenant to avoid leaving even transient residue on the real-pilot tenant or the rehearsal tenant.

---

## Rollback

**One command** reverts the prod identity service to the Sprint 0-3 image:

```bash
AWS_PROFILE=prod aws ecs update-service \
  --cluster prod-basic --service identitybasic \
  --task-definition identity:2 \
  --force-new-deployment --region ap-south-1
```

TaskDef `:2` points at `identity:3c420c1-20260424151449` (the Sprint 0-3 prod image). The 5 new Staff schema fields are optional → no data migration needed to revert.

shared-types `@0.33.0` stays on npm indefinitely; if the pin needs to revert, consumer `package.json` files downgrade to `^0.32.0` + next identity ECR build resolves the older shape. Reverting shared-types itself is unnecessary because `0.33.0` is a strict superset of `0.32.0` (purely additive exports).

---

## Known gaps / follow-ups

1. **No audit events yet on staff credential/assignment edits** — S4.7 is the next PR. Affected endpoints today (`POST /staff/:id/credentials`, `PATCH /staff/:id/credentials/:credId`, `DELETE /staff/:id/credentials/:credId`, same for assignments) write to DDB but do not emit `staff.credential.edited` IEMIS audit events. UI-layer observability (frontend toasts, CloudWatch log scrapes) still works in the meantime.

2. **CEHRD Staff-code format spec unconfirmed** — `iemisStaffIdSchema` validates as 16 digits by analogy with `iemisStudentIdSchema`. Sprint 11 tightens when the real CEHRD Staff export spec lands (via Saraswati principal or CEHRD portal download).

3. **Frontend UI doesn't surface the 5 new fields yet** — `EditStaffModal` still shows only pre-Sprint-4 fields. Separate frontend PR follows after S4.7 merges (which will bump shared-types to 0.34.0 with new credential-category enum; single frontend pin bump for both).

4. **IEMIS enum doesn't yet include Staff-specific event types** — `IEMIS_AUDIT_EVENT_TYPES` still carries only `iemis.verify-school-code`, `iemis.audit.list-viewed`, `student.descriptor.edited`. Sprint 4 S4.7 adds `staff.credential.created|edited|deleted`, `staff.assignment.created|edited|deleted`, `staff.training.created|edited|deleted`.

5. **Academics `iemis.audit.emit_failures` alarm still missing** (carried over from Sprint 0-3 summary §R5). Not on Sprint 4 critical path.

---

## Next

- **S4.2 decision doc** — `docs/decisions/sprint4-credentials-vs-qualifications.md` (same docs PR as this summary)
- **S4.7 audit events** — separate backend PR. Shared-types 0.34.0 + `IEMIS_AUDIT_EVENT_TYPES` extension + `IemisAuditLogger.emit(...)` wiring in Staff credential/assignment services + mapper regression tests + `credentialCategory` field from S4.2 decision.
- **S4.3 StaffTraining** — separate backend PR. New entity + service + controller + CRUD + API Gateway route registration (`tenant-api-prod.json`) + NGINX `nginx.template` location block + audit events. Biggest of the three remaining slices.
- **Frontend** — after backend work lands, extend `EditStaffModal` with the 5 S4.1 fields + add Trainings tab mirroring the existing Credentials tab pattern.
