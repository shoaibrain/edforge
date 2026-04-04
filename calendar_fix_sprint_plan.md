# EdForge Calendar System Fix — Nepal Pilot Readiness

## Context

The calendar generation engine is fundamentally sound — Saturday-only weekends, tenant ABAC scoping, Gregorian date math, day counting (368 total / 316 instructional / 52 Saturdays), and frontend rendering all work correctly. Seven bugs were identified through production rehearsal that block Nepal pilot deployment. This plan fixes all seven across three sprints, each producing a demoable, testable artifact.

### Bug Summary

| # | Severity | Bug | Root Cause File | Line |
|---|----------|-----|-----------------|------|
| 1 | CRITICAL | `calendarDateId` = `schoolId` on every record | `calendar-date.service.ts` | 522 |
| 2 | CRITICAL | Zero holidays across 368 days | `AcademicSetupTab.tsx` | 1261-1269 |
| 3 | CRITICAL | Sessions show `totalInstructionalDays: 0` after generation | `calendar-date.service.ts` | 357-426 |
| 4 | HIGH | Calendar date range overruns session boundaries (+90 orphaned days) | `AcademicSetupTab.tsx` | 1265 |
| 5 | HIGH | "Generate Calendar" always visible — invitation to overwrite | `AcademicSetupTab.tsx` | 1297 |
| 6 | HIGH | Session gap Sep 9-14 (6 days in no session) | Session data / no validation |
| 7 | MEDIUM | Jan 1, 2027 marked instructional | Consequence of Bug 2 |

### What Works Correctly (Do Not Touch)

- Saturday = weekend (52 Saturdays non-instructional, Sunday instructional)
- ABAC tenant scoping (tenantId + schoolId on every record)
- Day counting arithmetic (368 total, 316 instructional)
- Frontend calendar grid rendering (month nav, color-coded day types)
- Nepal locale detection (Bikram Sambat badge, Saturday-only weekend defaults)
- Gregorian ISO date storage and day-of-week calculation
- DynamoDB key structure (`SCHOOL#{schoolId}#DATE#{date}`)

---

## Sprint 1: Data Integrity + Regeneration Safety

**Goal**: Fix the two backend data-corruption bugs and add a regeneration safety guardrail so generated calendar data is correct and protected from accidental overwrites.

**Demoable Artifact**: Generate a calendar for a Nepal school. Each date has a unique ID, Nepal holidays appear, and regeneration requires explicit confirmation.

---

### Task 1.1: Fix `calendarDateId` in response mapper

**Bug**: 1 (CRITICAL)
**Files**:
- `server/application/microservices/identity/src/schools/calendar-date.service.ts` line 522
- `packages/shared-types/src/schemas/identity/calendar-date.schema.ts` (calendarDateId schema)

**Problem**: `toCalendarDateResponse()` sets `calendarDateId: cd.schoolId`, so all 368 records share the same ID.

**Fix**:
1. Change line 522 from `calendarDateId: cd.schoolId` to `calendarDateId: `${cd.schoolId}::${cd.date}`` — this composite is globally unique (not just per-school), stable, and self-documenting.
2. In the shared-types schema, relax `calendarDateId: z.string().uuid()` to `calendarDateId: z.string()` since the new format is not a UUID.
3. Audit frontend consumers: grep for `calendarDateId` in `edforge-saas-frontend/` to confirm no code assumes UUID format or uses it as a flat-map key across schools.

**Verification**:
- Unit test: call `toCalendarDateResponse()` with a mock entity where `schoolId='abc'` and `date='2026-05-01'`. Assert `calendarDateId === 'abc::2026-05-01'`.
- Integration: `GET /schools/:id/calendar-dates?limit=10` — assert all returned items have distinct `calendarDateId` values.
- Regression: confirm the frontend `SchoolFullCalendar.tsx` and `AcademicSetupTab.tsx` calendarDateId usage still works (these use it for React keys and individual date lookups).

---

### Task 1.2: Document migration strategy for existing calendar data

**Bug**: 1 (related)

