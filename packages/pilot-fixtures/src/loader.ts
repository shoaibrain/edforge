/**
 * Pilot fixture loader — Sprint C1.7.
 *
 * The parametric query engine over the pilot-fixtures data tree. After
 * C1.0–C1.6 landed the data (metadata + 12 calendar files + bell schedule +
 * academic structure + holidays + programs), this module pulls everything
 * into one typed bundle and exposes the read queries the C2 greenlight gate
 * and downstream sprints (C5/C6/C7/C9) will rely on.
 *
 * Single-load contract: `loadPilotFixture(pilotId)` reads every fixture
 * file from disk in one pass, validates each against its C1.1/1.3/1.4/1.5/1.6
 * schema (loud failure on any drift), and returns the typed bundle.
 *
 * Pilot-agnostic. Engine code knows zero pilots — `pilotId` is always a
 * runtime argument.
 *
 * Timezone-safety: day-of-week derivation uses `bsToGregorian` from
 * `@aibrains/shared-types` and parses the AD output with `T12:00:00`
 * appended (the C0.a.3 pattern). This avoids the separate `gregorianToBs`
 * TZ fragility tracked in deferred-work.md — by anchoring at local noon,
 * the parsed Date stays inside the same calendar day in every real
 * timezone, so `.getDay()` returns the correct weekday.
 */

import * as fs from 'fs';
import * as path from 'path';

import Ajv2020 from 'ajv';
import { bsToGregorian, getBsMonthDays } from '@aibrains/shared-types';

import { loadPilot as loadPilotMetadata } from './pilot-registry';
import {
  PilotMetadataInvalidError,
  WEEKDAY_TOKENS,
  type PilotMetadata,
  type WeekdayToken,
} from './types';

// ============================================================================
// Types (the public surface of the loader bundle)
// ============================================================================

export type HolidayCategory = 'national' | 'religious' | 'school_specific';
export type ProgramCategory = 'school_specific' | 'academic';
export type ShiftScope = 'academic' | 'non-academic';
export type PeriodKind = 'class' | 'break' | 'exam_block' | 'assembly' | 'other';
export type ExamType = 'formative' | 'mid_term' | 'terminal' | 'quiz' | 'other';
export type EventType =
  | 'holiday'
  | 'program'
  | 'exam_window'
  | 'term_boundary'
  | 'ay_boundary'
  | 'school_event';

export interface CalendarEvent {
  bsDate: string;
  eventType: EventType;
  eventName: string;
  metadata?: {
    category?: string;
    blockId?: string;
    termId?: string;
    boundary?: 'start' | 'end';
    sourceTermId?: string;
    nextAyId?: string;
  };
}

export interface CalendarMonth {
  month: string;
  events: CalendarEvent[];
  notes?: string;
}

export interface Period {
  id: string;
  name?: string;
  startTime: string;
  endTime: string;
  kind?: PeriodKind;
}

export interface Shift {
  id: string;
  name: string;
  scope: ShiftScope;
  startTime: string;
  endTime: string;
  periods?: Period[];
}

export interface BellSchedule {
  shifts: Shift[];
  examDayShifts?: Shift[];
  notes?: string;
}

export interface ExamWindow {
  id: string;
  name?: string;
  examType: ExamType;
  startBsDate: string;
  endBsDate: string;
}

export interface Term {
  id: string;
  name: string;
  startBsDate: string;
  endBsDate: string;
  examWindow: ExamWindow;
}

export interface AcademicStructure {
  academicYearId: string;
  name: string;
  calendarSystem: 'gregorian' | 'bikram_sambat';
  startBsDate: string;
  endBsDate: string;
  terms: Term[];
  crossYearMarkers: {
    nextAcademicYearId: string;
    resultPublishBsDate: string;
    newSessionBeginBsDate: string;
    provisionalWindow: { startBsDate: string; endBsDate: string };
  };
  notes?: string;
}

export interface HolidayBlock {
  id: string;
  name: string;
  category: HolidayCategory;
  startBsDate: string;
  endBsDate: string;
  source?: string;
}

export interface SingleDayHoliday {
  bsDate: string;
  name: string;
  category: HolidayCategory;
  source?: string;
}

export interface HolidaysConsolidated {
  academicYearId: string;
  blocks: HolidayBlock[];
  singleDayHolidays: SingleDayHoliday[];
  notes?: string;
}

export interface Program {
  id: string;
  name: string;
  category: ProgramCategory;
  startBsDate: string;
  endBsDate: string;
  sourceTermId?: string;
  subcategory?: string;
}

