# Attendance Module — Technical Guidance Report

**Date:** 2026-02-22
**Module:** `academics/attendance` (frontend) + `academics/src/attendance` (backend)
**Pattern Reference:** Grades & Assessments module improvements (completed)

---

## Executive Summary

The Attendance module is architecturally strong — offline-first persistence, keyboard shortcuts, calendar-aware validation, and a clean two-tab layout (Overview / Daily Entry). However, it shares a class of denormalization bugs identical to the `courseName` issue we fixed in Grades, has several DTO fields that are promised but never populated, and the Dashboard tab underutilizes available data. This report identifies **14 issues** across 4 categories, prioritized for the 20-school Nepal pilot.

---

## Issue 1: Missing Student Name Denormalization (Critical)

### Identical Pattern to Grades `courseName` Bug

**Root Cause:** The `Attendance` entity has no `studentName` field. The response DTO declares `studentName?: string` but the mapper never populates it. When `getAttendanceByDate()` returns records, every record has `studentName: undefined`.

**Current Workaround (fragile):** The frontend sidesteps this by:
1. Fetching the section roster separately (`useSectionRoster`)
2. Matching `studentId` from attendance records to roster entries
3. Displaying `s.studentName || s.studentId` from the roster, not the attendance record

This works for the Daily Entry grid but **breaks for Dashboard alerts** — `getAttendanceAlerts()` does a separate batch-fetch of student names via the identity service, adding N+1 queries.

**Data Flow:**
```
AttendanceGrid.tsx:113  →  studentName: s.studentName || s.studentId  // from ROSTER, not attendance
  ↑ roster comes from useSectionRoster (separate API call)

dashboard.tsx:547       →  alert.studentName                         // from getAttendanceAlerts()
  ↑ backend batch-fetches names in getAttendanceAlerts() lines 581-657 (N+1)
```

### Fix Strategy (Same as Grades)

**Step 1A — Backend: Denormalize studentName on write**

File: `attendance.service.ts` — `recordAttendance()` and `recordBulkAttendance()`

When recording attendance, resolve `studentName` from the student entity or enrollment record and store it on the attendance entity. The section roster (already queried for enrollment validation) contains `studentName`.

```typescript
// In recordBulkAttendance(), after fetching roster:
const studentNameMap = new Map(roster.students.map(s => [s.studentId, s.studentName]))

// When creating/updating each attendance record:
entity.studentName = dto.studentName || studentNameMap.get(dto.studentId) || dto.studentId
```

**Step 1B — Backend: Add studentName to Attendance entity**

File: `attendance.entity.ts`

```typescript
interface Attendance extends BaseEntity {
  // ... existing fields
  studentName?: string  // Denormalized from enrollment for read efficiency
}
```

**Step 1C — Backend: Populate in mapper**

File: `attendance.mapper.ts` — `attendanceEntityToDto()`

The mapper already accepts a `studentName` parameter but it's optional and rarely passed. Once the entity stores the name, always use it:

```typescript
studentName: entity.studentName || studentName || undefined,
```

**Step 1D — Backend: Eliminate N+1 in getAttendanceAlerts()**

Currently: 1 enrollment query + N student-name lookups + N attendance summaries = O(2N+1) queries.

With denormalized `studentName` on the attendance entity, the alerts endpoint can aggregate directly from attendance records without the identity service roundtrip.

**Step 1E — Frontend: Pass studentName in bulk save (defense in depth)**

File: `index.tsx` — `handleSave()` callback

```typescript
// The roster already has studentName. Pass it along:
records.map(r => ({
  studentId: r.studentId,
  status: r.status,
  notes: r.notes,
  studentName: roster?.students.find(s => s.studentId === r.studentId)?.studentName,
}))
```

---

## Issue 2: DTO Fields Promised But Never Populated

The `AttendanceResponseDto` schema declares 8+ fields that are never set by the backend. This creates a false API contract — consumers expect data that never arrives.