**Problem**: Existing calendar dates in DynamoDB already have `calendarDateId: schoolId` in their API responses. After Task 1.1 deploys, old data served through the response mapper will automatically get the new composite format (the fix is in the mapper, not the stored data). However, any cached frontend data or saved references will be stale.

**Fix**:
1. Add a note to the deploy runbook: "Schools with existing calendars should regenerate after this deploy to ensure consistent data."
2. The response mapper fix (Task 1.1) is sufficient — no stored DynamoDB data needs migration because `calendarDateId` is computed at read time, not stored.
3. Add a rehearsal test that generates, reads, then regenerates and reads again — verifying IDs are consistent.

**Verification**: Deploy to dev, read existing calendar dates via API, confirm `calendarDateId` is now `schoolId::date` format without any data migration.

---

### Task 1.3: Create Nepal public holidays data file (2026-2027)

**Bug**: 2 (CRITICAL)
**File to create**: `server/application/microservices/identity/src/data/holidays/np-2026-2027.json`
**Also create**: `server/application/microservices/identity/src/data/holidays/index.ts` (barrel export with typing)

**What**: Create a JSON file containing Nepal gazetted public holidays for the 2026-2027 academic year range (approx Mar 2026 — Apr 2027 Gregorian). The data lives in the backend service only — the frontend will request it via API.

**Format** (matches existing `GenerateCalendarDto.holidays` schema):
```json
[
  { "date": "2026-04-14", "name": "Nepali New Year (Baisakh 1)", "eventType": "holiday" },
  { "date": "2026-05-11", "name": "Buddha Jayanti", "eventType": "holiday" },
  { "date": "2026-05-29", "name": "Republic Day (Jestha 15)", "eventType": "holiday" },
  { "date": "2026-09-19", "name": "Constitution Day (Ashwin 3)", "eventType": "holiday" },
  { "date": "2026-10-02", "name": "Ghatasthapana (Dashain begins)", "eventType": "holiday" },
  { "date": "2026-10-11", "name": "Vijaya Dashami", "eventType": "holiday" },
  { "date": "2026-10-12", "name": "Dashain (Ekadashi)", "eventType": "holiday" },
  { "date": "2026-10-20", "name": "Laxmi Puja (Tihar)", "eventType": "holiday" },
  { "date": "2026-10-22", "name": "Bhai Tika (Tihar)", "eventType": "holiday" },
  { "date": "2027-01-01", "name": "New Year's Day", "eventType": "holiday" },
  { "date": "2027-01-14", "name": "Maghe Sankranti", "eventType": "holiday" },
  { "date": "2027-02-19", "name": "Democracy Day", "eventType": "holiday" },
  { "date": "2027-03-03", "name": "Maha Shivaratri", "eventType": "holiday" },
  { "date": "2027-03-17", "name": "Holi (Fagu Purnima)", "eventType": "holiday" }
]
```

**Note**: Exact dates for moveable feasts (Dashain, Tihar, Holi, Shivaratri) must be verified against the Nepal Government official gazette for BS 2083. The dates above are estimates and must be cross-referenced.

**Verification**:
- Unit test: import the file, assert array length is 15-30, all dates are valid `YYYY-MM-DD`, all `eventType` values are `'holiday'`, no duplicate dates.

---

### Task 1.4: Create holiday loader utility and backend endpoint

**Bug**: 2 (CRITICAL)
**Files**:
- Create: `server/application/microservices/identity/src/schools/holiday.service.ts`
- Create: `server/application/microservices/identity/src/schools/holiday.controller.ts`
- Modify: `server/application/microservices/identity/src/schools/calendar.module.ts` (register new service + controller)

**What**: Create a `HolidayService` with method `getHolidaysForLocale(locale: string, startDate: string, endDate: string)` that:
1. If locale matches Nepal (`'np'`, `'ne-NP'`, `'NP'`), loads the Nepal holidays JSON from Task 1.3.
2. Filters to holidays within `[startDate, endDate]`.
3. Returns the filtered array matching `GenerateCalendarDto.holidays` format.

Expose as `GET /holidays?locale=np&startDate=2026-03-29&endDate=2027-04-01` via `HolidayController`.

