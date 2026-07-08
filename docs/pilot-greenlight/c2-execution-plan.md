# Sprint C2 — Execution Plan

> **Status:** approved planning artifact. No code or test PRs yet. Each ticket below lands as its own PR, in the order listed.
>
> **What C2 delivers:** the **internal greenlight gate** per [sprint-plan.md §C2](sprint-plan.md). Two prod-deployed backend additions + 1 write-path smoke + 5 non-negotiable read-path tests + 1 parametric harness + 1 gate doc. Every test runs against a deployed dev tenant via HTTP; no jest-isolation mocks.
>
> **Outcome:** when the 6 smoke scripts (C2.0 + C2.1-C2.5) all exit 0 against the first pilot's dev tenant, the engine + fixture combination is internally validated. **Greenlight verdict** = ready for Sprint C3 (pre-greenlight hardening) and Sprint C12 (external greenlight rehearsal).
>
> **Inventory finding** (basis for this plan): the plan-literal endpoints `/instructional-days` and `/shift-profile` don't exist in the backend yet. `/calendar-dates/stats` exists with the instructional-day count, so C2.1 can reuse it. C2.2 + C2.5 need a net-new `/shift-profile` endpoint. C2.4 needs a net-new attendance `DATE_NOT_INSTRUCTIONAL` validation. The hybrid path below builds only what's genuinely missing.

---

## 1. Pre-conditions (must hold before C2.0 starts)