| Field | DTO Type | Actual Value | Impact |
|-------|----------|-------------|--------|
| `studentName` | `string?` | Always `undefined` | **HIGH** — See Issue 1 |
| `studentNumber` | `string?` | Always `undefined` | LOW — Entity has no field for it |
| `classroomName` | `string?` | Always `undefined` | MEDIUM — DTO promises it, never resolved |
| `minutesLate` | `number?` | Always `undefined` | MEDIUM — Not computed from checkInTime |
| `minutesEarly` | `number?` | Always `undefined` | MEDIUM — Not computed from checkOutTime |
| `attendanceType` | `string` | Always `'daily'` | LOW — Hardcoded in mapper |
| `locationVerified` | `boolean` | Always `false` | LOW — Hardcoded in mapper |
| `excuseType` | `enum?` | Always `undefined` | LOW — Not mapped from entity |

### Recommendation

**For MVP:** Fix `studentName` (Issue 1). Document the rest as "v2 — multi-period attendance" in a technical debt tracker. Remove or mark as `@deprecated` any fields not planned for pilot.

**For v2:** When multi-period attendance is implemented, populate `attendanceType`, `classroomName`, `minutesLate`, and `periodNumber`.

---

## Issue 3: `byGradeLevel` — Dashboard Shows Placeholder

### Current State

The `DailyAttendanceSummary` response type declares `byGradeLevel?: Record<string, { total, present, absent, rate }>` but the backend's `getDailyAttendanceSummary()` never computes it.

The frontend (`dashboard.tsx:448`) checks for it and renders a table if present, but always falls through to the placeholder:
```
"Grade-level data available with enrollment integration"
```

### Fix Strategy

**Backend:** In `getDailyAttendanceSummary()`, the service already queries all attendance records for the date. Cross-reference with enrollment data (student → grade level) to group and aggregate:

```typescript
// After querying attendance records for the date:
// 1. Collect unique studentIds from attendance records
// 2. Batch-fetch their enrollment records (already have schoolId + academicYearId)
// 3. Group by gradeLevel, compute present/absent/rate per group
// 4. Set summary.byGradeLevel = groupedResult
```

This is medium effort but high value — school administrators in Nepal track attendance by grade level for government reporting.

**Frontend:** Already implemented. The `dashboard.tsx:448-489` table renders automatically when `byGradeLevel` is populated.

---

## Issue 4: DTO Field Name Mapping Disconnect

The backend has silent field-name translations between DTO and entity that create confusion:

| DTO Field | Entity Field | Location |
|-----------|-------------|----------|
| `notes` | `note` | `attendance.service.ts:112,177,198,354` |
| `excuseReason` | `reason` | `attendance.service.ts:113,359` |

### Recommendation

This isn't a bug — the mapper handles it correctly. But it's a maintenance trap. Add inline comments at each translation point:

```typescript
note: dto.notes,          // DTO 'notes' → Entity 'note' (singular)
reason: dto.excuseReason, // DTO 'excuseReason' → Entity 'reason'
```

---

## Issue 5: Dashboard Chart Interactivity (Same Improvements as Grades)

### 5A: 30-Day Area Chart — Enhanced Tooltip

**Current:** `ChartTooltip` shows only the attendance rate percentage.

**Improvement:** Show present/absent/total counts alongside the rate. The data is already in `chartData` (`present`, `absent`, `total` fields — dashboard.tsx:265-269) but the tooltip ignores it.

```tsx
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const { rate, present, absent, total } = payload[0].payload
  return (
    <div className="bg-surface-primary border border-border-secondary rounded-lg shadow-lg px-3 py-2">
      <p className="text-xs text-text-tertiary mb-1">{label}</p>
      <p className="text-sm font-bold text-text-primary">{rate.toFixed(1)}%</p>
      <div className="text-xs text-text-secondary mt-1 space-y-0.5">
        <p>{present} present / {absent} absent</p>
        <p>{total} total students</p>
      </div>
    </div>
  )
}
```

### 5B: Area Chart — Animation & Active Dot Enhancement

