# Calendar event-type vocabulary audit — PABSON pilot Day-1

**Date:** 2026-05-17
**Trigger:** Pre-flight before building the `/calendar-blocks` frontend UI (and the broader calendar-setup walkthrough) for Saraswati School (`pabson-saraswati-bs-2083`). Goal: confirm the existing backend event-type vocabulary covers what a PABSON operator will need to declare during Day-1 calendar setup, BEFORE we build UI against it.

**Outcome:** ✅ Backend vocabulary is sufficient for Saraswati Day-1. **No backend enum bumps required.** Two small UX-clarity questions (documented below) become **frontend design decisions** in the upcoming C4-frontend sprint plan.

---

## 1. Backend vocabulary inventory (what exists today)

### 1.1 `CalendarDate.calendarEvents[].eventType` — 17 values

File: [`packages/shared-types/src/schemas/identity/calendar-date.schema.ts:32-50`](../../packages/shared-types/src/schemas/identity/calendar-date.schema.ts#L32)

```ts
calendarEventDescriptorSchema = z.enum([
  'instructional_day',       // Regular school day
  'non_instructional_day',   // No classes
  'holiday',                 // Official holiday
  'teacher_only',            // Professional development (staff present, students off)
  'student_holiday',         // Students off, teachers work
  'weather_day',             // Emergency closure
  'exam_window',             // Term exam day (auto-synced from GradingPeriod)
  'school_program',          // Curated school event (cultural, religious, community)
  'monthly_test',            // Periodic assessment day (PABSON monthly cadence)
  'early_release',           // Shortened day
  'late_start',              // Delayed start
  'conference_day',          // Parent-teacher conferences
  'graduation',              // Graduation ceremony
  'break',                   // Spring/Winter break (child-of-block)
  'in_service',              // Teacher in-service
  'make_up_day',             // Make-up for missed day
  'other',
])
```

### 1.2 `CalendarDate.calendarEvents[].audience` — role segmentation

File: same schema, lines 73-79.

```ts
calendarEventAudienceSchema = z.enum([
  'students', 'faculty', 'parents', 'community', 'all'
])
```

Comment in source: "Default `all` means whole-school visibility / optional; absent = whole-school visibility." **Single value, not an array.** See [Question Q2](#21-question-q2--audience-semantics) below.

### 1.3 `CalendarDate.calendarEvents[].category` — finer classification

File: same schema, lines 58-66.

```ts
calendarEventCategorySchema = z.enum([
  'cultural', 'religious', 'academic', 'assessment',
  'administrative', 'community', 'professional_development', 'other'
])
```

### 1.4 `CalendarBlock.blockDescriptor` — multi-day umbrella

File: [`packages/shared-types/src/schemas/identity/calendar-block.schema.ts:37-43`](../../packages/shared-types/src/schemas/identity/calendar-block.schema.ts#L37)

```ts
calendarBlockDescriptorSchema = z.enum([
  'religious_festival',   // Dashain, Tihar, Holi
  'school_vacation',      // Summer, Winter
  'exam_block',           // Multi-day exam window
  'national_observance',  // Multi-day national event (rare)
  'other',
])
```

### 1.5 CalendarDate entity flags

File: [`server/application/microservices/identity/src/common/entities/calendar-date.entity.ts:85-153`](../../server/application/microservices/identity/src/common/entities/calendar-date.entity.ts#L85)

- `isInstructionalDay: boolean`
- `isHoliday: boolean`
- `isWeekend: boolean`
- `dayOfWeek: DayOfWeek`
- `blockId`, `blockName`, `blockDescriptor` — denormalized block link (C4.2)
- `gradingPeriodId`, `gradingPeriodName` — link to enclosing grading period (read-only reference)

**No top-level role-segmentation field** (no `staffOnly: boolean` / `studentOnly: boolean`). Role segmentation is expressed via `calendarEvents[].audience`.

### 1.6 Bell schedule day types — orthogonal

File: [`packages/shared-types/src/schemas/identity/bell-schedule.schema.ts:23-31`](../../packages/shared-types/src/schemas/identity/bell-schedule.schema.ts#L23)

```ts
scheduleDayTypeSchema = z.enum([
  'regular', 'early_release', 'late_start', 'assembly',
  'testing', 'half_day', 'special',
])
```

These define **which bell schedule applies**, not what the calendar declares. A calendar date links to a bell schedule, which has a `dayType` — but the calendar event itself doesn't carry that `dayType` directly. See [Question Q1](#22-question-q1--half-day-representation) below for the implications.

### 1.7 PABSON archetype holiday seed

File: [`packages/shared-types/src/locale/holiday-seeds/pabson-npl-2083.json`](../../packages/shared-types/src/locale/holiday-seeds/pabson-npl-2083.json)

Pre-seeded into every PABSON tenant's BS 2083 calendar at generate-calendar time:
- **6 multi-day blocks**: Dashain, Tihar, Chhath, Summer Vacation, Winter Vacation, Holi → all `eventType: 'break'`
- **13 single-day national / religious holidays** → all `eventType: 'holiday'`
- **9 school programs** (Saraswati-specific via [`packages/pilot-fixtures/pilots/pabson-saraswati-bs-2083/programs.json`](../../packages/pilot-fixtures/pilots/pabson-saraswati-bs-2083/programs.json)) → `eventType: 'school_program'`

This means a freshly-generated Saraswati calendar already has all the canonical Nepal holidays + the 6 expected vacation blocks + the school-specific programs **without operator action**. The operator only declares *additional* events (school-specific PD days, exam blocks tied to terms, ad-hoc events).

---

## 2. PABSON pilot needs mapped

Looking at the operator-vocabulary target (Allen ISD reference calendar the user provided, translated to PABSON context):

| Operator declares… | Multi-day? | Mapping | Status |
|---|---|---|---|
| **Dashain** ~9 days, Sept-Oct | ✓ | `CalendarBlock { blockDescriptor: 'religious_festival', childEventType: 'break' }` | ✅ pre-seeded |
| **Tihar** ~5 days, Oct-Nov | ✓ | same shape | ✅ pre-seeded |
| **Summer Vacation** ~30 days | ✓ | `CalendarBlock { blockDescriptor: 'school_vacation' }` | ✅ pre-seeded |
| **Winter Vacation** ~7 days | ✓ | same shape | ✅ pre-seeded |
| **Holi** ~4 days | ✓ | `CalendarBlock { blockDescriptor: 'religious_festival' }` | ✅ pre-seeded |
| **Mid-term / Final exam window** | ✓ | `CalendarBlock { blockDescriptor: 'exam_block', childEventType: 'exam_window' }` — auto-synced from `GradingPeriod` per C4 | ✅ |
| **National holidays** (Buddha Jayanti, Constitution Day, Republic Day, Loktantra Diwas, Saraswati Puja, etc.) | ✗ | `CalendarDate` event `holiday` | ✅ all 13 pre-seeded |
| **Saraswati Puja Celebration** (school program) | ✗ | `CalendarDate` event `school_program` + `category: 'religious'` | ✅ pre-seeded via Saraswati fixture |
| **Staff Professional Development Day** (staff only) | ✗ | `CalendarDate` event `teacher_only` (+ optional `audience: 'faculty'`) | ✅ supported |
| **Student Early Release** (students leave early) | ✗ | `CalendarDate` event `early_release` (+ optional `audience: 'students'`) | ✅ supported |
| **Staff+Student Early Release** (both leave early) | ✗ | `CalendarDate` event `early_release` (+ `audience: 'all'` or absent) | ✅ supported — see Q2 |
| **Bad Weather Make-Up Day** | ✗ | `CalendarDate` event `make_up_day` | ✅ supported |
| **Parent-Teacher Conference Day** | ✗ | `CalendarDate` event `conference_day` | ✅ supported |
| **Graduation / Annual Function** | ✗ | `CalendarDate` event `graduation` | ✅ supported |
| **Trade Day / Half Day** | ✗ | `CalendarDate` event `early_release` OR bell-schedule with `dayType: 'half_day'` | ⚠ ambiguous — see Q1 |
| **Start/End of Grading Period markers** | ✗ | Derived from `Term` / `GradingPeriod` entities — NOT a CalendarDate event | not in calendar scope (visual-only render) |
| **In-service Teacher Day** | ✗ | `CalendarDate` event `in_service` | ✅ supported |
| **Monthly Test Day** (PABSON cadence) | ✗ | `CalendarDate` event `monthly_test` | ✅ supported |

**Every PABSON Day-1 operator declaration maps to an existing enum value.** No additions needed.

---

## 3. Open questions (frontend design decisions, NOT backend gaps)

### 2.1 Question Q1 — half-day representation

The backend has **two** plausible ways to mark a half-day:

1. **Calendar-event level** — `CalendarDate.calendarEvents[].eventType: 'early_release'` (or `'half_day'` does NOT exist in the event-type enum; the closest is `early_release`)
2. **Bell-schedule level** — assign the date a `bellScheduleId` whose `dayType: 'half_day'` (or `early_release`)

The semantic difference is unclear from code comments. A naive UI could let the operator do BOTH and end up with conflicting metadata.

**Recommendation:** Calendar UI should declare half-day **at the event level** (`eventType: 'early_release'`). The bell-schedule `dayType: 'half_day'` is for the schedule itself (how periods are shortened); it's a separate concern from "what's on the calendar today." Document this in the FE component's JSDoc + add a Cypress E2E asserting only the event level is editable from the calendar drawer.

### 2.2 Question Q2 — `audience` semantics

`audience` is a single enum value, not an array (per the schema). Allen ISD's "Staff Early Release" vs "Student Early Release" vs "Staff+Student Early Release" maps to:

- Staff only → `eventType: 'early_release'`, `audience: 'faculty'`
- Student only → `eventType: 'early_release'`, `audience: 'students'`
- Both → `eventType: 'early_release'`, `audience: 'all'` (or absent — same meaning per schema comment)

**One ambiguity:** the `teacher_only` event-type and `audience: 'faculty'` are partially redundant. A "Staff PD Day" could be declared as `teacher_only` (no audience needed) OR as `non_instructional_day` + `audience: 'faculty'`. The first is the operator's clearest semantic; recommend the calendar UI default to `teacher_only` for the "Staff PD" option in the create-event dropdown.

**Recommendation:** Calendar UI exposes the dropdown of common combinations as **labelled options** rather than two raw dropdowns:

```
[Single-day event type ▾]
  • Holiday (school closed for all)
  • Staff Professional Development (students off, staff in)
  • Student Holiday (students off, staff working)
  • Early Release — All
  • Early Release — Students Only
  • Early Release — Staff Only
  • Make-Up Day
  • Parent-Teacher Conference
  • Graduation / Annual Function
  • School Program (cultural/religious/community)
  • Other (free-text)
```

The UI maps each option to the right `(eventType, audience?, category?)` triple internally. Operator never sees "audience" as a separate concept unless they pick "Other."

### 2.3 Question Q3 — grading-period markers

The Allen ISD calendar shows "Start of Grading Period" / "End of Grading Period" as visual markers (rectangular brackets) inside the month grid. These are **not CalendarDate events**; they're derived from the `Term` / `GradingPeriod` entity's `startDate` / `endDate` fields.

**Recommendation:** Calendar grid renders these as **visual decorators** (a small badge or bracket on the corresponding dates) by joining `CalendarDate.gradingPeriodId` against the term list. Operator doesn't declare them; they appear automatically when terms are configured.

This is a **purely-presentational** concern — no backend work, no schema change.

---

## 4. Verdict

- **No backend enum bumps required for Saraswati Day-1.**
- The frontend calendar-blocks sprint can proceed against the existing vocabulary.
- The three open questions above are **FE design decisions** that should be answered in the upcoming Plan-mode write-up:
  - Q1 — declare half-day at event level, not bell-schedule level
  - Q2 — UI surfaces curated labelled options, not raw `(eventType, audience)` pairs
  - Q3 — grading-period markers are visual joins, not CalendarDate events

Two **non-blocking follow-ups** worth noting for backlog:
- Add JSDoc to the schema clarifying the half-day path
- Add a Cypress E2E (in the C4-FE sprint) that exercises one event of each curated UI option to assert the resulting DDB row carries the expected `(eventType, audience, category)` triple

## 5. Sources read for this audit

- `packages/shared-types/src/schemas/identity/calendar-date.schema.ts`
- `packages/shared-types/src/schemas/identity/calendar-block.schema.ts`
- `packages/shared-types/src/schemas/identity/bell-schedule.schema.ts`
- `server/application/microservices/identity/src/common/entities/calendar-date.entity.ts`
- `server/application/microservices/identity/src/schools/calendar-date.service.ts`
- `packages/shared-types/src/locale/holiday-seeds/pabson-npl-2083.json`
- `packages/pilot-fixtures/pilots/pabson-saraswati-bs-2083/programs.json`

---

**Next:** Plan-mode write-up for the Sprint C4-frontend implementation, baking in Q1/Q2/Q3 decisions as part of the component design.
