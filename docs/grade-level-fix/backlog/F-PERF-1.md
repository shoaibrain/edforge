---
id: F-PERF-1
title: /api/academics/attendance/{overview,alerts} 504 Gateway Timeout on cold-start
status: Backlog — surfaced during T1 preview validation 2026-05-12
severity: MEDIUM — operator-visible (home dashboard widgets stay in error state on first hit)
sprint: grade-level-fix (out of T1 scope; tracked as backlog for the same sprint)
discovered_by: T1 preview validation on dev-pabson-primary School A
---

# F-PERF-1 — Attendance endpoints 504 on cold-start

## Symptom

During T1 frontend preview validation, the home dashboard for `dev-pabson-primary-school-A-wide` rendered most widgets cleanly but threw two React Query errors in the browser console:

```
[React Query] Query error {queryKey: ['home','alerts','4209e3d8-…','0167de00-…'], status: 504, message: 'Request failed with status code 504'}
[React Query] Query error {queryKey: ['home','attendance-overview','4209e3d8-…','0167de00-…','2026-05-12'], status: 504, message: 'Request failed with status code 504'}
```

Network tab showed two endpoints returning `504 Gateway Timeout`:

- `GET /api/academics/attendance/overview?schoolId=…&yearId=…&date=2026-05-12`
- `GET /api/academics/attendance/alerts?schoolId=…&yearId=…`

All other home-dashboard API calls returned 200/304 normally:

- `/api/users/me`
- `/api/tenants/<tenantId>`
- `/api/tenants/<tenantId>/settings`
- `/api/schools?tenantId=…`
- `/api/schools/<schoolId>/current`
- `/api/schools/<schoolId>/configuration`
- `/api/finance/schools/<schoolId>/summary`
- `/api/academics/attendance/trend?schoolId=…`
- `/api/academics/sections?schoolId=…`
- `/api/academics/dashboard/overview?schoolId=…`

So the failure is **specific to two endpoints** (`/attendance/overview`, `/attendance/alerts`) rather than a broad academics-service outage.

## Test bed when observed

- Tenant: `dev-pabson-primary` (`21aea5da-511f-4dfa-a6f2-6971f63a719f`)
- School: `dev-pabson-primary-school-A-wide` (`4209e3d8-d2e2-4e0e-9961-790341c264f4`)
- Academic year: `0167de00-cc49-476b-9654-ef98a8cf9014` (active, 2083-academic-year)
- Students: 200 imported via IEMIS (Sprint C3/C4 work)
- Attendance records: **0** (no attendance has ever been taken for this school)

## Hypotheses (most → least likely)

### H1 — ECS cold start under `desiredCount=1` (post-infra-sunset/6)

The infra-sunset/6 sprint cut `desiredCount` from 2 → 1 for headline cost reduction. After a quiet period (e.g., no requests for 30+ min during deploy gaps), the single `academicsbasic` task can be in a CPU-idle state. The next request — especially an aggregation-heavy one like attendance overview — pays warmup cost on top of compute time, exceeding API Gateway's 30s timeout.

**Validation:** request the same endpoint a second time within 60s of the first. If it succeeds (warm task), hypothesis confirmed.

### H2 — N+1 query pattern in `attendance.service.ts` for empty-data case

`attendance/overview` likely:
1. Queries all `Enrollment` rows for the school+AY (200 rows)
2. For each enrollment, looks up today's attendance record (200 GetItem calls or 200 entries in a Query result)
3. Aggregates into `byGradeLevel` buckets

When attendance records exist, step 2's keyed lookups are cheap. When attendance is **completely empty** (our case), the code path may fall into a slow "no records found" branch that does a full scan or a join with sections/students/something else that's more expensive.

**Validation:** add a few attendance records and re-test. If 504s disappear with attendance data present, this is the smoking gun.

### H3 — Recently-deployed query that didn't account for empty AY

A recent academics deploy (Sprint C4 async IEMIS + AY decoupling, 2026-04-30) refactored the dashboard / attendance data flow. There may be a query added in that work that doesn't short-circuit on `enrollmentCount > 0 && attendanceCount == 0`.

**Validation:** code-read `attendance.service.ts` around line 627 (per CLAUDE.md note: "Task 1.6: byGradeLevel computed from enrollment data").

## Why not in T1 scope

T1 was F-LEGACY-1: the legacy grade-level validator. These 504s are unrelated:

- They affect endpoints the legacy validator doesn't touch.
- They'd manifest the same way on `edforge.app` for Saraswati if she navigated to the same home dashboard under the same empty-attendance conditions — i.e., this is a pre-existing pilot bug, not something T1 introduced.
- Backend code wasn't changed in T1.

Filing here so it's tracked rather than absorbed into T1's PR.

## Suggested triage path

1. **Quick test (5 min)** — re-load the dev-pabson-primary home page once the `academicsbasic` task is known to be warm (e.g., right after a `update-service --force-new-deployment`). If 504s vanish on a warm task, file as "cold-start consequence of desiredCount=1, escalate to product".
2. **If 504s persist on warm task** — code-read `academics/src/attendance/attendance.service.ts` lines 627+, look for the empty-data branch. CloudWatch logs from a known-504 request will surface the slow query.
3. **Mitigation options** (pick after diagnosis):
   - (a) Add an `if (enrollmentCount === 0) return emptyResponse` short-circuit at the start of both handlers — cheap, ships fast.
   - (b) Add CloudWatch synthetic ping every 5 min hitting `/health` to keep the task warm — fights the cost-savings of `desiredCount=1` but only marginally.
   - (c) Raise `desiredCount` back to 2 — reverses infra-sunset/6's savings; least preferred.

## Owner / next step

Unassigned. Likely picks up in T2 (F-IEMIS-1 janitor cron CDK) backend deploy window — that deploy will warm the task and let us re-test cleanly.

## Related

- [docs/grade-level-fix/SPRINT-PLAN.md](../SPRINT-PLAN.md) § Backlog
- [docs/infrastructure-sunset/sprint-4-vercel-env-update.md](../../infrastructure-sunset/sprint-4-vercel-env-update.md) (closeout context)
- Memory: `project_grade_level_fix_T1_shipped.md`