```tsx
<Area
  type="monotone"
  dataKey="rate"
  stroke="#14b8a6"
  strokeWidth={2}
  fill="url(#attendanceGradient)"
  dot={false}
  activeDot={{ r: 5, fill: '#14b8a6', stroke: '#fff', strokeWidth: 2 }}
  isAnimationActive={true}
  animationDuration={800}
  animationEasing="ease-out"
/>
```

### 5C: Area Chart — Reference Line at 90% Threshold

Add a visual threshold line matching the alerts cutoff:

```tsx
import { ReferenceLine } from 'recharts'

<ReferenceLine
  y={90}
  stroke="var(--color-text-tertiary)"
  strokeDasharray="4 4"
  label={{ value: '90% threshold', position: 'insideTopRight', fontSize: 10 }}
/>
```

### 5D: Alerts Table — Sortable Headers

Same pattern as Grades `CoursePerformanceTable`. Add sort state for `attendanceRate`, `absentDays`, `totalDays`:

```tsx
const [sortKey, setSortKey] = useState<'attendanceRate' | 'absentDays' | 'totalDays'>('attendanceRate')
const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

const sortedAlerts = useMemo(() => {
  return [...alerts].sort((a, b) =>
    sortDir === 'asc' ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]
  )
}, [alerts, sortKey, sortDir])
```

### 5E: Stat Cards — Add Sparkline or Trend Indicator

The stat cards show today's snapshot but give no sense of trend. Add a micro-indicator:

```tsx
// Use trendData (already fetched) to compute 7-day delta:
const weekAgoRate = trendData?.[trendData.length - 7]?.attendanceRate
const todayRate = summary?.attendanceRate
const delta = todayRate && weekAgoRate ? todayRate - weekAgoRate : null
// Show ↑2.3% or ↓1.1% next to the attendance rate
```

---

## Issue 6: Daily Entry UX Improvements

### 6A: Section Completion Indicator

The Daily Entry tab shows no indication of which sections have already been submitted for today. After saving attendance for Section A, the dropdown still looks the same as an unsaved Section B.

**Fix:** After fetching the daily summary, compare `summary.totalStudents` against known section sizes, or add a `sectionId[]` array to the summary response showing which sections have records.

Display in the `SectionSelector` dropdown:
```tsx
<option key={s.sectionId} value={s.sectionId}>
  {s.courseName} - {s.sectionNumber} {completedSections.has(s.sectionId) ? '✓' : ''}
</option>
```

### 6B: Undo Last Status Change

The AttendanceGrid supports "Clear All" but not single-entry undo. Given the keyboard-driven workflow (P/A/L/E/R), a misclick or mispress can silently change a status. Add undo via Ctrl+Z or a brief toast:

```
toast("Changed to Absent", { action: { label: "Undo", onClick: () => revert() } })
```

### 6C: Attendance Row — Show Previous Day's Status

For teachers reconciling attendance, seeing yesterday's status helps spot patterns. The roster query can optionally include previous-day records:

```tsx
// In AttendanceRow, show a subtle indicator:
{previousStatus && (
  <span className="text-[10px] text-text-tertiary ml-1">
    (yesterday: {previousStatus[0].toUpperCase()})
  </span>
)}
```

---

## Issue 7: Offline Resilience Gaps

### 7A: localStorage Quota Exhaustion

`useOfflineAttendance` writes to `localStorage` on every status change. With 500 students across 10 sections, this could hit the 5MB quota on low-end devices common in Nepal.

**Fix:** Add quota-aware error handling:
```typescript
function saveToStorage(key: string, state: OfflineAttendanceState) {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      // Evict oldest entries (dates > 7 days old)
      evictOldEntries()
      localStorage.setItem(key, JSON.stringify(state))
    }
  }
}
```

### 7B: Stale localStorage Cleanup

Old attendance entries (dates > 7 days) are never cleaned up. Add a cleanup on mount:

```typescript
useEffect(() => {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  Object.keys(localStorage)
    .filter(k => k.startsWith(STORAGE_PREFIX))
    .forEach(key => {
      const saved = loadFromStorage(key)
      if (saved?.lastSavedAt && saved.lastSavedAt < cutoff) {
        localStorage.removeItem(key)
      }
    })
}, [])
```