export interface Programs {
  academicYearId: string;
  programs: Program[];
  notes?: string;
}

/**
 * The full pilot fixture bundle. Returned by `loadPilotFixture(pilotId)`.
 *
 * `metadata` carries the registry-level facts (archetype, country, etc.).
 * `calendar` is keyed by BS month slug ('baisakh' through 'chait').
 */
export interface PilotFixture {
  metadata: PilotMetadata;
  calendar: Record<string, CalendarMonth>;
  bellSchedule: BellSchedule;
  academicStructure: AcademicStructure;
  holidaysConsolidated: HolidaysConsolidated;
  programs: Programs;
}

/** Per-day entry produced by the `expand*` helpers. */
export interface ExpandedBlockDay {
  bsDate: string;
  blockId: string;
  blockName: string;
  category: HolidayCategory;
}

export interface ExpandedHolidayDay {
  bsDate: string;
  name: string;
  category: HolidayCategory;
  /** `blockId` is undefined for single-day holidays. */
  blockId?: string;
}

export interface ExpandedProgramDay {
  bsDate: string;
  programId: string;
  programName: string;
  category: ProgramCategory;
  sourceTermId?: string;
}

/**
 * Output of `shiftProfileForDate`. The `classification` lets callers
 * distinguish *why* a day is non-instructional (so the UI can render
 * "weekend" vs "holiday" differently).
 */
export type DayClassification =
  | 'regular' // standard school day; `shifts` = bellSchedule.shifts
  | 'exam_day' // has at least one exam_window event; `shifts` = bellSchedule.examDayShifts ?? shifts
  | 'holiday' // holiday block day or single-day holiday
  | 'weekend' // weekday is NOT in metadata.schoolDays
  | 'vacation'; // school-specific block (summer/winter vacation); a sub-case of `holiday` semantically but distinguished for UI

export interface ShiftProfile {
  classification: DayClassification;
  /** Empty for non-instructional days. */
  shifts: Shift[];
  /** Single label describing why, suitable for UI tooltips. */
  reason?: string;
}

// ============================================================================
// File I/O + schema validation
// ============================================================================

const PACKAGE_ROOT = path.resolve(__dirname, '..');
/**
 * Schemas live at `<package>/src/schema/*.json` regardless of whether
 * the loader is consumed from `src/` (ts-jest, ts-node) or `dist/`
 * (the `main` export). `tsc` does NOT copy JSON files into `dist/`, so
 * resolving via `__dirname/schema` works for the in-package tests but
 * breaks when downstream consumers import via `@edforge/pilot-fixtures`
 * → `dist/index.js`. Pinning to `<PACKAGE_ROOT>/src/schema` is robust
 * for both cases because the workspace symlink keeps `src/` next to
 * `dist/` for downstream consumers.
 */
const SCHEMA_DIR = path.resolve(PACKAGE_ROOT, 'src', 'schema');

const MONTH_SLUGS = [
  'baisakh', 'jeth', 'asar', 'saun', 'bhadau', 'asoj',
  'kartik', 'mangsir', 'pus', 'magh', 'fagun', 'chait',
] as const;

