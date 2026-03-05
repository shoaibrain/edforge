# Attendance Module — Sprint Plan for MVP (20 Pilot Schools)

**Date:** 2026-02-22
**Module:** `academics/attendance` (frontend + backend)
**Goal:** Transform the attendance module from a basic recording tool into a comprehensive, enterprise-grade attendance management system suitable for 20 pilot schools in Nepal.
**Reviewed by:** Staff Engineer subagent with 25 improvement suggestions incorporated.

---

## Current State Assessment

### What's Working
- Two-tab layout (Overview / Daily Entry) with framer-motion transitions
- Bulk attendance recording with keyboard shortcuts (P/A/L/E/R)
- Offline-first localStorage persistence with auto-sync every 30s
- Calendar-aware validation (blocks non-instructional days)
- 30-day attendance trend area chart
- Student alerts table (below 90% threshold) with CSV export
- Date navigation with future-date blocking

### Critical Bugs Identified

| Bug | Evidence | Severity |
|-----|----------|----------|
| **`totalStudents` counts records, not enrolled students** | `getDailyAttendanceSummary()` sets `totalStudents: result.items.length` — only counts students *with attendance records*. A school with 500 enrolled but 200 recorded shows `totalStudents: 200` and inflated 95% rate. Real rate against enrollment: 38%. | **P0 — All dashboard metrics are wrong** |
| **`tardy` status silently dropped from daily summary** | Zod schema allows both `tardy` and `late`. `getDailyAttendanceSummary()` only handles `case 'late':`; any record stored as `'tardy'` is not counted. | **P0 — Data loss** |
| **`remote` status handled nowhere** | Valid status in Zod schema but neither summary method counts it. Falls through switch → counted in total but no category. Unclear if "attending." | **P1 — Undefined behavior** |
| **No student name denormalization** | Entity has no `studentName` field; DTO returns `undefined`; alerts use N+1 query pattern for names | **P1 — Performance + data integrity** |

### Critical Gaps Identified

| Gap | Evidence | Impact |
|-----|----------|--------|
| **`byGradeLevel` never computed** | Dashboard shows permanent placeholder: "Grade-level data available with enrollment integration" | Government reporting blocked |
| **N+1 query storms** | `getAttendanceAlerts()` = O(2N+1) DynamoDB ops; `getAttendanceTrend()` = 1 query per date | Backend performance at scale |
| **No section-level tracking** | Admin can't see which teachers/sections have recorded attendance today | Accountability gap |
| **No attendance overview aggregate** | Unlike grades module's `getGradeOverview()`, no single endpoint for dashboard data | Multiple network requests, no computed metrics |
| **Chart tooltip shows only %** | Trend API returns `present`, `absent`, `late`, `totalStudents` per date but tooltip ignores them | Underutilized data |
| **No student drill-down** | `getStudentAttendance()` and `getStudentAttendanceSummary()` hooks defined but never used in UI | Dead code, missing workflow |
| **No correction workflow** | `updateAttendance()` PATCH endpoint exists but no UI to use it | Teachers can't fix mistakes |
| **No absence reason categorization** | Free-text notes only; backend schema supports `excuseType` enum but never populated | No structured reporting |
| **Hardcoded thresholds** | 90% alert threshold, 90-day lookback both hardcoded | No school-level configuration |
| **8 DTO fields always undefined** | `studentName`, `studentNumber`, `classroomName`, `minutesLate`, `minutesEarly`, `attendanceType`, `locationVerified`, `excuseType` | False API contract |
| **No academic year context** | Dashboard uses hardcoded `Date.now() - 90 days` instead of academic year start | Incorrect date scoping |
| **Partial save silently clears dirty flag** | `useOfflineAttendance` treats bulk save as all-or-nothing; if 3 of 50 fail, dirty flag is cleared, losing the failures | Data loss on intermittent connectivity |

### API Response Analysis (Live Data)