**Verification**:
- Unit test: call with `locale='np'`, date range covering Oct 2026. Assert Dashain holidays are returned.
- Unit test: call with `locale='en-US'`. Assert returns empty array.
- Integration: `GET /holidays?locale=np&startDate=2026-01-01&endDate=2027-12-31` returns 15+ entries.

---

### Task 1.5: Frontend — fetch holidays and pass to generate API

**Bug**: 2 (CRITICAL)
**Files**:
- `edforge-saas-frontend/apps/shell/src/hooks/useCalendar.ts` (add `useHolidays` query hook)
- `edforge-saas-frontend/apps/shell/src/services/calendar.service.ts` (add `getHolidays` API call)
- `edforge-saas-frontend/apps/shell/src/pages/settings/tabs/AcademicSetupTab.tsx` lines 1254-1275

**What**: Modify `CalendarStep` component to:
1. Fetch holidays from the new backend endpoint using the detected locale and academic year date range.
2. Pass the holidays array to `generateCalendar.mutate()` data payload.

**Current** (lines 1260-1269):
```typescript
data: {
  academicYearId: yearId,
  startDate, endDate,
  includeWeekends: false,
  schoolDays,
}
```

**After**:
```typescript
data: {
  academicYearId: yearId,
  startDate, endDate,
  includeWeekends: false,
  schoolDays,
  holidays: localeHolidays || [],  // from useHolidays() hook
}
```

**Verification**:
- Manual: In a Nepal-locale tenant, open DevTools Network tab, click Generate Calendar. The POST request body contains a `holidays` array with 15+ entries.
- After generation: `GET /schools/:id/calendar-dates?isHoliday=true` returns entries. Previously returned 0.
- Bug 7 auto-verified: `GET /schools/:id/calendar-dates` for date `2027-01-01` shows `isHoliday: true`, `isInstructionalDay: false`.

---

### Task 1.6: Fix misleading preview text about holidays

**Bug**: 2 (related)
**File**: `edforge-saas-frontend/apps/shell/src/pages/settings/tabs/AcademicSetupTab.tsx` line 1443

**Current text**: `"National holidays from locale public holiday calendar will be imported"`

**Fix**: Make conditional on locale and loaded holidays:
- If holidays were loaded (length > 0): `"{count} national holidays from {locale} public holiday calendar will be applied"`
- If no holidays loaded: `"No locale holiday calendar available - holidays can be added manually after generation"`

**Verification**: Manual — switch between Nepal and US locale tenants. Text updates accordingly.

---

### Task 1.7: Add regeneration confirmation modal (safety guardrail)

**Bug**: 5 (HIGH)
**File**: `edforge-saas-frontend/apps/shell/src/pages/settings/tabs/AcademicSetupTab.tsx`

**Problem**: The Generate Calendar button and form are always visible and identical whether generating for the first time or regenerating. Users will accidentally overwrite manual edits.

**Fix**:
1. Derive `calendarExists = totalDays > 0` from `calendarStats` (already available at line 1222).
2. When `calendarExists`:
   - Change button text from "Generate Calendar" to "Regenerate Calendar"
   - Change button color from green (`#1D9E75`) to amber/warning
   - Strengthen the confirmation modal text: "This will DELETE all {totalDays} existing calendar dates and regenerate. Any manual edits (teacher in-service days, early releases, holiday overrides) will be lost. This cannot be undone."
3. When `!calendarExists`: keep current simple confirmation behavior.

**Verification**: Manual — generate a calendar. Button changes to amber "Regenerate Calendar". Click it. Modal warns about existing data loss with specific count.

---

### Task 1.8: Unit tests for calendar date generation with holidays

**File to create**: `server/application/microservices/identity/src/common/entities/__tests__/calendar-date.entity.spec.ts`

**Test cases**:
1. Generate with empty holidays array — all weekdays are instructional.
2. Generate with 3 holidays — those dates are `isHoliday: true`, `isInstructionalDay: false`.
3. Holiday falling on a Saturday (weekend) — still marked as weekend, not double-counted as holiday.
4. `instructionalDayNumber` sequencing skips holidays correctly.
5. `calendarEvents` contains the holiday description string.
6. Idempotency: generating the same range twice produces identical output.