function loadJsonFile<T>(p: string): T {
  if (!fs.existsSync(p)) {
    throw new Error(`pilot-fixtures: file not found at ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

function compileSchema(schemaPath: string) {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const schema = loadJsonFile<object>(schemaPath);
  return ajv.compile(schema);
}

/**
 * Validates `data` against the schema at `schemaPath`. Throws
 * `PilotMetadataInvalidError` (re-used because the error class already
 * carries `code` and `issues`) on failure with a structured detail.
 *
 * The fixture is the single source of truth — if a fixture is malformed,
 * we want a loud, structured failure at load time, not silent acceptance.
 */
function validateAgainstSchema(
  pilotId: string,
  data: unknown,
  schemaPath: string,
  fixtureName: string,
): void {
  const validate = compileSchema(schemaPath);
  if (!validate(data)) {
    const issues = (validate.errors ?? []).map((e) => ({
      code: 'custom' as const,
      message: `${fixtureName}: ${e.instancePath} ${e.message ?? 'invalid'}`,
      path: e.instancePath.split('/').filter(Boolean),
    }));
    throw new PilotMetadataInvalidError(pilotId, issues);
  }
}

// ============================================================================
// loadPilotFixture — single-call full bundle loader
// ============================================================================

/**
 * Load the full fixture bundle for a pilot. Reads every fixture file
 * from disk, validates each against its C1.1/1.3/1.4/1.5/1.6 schema,
 * and returns the typed bundle. Throws `PilotMetadataInvalidError` on
 * any schema violation.
 *
 * Does NOT cache — every call re-reads from disk. Fixtures are small
 * (a few KB total per pilot); caching is the caller's responsibility
 * if needed.
 *
 * @param pilotId — the kebab-case pilot slug from the fixture directory name
 * @returns the full PilotFixture
 * @throws PilotNotFoundError if the pilot's metadata.json is missing
 * @throws PilotMetadataInvalidError if any fixture file fails schema validation
 */
export function loadPilotFixture(pilotId: string): PilotFixture {
  // Reuse the C1.0 registry's metadata loader. This also validates
  // metadata.json against its schema + throws PilotNotFoundError for
  // unknown ids.
  const metadata = loadPilotMetadata(pilotId);

  const pilotDir = path.resolve(PACKAGE_ROOT, 'pilots', pilotId);

  // Calendar — 12 monthly files. Each validated against C1.1 schema.
  const calendarSchema = path.resolve(SCHEMA_DIR, 'calendar-fixture.schema.json');
  const calendar: Record<string, CalendarMonth> = {};
  for (const month of MONTH_SLUGS) {
    const monthPath = path.resolve(pilotDir, 'calendar', `${month}.json`);
    const data = loadJsonFile<CalendarMonth>(monthPath);
    validateAgainstSchema(pilotId, data, calendarSchema, `calendar/${month}.json`);
    calendar[month] = data;
  }

  // Bell schedule
  const bellPath = path.resolve(pilotDir, 'bell-schedule.json');
  const bellSchema = path.resolve(SCHEMA_DIR, 'bell-schedule.schema.json');
  const bellSchedule = loadJsonFile<BellSchedule>(bellPath);
  validateAgainstSchema(pilotId, bellSchedule, bellSchema, 'bell-schedule.json');

  // Academic structure
  const structPath = path.resolve(pilotDir, 'academic-structure.json');
  const structSchema = path.resolve(SCHEMA_DIR, 'academic-structure.schema.json');
  const academicStructure = loadJsonFile<AcademicStructure>(structPath);
  validateAgainstSchema(pilotId, academicStructure, structSchema, 'academic-structure.json');

  // Holidays consolidated
  const holsPath = path.resolve(pilotDir, 'holidays-consolidated.json');
  const holsSchema = path.resolve(SCHEMA_DIR, 'holidays-consolidated.schema.json');
  const holidaysConsolidated = loadJsonFile<HolidaysConsolidated>(holsPath);
  validateAgainstSchema(pilotId, holidaysConsolidated, holsSchema, 'holidays-consolidated.json');

  // Programs
  const progsPath = path.resolve(pilotDir, 'programs.json');
  const progsSchema = path.resolve(SCHEMA_DIR, 'programs.schema.json');
  const programs = loadJsonFile<Programs>(progsPath);
  validateAgainstSchema(pilotId, programs, progsSchema, 'programs.json');

  return { metadata, calendar, bellSchedule, academicStructure, holidaysConsolidated, programs };
}

// ============================================================================
// Date helpers (BS-aware, TZ-safe)
// ============================================================================

interface BsDateParts {
  year: number;
  month: number;
  day: number;
}

function parseBs(s: string): BsDateParts {
  const [y, m, d] = s.split('/').map(Number);
  return { year: y, month: m, day: d };
}

function formatBs(parts: BsDateParts): string {
  return `${parts.year}/${String(parts.month).padStart(2, '0')}/${String(parts.day).padStart(2, '0')}`;
}

/** Lexicographic compare. -1 if a<b, 0 if equal, 1 if a>b. */
function cmpBs(a: string, b: string): number {
  const pa = parseBs(a);
  const pb = parseBs(b);
  if (pa.year !== pb.year) return pa.year < pb.year ? -1 : 1;
  if (pa.month !== pb.month) return pa.month < pb.month ? -1 : 1;
  if (pa.day !== pb.day) return pa.day < pb.day ? -1 : 1;
  return 0;
}

/** Inclusive list of BS dates from start to end. Same-year only. */
function expandRange(startBs: string, endBs: string): string[] {
  const s = parseBs(startBs);
  const e = parseBs(endBs);
  if (s.year !== e.year) {
    throw new Error(`expandRange cross-year not supported: ${startBs} → ${endBs}`);
  }
  const out: string[] = [];
  let { month, day } = s;
  while (true) {
    out.push(formatBs({ year: s.year, month, day }));
    if (month === e.month && day === e.day) break;
    day++;
    if (day > getBsMonthDays(s.year, month)) {
      month++;
      day = 1;
    }
  }
  return out;
}

/**
 * BS day-of-week. Returns the WEEKDAY_TOKEN ('sun' .. 'sat') for the
 * given BS calendar date.
 *
 * Implementation: converts BS → AD via shared-types, then parses the
 * AD date string with `T12:00:00` appended so the resulting Date is
 * local-noon — far from any midnight TZ-shift edge. `getDay()` then
 * returns the calendar weekday reliably in every real timezone. This
 * is the same pattern C0.a.3 used to wrap `gregorianToBs` in the
 * frontend converter.
 */
export function bsDayOfWeek(year: number, month: number, day: number): WeekdayToken {
  const adIso = bsToGregorian(year, month, day);
  const adNoon = new Date(`${adIso}T12:00:00`);
  const idx = adNoon.getDay();
  return WEEKDAY_TOKENS[idx];
}

// ============================================================================
// Expand queries
// ============================================================================

/**
 * Expand every multi-day holiday block to per-day entries. Single-day
 * holidays are NOT included — see `expandHolidays` for the combined view.
 *
 * Sorted by bsDate ascending.
 */
export function expandBlocks(fixture: PilotFixture): ExpandedBlockDay[] {
  const out: ExpandedBlockDay[] = [];
  for (const block of fixture.holidaysConsolidated.blocks) {
    for (const bsDate of expandRange(block.startBsDate, block.endBsDate)) {
      out.push({
        bsDate,
        blockId: block.id,
        blockName: block.name,
        category: block.category,
      });
    }
  }
  return out.sort((a, b) => cmpBs(a.bsDate, b.bsDate));
}

/**
 * Combined view: every holiday day in the AY. Includes both multi-day
 * block days (with `blockId`) and standalone single-day holidays (no
 * `blockId`). Sorted by bsDate ascending.
 *
 * Total day count = sum of block lengths + count of single-day holidays.
 * For the first pilot: 36 + 13 = 49 holiday-days.
 */
export function expandHolidays(fixture: PilotFixture): ExpandedHolidayDay[] {
  const out: ExpandedHolidayDay[] = [];

  // Block-day expansion
  for (const block of fixture.holidaysConsolidated.blocks) {
    for (const bsDate of expandRange(block.startBsDate, block.endBsDate)) {
      out.push({
        bsDate,
        name: block.name,
        category: block.category,
        blockId: block.id,
      });
    }
  }

  // Single-day holidays — no blockId by definition
  for (const sd of fixture.holidaysConsolidated.singleDayHolidays) {
    out.push({
      bsDate: sd.bsDate,
      name: sd.name,
      category: sd.category,
    });
  }

  return out.sort((a, b) => cmpBs(a.bsDate, b.bsDate));
}

/**
 * Expand every program to per-day entries. Multi-day programs
 * (e.g., Saraswati Puja Magh 28-29) appear as N entries with the same
 * `programId`. Sorted by bsDate ascending.
 */
export function expandPrograms(fixture: PilotFixture): ExpandedProgramDay[] {
  const out: ExpandedProgramDay[] = [];
  for (const prog of fixture.programs.programs) {
    for (const bsDate of expandRange(prog.startBsDate, prog.endBsDate)) {
      out.push({
        bsDate,
        programId: prog.id,
        programName: prog.name,
        category: prog.category,
        sourceTermId: prog.sourceTermId,
      });
    }
  }
  return out.sort((a, b) => cmpBs(a.bsDate, b.bsDate));
}

// ============================================================================
// Point queries
// ============================================================================

/**
 * Every event in the calendar (across all 12 monthly files) that
 * falls on the given bsDate.
 *
 * Multi-event days are supported — for the first pilot, Asoj 25 returns
 * `[Ghatasthapana (holiday), Term 2 Exam — Day 4 (exam_window)]`.
 * Order: as declared in the monthly file.
 *
 * Returns an empty array for dates with no events. Callers should NOT
 * treat empty as "instructional" — use `shiftProfileForDate` for that.
 */
export function eventsOnDate(fixture: PilotFixture, bsDate: string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const month of MONTH_SLUGS) {
    const monthDoc = fixture.calendar[month];
    if (!monthDoc) continue;
    for (const ev of monthDoc.events) {
      if (ev.bsDate === bsDate) out.push(ev);
    }
  }
  return out;
}

/**
 * Count of instructional days in the inclusive BS range `[startBs, endBs]`.
 *
 * An instructional day must be:
 *   1. A weekday in the pilot's `schoolDays` config (sun..sat tokens).
 *   2. NOT a holiday block day (Dashain, Tihar, etc.).
 *   3. NOT a single-day holiday (Buddha Jayanti, etc.).
 *   4. NOT a school-specific vacation day (Summer/Winter Vacation —
 *      these are blocks too; included via #2).
 *
 * Exam-window days ARE instructional (per C2.4 — attendance is recorded
 * during exam windows). The exam-day variant of the bell schedule
 * applies on those days.
 *
 * Same-year ranges only (current implementation). Cross-year handoff is
 * the C9 sprint's concern; this helper covers the within-AY queries
 * the C2.1 read-path test exercises.
 *
 * @param fixture — pilot fixture bundle
 * @param startBs — inclusive start BS date
 * @param endBs — inclusive end BS date
 * @param schoolDays — optional override; defaults to fixture.metadata.schoolDays
 */
export function instructionalDaysInRange(
  fixture: PilotFixture,
  startBs: string,
  endBs: string,
  schoolDays?: readonly WeekdayToken[],
): number {
  if (cmpBs(startBs, endBs) > 0) {
    throw new Error(`instructionalDaysInRange: start > end (${startBs} → ${endBs})`);
  }
  const allowedDays = new Set<WeekdayToken>(
    schoolDays ?? fixture.metadata.schoolDays,
  );

  // Build holiday-day set once for O(1) lookup.
  const holidayDays = new Set<string>();
  for (const h of expandHolidays(fixture)) {
    holidayDays.add(h.bsDate);
  }

  const allDays = expandRange(startBs, endBs);
  let count = 0;
  for (const bsDate of allDays) {
    if (holidayDays.has(bsDate)) continue;
    const { year, month, day } = parseBs(bsDate);
    const dow = bsDayOfWeek(year, month, day);
    if (!allowedDays.has(dow)) continue;
    count++;
  }
  return count;
}

/**
 * Bell-schedule profile for a given BS date.
 *
 * Resolution order:
 *   1. Weekend (date's weekday not in `schoolDays`) → classification='weekend', shifts=[]
 *   2. Vacation block (school_specific holiday block) → classification='vacation', shifts=[]
 *   3. Any other holiday → classification='holiday', shifts=[]
 *   4. Exam-window event present → classification='exam_day', shifts=examDayShifts ?? regular
 *   5. Otherwise → classification='regular', shifts=regular
 *
 * Non-academic shifts (e.g., the boarder morning routine) are filtered
 * out of the returned `shifts` array on non-instructional days; on
 * instructional days they remain because they're legitimately scheduled.
 */
export function shiftProfileForDate(fixture: PilotFixture, bsDate: string): ShiftProfile {
  const { year, month, day } = parseBs(bsDate);
  const dow = bsDayOfWeek(year, month, day);
  const schoolDaysSet = new Set<WeekdayToken>(fixture.metadata.schoolDays);

  // 1. Weekend
  if (!schoolDaysSet.has(dow)) {
    return {
      classification: 'weekend',
      shifts: [],
      reason: `Not a school day (${dow})`,
    };
  }

  // 2/3. Holiday or vacation block — find the matching entry, if any
  const blockMatch = fixture.holidaysConsolidated.blocks.find(
    (b) => cmpBs(bsDate, b.startBsDate) >= 0 && cmpBs(bsDate, b.endBsDate) <= 0,
  );
  if (blockMatch) {
    return {
      classification: blockMatch.category === 'school_specific' ? 'vacation' : 'holiday',
      shifts: [],
      reason: blockMatch.name,
    };
  }
  const singleDayHoliday = fixture.holidaysConsolidated.singleDayHolidays.find(
    (sd) => sd.bsDate === bsDate,
  );
  if (singleDayHoliday) {
    return {
      classification: 'holiday',
      shifts: [],
      reason: singleDayHoliday.name,
    };
  }

  // 4. Exam window
  const dayEvents = eventsOnDate(fixture, bsDate);
  const hasExam = dayEvents.some((e) => e.eventType === 'exam_window');
  if (hasExam) {
    const examShifts =
      fixture.bellSchedule.examDayShifts && fixture.bellSchedule.examDayShifts.length > 0
        ? fixture.bellSchedule.examDayShifts
        : fixture.bellSchedule.shifts;
    return {
      classification: 'exam_day',
      shifts: examShifts,
      reason: 'Exam window in effect',
    };
  }

  // 5. Regular
  return {
    classification: 'regular',
    shifts: fixture.bellSchedule.shifts,
  };
}
