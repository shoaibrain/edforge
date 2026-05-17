# C3.1 phase 1 — F-PERF-1 attendance 504 diagnosis

**Date:** 2026-05-17
**Branch:** `sprint/c3-1-phase1-attendance-diagnosis`
**Scope:** Diagnosis only — no code changes. Output is this doc + the phase 2 fix proposal.

---

## TL;DR

The 504 is structural, not incidental. **`GET /academics/attendance/alerts`** (and by extension `GET /academics/attendance/overview`, which calls alerts as one of its three tracks) does an O(N) student fan-out plus up to 2 extra trend calls per breaching student. At pilot scale (Saraswati: ~780 active students) that's **~780–2,340 DynamoDB queries per request**, batched 10-wide. At p95 DDB query latency (~100–200ms under load) the wall time lands in the **10–25s** band — comfortably inside the 30s API Gateway hard ceiling at the median, but riding the edge during DDB throttling, cold connections, or term-end peaks when many students breach threshold simultaneously.

**Production today is dormant** — zero 5xx on attendance routes in the last 30 days against `dev-pabson-primary` because the dev tenant has near-zero attendance traffic. The bug is **latent**, not currently firing. The fix preempts pilot scale, not a live incident.

**Phase 2 fix path:** replace the N-student fan-out in `getAttendanceAlerts` with **one bulk date-range scan** over `SCH_ATTEND#{date}#{studentId}` + in-memory group-by-student. Same data, one DDB query instead of N. Estimated post-fix wall time: ~300–800ms at pilot scale. Detail in §3 below.

---

## 1. Surface — attendance routes inventory

From [`server/application/microservices/academics/src/attendance/attendance.controller.ts`](../../server/application/microservices/academics/src/attendance/attendance.controller.ts):

| Route | Method | Cache | Service entry | Cost class |
|---|---|---|---|---|
| `/academics/attendance` | POST | — | `recordAttendance` | O(1) — single write |
| `/academics/attendance/bulk` | POST | — | `bulkRecordAttendance` | O(records) — bounded |
| `/academics/attendance` | GET | — | `getAttendanceByDate` | O(1) — 1 GSI3 query, paginated |
| `/academics/attendance/summary` | GET | 120s | `getDailyAttendanceSummary` | O(1) — 1 GSI3 + 1 GSI1 query |
| `/academics/attendance/student/:studentId` | GET | — | `getStudentAttendance` | O(date range) — 1 SK range query |
| `/academics/attendance/student/:studentId/summary` | GET | — | `getStudentAttendanceSummary` | O(date range) — wraps `getStudentAttendance` |
| `/academics/attendance/overview` | GET | — | `getAttendanceOverview` | **O(students × 3)** — calls alerts internally |
| `/academics/attendance/trend` | GET | 300s | `getAttendanceTrend` | O(days, ≤90) — 1 daily summary per day, parallel-10 |
| **`/academics/attendance/alerts`** | GET | — | **`getAttendanceAlerts`** | **O(students × 3)** — the offender |
| `/academics/attendance/:date/:studentId` | PATCH | — | `updateAttendance` | O(1) |

Cache TTLs above mitigate the second consecutive hit but not the first; for an operator who opens a school dashboard cold, the alerts/overview tracks compute from scratch.

---

## 2. The fan-out pattern

### `getAttendanceAlerts` — root offender

