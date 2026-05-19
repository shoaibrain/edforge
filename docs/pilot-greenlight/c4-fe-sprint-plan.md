# Sprint C4-FE — Calendar Blocks + curated single-day event UI

**Date:** 2026-05-17 (updated post-architecture-review)
**Status:** 🟢 **Sprint closed 2026-05-19** — all 10 sections shipped across PRs #128, #60, #129 + the §3.7/§3.8 finisher PR. Saraswati pilot operator activated their school in prod via the UI on 2026-05-18; the IEMIS XLSX import path is unblocked. Full closeout: [`c4-fe-sprint-closeout.md`](./c4-fe-sprint-closeout.md).
**Predecessor:** Backend Sprint C4 + C4-followup + C4-followup-2 (PRs #120–#126), shipped + validated in prod at commit `3beb8d9`. 9-smoke green against `dev-pabson-primary`.
**Vocabulary audit:** [`c4-fe-vocabulary-audit.md`](./c4-fe-vocabulary-audit.md) — backend vocabulary confirmed sufficient.
**BS picker audit:** confirmed industry-standard (Gregorian-on-wire, BS-in-display). 5 hygiene refinements; only R2 (JSDoc) folded into C4-FE; the rest are a separate follow-up.
**Shared-types audit:** ONE critical drift identified — `calendarDateResponseSchema` missing 4 block-related fields. This **is now a confirmed scope item** in the C4-FE PR (was previously listed as a risk in §5/§8).

---

## 0. Architecture decisions resolved before implementation

Three architectural questions were investigated before code starts. Their resolutions are baked into the plan below; this section is the durable record.

### 0.1 Asymmetric routes (`/calendar-blocks?schoolId=` vs `/schools/:id/...`) — documented

`/calendar-blocks` is top-level with `schoolId` as a **query param**, asymmetric to bell-schedules which are nested under `/schools/:schoolId/...`. **This asymmetry is intentional** and is now documented inline in §3.1 below. The reason: a block's natural identity is `(tenantId, blockId)` — schools are a *filter*, not a *parent*. Bell-schedules ARE per-school by design. Do NOT "fix" the asymmetry without coordinating all four touch-points (controller routes + `tenant-api-prod.json` + `nginx.template` + the route-drift linter).

### 0.2 BS date handling — architecture is correct, ship as-is

The audit confirmed our design (Gregorian ISO over the wire, BS display in the picker layer) is **the industry-standard pattern for multi-calendar systems**. Every modern multi-calendar system (Islamic Hijri, Buddhist, Hebrew, Japanese Imperial, Bikram Sambat) follows this: canonical storage in Gregorian + presentation-layer conversion. BS isn't in `Intl.DateTimeFormat` so a library is required; we have one (`packages/shared-types/src/utils/bikram-sambat.ts`, ~3,200 roundtrip test samples + BS 2083 regression coverage).

**Five hygiene refinements identified** (none are correctness issues — all are sharp edges):
- **R1** Branded types (`type GregorianDateString = string & { __brand: 'gregorian' }; type BsDateString = string & { __brand: 'bs' }`) — would prevent a class of bugs at compile time. **Follow-up sprint** (1.5h).
- **R2** JSDoc on `BsDatePicker` clarifying the Gregorian-in/Gregorian-out contract — **folded into C4-FE** since we're touching call sites (0.5h).
- **R3** Replace silent `catch` blocks (lines 35/46/54/62) with `console.warn` or error callback prop — **follow-up sprint** (1h).
- **R4** Add boundary tests for BS 2090 last-year + Chaitra 30 → Baishakh 1 transitions — **follow-up sprint** (1h).
- **R5** Refinement on `generateCalendarSchema` to validate dual AD/BS input consistency — **follow-up sprint** (1h).

R1+R3+R4+R5 ship as a "BS date handling hygiene" PR after C4-FE lands. Not blocking the pilot.

### 0.3 Shared-types redundancy + entity-vs-schema drift — confirmed; partial fix in C4-FE

The audit found:

🔴 **1 CRITICAL drift** — `calendarDateResponseSchema` does NOT include `blockId / blockName / blockDescriptor / subEventName` even though the entity has them. Without this fix the FE literally cannot render block context on the grid. **Fold into C4-FE as item §3.0 (prerequisite).**

🔴 **2 HIGH duplications** — `COUNTRY_DEFAULTS` + `ARCHETYPE_DEFAULTS` hand-duplicated in `server/application/microservices/identity/src/common/entities/workspace-settings.entity.ts` (lines 121-153, 167-190) for Dockerfile-isolation reasons (identity Docker container can't resolve workspace symlinks at build time). Sync-guard test exists in `tenant-seeder-lambda.spec.ts` but only checks 2 of 4 consumers (Lambda + entity); doesn't include AdminWeb or the workspace-settings entity. **Separate small PR after C4-FE — not blocking the pilot.**

🟡 **1 MEDIUM duplication** — `RegionalSettings` interface duplicated inline in same entity. Same Dockerfile reason. Same separate-PR fix path.

✅ **Intentional FE-local union** for `CalendarEventDescriptor` in `edforge-saas-frontend/apps/shell/src/components/calendar/event-types.ts` — explicitly avoids bundling Zod into FE bundle. Comment cites the canonical source. All 17 values verified in sync. **Keep as-is; formalize with a sync contract test in C4-FE's test plan.**

### 0.4 Playwright run target — confirmed: hits `dev-pabson-primary` directly

CI Playwright stage runs against `dev-pabson-primary` (the same tenant the backend C4 smoke validates against). The new `calendar-blocks.spec.ts` follows the existing `nepal-onboarding.spec.ts` pattern. AY bootstrapping happens in `beforeAll` via API; teardown cleans up created blocks. No isolated-tenant-per-run setup required.

### 0.5 Scope confirmation

- **Option B** confirmed: Calendar Blocks CRUD + curated single-day dropdown enhancement.
- **Wizard placement**: blocks inside the existing Step 3 (Calendar), no new step.
- **Timeline**: quality-first; no calendar-week pressure. Implementation should be scalable + correctly architected + robust E2E coverage.

---

## 1. Sprint goal & non-goals

**Goal.** Ship operator-self-serve UI in `apps/shell` for the validated `/calendar-blocks` REST surface so a fresh PABSON-archetype calendar can be set up end-to-end (multi-day vacations / festivals / exam blocks + curated single-day events) without engineer involvement, unblocking the staged Day-1 greenlight loop: AY activate → IEMIS import → 2–3 week verification.

**Non-goals.**
- No backend service-logic changes — but one **shared-types schema bump is in scope** (calendarDateResponseSchema field additions; see §3.0). No service handler changes; the serializer already projects these fields from the entity.
- No new MFE; everything lives in `apps/shell`.
- No changes to AY / Terms screens beyond a single deep-link button on the AY card (this sprint will not redesign Sessions or GradingPeriod CRUD).
- No grading-period auto-creation from exam blocks (already handled server-side; FE only renders).
- No "drag-on-grid" block creation in v1 — block creation is form-driven via the BS date picker. Drag-create is a stretch follow-up.
- No mobile-specific layout work; the existing settings shell is desktop-first.
- No renaming or merge of the dormant `school-calendar.tsx` / `school-bell-schedule.tsx` legacy pages. They are not currently routed and remain reference material.

---

## 2. Scope decision — three options evaluated

The active calendar UI today is `CalendarStep` inside `AcademicSetupTab.tsx` (mounted at `/settings/schools/:id?tab=academic-setup`). The standalone `school-calendar.tsx` / `school-bell-schedule.tsx` files in `apps/shell/src/pages/settings/` exist but are **NOT** exported from `pages/settings/index.ts` and not referenced from the router — they are legacy reference implementations. So the audit's Q2 "single-date drawer" today lives in the inline `DateEditPanel` inside `AcademicSetupTab.tsx` (lines 1506–1673), not in `school-calendar.tsx`.

### Option A — Calendar Blocks ONLY (~3 days)
- Service + hook + new `BlocksPanel` (in-place section inside `CalendarStep`) with list/create/edit/delete.
- BS date picker reused via `<DateInput>` from `@edforge/ui`.
- The existing `DateEditPanel` (single-date editor in `CalendarStep`) is untouched — operator still sees raw `EVENT_TYPE_COLORS` dropdown (`teacher_only`, `early_release`, etc.).
- Files touched: ~6 (1 service, 1 hook, 1 new panel component, 1 invalidation hook into `useCalendar`, 1 minor edit to `CalendarStep`, 1 Playwright spec).
- Demo-readiness: covers the headline "set up Dashain in one click" demo. Single-day events still feel raw (operator picks `teacher_only` and an audience separately).
- Effort estimate: ~3 dev-days.

### Option B — Blocks + curated single-day dropdown enhancement (RECOMMENDED, ~5 days)
- All of Option A.
- Plus: replace the raw `EVENT_TYPE_OPTIONS` dropdown inside `DateEditPanel` (and the parallel one in the legacy `school-calendar.tsx`) with the curated labelled options from the audit (Holiday / Staff PD / Student Holiday / Early Release — All / Early Release — Students / Early Release — Staff / Make-Up Day / Parent-Teacher Conference / Graduation / School Program / Other).
- Introduce a `singleDayCuratedOptions.ts` mapper that decodes each option into `(eventType, audience?, category?)` and encodes existing CalendarDate records back to the curated option on edit-open. "Other" reveals the raw eventType field as an escape hatch.
- Files touched: ~9 (Option A + mapper module + retrofit `DateEditPanel` + retrofit `school-calendar.tsx` drawer for legacy parity + extended Playwright spec covering one event of each curated option per audit follow-up #2).
- Demo-readiness: covers BOTH multi-day setup AND the "feels like a real product" single-day flow. Saraswati operator never sees the word `audience` unless they pick "Other".
- Effort estimate: ~5 dev-days.

### Option C — Blocks + Q2 + grading-period visual markers (~6.5 days)
- All of B.
- Plus: when the FE renders the inline `CalendarMonthGrid` (and the FullCalendar `dayCellContent` in `SchoolFullCalendar`), it reads `dateEntry.gradingPeriodId` and decorates the cell with a small bracket/pill on grading-period start/end transitions, by joining against the terms list (already loaded by `SessionsStep` / `useAcademicSessions`).
- Files touched: ~12 (Option B + 1 utility to compute term-boundary marker positions + 2 grid renderers updated).
- Demo-readiness: matches the Allen-ISD reference visually; nice-to-have but the audit explicitly flagged it as decorator-only and lowest priority.
- Effort estimate: ~6.5 dev-days.

### ✅ Recommendation: Option B

Rationale:
- Option A leaves jargon (`teacher_only`, `early_release`) in front of operators, which is the audit's Q2 root concern. Pilot operators are non-engineers; ambiguity here will burn 1–2 support tickets in week 1 of the verification loop.
- Option C's grading-period markers are visual-only; they don't gate operator self-service. Punt to a polish sprint after the pilot data lands.
- Option B is the smallest scope that delivers BOTH the audit-confirmed UX bets (Q1 surface, Q2 curated labels) in one PR. Still ships within a single 1-week sprint with buffer.

---

## 3. File-by-file plan (Option B)

### 3.0 PREREQUISITE — shared-types schema fix + contract test
**Path:** `packages/shared-types/src/schemas/identity/calendar-date.schema.ts` (modification)
**Path:** `packages/shared-types/package.json` (version bump 0.50.0 → 0.51.0)
**Path:** `server/application/microservices/identity/src/calendar-dates/__tests__/calendar-date.contract.spec.ts` (new file)
**Consumer pin bumps:** `server/application/package.json`, `server/package.json`, root `package-lock.json`, `edforge-saas-frontend/apps/shell/package.json` (per `edforge_shared_types_caret_pin` memory)

**Why this exists.** The audit found `calendarDateResponseSchema` (lines 174–212) does NOT project four fields that the entity stores: `blockId`, `blockName`, `blockDescriptor`, `subEventName`. Without these, the FE has to make a second `GET /calendar-blocks` query for every grid render to look up block context per date — wasteful and slow. With them, the calendar-grid renderer reads block context directly off the date row.

**The fields are already populated server-side.** Entity `calendar-date.entity.ts:120-133` writes them on every block-create. The bug is purely that the response Zod schema doesn't expose them in the inferred type, so the FE's `CalendarDateResponseDto` has them as `unknown`/missing.

**Schema change:**
```ts
// In calendarDateResponseSchema, alongside the existing fields:
// Multi-day block association (denormalized for read-side rendering)
// Set when the date is the child of a CalendarBlock.
blockId: z.string().uuid().optional(),
blockName: z.string().optional(),
blockDescriptor: calendarBlockDescriptorSchema.optional(),
subEventName: z.string().optional(),
```

**Contract test (drift prevention):**
```ts
// calendar-date.contract.spec.ts — runs in identity's jest suite
import { calendarDateResponseSchema } from '@aibrains/shared-types';
import type { CalendarDate } from '../../common/entities/calendar-date.entity';

describe('CalendarDate entity ↔ schema contract', () => {
  // For each field on the entity, assert it is either:
  //   (a) in calendarDateResponseSchema.shape, OR
  //   (b) explicitly in INTERNAL_ONLY_FIELDS (gsi1pk, gsi1sk, gsi9pk, gsi9sk,
  //       tenantId, entityKey, entityType, version)
  // Fails if a future entity field is added without either inclusion.
  it('every entity field is either projected or explicitly internal-only', () => { ... });
});
```

Same shape applies (as follow-up backlog, not in this PR) for CalendarBlock and other entities — but this PR establishes the pattern for the one entity that's broken now.

**Deploy gotcha:** per the `edforge_shared_types_caret_pin` memory, every consumer pin must bump in lockstep — root + `server/application` + `server/` + AdminWeb (only if AdminWeb imports the schema, which it doesn't yet for this; verify). Skipping a consumer pin means Docker builds resolve the OLD version from npm registry even though local workspace symlinks have the NEW version. That's how PR #59 + #122 broke prod.

### 3.1 API service — new file
**Path:** `edforge-saas-frontend/apps/shell/src/services/calendar-block.service.ts`

**Type:** New file. Symmetric to `bell-schedule.service.ts`.

**Inline JSDoc to add (documents the asymmetric route):**
```ts
/**
 * Calendar Block API client.
 *
 * **Route shape is intentionally asymmetric to bell-schedules.**
 * Calendar blocks are top-level (`/calendar-blocks?schoolId=...`)
 * with `schoolId` as a query param, NOT nested under
 * `/schools/:schoolId/...` like bell-schedules.
 *
 * Reason: a block's natural identity is `(tenantId, blockId)` —
 * schools are a *filter*, not a *parent*. List queries often span
 * multiple schools (org-wide reporting); nesting would force
 * separate calls per school. Bell-schedules ARE per-school by
 * design (different schools run different bell schedules).
 *
 * Do NOT "fix" this asymmetry without coordinating all four
 * touch-points: controller routes + `tenant-api-prod.json` +
 * `nginx.template` + the route-drift linter.
 */
```

This JSDoc lives at the top of the service module. The parallel comment goes in the backend controller at `server/application/microservices/identity/src/calendar-blocks/calendar-block.controller.ts` (single line above the `@Controller('calendar-blocks')` decorator pointing to this doc).

```ts
export async function listCalendarBlocks(
  schoolId: string,
  filter: { academicYearId?: string; blockDescriptor?: BlockDescriptor; from?: string; to?: string; limit?: number; cursor?: string }
): Promise<CalendarBlockListResponseDto>

export async function getCalendarBlock(schoolId: string, blockId: string): Promise<CalendarBlockResponseDto>

export async function createCalendarBlock(data: CreateCalendarBlockDto): Promise<CalendarBlockResponseDto>
// schoolId lives in body for POST per the Zod schema

export async function updateCalendarBlock(schoolId: string, blockId: string, data: UpdateCalendarBlockDto): Promise<CalendarBlockResponseDto>

export async function deleteCalendarBlock(schoolId: string, blockId: string): Promise<{ deletedChildren: number }>

export const calendarBlockService = { listCalendarBlocks, getCalendarBlock, createCalendarBlock, updateCalendarBlock, deleteCalendarBlock }
```

### 3.2 Data hook — new file
**Path:** `edforge-saas-frontend/apps/shell/src/hooks/useCalendarBlocks.ts`

**Type:** New file. Mirrors `useBellSchedules.ts` shape.

**Notable design decisions:**
- Query-key factory `calendarBlockKeys` with `all / list(schoolId, ayId) / detail(schoolId, blockId)`.
- **Critical cache-invalidation rule:** every mutation must invalidate BOTH `calendarBlockKeys.list(...)` AND `calendarKeys.all` (imported from `useCalendar`), because block CRUD writes/deletes child `CalendarDate` rows server-side. Without this the operator creates Dashain, the block list updates, but the grid still shows Mon–Fri as instructional days until a manual refresh. Import the existing `calendarKeys` rather than duplicating keys (don't add a new singleton).
- React Query staleTime: 5 min (matches the rest of the calendar domain).
- Toast messages on success: e.g. `"Created Dashain (9 days)"` using `result.childDateCount`.

```ts
export const calendarBlockKeys = {
  all: ['calendar-blocks'] as const,
  list: (schoolId: string, academicYearId?: string) =>
    [...calendarBlockKeys.all, 'list', schoolId, academicYearId] as const,
  detail: (schoolId: string, blockId: string) =>
    [...calendarBlockKeys.all, 'detail', schoolId, blockId] as const,
}

export function useCalendarBlocks(schoolId: string, academicYearId: string, enabled?: boolean)
export function useCalendarBlock(schoolId: string, blockId: string, enabled?: boolean)
export function useCreateCalendarBlock(schoolId: string) // invalidates list + calendarKeys.all
export function useUpdateCalendarBlock(schoolId: string)
export function useDeleteCalendarBlock(schoolId: string)
```

### 3.3 Curated single-day options mapper — new file
**Path:** `edforge-saas-frontend/apps/shell/src/components/calendar/single-day-curated-options.ts`

**Type:** New file. The single source of truth for the curated dropdown.

**Notable design decisions:**
- Defines an exported `CuratedSingleDayKey` discriminated union with the 11 audit-defined labels.
- Each option maps to `{ eventType, audience?, category?, autoInstructional: boolean }` — the FE never lets the operator type these enum values; they're internal.
- Exports `decodeCalendarEvent(evt: CalendarEventDto): CuratedSingleDayKey` for open-existing-record flow. If the stored `(eventType, audience, category)` triple doesn't match any curated triple, it falls back to `'other'` with the raw enum field exposed.
- Exports `encodeCuratedOption(option, description): CalendarEventDto` for the save flow.
- Co-located so the `AcademicSetupTab` `DateEditPanel` AND the legacy `school-calendar.tsx` drawer can both import — satisfies audit follow-up #2.

```ts
export type CuratedSingleDayKey =
  | 'holiday'
  | 'staff_pd'           // teacher_only, audience absent
  | 'student_holiday'    // student_holiday, audience absent
  | 'early_release_all'  // early_release, audience=all
  | 'early_release_students'
  | 'early_release_staff'
  | 'make_up_day'
  | 'conference_day'
  | 'graduation'
  | 'school_program'
  | 'other'

export interface CuratedOptionMeta {
  key: CuratedSingleDayKey
  label: string
  description: string  // operator-facing helper text
  eventType: CalendarEventDescriptor
  audience?: CalendarEventAudience
  category?: CalendarEventCategory
  autoInstructional: boolean
}

export const CURATED_OPTIONS: CuratedOptionMeta[] = [...]

export function decodeCalendarEvent(evt?: CalendarEventDto): CuratedSingleDayKey
export function encodeCuratedOption(key: CuratedSingleDayKey, description?: string, rawOverride?: CalendarEventDescriptor): CalendarEventDto
```

### 3.4 `BlocksPanel` component — new file
**Path:** `edforge-saas-frontend/apps/shell/src/components/calendar/BlocksPanel.tsx`

**Type:** New file. The CRUD UI lives here so it's reusable from the AcademicSetupTab wizard (and from the legacy page if we ever route it).

**Notable design decisions:**
- One component renders: header + "+ New Block" button + list of existing blocks (grouped by `blockDescriptor`) + inline `BlockDrawer` for create/edit.
- Visual list mirrors the bell-schedule list pattern (`school-bell-schedule.tsx:2320–2354`): one card per block with a 2-line summary, inline date range badge (e.g. "Aug 28 – Sep 5, 2025 · 9 days"), descriptor icon (palm-tree for vacation, candle for religious_festival, scroll for exam_block), edit / delete affordances.
- Empty state: callout mentioning the seeded blocks ("6 vacation blocks pre-loaded from your locale — edit or add your own"). Pulls the locale name from `useLocaleDefaults`.
- Filter chips at top (All / Religious / Vacation / Exam / Observance / Other) bound to `blockDescriptor`.
- For each list item:
  - `blockName` (bold) + chip showing `blockDescriptor`
  - date range in the operator's calendar system (call `adToBS` when `calendarSystem === 'bikram_sambat'`)
  - `childDateCount` ("9 days") + `childEventType` ("Break")
  - Pencil / Trash buttons
- Delete: confirm-modal with explicit copy "This will reset the 9 underlying calendar dates to non-instructional (their per-day overrides will be lost)."

```tsx
interface BlocksPanelProps {
  schoolId: string
  academicYearId: string
  academicYearStartDate: string   // ISO Gregorian, for date-picker min
  academicYearEndDate: string     // ISO Gregorian, for date-picker max
  calendarSystem: 'gregorian' | 'bikram_sambat'
}

export function BlocksPanel(props: BlocksPanelProps): JSX.Element
```

### 3.5 `BlockDrawer` component — new file
**Path:** `edforge-saas-frontend/apps/shell/src/components/calendar/BlockDrawer.tsx`

**Type:** New file. Form for create + edit.

**Notable design decisions:**
- Right-side `Drawer` from `@edforge/ui` (size="lg") matching the `school-calendar.tsx` single-day drawer pattern.
- Fields:
  - Block Name (text, required, max 120)
  - Block Descriptor (dropdown, required: Religious Festival / School Vacation / Exam Block / National Observance / Other)
  - Start Date (`<DateInput calendarSystem={...}>`)
  - End Date (`<DateInput>` with min = startDate)
  - Child Event Type (auto-set by descriptor: `exam_block` → `exam_window`, else `break`; user can override via "advanced" disclosure)
  - Description (textarea, max 500, optional)
  - Sub-events repeater (collapsed by default; "+ Add named sub-event" reveals: date picker constrained to [startDate, endDate], name, description). Max 50 per backend.
- Client-side validation before submit:
  - endDate ≥ startDate
  - dates within [academicYearStartDate, academicYearEndDate] (defense in depth)
  - sub-event dates within block range
- **Edit mode locks startDate + endDate** (per backend semantics — `updateCalendarBlockSchema` doesn't include them; range change = delete + recreate). Show inline note: "To change the date range, delete and recreate this block. Per-day notes will be lost."
- On submit, call `useCreateCalendarBlock` or `useUpdateCalendarBlock`; close drawer on success; toast fires from hook.

```tsx
interface BlockDrawerProps {
  open: boolean
  onClose: () => void
  schoolId: string
  academicYearId: string
  academicYearStartDate: string
  academicYearEndDate: string
  calendarSystem: 'gregorian' | 'bikram_sambat'
  blockToEdit?: CalendarBlockResponseDto | null  // null/undefined = create mode
}
```

### 3.6 `CalendarStep` wiring — modification
**Path:** `edforge-saas-frontend/apps/shell/src/pages/settings/tabs/AcademicSetupTab.tsx`

**Type:** Modification.

**What changes:**
- Add `import { BlocksPanel } from '@/components/calendar/BlocksPanel'`.
- Inside `CalendarStep`, after the existing `CalendarMonthGrid` block (around line 1872), render `<BlocksPanel>` as a new sub-section. Heading "Multi-Day Events" with a passive-info pill noting "{n} blocks · {seedCount} pre-loaded from locale".
- Gate on `calendarExists` — no point in setting up blocks before the calendar exists, and the AY date range needs to be present.
- Replace the existing `DateEditPanel` `<select>` of raw event types (line 1638) with the curated dropdown driven by `single-day-curated-options.ts`. The `onSave` handler now goes through `encodeCuratedOption` so the API payload's `calendarEvents[0]` carries `(eventType, audience, category)`. `decodeCalendarEvent` runs on open so the dropdown shows the right selected option for existing rows.
- When the user picks "Other", reveal the original raw `<select>` from `OPERATOR_SELECTABLE_TYPES` underneath as the escape hatch.

**No new wizard step.** Rationale: blocks are scoped to the existing "Calendar" step (Step 3) — they are still calendar data. Adding a 5th step would visually demote them to "extra" and break the implicit linear flow (years → sessions → calendar → bell). The mental model is "this is part of the calendar step." Matches the `BellScheduleStep` pattern of having both the schedule list AND its periods nested inside step 4.

### 3.7 Legacy `school-calendar.tsx` drawer retrofit — modification
**Path:** `edforge-saas-frontend/apps/shell/src/pages/settings/school-calendar.tsx`

**Type:** Modification (small).

**What changes:**
- The dropdown at line 494-506 (`EVENT_TYPE_OPTIONS.map(...)`) is replaced with the curated dropdown using `single-day-curated-options.ts`.
- Save handler at line 231 uses `encodeCuratedOption` instead of building the payload by hand.

**Why touch a dormant page?** Two reasons: (1) audit follow-up #2 asks for a Playwright spec exercising each curated option's resulting DDB row — running that against the legacy page is fine but exercising the SAME mapper module from both call sites is the cheapest way to keep them in sync; (2) it stays consistent if someone re-routes this page later. Small change, ~30 LOC.

### 3.8 `useCalendar.ts` JSDoc — minor modification
**Path:** `edforge-saas-frontend/apps/shell/src/hooks/useCalendar.ts`

**Type:** Modification (JSDoc only).

**What changes:**
- No new exports. The new `useCalendarBlocks` hook imports `calendarKeys` from this file and invalidates `calendarKeys.all` on block mutations. That's already exported (line 50) — no code change needed.
- Add JSDoc comment near `useUpdateCalendarDate` noting "Block writes invalidate calendarKeys.all; date writes do NOT invalidate calendarBlockKeys (per-day edits don't change the block envelope)."

### 3.9 FullCalendar grid block-render
**Path:** `edforge-saas-frontend/apps/shell/src/components/calendar/SchoolFullCalendar.tsx` + sibling `block-overlay-utils.ts` (new helper)

**Type:** Modification + tiny new helper.

The audit recommends visualizing blocks as "color band / hatched overlay" on the FullCalendar month grid. Two approaches:
1. **Read denormalized fields from CalendarDate** (recommended). Backend writes `blockId / blockName / blockDescriptor` onto each child `CalendarDate` per `calendar-date.entity.ts:120`. So `useFullCalendarEvents` data ALREADY carries everything needed. Add a per-cell side-badge (small label "Dashain" on the first day of a contiguous block run) in `dayCellContent`.
2. Fetch `useCalendarBlocks` separately and project a multi-day FullCalendar event with `allDay: true`. Duplicates data already loaded.

**Plan:** ship approach #1 with a tiny `block-overlay-utils.ts` helper that, given the sorted dateMap, returns the first day of each contiguous block run. ~50 LOC, adds the "Dashain" label visually so operators see their block worked. Keep scope minimal — cell-content text only, no SVG hatching in v1.

⚠ **Risk:** the FE `CalendarDateResponseDto` Zod schema may NOT include `blockId/blockName/blockDescriptor` (see Risk #5 in section 5). Verify during impl; may force a small shared-types bump.

### 3.10 Playwright E2E — new spec
**Path:** `edforge-saas-frontend/e2e/tests/calendar-blocks.spec.ts`

**Type:** New file. Sibling to `nepal-onboarding.spec.ts`. **Playwright**, not Cypress (the repo standardized on Playwright per `e2e/tests/*.spec.ts`).

**Coverage matrix:**
1. **Happy path — create.** Open academic-setup tab → calendar step → "+ New Block" → "Religious Festival" → name "Dashain 2082" → pick startDate + endDate spanning 9 days via BS picker → Submit. Assert: toast "Created Dashain 2082 (9 days)". Assert: block appears in list. Assert: 9 underlying calendar grid cells show the block label.
2. **Happy path — edit.** Click pencil → rename to "Dashain 2082 — extended" → Submit. Assert: list reflects new name + sample calendar date's `blockName` denormalized field reflects it (via API fetch).
3. **Happy path — delete.** Click trash → confirm modal. Assert: list empty. Assert: 9 calendar dates revert (`calendarEvents[0].eventType !== 'break'` for those days).
4. **Curated dropdown — Staff PD.** Open single-date editor on a Wednesday → pick "Staff Professional Development" → save. Assert via API GET: `calendarEvents[0].eventType === 'teacher_only'`. Repeat for "Early Release — Students Only" → `eventType === 'early_release'`, `audience === 'students'`. (Audit follow-up #2 satisfied.)
5. **Validation — endDate < startDate.** Pick startDate, pick endDate before it. Assert submit disabled + inline error renders.
6. **Validation — cross-AY.** Pick startDate outside the AY range. Assert client-blocks or surfaces server 400 in toast.

Run target: assume same `dev-pabson-primary` tenant the backend smoke uses, OR fresh per-run tenant via `request.post`. Confirm with team at sprint start (risk #4).

---

## 4. UX walkthrough (text storyboard)

Operator path: "Set up Dashain on Saraswati's calendar."

1. Operator opens **School Detail → Academic Setup → Calendar** step. 3-step header shows "✓ Years, ✓ Sessions, → Calendar". Calendar already generated (PABSON archetype auto-seeded 6 vacation blocks, 13 holidays, 9 programs). Month grid shows Bhadra 2082 with red holidays and pre-seeded break shading on Dashain dates.
2. Below the grid, a new **"Multi-Day Events"** sub-section appears. Header: "Multi-Day Events · 6 blocks pre-loaded from your locale".
3. Cards list each pre-seeded block: "Dashain (9 days · Religious Festival · Bhadra 12 – Bhadra 20)", "Tihar (5 days)", "Summer Vacation (30 days)" etc. Each has pencil + trash. A "+ New Block" button in section header.
4. Operator decides their Dashain is actually 11 days this year (extended). Clicks trash on the seeded "Dashain" card.
5. Modal: "Delete Dashain block? This will reset the 9 underlying calendar dates to non-instructional. Per-day notes on those dates will be lost." Buttons: Cancel | Delete.
6. Confirms. Toast: "Deleted Dashain. 9 calendar dates were reset." Card disappears. Grid shading softens.
7. Clicks "+ New Block". Right-side drawer slides in: "New Calendar Block".
8. Fields:
   - Name: "Dashain 2082"
   - Descriptor: "Religious Festival"
   - Start Date: clicks BS picker (school's calendarSystem is bikram_sambat). Picker shows Bhadra 2082; picks Bhadra 12. Field displays "Bhadra 12, 2082".
   - End Date: picks Bhadra 22 (11 days inclusive).
   - Description: "Extended Dashain — 11-day break"
   - Sub-events: clicks "+ Add named sub-event". Adds "Mahaastami" → Bhadra 18. Adds "Vijaya Dashami" → Bhadra 20.
9. Hits Save. Drawer spinner. Backend creates 1 block + 11 child CalendarDate rows. Success: drawer closes, toast "Created Dashain 2082 (11 days)".
10. Blocks list now has "Dashain 2082 · 11 days · Religious Festival". Calendar grid has 11 cells shaded break-color with label "Dashain 2082" on the first day of the run.
11. **Error path — date validation.** EndDate before startDate → Save disabled + inline red "End date must be on or after start date".
12. **Error path — outside AY.** StartDate outside AY → drawer shows "Dates must fall within {AY name} ({start} – {end})". Server 400 surfaces as toast.
13. **Single-day curated flow.** Operator clicks a specific Wednesday in the grid. Inline DateEditPanel opens (retrofitted). "Event Type" dropdown shows curated labels.
14. Operator picks "Staff Professional Development". "Instructional Day" toggle auto-flips off. Types description "September Staff Training". Saves. Server PATCH sends `calendarEvents: [{ eventType: 'teacher_only', description: 'September Staff Training', isAllDay: true }]`. Toast.
15. **Conflict edge.** Operator picks a date inside the new Dashain block. DateEditPanel renders curated dropdown but shows a passive info pill: "This date is part of the 'Dashain 2082' block. Saving an override here will keep the block link but customize this single day." Matches backend semantic (per-day overrides survive PATCH).

---

## 5. Risks & open questions

**Updated after architecture reviews — most prior risks resolved.** The remaining items are implementation-detail risks, not architectural unknowns.

1. ~~**BS date picker mechanics**~~ — ✅ RESOLVED in §0.2. Confirmed industry-standard. Folded R2 (JSDoc) into this PR; R1/R3/R4/R5 are a follow-up sprint.

2. **React Query invalidation surface — implementation detail.** Block mutations MUST invalidate `calendarKeys.dates(schoolId)` (declared in `useCalendar.ts:54`). The new hook will import `calendarKeys` and invalidate. Stats endpoint also needs invalidation. Plan: invalidate `calendarKeys.all` (umbrella) on block writes — same approach `useGenerateCalendar` takes (`useCalendar.ts:192`).

3. **Module Federation singleton scope.** No new cross-MFE state introduced — new hook lives entirely inside `apps/shell`. Shared React Query client is already a singleton via `@tanstack/react-query` in `mf-shared.ts:34`. **No new `mf-shared` entry required.** Verify during impl that new service module isn't accidentally imported from `apps/academics` or `apps/people`; if so, move to `packages/`.

4. ~~**Playwright run target**~~ — ✅ RESOLVED in §0.4. CI hits `dev-pabson-primary` directly. Follow `nepal-onboarding.spec.ts` pattern: `beforeAll` bootstraps AY via API; teardown cleans up.

5. ~~**Block-on-grid render — possible shared-types bump**~~ — ✅ RESOLVED in §0.3. The bump IS happening, scoped as §3.0 prerequisite (4 fields added to `calendarDateResponseSchema`, contract test for drift prevention, all consumer pins bumped).

6. **Curated option for "Holiday" overlap with seeded data.** PABSON archetype seeds 13 single-day holidays. When operator opens one (e.g., "Saraswati Puja"), curated dropdown should decode as "Holiday" — not "Other". `decodeCalendarEvent` handles this. Implementation risk: if pre-seeded events carry a `category` field but curated meta doesn't, decode falls through to "Other". Spec the mapper with the vocabulary-audit's expected categories so seed-overlap is clean.

7. **Sub-events UX scope.** Backend allows up to 50 sub-events per block. PABSON Dashain has ~3 named days. In v1 drawer's sub-event repeater is functional but minimal — no inline date pickers per row using BS; just date inputs constrained client-side to block range. Defer "named sub-event grid badges on calendar" to polish sprint.

8. **Two stale files** (`school-calendar.tsx`, `school-bell-schedule.tsx`) **not routed.** Sprint touches them for parity per audit follow-up #2. If team wants to delete them in this sprint, separate decision — recommend leaving alone (delete risk > benefit during pilot prep).

9. **Concurrent edits during block create.** If operator A is editing a single calendar date in the DateEditPanel while operator B creates a block covering that date, the backend's existing C4-followup-2 logic handles it: `BLOCK_CONFLICTS_OPERATOR_DATES` 409 if the partition preflight finds operator-edited rows. The drawer should surface that error with the conflicting-dates list rendered as a hint ("the following dates have operator edits: 2026-10-19"). Plan: standard React Query mutation error handler renders the error toast + the drawer stays open with the explicit message.

---

## 6. Estimated effort

| Area | Hours |
|---|---|
| **§3.0 PREREQUISITE: shared-types schema bump + contract test + consumer pin bumps** | **3** |
| `calendar-block.service.ts` + asymmetric-route JSDoc (3.1) | 1.5 |
| `useCalendarBlocks.ts` (3.2) | 1.5 |
| `single-day-curated-options.ts` + unit tests (3.3) | 2.5 |
| `BlocksPanel.tsx` (3.4) | 4 |
| `BlockDrawer.tsx` + BS picker integration + sub-event repeater + validation (3.5) | 5 |
| `CalendarStep` integration in `AcademicSetupTab.tsx` (3.6) | 2 |
| Legacy `school-calendar.tsx` drawer retrofit (3.7) | 1 |
| `useCalendar.ts` JSDoc (3.8) | 0.25 |
| Grid block-overlay `block-overlay-utils.ts` + integration (3.9) | 3.5 |
| Playwright spec against `dev-pabson-primary` (3.10) | 4 |
| Vitest unit tests on mapper + hook invalidation logic + event-types sync | 2.5 |
| **BS picker R2 JSDoc add** (audit-confirmed in-scope) | 0.5 |
| Manual smoke vs `dev-pabson-primary` + bug-fix buffer | 4 |
| Code review feedback loop | 2 |
| **Total** | **~37 hours / ~5–6 dev-days** |

Quality-first; no calendar-week pressure per user directive. The §3.0 prerequisite adds ~3h but eliminates the latent "FE can't render block context" bug class entirely + establishes the contract-test pattern for other entities.

---

## 7. Test plan (post-implementation)

### Unit tests (Vitest)
- `single-day-curated-options.test.ts`:
  - Every `CURATED_OPTIONS` entry round-trips: `decodeCalendarEvent(encodeCuratedOption(key))` === key.
  - Unknown `(eventType, audience)` triple decodes to `'other'`.
  - "Holiday" decode handles both `category: 'religious'` and no-category cases.
  - Each pre-seeded PABSON holiday in `pabson-npl-2083.json` decodes to a curated key (not `'other'`).
- `useCalendarBlocks.test.ts` (mocked service):
  - Create mutation invalidates `calendarBlockKeys.list` AND `calendarKeys.all`.
  - Delete mutation invalidates both.
  - Toast fires on success with `result.childDateCount`.
- **`event-types-sync.test.ts` (new, drift prevention)** — formalize the FE-local `CalendarEventType` union vs shared-types `calendarEventDescriptorSchema` invariant:
  - Assert every value in `event-types.ts` `CalendarEventType` appears in the schema enum.
  - Assert every schema enum value appears in `CalendarEventType`.
  - Fails if either side adds a value without updating the other.

### Jest (backend) — contract test for drift prevention
- **`calendar-date.contract.spec.ts`** (per §3.0) — formalizes the entity-vs-schema contract:
  - Every field on the `CalendarDate` entity (computed from TS type via reflection or static list) is either projected by `calendarDateResponseSchema` OR explicitly excluded in an `INTERNAL_ONLY_FIELDS` set (`gsi1pk`, `gsi1sk`, `gsi9pk`, `gsi9sk`, `tenantId`, `entityKey`, `entityType`, `version`).
  - Fails on next entity field add unless the schema is updated OR the field is added to the internal-only allowlist.

### Playwright E2E
- The 6 scenarios in §3.10 plus `beforeAll` bootstrapping an AY for the test tenant.
- Tag-marker: `@calendar-blocks` so CI can run only this spec in PR mode.

### Manual smoke vs `dev-pabson-primary`
A 9-test manual smoke driven from the UI:
1. Generate calendar (pre-existing).
2. Open Calendar step. Confirm 6 pre-seeded blocks render.
3. Create new block "Smoke Holi" (4 days). Confirm grid + list + child date count.
4. Edit the block. Rename. Confirm.
5. Curated dropdown — pick "Staff PD" on weekday. Confirm via curl: DDB row carries `eventType: 'teacher_only'`.
6. Curated dropdown — pick "Early Release — Students Only". Confirm `audience: 'students'`.
7. Delete a seeded vacation block. Confirm cascade — both list and grid update.
8. Open date INSIDE existing block. Confirm conflict pill in edit panel.
9. End-to-end: open BS-mode school, confirm all date displays use BS conversion.

### "Demo-ready" definition
- All 6 Playwright cases pass in CI.
- All 9 manual smokes pass against `dev-pabson-primary`.
- Vercel preview from feature branch loads `/settings/schools/:id?tab=academic-setup` without console errors.
- Legacy `school-calendar.tsx` still type-checks.
- No regression: existing single-date edits still work ("Other" escape hatch covers historical rows).
- Verbal walkthrough script from §4 completes in under 4 minutes during live demo.

---

## 8. Deploy plan

Sprint is **mostly** frontend-additive, with one in-scope shared-types schema bump (§3.0). No backend service-logic changes; no infra; no IAM; no CDK.

**Shared-types publish — CONFIRMED in scope.**
- Bump `@aibrains/shared-types` `0.50.0` → `0.51.0`.
- Add 4 fields to `calendarDateResponseSchema` (per §3.0): `blockId / blockName / blockDescriptor / subEventName`.
- Run `npm publish` from `packages/shared-types/` (2FA prompt).
- Verify registry: `npm view @aibrains/shared-types version` returns `0.51.0`.
- **Caret-pin bump in all consumers in the SAME PR** per `edforge_shared_types_caret_pin` memory:
  - `server/application/package.json`
  - `server/package.json`
  - `edforge-saas-frontend/apps/shell/package.json` (since the FE will consume the new fields)
  - root `package-lock.json` refresh via `npm install`
- AdminWeb pin: verify whether AdminWeb consumes `calendarDateResponseSchema`. If yes, bump there too (forces a `controlplane-stack` redeploy and a jsdom bundle-sim per CLAUDE.md). If no, leave AdminWeb pin alone.
- Identity service does NOT need redeploy — the entity already populates these fields; the schema bump is type-only on the response. Confirm this by inspecting the actual API response with curl: `GET /schools/:id/calendar-dates` — if `blockId` is present in the JSON for a block child date, no redeploy needed. If not (serializer drops unknown fields), redeploy identity.

**Vercel deploy.** PR merge to `main` auto-deploys `apps/shell`. No CDK / ECR involvement. Shell-host bundle changes; academics / people / finance MFE bundles do not.

**Backend smoke after merge.** Backend `/calendar-blocks` routes already validated in prod (commit `3beb8d9`). FE deployment cannot regress backend behavior. Still run a single curl-based 1-smoke against `dev-pabson-primary` post-deploy: `GET /calendar-blocks?schoolId=...&academicYearId=...` → confirm 200 + non-empty list (verifies API client hits right path + auth header passes through).

**Rollback.** If critical bug surfaces post-deploy, revert PR. Changes are additive (no DB writes triggered just by loading UI), rollback is no-data-loss. Seeded blocks remain in DDB; operator just loses UI to manage them temporarily.

**Pilot greenlight gating.** Per staged plan, after this sprint merges:
1. Saraswati pilot operator does live calendar setup using new UI (engineer-on-call but not engineer-driven).
2. Activate AY.
3. IEMIS XLSX import (separate sprint).
4. 2–3 week verification loop.

---

## Critical files for implementation reference

- `edforge-saas-frontend/apps/shell/src/pages/settings/tabs/AcademicSetupTab.tsx` — the active calendar UI (~2200 lines)
- `edforge-saas-frontend/apps/shell/src/hooks/useCalendar.ts` — existing data hook patterns + `calendarKeys` query-key factory
- `edforge-saas-frontend/apps/shell/src/components/calendar/event-types.ts` — existing raw event-type definitions (will be partially replaced)
- `packages/shared-types/src/schemas/identity/calendar-block.schema.ts` — request/response Zod shapes
- `edforge-saas-frontend/packages/ui/src/components/BsDatePicker.tsx` — BS date input (reuse, don't reinvent)
- `edforge-saas-frontend/apps/shell/src/services/bell-schedule.service.ts` — symmetric service to mirror
- `edforge-saas-frontend/apps/shell/src/hooks/useBellSchedules.ts` — symmetric hook to mirror

---

## Open questions for product / staff-eng review before implementation

**All 4 prior questions resolved (see §0).** Remaining decisions are implementation-time only:

1. ~~Option B scope~~ — ✅ CONFIRMED (§0.5).
2. ~~Shared-types bump~~ — ✅ CONFIRMED in scope as §3.0 prerequisite (§0.3).
3. ~~Playwright run target~~ — ✅ CONFIRMED dev-pabson-primary direct (§0.4).
4. ~~Wizard placement~~ — ✅ CONFIRMED inside Step 3 (§0.5).

**Implementation-time decisions (defer until coding):**
- **Identity service redeploy needed?** Determined by whether the existing serializer drops unknown fields. Verify via curl against prod once §3.0 schema lands. If no redeploy needed, the C4-FE PR ships as a pure-FE deploy. If yes, this becomes a 2-step deploy: identity ECR roll first, then frontend.
- **AdminWeb pin bump?** Determined by whether AdminWeb imports `calendarDateResponseSchema`. Grep `client/AdminWeb/src/` during impl. If no consumption, skip the AdminWeb pin (saves a `controlplane-stack` redeploy + jsdom bundle-sim).

## Related follow-up backlog (NOT in this PR)

Tracked here so they don't get lost. None are pilot-blocking.

1. **BS date handling hygiene PR** (audit refinements R1, R3, R4, R5):
   - Branded types (`GregorianDateString`, `BsDateString`)
   - Replace silent `catch` in BsDatePicker with `console.warn`
   - Add boundary tests for BS 2090 last-year + Chaitra 30 → Baishakh 1
   - Refinement on `generateCalendarSchema` for dual AD/BS consistency
   - ~4.5h total

2. **COUNTRY_DEFAULTS / ARCHETYPE_DEFAULTS sync guard PR** (shared-types audit item):
   - Extend the existing `tenant-seeder-lambda.spec.ts` guard to cover AdminWeb + the workspace-settings entity (currently only Lambda + entity covered out of 4 consumers).
   - Considering Option A (CDK-synth JSON injection to eliminate the duplication entirely) vs Option B (status quo + better guards) — Option B is the minimum viable; Option A is the right long-term answer.
   - ~2h for Option B, ~8h for Option A.

3. **Entity-vs-schema contract test pattern** for other entities (extend §3.0's pattern):
   - Apply same `XYZ.contract.spec.ts` pattern to other identity entities (Staff, Student, AcademicYear, Term, BellSchedule, CalendarBlock).
   - ~8h total.

4. **Option C grading-period markers** if product wants them later (~1.5 days incremental on top of C4-FE).