- [x] Sprint C1 closed (PR #90 merged 2026-05-16). `@edforge/pilot-fixtures` exists with `loadPilotFixture` + 6 query helpers.
- [x] `dev-pabson-primary` tenant live in prod with school `4209e3d8-d2e2-4e0e-9961-790341c264f4` and AY `0167de00-cc49-476b-9654-ef98a8cf9014` (per memory `project_dev_tenant_system_sprint_3_shipped`).
- [ ] **Operator deliverable:** fresh prod TenantAdmin JWT for `dev-pabson-primary`, written to `/private/tmp/c0-c-3-prod-jwt.txt` (CLAUDE.md JWT-via-file rule). JWTs expire in ~1 hour; refresh as needed during execution.
- [ ] **Tenant calendar state:** dev-pabson-primary's AY needs `isCurrent: true` AND `calendar-dates` seeded from the pilot fixture, OR C2.0 seeds it as part of the write-path smoke. The current AY data has `isCurrent: false` per the production CloudWatch reports on 2026-05-16. Decision deferred to PR #2.

---

## 2. Per-ticket plan — 9 PRs total

### PR #1 — This document (sprint/c2-plan)

Doc-only. Locks the C2 plan. Doesn't execute anything.

### PR #2 — C2.0 write-path smoke skeleton

**Branch:** `sprint/c2-0-write-path-smoke`

**Files:**
- `scripts/smoke-tests/pilot-write-path.ts` (NEW)

**Scope:**
- Reads `ADMIN_TOKEN` from `/private/tmp/c0-c-3-prod-jwt.txt`
- Reads `PILOT_ID` env (default `pabson-saraswati-bs-2083`)
- Loads the pilot fixture via `loadPilotFixture(PILOT_ID)` from `@edforge/pilot-fixtures` (workspace symlink)
- **Minimal write batch** for the skeleton:
  - Create 1 staff training (already proven path per S3.2 baseline)
  - Verify: 2xx response, audit row written, event emitted to bus
- Tee output to `${EDFORGE_DEPLOY_LOG_DIR:-/tmp/edforge-deploys}/prod-smoke-c2-0-<ts>-<sha>.log`
- Cleanup: DELETE the training before exit
- Exit 0 on success, non-zero on any assertion failure

**Why minimal:** the full plan-literal C2.0 specifies "bulk-imports 50 students; enrolls them; marks 1 day of period attendance for one section." That's the **full smoke** target for C2.6 (the harness). For C2.0's first PR, we establish the loop with 1 write so we don't blow up on a tenant-state issue we haven't characterized.

**Validation:**
- Local: typecheck `npx tsc --noEmit scripts/smoke-tests/pilot-write-path.ts`
- Operator run (deferred to user-authorized window): `AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' scripts/smoke-tests/pilot-write-path.ts`

**Backend changes:** none.
**Deploy:** none.

### PR #3 — C2.1 instructional-days read test

**Branch:** `sprint/c2-1-instructional-days-test`

**Files:**
- `scripts/smoke-tests/pilot-greenlight-c2-1.ts` (NEW)

**Scope:**
- Loads the pilot fixture
- For each term in the fixture's `academicStructure`:
  - Compute expected instructional-day count via `instructionalDaysInRange(fixture, term.startBsDate, term.endBsDate)`
  - HTTP `GET /schools/:id/calendar-dates/stats?from=<adStart>&to=<adEnd>` against the deployed tenant
  - **Date format conversion:** the existing `/calendar-dates/stats` endpoint takes AD dates. Convert via `bsToGregorian` from shared-types before query.
  - Assert: `response.body.instructionalDays === expected` for each term
- Tee output

**Per-term expected counts:**
The exact numbers come out of the fixture loader at runtime. The fixture's [test anchors](../../packages/pilot-fixtures/src/academic-structure.spec.ts) lock the calendar-day inclusive count (T1=92, T2=82, T3=81, T4=84). The loader's `instructionalDaysInRange` subtracts Saturdays + holiday days. Specific numbers verified once at first PR run.

**Backend changes:** none.
**Deploy:** none.
**Caveat:** assumes `dev-pabson-primary`'s calendar-dates have been generated for the AY. If not, the stats endpoint returns 0 and the assertion fails — that's the signal to seed via `POST /schools/:id/academic-years/:yearId/generate-calendar` first. Handled by C2.0's seed step OR a separate one-time seed action.

### PR #4 — C2.3 exam-window containment test

**Branch:** `sprint/c2-3-exam-window-containment`

**Files:**
- `scripts/smoke-tests/pilot-greenlight-c2-3.ts` (NEW)

**Scope:**
- For each of the 4 exam windows in the fixture:
  - HTTP `GET /schools/:id/calendar-dates?from=<adStart>&to=<adEnd>` for the window's range
  - Assert: every date in the window has at least one event of type `exam_window` with `metadata.termId` matching the term
  - Sample a small set of dates OUTSIDE every window and assert they have NO `exam_window` event
- Total exam-window day coverage: 9 + 9 + 10 + 12 = 40 days

**Backend changes:** none. Uses existing `/calendar-dates` list endpoint.
**Deploy:** none.

### PR #5 — Backend PR-A: `GET /schools/:id/shift-profile?date=`

**Branch:** `sprint/c2-backend-a-shift-profile-endpoint`

**Files (server/application):**
- `microservices/identity/src/schools/shift-resolver.controller.ts` (NEW) — single endpoint with `@Get('schools/:schoolId/shift-profile')` accepting `?date=<YYYY-MM-DD AD>` query
- `microservices/identity/src/schools/shift-resolver.service.ts` (NEW) — mirrors C1.7's `shiftProfileForDate` logic against backend data:
  - Read school's `BellSchedule` entity
  - Read `CalendarDate` for the queried date (resolve eventType + isInstructionalDay)
  - Resolve `metadata.schoolDays` from `WorkspaceSettings.regional.defaultWeekStartsOn` OR (better) from `school.schoolDays` config
  - Return same 5-way classification as the fixture: `regular | exam_day | holiday | weekend | vacation`
- `microservices/identity/src/schools/shift-resolver.service.spec.ts` (NEW) — unit tests mocking DDB

**Three-way route registration:**
- ✅ NestJS controller (above)
- New entry in `server/lib/tenant-api-prod.json` for `/schools/{schoolId}/shift-profile`
- nginx: existing `/schools` prefix block already covers it — no change needed

**Validation:**
- Local: `npx nest build identity` clean
- Local: `npx jest shift-resolver.service` 100% scenarios green
- After PR merge + your `Phase 5 GO` authorization:
  - Build + push identity image
  - Roll identitybasic ECS
  - Smoke against deployed: `curl /schools/:id/shift-profile?date=2083/07/01` returns 200 with classification: 'holiday'

**Deploy:** identity ECR push + ECS roll. Same ladder as C0.c.3.

### PR #6 — C2.2 shift resolution test

**Branch:** `sprint/c2-2-shift-resolution-test`

**Files:**
- `scripts/smoke-tests/pilot-greenlight-c2-2.ts` (NEW)

**Scope:**
- 30 sampled dates per the plan (10 regular + 10 exam-window + 10 weekend/holiday)
- For each: HTTP `GET /schools/:id/shift-profile?date=<AD>` and compare against fixture's `shiftProfileForDate`
- Assert: backend's classification === fixture's classification

**Backend changes:** uses PR-A.
**Deploy:** none (PR-A's deploy already happened).

### PR #7 — Backend PR-B: attendance `DATE_NOT_INSTRUCTIONAL` validation

**Branch:** `sprint/c2-backend-b-attendance-date-validation`

**Files (server/application):**
- `microservices/academics/src/attendance/attendance.service.ts` (MODIFY) — add date-validation step in `recordAttendance` before the audit write
- Cross-service call: academics service reads from identity's calendar-dates via either HTTP (through API Gateway) OR by adding a direct DDB read. **Decision needed at PR time** — check existing cross-service patterns first.
- `microservices/academics/src/attendance/attendance.service.spec.ts` — new specs for date-validation

**API contract:**
- Existing POST `/schools/:id/students/:studentId/attendance` — current happy path returns 201
- New behavior: if `date` is non-instructional (calendar-date `isInstructionalDay === false`), return 400 with:
  ```json
  {
    "statusCode": 400,
    "errorCode": "DATE_NOT_INSTRUCTIONAL",
    "message": "Attendance cannot be recorded on a non-instructional day (...)",
    "details": { "date": "...", "reason": "holiday|vacation|weekend" }
  }
  ```

**Three-way route registration:** no new route — modifies existing POST. Just code change in the service.

**Validation:**
- Local: `npx nest build academics`
- Local: jest specs cover both new validation cases + existing happy paths

**Deploy:** academics ECR push + ECS roll. Same ladder.

### PR #8 — C2.4 holiday exclusion test

**Branch:** `sprint/c2-4-holiday-exclusion-test`

**Files:**
- `scripts/smoke-tests/pilot-greenlight-c2-4.ts` (NEW)

**Scope:**
- For each multi-day holiday block in the fixture's `holidaysConsolidated`:
  - Sample one day in the block
  - HTTP POST attendance → expect 400 with `errorCode: DATE_NOT_INSTRUCTIONAL`
  - HTTP `GET /shift-profile?date=` → expect `classification: 'holiday'` or `'vacation'`, `shifts: []`
- For each single-day holiday: same checks
- For one regular instructional day (control): HTTP POST attendance → 201

**Backend changes:** uses PR-B's validation.
**Deploy:** none (PR-B's deploy already happened).

### PR #9 — C2.5 shift transitions + C2.6 harness + C2.7 docs

**Branch:** `sprint/c2-5-6-7-harness-and-docs`

**Files:**
- `scripts/smoke-tests/pilot-greenlight-c2-5.ts` (NEW) — 6 edge cases:
  - AY boundary day (Baisakh 3)
  - Next-AY day-1 (Baisakh 1 2084 — provisional window start)
  - Next-AY result-publish day (Baisakh 8 2084)
  - Next-AY new-session-begin day (Baisakh 12 2084)
  - Mid-vacation day (e.g., Summer Vacation Day 5)
  - Day after a school-specific program day (e.g., day after Saraswati Puja)
- `scripts/smoke-tests/pilot-greenlight.ts` (NEW; the C2.6 harness) — runs C2.0 + C2.1 → C2.5 sequentially with `PILOT_ID` env var, parametric over `listPilots()` if multiple pilots registered
- `docs/pilot-greenlight/gate.md` (NEW; the C2.7 doc) — what each test proves + how to re-run + how to register a new pilot

**Backend changes:** none.
**Deploy:** none.

---

## 3. Deploy timeline

| Phase | What happens | Operator action |
|---|---|---|
| Phase 0 | PRs #1-#4 land (planning + 3 read-only smokes against existing endpoints) | None (no deploy) |
| **Phase 1** | PR #5 lands (shift-profile endpoint code) | **Authorize:** identity ECR + ECS roll for shift-profile activation |
| Phase 1 verify | CloudWatch sample post-roll; PR #6 runs against the new endpoint | None |
| **Phase 2** | PR #7 lands (attendance validation code) | **Authorize:** academics ECR + ECS roll |
| Phase 2 verify | CloudWatch sample; PR #8 runs against the new validation | None |
| Phase 3 | PR #9 (harness + docs) lands; full C2.0-C2.5 run as a single harness invocation | **Authorize:** final greenlight verdict run against fresh JWT |

**Two prod deploys total** (one per backend PR). Each follows the C0.c.3 deploy ladder I documented in `c0-c-3-deploy-plan.md` — pre-flight gates, ECR push, ECS roll, CloudWatch monitoring, rollback path.

---

## 4. Greenlight verdict criteria

Per [sprint-plan.md §12](sprint-plan.md):
- **Internal greenlight (end of C2):**
  - [ ] C2.0 write-path smoke exit 0
  - [ ] C2.1-C2.5 all five read-path tests exit 0
  - [ ] All run against deployed prod-account dev tenant (not jest-isolation)

When all six smoke scripts exit 0 in a single C2.6 harness invocation against `dev-pabson-primary`, the **calendar / operational domain is internally validated for the first pilot.** Proceed to Sprint C3 (pre-greenlight hardening) and Sprint C12 (external greenlight rehearsal) per the dependency graph.

---

## 5. Rollback / abort

- **Backend PR-A or PR-B deploy fails verification** — same rollback path as C0.c.3 (re-tag prior ECR digest as `:latest`, force-new-deployment). Documented in [c0-c-3-deploy-plan.md §4](c0-c-3-deploy-plan.md).
- **Any smoke (C2.0-C2.5) reveals a fixture bug** — patch the fixture (PR-sized change to `packages/pilot-fixtures/pilots/<id>/<file>.json`) + bump the pilot-fixtures workspace internally if needed.
- **Any smoke reveals a backend bug** — separate backend PR; greenlight verdict deferred until bug is fixed and smoke re-runs green.
- **Major scope creep** — pause + reconvene; do NOT silently expand C2's scope.

---

## 6. Out of scope for C2 (deferred)

- **Cross-year handoff testing** (C9's centerpiece). C2.5's "next-AY day-1" probe just exercises the shift-profile endpoint for that date; it does NOT test the provisional → confirmed enrollment flip. That's the C9 sprint.
- **Per-period attendance** (C6). C2.0/4 use day-level attendance.
- **Result aggregation** (C7). C2.x doesn't touch result cards.
- **Pilot 2 onboarding**. The whole point of the parametric pattern is that pilot 2 lands by dropping fixture data + running the suite. Until pilot 2 is registered, every parametric block runs once for pilot 1.

---

## 7. Operator deliverables summary

| Item | When needed |
|---|---|
| Fresh prod TenantAdmin JWT for `dev-pabson-primary` at `/private/tmp/c0-c-3-prod-jwt.txt` | Start of PR #2; refresh as needed (~1h lifetime) |
| Authorize identity ECR + ECS roll | After PR #5 merges |
| Authorize academics ECR + ECS roll | After PR #7 merges |
| Final greenlight verdict run authorization | After PR #9 merges |

---

## 8. PR mapping

| PR # | Branch | Owner | Status |
|---|---|---|---|
| 1 | `sprint/c2-plan` | this PR | open |
| 2 | `sprint/c2-0-write-path-smoke` | claude | pending #1 |
| 3 | `sprint/c2-1-instructional-days-test` | claude | pending #2 |
| 4 | `sprint/c2-3-exam-window-containment` | claude | pending #3 |
| 5 | `sprint/c2-backend-a-shift-profile-endpoint` | claude | pending #4 + your-authorize-deploy |
| 6 | `sprint/c2-2-shift-resolution-test` | claude | pending PR-A deploy |
| 7 | `sprint/c2-backend-b-attendance-date-validation` | claude | pending #6 + your-authorize-deploy |
| 8 | `sprint/c2-4-holiday-exclusion-test` | claude | pending PR-B deploy |
| 9 | `sprint/c2-5-6-7-harness-and-docs` | claude | pending #8 |

End of plan.