**Summary endpoint** returns 8 fields — UI renders 5 (hides `halfDay`, doesn't use `totalStudents` directly)
**Trend endpoint** returns 8 fields per data point — tooltip renders 1 (`attendanceRate` only)
**Alerts endpoint** returns 5 fields per student — UI renders all but without interactivity

---

## Sprint Architecture

```
Sprint 1: Backend Data Foundation, Bug Fixes & Performance
   ↓
Sprint 2: Dashboard Overview Redesign (new aggregate endpoint + rich UI)
   ↓
Sprint 3: Chart Interactivity & Deep Analytics
   ↓
Sprint 4: Daily Entry Enhancements, Correction Workflow & Keyboard Navigation
   ↓
Sprint 5: Offline Hardening, Accessibility, Nepal Localization & Polish
```

Each sprint builds on the previous, produces a demoable increment, and is independently valuable.

### Testing Strategy

Every task must include one of:
- **Backend tasks:** Unit test for the service method (mock DynamoDB, verify aggregation/computation logic, test edge cases). Integration test for the controller route (verify params, response shape).
- **Frontend component tasks:** Render test with mock data verifying the component renders without errors, key elements are present, and error/empty states handled.
- **Frontend hook tasks:** Verify query key structure, enabled conditions, and stale time configuration.
- **UI interaction tasks:** Manual smoke test with specific steps documented. Screenshot comparison where applicable.

---

## Sprint 1: Backend Data Foundation, Bug Fixes & Performance

**Goal:** Fix critical data integrity bugs, optimize N+1 queries, denormalize student names, and create the attendance overview aggregate endpoint.

**Demo:** Backend returns comprehensive attendance overview in a single API call with correct `totalStudents` denominator (enrollment-based), student names, grade-level breakdowns, section completion data, and normalized status handling.

---

### Task 1.1: Fix `totalStudents` to use enrollment count, not attendance record count

**Description:** `getDailyAttendanceSummary()` currently sets `totalStudents: result.items.length`, which only counts students who have attendance records. This produces inflated attendance rates. For government reporting and school admin decisions, the denominator must be total enrolled students, not total recorded.

**Files:**
- `server/.../attendance/attendance.service.ts` — `getDailyAttendanceSummary()`

**Changes:**
- After querying attendance records via GSI3, also query enrollment records for the school + academic year (`GSI1: ENROLLMENT#{academicYearId}#`)
- Filter enrollments to `status === 'enrolled' || status === 'active'`
- Set `totalStudents = enrolledStudents.length` (not `result.items.length`)
- Add `totalRecorded: result.items.length` to the response for "X of Y recorded" display
- Recalculate `attendanceRate = (present + late + halfDay) / totalStudents * 100`

**Response change:**
```typescript
// Add to DailyAttendanceSummaryDto:
totalRecorded: number  // students who have an attendance record today
```

**Tests:**
- Unit test: Given 100 enrolled students and 60 attendance records (50 present, 10 absent), verify `totalStudents: 100`, `totalRecorded: 60`, `attendanceRate: 60` (not 83.3%)
- Edge case: 0 enrolled students → `attendanceRate: 0`, no division by zero

---

### Task 1.2: Normalize `tardy`/`late` and add `remote` handling to summary calculations

**Description:** The Zod schema allows both `tardy` and `late` as valid `AttendanceStatus` values. `getDailyAttendanceSummary()` only handles `case 'late':`; `tardy` records are silently dropped. `remote` records fall through entirely. This causes silent data loss in every aggregate metric.

**Files:**
- `server/.../attendance/attendance.service.ts` — `getDailyAttendanceSummary()`, `getStudentAttendanceSummary()`

**Changes:**
- In both methods' switch statements, add `case 'tardy':` as a fallthrough to `case 'late':` (both increment the `late` counter)
- Add `case 'remote':` to both methods — increment a new `remote` counter
- Define policy: `remote` counts as "attending" for rate calculation (same as `present` and `late`)
- Update rate formula: `attendanceRate = (present + late + halfDay + remote) / totalStudents * 100`
- Add `remote: number` field to `DailyAttendanceSummaryDto`

**Tests:**
- Unit test: Given records [present, present, tardy, remote, absent], verify `present: 2, late: 1, remote: 1, absent: 1, attendanceRate: 80` (4 of 5 attending)
- Unit test: All-tardy input → `late` counter reflects correctly, not zero

---

### Task 1.3: Add `studentName` to Attendance Entity

**Description:** Add `studentName` field to the Attendance entity interface. This is the attendance equivalent of the grades `courseName` bug.

**Files:**
- `server/.../common/entities/attendance.entity.ts`

**Changes:**
- Add `studentName?: string` field to the `Attendance` interface
- Add `studentName?: string` field to the `BulkAttendanceRecord` interface

**Tests:**
- `nest build academics` compiles without errors
- Verify existing attendance records still deserialize correctly (field is optional)

---

### Task 1.4: Denormalize `studentName` on attendance record creation

**Description:** Resolve student name from enrollment/roster during `recordAttendance()` and `recordBulkAttendance()` and persist it on the entity.

**Files:**
- `server/.../attendance/attendance.service.ts` — `recordAttendance()`, `recordBulkAttendance()`

**Changes:**
- In `recordAttendance()`: Query the student entity by `STUDENT#{studentId}` to get `studentName`. Set `entity.studentName = dto.studentName || fetchedStudentName || dto.studentId`.
- In `recordBulkAttendance()`: Before the loop, batch-fetch all student names from enrollment records for the school (single GSI1 query). Build `studentNameMap: Map<string, string>`. Inside the loop, set `entity.studentName = studentNameMap.get(record.studentId) || record.studentId`.
- Keep fallback chain: DTO value → enrollment lookup → studentId as last resort

**Tests:**
- Unit test: Mock enrollment query returning 3 students → verify all 3 attendance entities have `studentName`
- Unit test: Student not in enrollment → falls back to `studentId`
- Integration test: POST `/academics/attendance` → verify response has `studentName` populated

---

### Task 1.5: Populate `studentName` in attendance mapper response + backfill fallback

**Description:** Update the mapper to read `studentName` from the entity. For historical records without `studentName`, keep the existing name resolution as a fallback (don't remove the N+1 path entirely until data is backfilled).

**Files:**
- `server/.../common/mappers/attendance.mapper.ts` — `attendanceEntityToDto()`

**Changes:**
- Change: `studentName: studentName || undefined` → `studentName: entity.studentName || studentName || undefined`
- In `getAttendanceAlerts()`: When computing summaries, prefer `record.studentName` from the entity. Only fall back to the student entity lookup if `studentName` is missing (for pre-migration records). This gracefully handles both old and new records.

**Tests:**
- Unit test: Entity with `studentName: 'Olivia Chen'` → DTO has `studentName: 'Olivia Chen'`
- Unit test: Entity without `studentName`, fallback param provided → DTO uses fallback
- Unit test: Entity without `studentName`, no fallback → DTO has `studentName: undefined`

---

### Task 1.6: Compute `byGradeLevel` in `getDailyAttendanceSummary()`

**Description:** Cross-reference attendance records with enrollment data to compute grade-level breakdown. The frontend already has the rendering code (`dashboard.tsx:448-489`).

**Files:**
- `server/.../attendance/attendance.service.ts` — `getDailyAttendanceSummary()`

**Changes:**
- Reuse the enrollment query from Task 1.1 (already needed for `totalStudents`)
- Build `studentGradeMap: Map<string, string>` from enrollment's `gradeLevel` field
- Group attendance records by grade level, compute `{ total, present, absent, rate }` per group
- Students not in enrollment → group under "Unclassified"
- Return `byGradeLevel` in the summary DTO

**Tests:**
- Unit test: 3 students in Grade 9, 2 in Grade 10. 2 present in G9, 1 absent; 2 present in G10 → verify correct per-grade stats
- Edge case: Student with no enrollment record → grouped under "Unclassified"
- Integration test: `GET /academics/attendance/summary?schoolId=&date=` returns `byGradeLevel`

---

### Task 1.7: Optimize `getAttendanceTrend()` — parallelize date queries

**Description:** Currently calls `getDailyAttendanceSummary()` sequentially per date (30-90 queries). Parallelize with bounded concurrency.

**Files:**
- `server/.../attendance/attendance.service.ts` — `getAttendanceTrend()`

**Changes:**
- Replace sequential loop with `Promise.all` batched in groups of 10 concurrent queries
- Each batch: `Promise.all(datesBatch.map(date => getDailyAttendanceSummary(schoolId, date, context)))`
- Process batches sequentially (10 at a time), combine results
- Only include summaries where `totalRecorded > 0`

**Tests:**
- Unit test: Mock 30 dates → verify all 30 summaries returned
- Performance test: verify batched approach executes ~3x faster than sequential (mock timings)
- Response shape unchanged: `DailyAttendanceSummaryDto[]`

---

### Task 1.8: Optimize `getAttendanceAlerts()` — batch queries, use denormalized names

**Description:** Reduce from O(2N+1) to O(D+1) queries by batch-fetching attendance records and using denormalized `studentName`.

**Files:**
- `server/.../attendance/attendance.service.ts` — `getAttendanceAlerts()`

**Changes:**
- Query enrollments (1 query) → get list of active student IDs
- Batch-fetch all attendance records for the date range (batched GSI3 queries, same as trend optimization)
- Group records by studentId in memory, compute per-student summaries
- Use `record.studentName` from the denormalized field (Task 1.4)
- **Fallback:** For records without `studentName` (pre-migration), keep the student entity lookup but batch it via `BatchGetItem` instead of individual `getItem` calls
- Cap response to top 20 worst cases; return `totalAtRiskCount` for "showing 20 of 45"
- Compute `trend` per student: compare last-7-day rate to previous-7-day rate → 'improving' | 'declining' | 'stable'

**Tests:**
- Unit test: 10 students, 3 below threshold → verify only 3 returned, sorted ascending
- Unit test: Verify trend computation (last 7 days 80%, previous 7 days 70% → 'improving')
- Performance: mock 100 students → verify total DynamoDB calls < 50 (vs previous 200+)

---

### Task 1.9: Create `AttendanceOverviewResponseDto` in shared-types

**Description:** Define the response schema for the new aggregate endpoint.

**Files:**
- `packages/shared-types/src/schemas/academics/attendance.schema.ts`

**Changes:**
- Add `AttendanceOverviewResponseDto` Zod schema:
```typescript
{
  todaySummary: DailyAttendanceSummaryDto & { totalRecorded: number }
  sectionCompletion: {
    totalSections: number
    sectionsWithAttendance: number
    sections: Array<{
      sectionId: string; sectionNumber: string; courseName: string
      studentCount: number; recordedCount: number; isComplete: boolean
    }>
  }
  trend: DailyAttendanceSummaryDto[]
  periodAverages: { last7Days: number; last30Days: number; academicYear: number }
  atRiskStudents: Array<{
    studentId: string; studentName: string; gradeLevel?: string
    attendanceRate: number; totalDays: number; absentDays: number
    trend: 'improving' | 'declining' | 'stable'
  }>
  totalAtRiskCount: number
  absenceBreakdown: {
    unexcused: number; excused: number; late: number; halfDay: number; remote: number
  }
  dayOfWeekPattern: Record<string, { avgRate: number; avgAbsent: number }>
}
```

**Tests:**
- Schema compiles without errors
- Verify Zod parse/validate with sample data

---

### Task 1.10: Create `getAttendanceOverview()` service method — todaySummary + trend

**Description:** First slice of the overview endpoint: today's summary and 30-day trend.

**Files:**
- `server/.../attendance/attendance.service.ts`

**Changes:**
- New method `getAttendanceOverview(schoolId, academicYearId, date, context)`:
  1. Call `getDailyAttendanceSummary(schoolId, date, context)` → `todaySummary`
  2. Compute 30-day trend using optimized `getAttendanceTrend()` (Task 1.7)
  3. Compute `periodAverages` from trend data (avg of last 7, last 30, and full academic year)
  4. Return partial response: `{ todaySummary, trend, periodAverages }`
- Accept `academicYearId` to resolve actual year start date (query academic year entity for `startDate`) — replaces hardcoded 90-day lookback
- Add 60s in-memory cache keyed by `(schoolId, date)` — same pattern as `calendarCache`

**Tests:**
- Unit test: Mock today's summary + 30-day trend → verify `periodAverages` computed correctly
- Unit test: Cache hit → second call returns cached response
- Unit test: Academic year start date used for year average, not hardcoded 90 days

---

### Task 1.11: Add sectionCompletion + atRiskStudents + absenceBreakdown to overview

**Description:** Complete the overview endpoint with section completion status, at-risk students, absence breakdown, and day-of-week patterns.

**Files:**
- `server/.../attendance/attendance.service.ts` — `getAttendanceOverview()`

**Changes:**
- Query sections for the school (GSI1, `SECTION#` prefix) → compute `sectionCompletion`:
  - For each section: count enrolled students, count attendance records for today
  - `isComplete = recordedCount >= studentCount`
- Compute `atRiskStudents` using optimized logic from Task 1.8 (capped to top 20)
- Compute `absenceBreakdown` from today's records: categorize by status
- Compute `dayOfWeekPattern` from trend data: group by dayOfWeek, average rate and absent count

**Tests:**
- Unit test: 4 sections, 2 with full attendance → `sectionsWithAttendance: 2, totalSections: 4`
- Unit test: Absence breakdown sums match total absent + late + excused
- Unit test: Day-of-week pattern correctly averages across dates

---

### Task 1.12: Add controller route + API Gateway registration

**Description:** Wire up the overview endpoint and register in API Gateway.

**Files:**
- `server/.../attendance/attendance.controller.ts` — new route
- API Gateway route configuration

**Changes:**
- Add `GET /academics/attendance/overview` route before the `:date/:studentId` catch-all
- Query params: `schoolId` (required), `academicYearId` (required), `date` (required)
- Register route in API Gateway (same pattern as `/academics/grades/overview`)

**Tests:**
- Integration test: `curl` to `/api/academics/attendance/overview?schoolId=&academicYearId=&date=` returns full response
- Verify route ordering doesn't conflict with existing routes

---

### Task 1.13: Add frontend types, API function, and hook for overview

**Description:** Add the TypeScript type, API function, and React Query hook for the overview endpoint.

**Files:**
- `edforge-saas-frontend/apps/academics/src/services/academics.service.ts`
- `edforge-saas-frontend/apps/academics/src/hooks/useAttendance.ts`

**Changes:**
- Add `AttendanceOverviewResponse` interface matching backend DTO
- Add `getAttendanceOverview()` API function
- Add `useAttendanceOverview` hook with `staleTime: 60_000` and `placeholderData: keepPreviousData` (prevents loading flicker on date change)
- Add `attendanceKeys.overview` query key
- Add cache invalidation for overview key in `useRecordBulkAttendance` onSuccess

**Tests:**
- `tsc --noEmit` passes
- Hook uses correct query key and respects `enabled` condition
- Bulk save mutation invalidates overview cache

---

### Task 1.14: Pass `studentName` from frontend in bulk attendance save

**Description:** Defense-in-depth: pass `studentName` from the roster data when saving.

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/attendance/index.tsx`
- `edforge-saas-frontend/apps/academics/src/services/academics.service.ts`

**Changes:**
- Add `studentName?: string` to `BulkAttendanceRecord` interface
- In `handleSave`, build a `Map<string, string>` from roster for O(1) name lookup, then map records to include `studentName`

**Tests:**
- Network tab shows `studentName` in POST body
- `tsc --noEmit` passes

---

### Task 1.15: Fix partial-save data loss in offline hook

**Description:** `useOfflineAttendance` clears the dirty flag even when `BulkAttendanceResponse.errors` is non-empty, losing failed records.

**Files:**
- `edforge-saas-frontend/apps/academics/src/hooks/useOfflineAttendance.ts`

**Changes:**
- In `flushToServer()`: After `onSave(records)` resolves, check if the response has errors
- If errors.length > 0: keep dirty flag set, only remove successfully saved entries from localStorage
- Update `onSave` type to return the `BulkAttendanceResponse` so the hook can inspect errors

**Tests:**
- Unit test: 50 records, 3 fail → dirty flag remains true, 3 failed entries preserved
- Unit test: All records succeed → dirty flag cleared

---

## Sprint 2: Dashboard Overview Redesign

**Goal:** Replace the basic dashboard with a rich, interactive overview powered by the aggregate endpoint. Match the quality bar set by the Grades Overview module. Prioritize government reporting needs (grade-level breakdown).

**Demo:** Admin visits `/academics/attendance` → sees academic year context, stat cards with trend indicators, grade-level breakdown table with real data, section completion donut + table, absence breakdown, and day-of-week pattern.

**Sprint 2 task order prioritizes Nepal government reporting (grade-level first, cosmetic last).**

---

### Task 2.1: Add Academic Year Context Bar to attendance header

**Description:** Add the same academic year context bar used in the Grades module.

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/attendance/index.tsx`

**Changes:**
- Add right-aligned meta section in page header: academic year name with Calendar icon, last updated timestamp with RefreshCw icon
- Pass `currentYear.startDate` to `AttendanceDashboard` for proper date scoping

**Tests:**
- Academic year name displays in header
- Screenshot matches grades module pattern
- Build passes: `npm run build` in academics app

---

### Task 2.2: Replace dashboard data source with overview hook

**Description:** Refactor dashboard to use single `useAttendanceOverview` hook instead of 3 separate hooks.

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/attendance/dashboard.tsx`

**Changes:**
- Replace `useAttendanceSummary`, `useAttendanceTrend`, `useAttendanceAlerts` with `useAttendanceOverview`
- Derive all existing variables from overview response
- Remove `startDate30` and `startDateYear` computed dates
- Keep skeleton loaders for loading state

**Tests:**
- Network tab shows single `/attendance/overview` call instead of 3
- All existing UI elements render with same data
- Loading/error states preserved

---

### Task 2.3: Render `byGradeLevel` data in grade-level table (Government Reporting Priority)

**Description:** Remove the placeholder message and render actual grade-level breakdown. This is the highest-priority dashboard element for Nepal government reporting.

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/attendance/dashboard.tsx`

**Changes:**
- Feed data from `data.todaySummary.byGradeLevel`
- Add rate badge coloring to the rate column
- Make table headers sortable (reuse pattern from grades `CoursePerformanceTable`)

**Tests:**
- Grade-level table renders with real data (no placeholder)
- Each row shows grade level, total, present, absent, rate
- Rate color-coded: green >=95%, amber 90-95%, red <90%
- Sorting works on all columns

---

### Task 2.4: Add section attendance completion table

**Description:** Show which sections have/haven't recorded attendance today, with enrolled vs recorded counts.

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/attendance/dashboard.tsx`

**Changes:**
- New `SectionCompletionTable` component:
  - Columns: Section (courseName - sectionNumber), Enrolled, Recorded, Status
  - Sortable by any column
  - Complete = green checkmark, Partial = amber progress, None = gray

**Tests:**
- Table renders all sections from overview
- Sorting works on all columns
- Visual indicators match completion state

---

### Task 2.5: Redesign stat cards with period comparison + totalRecorded

**Description:** Enhance stat cards with trend deltas and add the "recorded vs enrolled" context.

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/attendance/dashboard.tsx`

**Changes:**
- Update StatCard to accept optional `trend` delta prop
- Show: Present (count + delta), Absent (count + delta), Late, Excused
- Add 5th card: "School Average" showing `periodAverages.academicYear`
- SubValue shows "X of Y students recorded" using `totalRecorded` / `totalStudents`

**Tests:**
- 5 stat cards render with trend indicators
- Arrows correct direction (green up, red down)
- "X of Y recorded" accurately reflects data

---

### Task 2.6: Add attendance completion donut chart with tooltip + animation

**Description:** Add donut chart showing section completion. Include tooltip and animation (merged from original Task 3.7 — no need for a separate cosmetic task).

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/attendance/dashboard.tsx`

**Changes:**
- Recharts `PieChart` + `Pie` donut: `sectionsWithAttendance / totalSections`
- Center overlay with percentage and fraction text
- Custom `CompletionTooltip`: "X sections completed" / "Y sections pending"
- Animation: `isAnimationActive={true} animationDuration={600}`

**Tests:**
- Donut proportions correct
- Tooltip shows on hover
- Animates on load

---

### Task 2.7: Add absence breakdown visualization

**Description:** Show categorized absence counts: unexcused, excused, late, half-day, remote.

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/attendance/dashboard.tsx`

**Changes:**
- Color-coded pill row showing each category with count and percentage
- Semantic colors match StatusBadge component (red=unexcused, blue=excused, amber=late, purple=half-day, indigo=remote)

**Tests:**
- All categories render
- Counts sum correctly
- Colors match StatusBadge

---

### Task 2.8: Add day-of-week attendance pattern (Defer if needed)

**Description:** Heatmap-style visualization showing which days of the week have lowest attendance.

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/attendance/dashboard.tsx`

**Changes:**
- 5-7 day cells, color intensity mapped to rate, tooltip on hover
- Compact single-row layout

**Tests:**
- All active school days rendered
- Color mapping correct
- Tooltip shows averages

---

### Task 2.9: Loading skeletons for redesigned dashboard

**Description:** Comprehensive skeleton states for all new sections to prevent layout shift.

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/attendance/dashboard.tsx`

**Changes:**
- `SkeletonStatCards` (5 cards), `SkeletonDonut`, `SkeletonGradeTable`, `SkeletonSectionTable`
- All match final layout dimensions

**Tests:**
- Slow network → full skeleton visible
- No CLS when data loads

---

## Sprint 3: Chart Interactivity & Deep Analytics

**Goal:** Make all charts and tables interactive. Add student drill-down.

**Demo:** Admin hovers trend chart → sees full breakdown. Clicks student name → modal shows history with calendar heatmap. Sorts all tables. Charts animate on load.

---

### Task 3.1: Enhance trend chart tooltip + animation + reference line

**Description:** Combine tooltip enhancement, chart animation, and 90% threshold line into a single chart upgrade task (merged from original 3.1 + 3.2 + 3.3).

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/attendance/dashboard.tsx`

**Changes:**
- Replace `ChartTooltip` with `TrendTooltip` showing present/absent/late/total counts
- Import `ReferenceLine` from recharts, add dashed line at y=90
- Add `isAnimationActive={true} animationDuration={800} animationEasing="ease-out"` to `<Area>`
- Enhanced active dot: `r: 5, fill: '#14b8a6', stroke: '#fff', strokeWidth: 2`

**Tests:**
- Hover chart → tooltip shows date, rate, present, absent, late, total
- 90% dashed reference line visible
- Chart animates on load
- Active dot visible on hover

---

### Task 3.2: Make alerts table sortable with trend indicators

**Description:** Sortable alert table headers + trend column (merged from original 3.4 + 3.6).

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/attendance/dashboard.tsx`

**Changes:**
- Extract into `AlertsTable` component
- Sort state: `sortKey: 'attendanceRate' | 'absentDays' | 'totalDays' | 'studentName' | 'trend'`
- Add "Trend" column: `↑` green (improving), `↓` red (declining), `→` gray (stable)
- Arrow indicators on active sort column

**Tests:**
- Click "Attendance Rate" → sorts ascending
- Click again → descending
- Trend arrows match data
- All 5 columns sortable

---

### Task 3.3: Optimize `getStudentAttendance()` for drill-down

**Description:** The current implementation queries all `ATTENDANCE#` records on the main table then filters by `studentId` in memory. For a school with 500 students over 90 days, this scans 45,000 records. Optimize before building the drill-down UI.

**Files:**
- `server/.../attendance/attendance.service.ts` — `getStudentAttendance()`

**Changes:**
- Instead of querying main table with `ATTENDANCE#` prefix:
  - Query with more specific SK: `ATTENDANCE#<startDate>` to `ATTENDANCE#<endDate>` range
  - Add filter expression: `studentId = :studentId`
  - Or: if a student-centric GSI exists, use it
- Remove the redundant post-filter `a.studentId === studentId`

**Tests:**
- Unit test: Returns only records for specified student in date range
- Performance: scan count reduced (verify with mock)

---

### Task 3.4: Create student attendance drill-down modal

**Description:** Clicking a student name in alerts opens a modal with their attendance history.

**Files:**
- `edforge-saas-frontend/apps/academics/src/components/attendance/StudentAttendanceModal.tsx` (new)
- `edforge-saas-frontend/apps/academics/src/routes/attendance/dashboard.tsx`

**Changes:**
- New `StudentAttendanceModal` component:
  - Header: student name + overall rate badge
  - Summary row: total days, present, absent, late, excused, rate
  - Calendar heatmap: last 30 days, colored cells (green/red/amber/blue)
  - Recent records table: last 10 records with date, status badge, notes
- Wire existing `useStudentAttendance` and `useStudentAttendanceSummary` hooks
- Click student name in alerts table → open modal

**Tests:**
- Click student name → modal opens with loading skeleton
- Modal shows correct summary stats
- Calendar heatmap colors match status
- Close via button or click-outside

---

### Task 3.5: Enhanced export dropdown (3-dot actions pattern)

**Description:** Replace single "Export Alerts CSV" button with dropdown menu matching grades module pattern.

**Files:**
- `edforge-saas-frontend/apps/academics/src/routes/attendance/dashboard.tsx`

**Changes:**
- 3-dot dropdown with: "Export Alerts CSV", "Export Daily Register", "Export Trend Data"
- Each option disabled if no data
- Click-outside dismissal

**Tests:**
- Menu opens on click
- Each export generates correct CSV content
- Disabled options not clickable

---

## Sprint 4: Daily Entry Enhancements, Correction Workflow & Keyboard Navigation

**Goal:** Improve teacher workflow: section completion indicators, search/filter, corrections, structured absence reasons, keyboard navigation.

**Demo:** Teacher sees completion checkmarks on sections. Searches for a student. Records with structured reason. Corrects yesterday's error. Navigates entirely via keyboard.

---

### Task 4.1: Section completion indicator in dropdown

**Files:** `index.tsx`

**Changes:**
- Use overview's `sectionCompletion.sections` to show checkmarks on completed sections in the selector

**Tests:** Checkmark appears after saving; updates on cache invalidation

---

### Task 4.2: Student search/filter in attendance grid

**Files:** `AttendanceGrid.tsx`

**Changes:**
- Search input with `Search` icon, real-time filter by name
- "X of Y students" counter, clear button
- Quick actions still apply to ALL students (with confirmation if filtered)

**Tests:** Filter works, counter updates, clear resets, All Present applies to all

---

### Task 4.3: Sortable columns in attendance grid

**Files:** `AttendanceGrid.tsx`

**Changes:**
- Header row with clickable Name / Student # / Status column labels
- `useMemo` sorted entries

**Tests:** All 3 columns sortable, arrow indicators visible

---

### Task 4.4: Keyboard navigation for grid (moved from Sprint 5)

**Files:** `AttendanceGrid.tsx`, `AttendanceRow.tsx`

**Changes:**
- Arrow Up/Down between rows, Tab to status buttons within row
- Enter/Space toggles status, Escape closes notes
- `aria-label="Attendance entry grid"` on container

**Tests:** Tab navigation works, arrow keys navigate rows, P/A/L/E/R still works

---

### Task 4.5: Structured absence reason selector

**Files:** `AttendanceRow.tsx`, `academics.service.ts`, `index.tsx`

**Changes:**
- When status is `absent` or `excused`: show reason dropdown (Medical, Family Emergency, Religious, School Activity, Weather, Transportation, Other) + free-text notes
- Map to `excuseType` in save payload

**Tests:** Mark Absent → dropdown appears; select Medical → `excuseType: 'medical'` in request; not shown for Present/Late

---

### Task 4.6: Attendance correction workflow

**Files:** `AttendanceGrid.tsx`, `AttendanceRow.tsx`

**Changes:**
- Past dates: rows in view mode with "Edit" button
- Edit → status buttons activate for that row
- Save calls `useUpdateAttendance` PATCH endpoint
- Cancel reverts without API call
- Show `updatedAt` if modified

**Tests:** Yesterday's rows in view mode; edit/save/cancel all work; toast on save

---

### Task 4.7: Add optimistic locking to `updateAttendance()` backend

**Files:** `server/.../attendance/attendance.service.ts` — `updateAttendance()`

**Changes:**
- Add `ConditionExpression: '#version = :expectedVersion'` to the UpdateItem call
- Handle `ConditionalCheckFailedException` → throw `ConflictException('Record was modified by another user')`
- Frontend: catch 409 → show "Someone else updated this record. Refresh to see their changes."

**Tests:**
- Unit test: Concurrent update → second one fails with ConflictException
- Integration test: PATCH with stale version → 409 response

---

### Task 4.8: Previous day's status indicator + progress bar

**Files:** `AttendanceRow.tsx`, `AttendanceGrid.tsx`, `index.tsx`

**Changes:**
- Fetch previous day's records (lazy-load after 2s delay to avoid adding to initial load)
- Show compact `StatusBadge` next to student name with tooltip "Yesterday: Present"
- Add progress bar (teal, fills as students are marked, green pulse at 100%)

**Tests:** Previous status badges visible; progress bar fills; green at 100%

---

## Sprint 5: Offline Hardening, Accessibility, Nepal Localization & Polish

**Goal:** Production readiness: offline reliability, accessibility, Nepal-specific localization, error boundaries, mobile responsiveness, bundle verification.

**Demo:** Teacher on intermittent connectivity records attendance offline → reconnects → syncs. Screen reader navigates full workflow. Dates display in Bikram Sambat. Mobile view is clean.

---

### Task 5.1: localStorage cleanup + quota handling

**Files:** `useOfflineAttendance.ts`

**Changes:**
- Mount cleanup: remove clean entries > 7 days old
- `QuotaExceededError` handling: evict oldest clean entries, retry

**Tests:** Old entries cleaned; quota exhaustion handled gracefully; dirty entries never evicted

---

### Task 5.2: ARIA labels for AttendanceRow + StatusBadge (merged)

**Files:** `AttendanceRow.tsx`, `StatusBadge.tsx`

**Changes:**
- Status buttons: `aria-label`, `aria-pressed`
- Notes toggle: `aria-label`, `aria-expanded`
- StatusBadge: `aria-label={config.label}`, `role="status"`

**Tests:** Screen reader announces full status labels, pressed state, expanded state

---

### Task 5.3: `aria-live` announcements for dynamic content

**Files:** `AttendanceGrid.tsx`, `index.tsx`

**Changes:**
- Visually-hidden `aria-live="polite"` region
- Announces: "All students marked present", "Attendance saved for X students", "Offline — saved locally"

**Tests:** Screen reader announces state changes with polite priority

---

### Task 5.4: Error boundary for dashboard charts

**Files:** `dashboard.tsx`

**Changes:**
- `ChartErrorBoundary` class component wrapping each chart section
- Fallback: "Chart could not be rendered. Please refresh."

**Tests:** Invalid chart data → boundary catches, fallback shown, rest of dashboard renders

---

### Task 5.5: Mobile-responsive attendance grid

**Files:** `AttendanceGrid.tsx`, `AttendanceRow.tsx`

**Changes:**
- `<768px`: Stack student info above status buttons, compact buttons (min 44px), hide keyboard hints
- `<640px`: Full-width save button, wrap controls

**Tests:** 375px width → usable, no horizontal scroll, buttons tappable

---

### Task 5.6: Bikram Sambat date display (Nepal localization)

**Description:** Nepal's education system uses Bikram Sambat calendar. Teachers think in BS dates. Display BS dates alongside Gregorian throughout the attendance module.

**Files:**
- `dashboard.tsx` (chart X-axis, tooltips)
- `DateSelector.tsx` (date display)
- CSV export functions

**Changes:**
- Add BS date conversion utility (use `nepali-date-converter` or equivalent library)
- Chart X-axis: show BS date format (e.g., "2082/11/10")
- DateSelector: show BS date below Gregorian date
- CSV exports: include BS date column

**Tests:**
- Chart X-axis shows BS dates
- DateSelector shows correct BS conversion
- CSV includes BS dates

---

### Task 5.7: Government-format monthly attendance register export

**Description:** Nepal's Ministry of Education requires a specific monthly attendance register format grouped by grade level with BS dates.

**Files:**
- `dashboard.tsx` (add to export dropdown)

**Changes:**
- New export option: "Monthly Register (MoE Format)"
- Output: Grade-level-grouped monthly grid with BS dates, daily status columns, monthly summary row
- Format matches Nepal MoE template

**Tests:**
- Export generates correct format
- BS dates throughout
- Grade-level grouping correct

---

### Task 5.8: Final build verification, bundle size check & cleanup

**Files:** All modified files

**Changes:**
- `tsc --noEmit` → zero errors
- `nest build academics` → compiled successfully
- `npm run build` in academics app → zero errors
- Verify Module Federation bundle size delta < 30KB gzipped vs baseline
- Remove unused imports and dead code
- Manual smoke test: navigate to `/academics/attendance` → all sections render

**Tests:**
- All builds pass
- Bundle size within budget
- E2E smoke test passes

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| **Total Sprints** | 5 |
| **Total Tasks** | 43 |
| **Backend Tasks** | 12 (Sprint 1: 10, Sprint 4: 1, Sprint 3: 1) |
| **Frontend Tasks** | 28 |
| **Shared/Infra Tasks** | 3 |
| **New API Endpoints** | 1 (`GET /attendance/overview`) |
| **New Components** | ~7 (StudentAttendanceModal, AlertsTable, SectionCompletionTable, CompletionDonut, WeeklyPattern, ChartErrorBoundary, MonthlyRegisterExport) |
| **Critical Bugs Fixed** | 4 (totalStudents denominator, tardy/remote handling, studentName denormalization, partial-save data loss) |
| **Files Modified** | ~18 |

---

## Appendix A: Review Improvements Incorporated

The following improvements were suggested by a Staff Engineer review and incorporated into this plan:

1. **P0 Bug: `totalStudents` uses record count, not enrollment count** → Task 1.1
2. **P0 Bug: `tardy` silently dropped, `remote` unhandled** → Task 1.2
3. **Task 1.7 split into 4 sub-tasks** (1.9, 1.10, 1.11, 1.12) for atomicity
4. **Backfill fallback for historical records** without `studentName` → Task 1.5
5. **Testing requirements** added to every task
6. **Sprint 2 reordered** to prioritize government reporting (grade-level first)
7. **Task 3.5 split** — backend optimization (3.3) before UI (3.4)
8. **Cache invalidation** for overview after bulk save → Task 1.13
9. **`keepPreviousData`** on overview hook to prevent loading flicker → Task 1.13
10. **Cosmetic tasks merged** (3.3 into 3.1, 3.7 into 2.6, 5.4 into 5.2)
11. **Keyboard navigation moved to Sprint 4** (with grid restructuring)
12. **Optimistic locking** for corrections → Task 4.7
13. **Partial-save data loss fix** → Task 1.15
14. **O(N) find() → Map lookup** in frontend name passing → Task 1.14
15. **`atRiskStudents` capped to top 20** with `totalAtRiskCount` → Task 1.8
16. **Overview endpoint caching** (60s in-memory TTL) → Task 1.10
17. **Bikram Sambat date display** → Task 5.6
18. **Government monthly register export** → Task 5.7
19. **Bundle size monitoring** → Task 5.8
20. **`getStudentAttendance` query optimization** before drill-down → Task 3.3

---

## Appendix B: Files Modified Per Sprint

### Sprint 1 (Backend Foundation — 15 tasks)
| File | Type |
|------|------|
| `server/.../common/entities/attendance.entity.ts` | Backend |
| `server/.../attendance/attendance.service.ts` | Backend |
| `server/.../attendance/attendance.controller.ts` | Backend |
| `server/.../common/mappers/attendance.mapper.ts` | Backend |
| `packages/shared-types/src/schemas/academics/attendance.schema.ts` | Shared |
| `edforge-saas-frontend/.../services/academics.service.ts` | Frontend |
| `edforge-saas-frontend/.../hooks/useAttendance.ts` | Frontend |
| `edforge-saas-frontend/.../hooks/useOfflineAttendance.ts` | Frontend |
| `edforge-saas-frontend/.../routes/attendance/index.tsx` | Frontend |
| API Gateway configuration | Infrastructure |

### Sprint 2 (Dashboard Redesign — 9 tasks)
| File | Type |
|------|------|
| `edforge-saas-frontend/.../routes/attendance/index.tsx` | Frontend |
| `edforge-saas-frontend/.../routes/attendance/dashboard.tsx` | Frontend |

### Sprint 3 (Interactivity — 5 tasks)
| File | Type |
|------|------|
| `server/.../attendance/attendance.service.ts` | Backend |
| `edforge-saas-frontend/.../routes/attendance/dashboard.tsx` | Frontend |
| `edforge-saas-frontend/.../components/attendance/StudentAttendanceModal.tsx` | Frontend (new) |

### Sprint 4 (Daily Entry — 8 tasks)
| File | Type |
|------|------|
| `server/.../attendance/attendance.service.ts` | Backend |
| `edforge-saas-frontend/.../components/attendance/AttendanceGrid.tsx` | Frontend |
| `edforge-saas-frontend/.../components/attendance/AttendanceRow.tsx` | Frontend |
| `edforge-saas-frontend/.../routes/attendance/index.tsx` | Frontend |
| `edforge-saas-frontend/.../services/academics.service.ts` | Frontend |

### Sprint 5 (Polish — 8 tasks)
| File | Type |
|------|------|
| `edforge-saas-frontend/.../hooks/useOfflineAttendance.ts` | Frontend |
| `edforge-saas-frontend/.../components/attendance/AttendanceGrid.tsx` | Frontend |
| `edforge-saas-frontend/.../components/attendance/AttendanceRow.tsx` | Frontend |
| `edforge-saas-frontend/.../components/attendance/StatusBadge.tsx` | Frontend |
| `edforge-saas-frontend/.../components/attendance/DateSelector.tsx` | Frontend |
| `edforge-saas-frontend/.../routes/attendance/dashboard.tsx` | Frontend |