**Verification**: `npx jest --testPathPattern=calendar-date.entity.spec` passes.

---

### Sprint 1 Demo Script

1. Select a Nepal-locale school in Setup Mode.
2. Navigate to Academic Setup > Calendar.
3. Click "Generate Calendar".
4. Show: holidays count > 0 in stats cards (e.g., "15 holidays").
5. Navigate to May 2026 — show Buddha Jayanti marked as holiday (red dot).
6. Navigate to Oct 2026 — show Dashain week marked as holidays.
7. Navigate to Jan 2027 — show Jan 1 marked as holiday (Bug 7 fixed).
8. Open DevTools, `GET /calendar-dates?limit=5` — show unique `calendarDateId` values (Bug 1 fixed).
9. Click "Regenerate Calendar" — show amber button and destructive warning modal (Bug 5 mitigated).

---

## Sprint 2: Session Integrity and Instructional Day Sync

**Goal**: After calendar generation, sessions have correct instructional day counts. Session gaps and date-range overruns are detected and surfaced as warnings.

**Demoable Artifact**: Generate a calendar, then view sessions — each shows correct instructional day count. Warnings appear for gaps and orphaned date ranges.

---

### Task 2.1: Extend generation response DTO to include `warnings`

**Prerequisite for**: Tasks 2.3, 2.4, 2.5
**Files**:
- `packages/shared-types/src/schemas/identity/calendar-date.schema.ts` (add `warnings` to generation response schema)
- `server/application/microservices/identity/src/schools/calendar-date.service.ts` (add `warnings: string[]` to `generateCalendar` return type)
- `edforge-saas-frontend/apps/shell/src/hooks/useCalendar.ts` (update mutation return type)

**What**: Add a `warnings: string[]` field to the calendar generation response. Initialize as empty array. This provides the transport mechanism for all subsequent warning features.

**Verification**: Generate a calendar. Response includes `warnings: []`. Frontend TypeScript compiles without errors.

---

### Task 2.2: Inject `AcademicSessionService` into `CalendarDateService`

**Bug**: 3 (CRITICAL)
**File**: `server/application/microservices/identity/src/schools/calendar-date.service.ts`

**What**: Add `AcademicSessionService` as a `forwardRef`-injected dependency (same pattern as `AcademicYearsService` on line 43).

**Changes**:
1. Import: `import { AcademicSessionService } from './academic-session.service';`
2. Constructor: `@Inject(forwardRef(() => AcademicSessionService)) private readonly academicSessionService: AcademicSessionService,`
3. Verify module registration in `calendar.module.ts` — both services should already be provided in the same module.

**Verification**: `npm run build` in server workspace — no TypeScript or circular dependency errors. NestJS app bootstraps successfully.

---

### Task 2.3: Add session instructional day sync after calendar generation

**Bug**: 3 (CRITICAL)
**File**: `server/application/microservices/identity/src/schools/calendar-date.service.ts`, method `generateCalendar()` lines 357-426

**What**: After step 6 (bulk insert, line 408) and before step 7 (summary, line 411), add session sync:

```typescript
// 6b. Sync session instructional day counts
const warnings: string[] = [];
const sessionSummaries: Array<{ sessionId: string; sessionName: string; instructionalDays: number }> = [];

try {
  const sessionsResult = await this.academicSessionService.listSessions(schoolId, context, yearId);
  const sessions = sessionsResult.items || [];

  for (const session of sessions) {
    const count = calendarDates.filter(
      cd => cd.date >= session.beginDate &&
            cd.date <= session.endDate &&
            cd.isInstructionalDay
    ).length;

    await this.academicSessionService.updateInstructionalDays(
      schoolId, session.academicSessionId, count, context
    );
    sessionSummaries.push({
      sessionId: session.academicSessionId,
      sessionName: session.sessionName,
      instructionalDays: count,
    });
  }
} catch (err) {
  this.logger.error(`Session sync failed for school ${schoolId}: ${err}`);
  warnings.push('Calendar generated successfully but session instructional day counts could not be updated. Please regenerate or contact support.');
}
```