---

## Issue 8: Academic Year Context (Consistency with Grades)

The Grades module now shows an Academic Year context bar in the page header. The Attendance module should follow the same pattern for consistency:

- Show "Academic Year 2081-82 (BS)" in the header
- Use `academicYearId` to scope the dashboard trend and alerts queries
- Currently, the dashboard uses a hardcoded 90-day lookback (`yearStart.setDate(yearStart.getDate() - 90)` at `dashboard.tsx:212`) instead of the actual academic year start date

**Fix:** Pass `currentYear.startDate` from the parent to `AttendanceDashboard` and use it as `startDateYear`.

---

## Prioritized Implementation Plan

### P0 — Must Fix Before Pilot (Critical)

| # | Issue | Effort | Files |
|---|-------|--------|-------|
| 1 | Student name denormalization (backend + frontend) | 4h | `attendance.entity.ts`, `attendance.service.ts`, `attendance.mapper.ts`, `index.tsx` |
| 2 | Eliminate N+1 in `getAttendanceAlerts()` | 2h | `attendance.service.ts` |
| 3 | `byGradeLevel` computation in daily summary | 3h | `attendance.service.ts`, (frontend already done) |
| 4 | Academic year context bar + proper date scoping | 1h | `index.tsx`, `dashboard.tsx` |

### P1 — Should Fix Before Pilot (Recommended)

| # | Issue | Effort | Files |
|---|-------|--------|-------|
| 5 | Enhanced chart tooltip (present/absent/total) | 30m | `dashboard.tsx` |
| 6 | 90% threshold reference line on chart | 15m | `dashboard.tsx` |
| 7 | Chart animation | 15m | `dashboard.tsx` |
| 8 | Sortable alerts table | 45m | `dashboard.tsx` |
| 9 | Section completion indicator in dropdown | 1h | `index.tsx` |
| 10 | localStorage cleanup for stale entries | 30m | `useOfflineAttendance.ts` |

### P2 — Nice to Have (Post-Pilot)

| # | Issue | Effort | Files |
|---|-------|--------|-------|
| 11 | Undo last status change | 2h | `AttendanceGrid.tsx` |
| 12 | Previous day's status indicator | 1h | `AttendanceRow.tsx`, `index.tsx` |
| 13 | Trend indicator on stat cards | 1h | `dashboard.tsx` |
| 14 | Document/remove unused DTO fields | 1h | `attendance.mapper.ts`, shared-types |

---

## Files Affected

| File | Layer | Changes |
|------|-------|---------|
| `server/.../attendance/attendance.entity.ts` | Backend | Add `studentName` field |
| `server/.../attendance/attendance.service.ts` | Backend | Denormalize studentName on write; compute byGradeLevel; optimize alerts query |
| `server/.../common/mappers/attendance.mapper.ts` | Backend | Use entity.studentName in DTO mapping |
| `edforge-saas-frontend/.../routes/attendance/index.tsx` | Frontend | Pass studentName in bulk save; academic year context bar; section completion |
| `edforge-saas-frontend/.../routes/attendance/dashboard.tsx` | Frontend | Enhanced tooltips, animations, reference line, sortable alerts, year scoping |
| `edforge-saas-frontend/.../hooks/useOfflineAttendance.ts` | Frontend | localStorage cleanup, quota handling |

---

## Verification Checklist

- [ ] Record bulk attendance → verify `studentName` stored in DynamoDB
- [ ] Load Overview dashboard → verify alerts table shows student names (not IDs)
- [ ] Verify `byGradeLevel` table renders with real grade-level breakdown
- [ ] Hover area chart → verify tooltip shows present/absent/total counts
- [ ] Verify 90% reference line visible on chart
- [ ] Click alerts table headers → verify sorting works
- [ ] Verify academic year context bar matches Grades module
- [ ] Test offline: disconnect wifi → record attendance → verify localStorage → reconnect → verify sync
- [ ] `npm run build` in frontend — zero TS errors
- [ ] `nest build academics` in backend — zero errors