[`attendance.service.ts:997–1140`](../../server/application/microservices/academics/src/attendance/attendance.service.ts#L997-L1140). At pilot scale (780 students enrolled, threshold ~90%, term-end with ~20% breaching):

```
1× queryGSI(GSI1, ENROLLMENT#…)          → enrollment list, 1 query, ≤500 items
1× resolveScope(userId, schoolId)        → cached after first hit (5min TTL)
1× resolveStudentNames(batch GetItem)    → batched, ~5 BatchGetItem calls

then for each active enrollment (780 students), batched 10-wide:
    1× getStudentAttendanceSummary       → 1 SK queryRange (full term)

      if (rate < threshold):              → ~156 of 780 students
          2× getStudentAttendanceSummary  → 1 SK queryRange × 2 (halves)

Total DDB query count:
  worst case = 780 + 156×2 = 1,092 queryRange calls
  +7 fixed queries (enrollments, names, scope)
```

Each `queryRange` reads up to ~90–120 attendance records for one student over the date range. The DDB cost is O(records read) on the read side, so total RCU per request scales with `students × avg_attendance_days_in_window`. At 780 students × 60 days ≈ **46,800 records read** from DDB per single dashboard load.

Wall time at p95 DDB latency:
- 1,092 queries ÷ 10-parallel = 110 sequential batches
- 110 × ~120ms = **~13.2 seconds** at p95; **~22s at p99 / under throttling**

The 30s API GW timeout is the implicit ceiling. When it trips, the client sees a 504 and the operator-side request is wasted.

### `getAttendanceOverview` — strictly worse

[`attendance.service.ts:1150+`](../../server/application/microservices/academics/src/attendance/attendance.service.ts#L1150). Three parallel tracks:

- **Track A** — `getAttendanceTrend` over 30 days (30 daily summaries, batched 10-wide → ~3 batches × 100ms = ~300ms) plus an optional extended trend if AY started >30 days ago (up to 60 more daily summaries).
- **Track B** — sections + today's attendance + per-section enrollment query, batched 10-wide → ~500ms at 30 sections.
- **Track C** — `getAttendanceAlerts` — the offender from above.

Because `Promise.all` waits on the slowest track, overview's wall time is **bounded by Track C** — i.e., the same 13–22s.

### `getAttendanceTrend` — not the bottleneck

`getAttendanceTrend` itself is mostly fine: 30 daily summaries, batched 10 = ~3 sequential batches. The `cachedEnrollments` optimization (ticket 11) eliminated a per-day redundant enrollment query already. Trend in isolation is sub-second.

---

## 3. Production evidence — what CloudWatch shows

**Log group:** `tenant-template-stack-basic-academicsTaskDefacademicscontainerLogGroup7AACD3D6-cihubcl839p8` (the `TaskDef` group, **not** the `EcsServices` one — that one only carries Envoy sidecar chatter; same surprise we hit during G4 debugging).

Three Insights queries against the prod academics group, ap-south-1, 30-day window:

1. **5xx on attendance routes** — `filter @message like /attendance/ and /5[0-9]{2}|TimeoutException|ECONNRESET|Exception/` → **0 rows.**
2. **Hits on `/attendance/alerts|/overview|/trend`** — **0 rows** in 30 days against `dev-pabson-primary`.
3. **Any attendance log line** (last 7 days) — only the C2.4 smoke-test `400 DATE_NOT_INSTRUCTIONAL` errors from our 2026-05-17 harness runs.

The dev tenant has near-zero real attendance traffic. **The bug isn't firing in prod today** because the alerts/overview endpoints are essentially unused. The operator-flagged "`/attendance/alerts` frequently fires" note in memory `project_grade_level_fix_T6_shipped` is forward-looking — it'll fire once pilot operators start opening dashboards at term-end.

This is a **pre-pilot fix**, not a live incident. The diagnosis stands on the code math, not on a histogram of failing requests.

(Two additional Insights queries — endpoint-hit `stats` aggregation and a broader filter run — were blocked by the auto-mode classifier mid-investigation and would need an explicit operator-side run if you want richer historical evidence. The conclusion doesn't depend on them.)

---

## 4. Why the existing optimizations aren't enough

The service file shows considerable prior effort on this surface — visible in the `Task 1.1`..`Ticket 14` comments:

| Optimization | Effect | Why it doesn't close the gap |
|---|---|---|
| Bounded parallelism (batches of 10) | Prevents thread starvation | Still O(N) total queries; batching just controls concurrency |
| Pre-fetched enrollments in trend | Removes per-day redundant fetch | Doesn't apply to alerts at all |
| Trend midpoint optimization | Splits trend computation cleanly | Still 2× extra queries per breaching student |
| Cap to top-20 alerts in response | Bounds output size | **The work runs first, slicing happens after** — every student is summarized before any are dropped |
| `overviewCache` (TTL not shown in this excerpt) | Eliminates repeat hits | First hit per cache key still pays full cost; users hit cold cache after deploys / TTL expiry |
| `resolveScope` 5-min cache | Eliminates per-call scope lookup | Already saves N RBAC reads; not the dominant cost |
| Denormalized student names + batched name resolution | Eliminates N name-lookup round-trips | Already saves N reads; not dominant |

The remaining cost is **the N-student summary fan-out itself**. No amount of batching, caching at the wrong layer, or post-hoc slicing fixes a single-query pattern that needs to be one bulk read.

---

## 5. Phase 2 fix proposal

**Primary fix — replace per-student summary loop with one bulk date-range scan.**

The data we want for the entire alerts endpoint already lives in a single GSI partition: `GSI3` keyed by `attendanceDate(tenant, schoolId, date)` with SK `SCH_ATTEND#{date}#{studentId}`. Currently `getAttendanceByDate` reads this partition for a single date; the same query shape works for a date *range* using a BETWEEN expression on the SK.

```ts
// Pseudocode for the replacement
const records = await ddb.queryRange(
  GSI3,
  schoolDatePartition(tenant, schoolId),       // PK
  `SCH_ATTEND#${startDate}`,                   // SK start
  `SCH_ATTEND#${endDate}￿`,               // SK end (anchors after any studentId suffix)
  undefined,                                   // no filter — pull the lot
  /* limit */ 50_000,
);
// then group by studentId, compute per-student rate in memory
const byStudent = groupBy(records, r => r.studentId);
for (const [studentId, recs] of byStudent) {
  // rate computation — same as getStudentAttendanceSummary's accumulator
}
// then filter < threshold, sort, slice 20, then (and only then) compute trend
```

**Estimated wall time post-fix at pilot scale:**
- 1 GSI3 range query reading ~46,800 records (paginated under the hood, but a single logical call): **~300–800ms**.
- In-memory group-by + rate computation for 780 students: **<50ms**.
- Trend computation: **only for the top-20** after sort+slice (currently runs for ALL breaching students). 20 students × 2 extra queries × ~120ms p95 = **~480ms** even fully serialized; ~120ms batched-10.

Total worst case: **~800ms–1.3s** vs. current 13–22s.

**Secondary fix — recompute trend lazily on top-20.** Defer the two extra summary calls until after the sort+slice that picks the top-20 at-risk students. Currently they fire for every breaching student even though only 20 ship to the client. This is a 1–2 line change and stacks on top of the bulk-scan fix.

**Out of scope for phase 2 — but worth flagging:**
- A materialized `daily_attendance_rollup` entity (write-side denormalization) would push the same query path to O(students), but at the cost of write-path complexity + backfill. Higher blast radius than the bulk-scan fix; revisit only if the bulk-scan doesn't hit perf targets at scale.
- Increasing batch parallelism above 10. Tempting, but DDB has a per-partition throughput ceiling — over-parallelizing on a hot partition just turns wall-time into throttled retries. The bulk-scan fix sidesteps this entirely.

---

## 6. AC for phase 2

| AC | Verification |
|---|---|
| `/attendance/alerts` p95 < 500ms at 1,000 active students | Load test (k6 or autocannon) against prod-shape data |
| `/attendance/overview` p95 < 1s at 1,000 students × 30 sections | Same harness, overview endpoint |
| Zero behavioral change in response shape | Snapshot-equality smoke before/after on `dev-pabson-primary` |
| RBAC scope filtering preserved | Existing `data-scope.service.spec.ts` extended with bulk-path coverage |
| Trend semantics preserved (improving/declining/stable for top-20) | Property test: top-20 trend values match per-student computation |

---

## 7. Risk

| Risk | Mitigation |
|---|---|
| GSI3 partition hot for large schools | Existing `attendanceDate` PK already partitions by (tenant, school, date) — bulk range stays within one school's partition; same hotness model the current code has, just one query instead of N |
| Pagination — single query might exceed 1MB DDB response | Use existing `queryRange` pagination wrapper; same behavior as `getStudentAttendance` already does for 365 records |
| Scope filtering currently applied per-student via `filterByStudentScope` — bulk path needs the same filter | Apply scope to the grouped result, identical to current overview Track B which filters scoped sections |
| Trend property test currently absent | Add one in phase 2 — small test cost, large invariant value |

---

## 8. Recommended path forward

1. **Phase 2 — implement the bulk-scan fix** as a single PR against `server/application/microservices/academics/src/attendance/attendance.service.ts`. ~150 LOC delta, two-method rewrite (`getAttendanceAlerts` + the trend-lazy slice), no CDK / IAM / schema change. **No shared-types bump.**
2. **Load test** locally against a seeded 1,000-student dev tenant before deploying. Capture the timing histogram in `docs/deploys/`.
3. **Deploy** academics ECR + ECS roll. Standard rollback path (previous task definition revision).
4. **Post-deploy** — re-run the Insights query for `/attendance/alerts` latency once real pilot traffic flows. The CloudWatch evidence we *couldn't* gather today becomes available once Saraswati onboards.

Estimated phase 2 effort: **3–5h of focused work** including tests + a load-test harness. Lower than the sprint-plan's vague C3.1 estimate because the diagnosis already pinned the change shape — no exploratory rework needed.