**Key design decision**: Sync is wrapped in try/catch. If it fails partway, calendar dates are still persisted (they're already in DynamoDB). The failure is reported as a warning in the response, not a generation failure.

**Verification**:
- Integration test: create 2 sessions, generate calendar, GET each session. Assert `totalInstructionalDays > 0`.
- Edge case: generate when no sessions exist. Assert no error, warnings may note "no sessions found."

---

### Task 2.4: Add date-range overrun detection with frontend warning

**Bug**: 4 (HIGH)
**Files**:
- `server/application/microservices/identity/src/schools/calendar-date.service.ts` (in `generateCalendar()`, after session sync)
- `edforge-saas-frontend/apps/shell/src/pages/settings/tabs/AcademicSetupTab.tsx` (display warnings)

**What — Backend**: After listing sessions in Task 2.3, compute:
```typescript
if (sessions.length > 0) {
  const lastSessionEnd = sessions.reduce((max, s) => s.endDate > max ? s.endDate : max, sessions[0].endDate);
  if (dto.endDate > lastSessionEnd) {
    const orphanedDays = calendarDates.filter(cd => cd.date > lastSessionEnd).length;
    warnings.push(
      `Calendar extends ${orphanedDays} days beyond the last session (ends ${lastSessionEnd}). ` +
      `These dates are not assigned to any session.`
    );
  }
}
```

**What — Frontend**: In `CalendarStep`, after successful generation:
1. Capture `warnings` from the mutation response.
2. If `warnings.length > 0`, render amber alert banners below the calendar stats cards.

**Verification**:
- Manual: generate a calendar where sessions end Dec 31 but academic year extends to Apr 1. Amber warning appears: "Calendar extends 90 days beyond the last session..."
- Unit test (backend): mock sessions ending Dec 31, generate through Apr 1. Assert warnings array is non-empty.

---

### Task 2.5: Add session gap detection with frontend warning

**Bug**: 6 (HIGH)
**Files**:
- Create: `packages/shared-types/src/utils/session-gap-detector.ts`
- Modify: `edforge-saas-frontend/apps/shell/src/components/calendar/SessionManager.tsx`

**What — Utility**:
```typescript
export interface SessionGap {
  gapStart: string;   // YYYY-MM-DD
  gapEnd: string;     // YYYY-MM-DD
  dayCount: number;
  beforeSession: string;  // session name
  afterSession: string;   // session name
}

export function detectSessionGaps(
  sessions: Array<{ sessionName: string; beginDate: string; endDate: string }>,
): SessionGap[]
```

Logic: sort sessions by `beginDate`. For each consecutive pair, if `sessions[i].endDate + 1 day < sessions[i+1].beginDate`, record the gap.

**What — Frontend**: In `SessionManager.tsx`, compute gaps using `useMemo`. If gaps found, render amber warning cards between the timeline and session list: "5-day gap between Third Semester (ends Sep 8) and Fourth Semester (starts Sep 14)".

**Verification**:
- Unit test: sessions where 3rd ends Sep 8, 4th starts Sep 14. Assert gap `{ gapStart: '2026-09-09', gapEnd: '2026-09-13', dayCount: 5 }`.
- Unit test: contiguous sessions. Assert no gaps.
- Manual: view Sessions & Terms with current Nepal data. Amber warning appears for Sep 9-14 gap.

---

### Task 2.6: Integration tests for session sync and warnings

**Files**:
- Add tests to `scripts/smoke-tests/sprint2-calendar-flow.ts` or create `scripts/smoke-tests/sprint3-calendar-integrity.ts`
- Add tests to `edforge-pilot-rehearsal.ts`

**Rehearsal test cases**:
```typescript
// After calendar generation:
await ph.test('Sessions have instructional day counts after generation', async () => {
  const res = await http.get(`/schools/${ctx.schoolId}/academic-sessions?academicYearId=${ctx.academicYearId}`);
  assert(res.status === 200, `Sessions: ${res.status}`);
  const sessions = res.data?.items || [];
  assert(sessions.length > 0, 'Expected at least 1 session');
  for (const s of sessions) {
    assert(s.totalInstructionalDays > 0,
      `Session "${s.sessionName}" has ${s.totalInstructionalDays} instructional days, expected > 0`);
  }
});

await ph.test('Calendar generation returns warnings for date overrun', async () => {
  // This test only validates if sessions end before academic year
  // May not fire for all configurations — conditional assertion
});
```

**Verification**: `npx ts-node edforge-pilot-rehearsal.ts --jwt <token>` — all new tests pass.

---

### Sprint 2 Demo Script

1. Generate a calendar for the Nepal school (or use the one from Sprint 1).
2. Navigate to Sessions & Terms — show each session now has instructional day counts (e.g., "First Semester: 27 instructional days").
3. Show the session gap warning: "5-day gap between Third Semester and Fourth Semester."
4. Show the date-range overrun warning: "Calendar extends 90 days beyond the last session."
5. Verify that the sum of session instructional days approximates total (minus orphaned days).

---

## Sprint 3: Polish, Full Validation, and Pilot Readiness

**Goal**: Complete UX polish, comprehensive end-to-end testing, and final pilot readiness validation. Address the BS badge accuracy. Ship production-ready.

**Demoable Artifact**: Full end-to-end pilot rehearsal passes. All calendar features are production-polished.

---

### Task 3.1: Collapse generation config panel after successful generation

**Bug**: 5 (HIGH — continued)
**File**: `edforge-saas-frontend/apps/shell/src/pages/settings/tabs/AcademicSetupTab.tsx`

**What**: After successful generation, collapse the configuration panel (locale selector, weekend picker, school days toggles, preview text). Only show the calendar grid and stats. The panel re-expands when "Regenerate Calendar" is clicked.

**Changes**:
1. Add state: `const [showGenPanel, setShowGenPanel] = useState(!calendarExists)`.
2. Wrap generation config panel (lines ~1359-1458) in `{showGenPanel && (...)}`.
3. "Regenerate Calendar" button sets `setShowGenPanel(true)`.
4. `onSuccess` callback sets `setShowGenPanel(false)`.

**Verification**: Manual — open a school with existing calendar. Config panel is collapsed. Only calendar grid and stats visible. Click "Regenerate" to expand.

---

### Task 3.2: Add post-generation success banner with statistics

**File**: `edforge-saas-frontend/apps/shell/src/pages/settings/tabs/AcademicSetupTab.tsx`

**What**: After successful generation, display a transient green success banner: "{totalDays} calendar dates generated: {instructionalDays} instructional, {holidays} holidays, {weekends} weekends." Auto-dismiss after 8 seconds.

**Changes**:
1. In `onSuccess` handler of `generateCalendar.mutate()`, capture response data to local state.
2. Render success banner conditionally. Auto-clear with `setTimeout`.

**Verification**: Manual — generate a calendar. Green banner appears with correct statistics. Disappears after 8 seconds.

---

### Task 3.3: Fix Bikram Sambat badge accuracy

**File**: `edforge-saas-frontend/apps/shell/src/pages/settings/tabs/AcademicSetupTab.tsx`

**Problem**: The badge says "Bikram Sambat calendar" implying BS date integration that doesn't exist. Dates are stored and displayed in Gregorian only.

**Fix**: Change the badge text from "Detected locale: Nepal (NP) - Bikram Sambat calendar" to "Detected locale: Nepal (NP) - Saturday weekend, Nepal public holidays". This is accurate — it describes what the locale detection actually configures.

**Verification**: Manual — the badge no longer claims BS calendar integration.

---

### Task 3.4: Instructional day count display in Sessions & Terms UI

**File**: `edforge-saas-frontend/apps/shell/src/components/calendar/SessionManager.tsx`

**What**: Enhance the session list to prominently show instructional day counts per session. Currently shown inline (line 427) but may show 0 for existing data.

**Changes**:
1. After calendar generation, session data is refetched (add query invalidation for sessions in the generate mutation's `onSuccess` if not already present).
2. Each session card shows: `{totalInstructionalDays} instructional days` in a highlighted badge.
3. If `totalInstructionalDays === 0` and calendar exists, show an amber warning: "Instructional days not computed — regenerate calendar to sync."

**Verification**: Manual — generate calendar, navigate to Sessions & Terms. Each session shows non-zero instructional day count.

---

### Task 3.5: Comprehensive end-to-end rehearsal test suite for calendar

**File**: `edforge-pilot-rehearsal.ts` (add new Phase or extend existing calendar phase)

**Test cases covering all 7 bugs**:

```typescript
const calendarPhase = new Phase('CAL', 'Calendar System Validation', true);

// Bug 1: Unique calendarDateId
await calendarPhase.test('Each calendar date has unique calendarDateId', async () => {
  const res = await http.get(
    `/schools/${ctx.schoolId}/calendar-dates?academicYearId=${ctx.academicYearId}&limit=100`
  );
  assert(res.status === 200, `Calendar dates: ${res.status}`);
  const items = res.data?.items || [];
  assert(items.length > 0, 'Expected calendar dates');
  const ids = new Set(items.map((d: any) => d.calendarDateId));
  assert(ids.size === items.length,
    `calendarDateId collision: ${ids.size} unique IDs for ${items.length} records`);
});

// Bug 2: Holidays exist
await calendarPhase.test('Calendar contains holidays (Nepal locale)', async () => {
  const res = await http.get(
    `/schools/${ctx.schoolId}/calendar-dates?academicYearId=${ctx.academicYearId}&isHoliday=true&limit=100`
  );
  assert(res.status === 200, `Holiday dates: ${res.status}`);
  const items = res.data?.items || [];
  assert(items.length >= 10,
    `Expected >= 10 holidays for Nepal, got ${items.length}`);
});

// Bug 3: Sessions have instructional days
await calendarPhase.test('Sessions updated with instructional day counts', async () => {
  const res = await http.get(
    `/schools/${ctx.schoolId}/academic-sessions?academicYearId=${ctx.academicYearId}`
  );
  assert(res.status === 200, `Sessions: ${res.status}`);
  const sessions = res.data?.items || [];
  for (const s of sessions) {
    assert(s.totalInstructionalDays > 0,
      `Session "${s.sessionName}" has 0 instructional days`);
  }
});

// Bug 7: Jan 1 is holiday
await calendarPhase.test('Jan 1, 2027 marked as holiday', async () => {
  const res = await http.get(
    `/schools/${ctx.schoolId}/calendar-dates/2027-01-01`
  );
  if (res.status === 200) {
    assert(res.data.isHoliday === true, 'Jan 1 should be a holiday');
    assert(res.data.isInstructionalDay === false, 'Jan 1 should not be instructional');
  }
});

// Weekend correctness
await calendarPhase.test('Saturday = non-instructional, Sunday = instructional', async () => {
  const res = await http.get(
    `/schools/${ctx.schoolId}/calendar-dates?academicYearId=${ctx.academicYearId}&limit=100`
  );
  const items = res.data?.items || [];
  const saturdays = items.filter((d: any) => d.dayOfWeek === 'saturday');
  const sundays = items.filter((d: any) => d.dayOfWeek === 'sunday');
  assert(saturdays.every((d: any) => !d.isInstructionalDay),
    'Saturday must be non-instructional');
  assert(sundays.every((d: any) => d.isInstructionalDay || d.isHoliday),
    'Sunday must be instructional (unless holiday)');
});
```

**Verification**: `npx ts-node edforge-pilot-rehearsal.ts --jwt <token>` — all calendar phase tests pass green.

---

### Task 3.6: Smoke test for calendar generation end-to-end

**File**: Create or update `scripts/smoke-tests/sprint3-calendar-integrity.ts`

**Test flow**:
1. Create academic year with date range.
2. Create 4 sessions within the year.
3. Call generate-calendar with Nepal locale holidays.
4. Assert: total days > 0, instructional days > 0, holidays > 10, weekends > 0.
5. Assert: each session has `totalInstructionalDays > 0`.
6. Assert: `calendarDateId` values are unique.
7. Regenerate calendar. Assert: previous data replaced, counts match.

**Verification**: Run smoke test against dev environment. All assertions pass.

---

### Sprint 3 Demo Script (Final Pilot Readiness Demo)

1. Create a new school with Nepal locale.
2. Complete school setup: Academic Year (2026-2027), Sessions (4 semesters), Calendar generation.
3. Show calendar grid — holidays are color-coded, Saturday weekends correct.
4. Show Sessions & Terms — each session has correct instructional day count.
5. Show session gap warning for Sep 9-14.
6. Show date-range overrun warning.
7. Show regeneration requires confirmation with data loss warning.
8. Show BS badge accurately describes Nepal configuration (not false BS integration claim).
9. Run `npx ts-node edforge-pilot-rehearsal.ts` — all tests green.
10. Declare calendar system pilot-ready.

---

## Task Summary Table

| Sprint | Task | Bug(s) | Type | Scope |
|--------|------|--------|------|-------|
| 1 | 1.1 Fix calendarDateId response mapper | 1 | Backend | 1 file, ~2 lines |
| 1 | 1.2 Document migration strategy | 1 | Documentation | Runbook entry |
| 1 | 1.3 Create Nepal holidays JSON | 2, 7 | Data | 1 new file |
| 1 | 1.4 Holiday loader utility + endpoint | 2 | Backend | 3 new files |
| 1 | 1.5 Frontend: fetch + pass holidays | 2 | Frontend | 3 files |
| 1 | 1.6 Fix misleading preview text | 2 | Frontend | 1 file, ~5 lines |
| 1 | 1.7 Regeneration confirmation modal | 5 | Frontend | 1 file |
| 1 | 1.8 Unit tests for holiday generation | 2 | Test | 1 new file |
| 2 | 2.1 Extend response DTO with warnings | 3,4 | Schema | 3 files |
| 2 | 2.2 Inject AcademicSessionService | 3 | Backend DI | 1 file, ~3 lines |
| 2 | 2.3 Session instructional day sync | 3 | Backend | 1 file, ~30 lines |
| 2 | 2.4 Date-range overrun detection + warning | 4 | Full-stack | 2 files |
| 2 | 2.5 Session gap detection + warning | 6 | Full-stack | 2 new files + 1 modify |
| 2 | 2.6 Integration tests for session sync | 3,4,6 | Test | 1-2 files |
| 3 | 3.1 Collapse gen panel after generation | 5 | Frontend | 1 file |
| 3 | 3.2 Post-generation success banner | 5 | Frontend | 1 file |
| 3 | 3.3 Fix BS badge accuracy | UX | Frontend | 1 file, 1 line |
| 3 | 3.4 Session instructional day display | 3 | Frontend | 1 file |
| 3 | 3.5 E2E rehearsal test suite | All | Test | 1 file |
| 3 | 3.6 Smoke test for full flow | All | Test | 1 new file |

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Nepal holiday date inaccuracy (moveable feasts) | Cross-reference with Nepal Gov gazette for BS 2083. Dates can be patched in JSON without code changes. |
| Circular dependency when injecting AcademicSessionService | Use `forwardRef` (same pattern as existing AcademicYearsService). Test NestJS bootstrap immediately. |
| Schema relaxation for calendarDateId (uuid to string) | Audit all consumers. The shared-types schema is used for validation — confirm frontend doesn't validate responses against it. |
| Session sync partial failure | Try/catch with warning in response (Task 2.3). Calendar dates are persisted regardless. |
| Performance of session sync (4 sequential DDB updates) | Acceptable for V1 (4 sessions = 4 updates). For schools with many sessions, consider `Promise.all`. |
| Holiday data versioning (2027-2028 year) | Document as V1_FOLLOWUP: annual holiday data file updates. The loader utility from Task 1.4 makes this a data-only change. |

---

## Post-V1 Backlog (Deferred)

- **BS date field**: Add `bsDate` to CalendarDate entity using `nepali-date-converter` npm package. Display in frontend calendar grid.
- **Holiday DynamoDB table**: Move from JSON file to `HOLIDAY_DATA#NP#YYYY` DynamoDB entity for admin-editable holidays.
- **Bell schedule enforcement**: Gate attendance recording against bell schedule periods.
- **Multi-country holiday support**: Extend holiday loader for India, US, and other locales.
- **Calendar-aware attendance validation**: Attendance API checks if date is instructional before accepting records.
