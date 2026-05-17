/**
 * Archetype-aware bell-schedule presets — Sprint C3.4 + C3.5.
 *
 * Each archetype supplies a canonical "academic shift" (C3.4) + "exam-day
 * variant" (C3.5) preset. Operators apply a preset via the
 * `POST /schools/:id/bell-schedules/preset` route — the service resolves
 * the school's archetype and builds a new `BellSchedule` from the
 * matching preset. Operators can edit the result afterward; presets are
 * defaults, not contracts.
 *
 * Adding a new archetype = add an entry here + ship the corresponding
 * `ARCHETYPE_DEFAULTS` row in `tenant-locale-defaults.ts`. No
 * service-layer branching on archetype.
 *
 * Time format: HH:MM (24-hour) — same convention as `timeSchema` in
 * `schemas/common.ts`. `durationMinutes` is always derivable from
 * start/end but is carried explicitly so consumers don't need to parse
 * twice.
 */

import type { ActiveArchetype } from '../locale/tenant-locale-defaults';

/**
 * The set of preset kinds an operator can apply. Stays small + explicit
 * — the open-ended schedule space already lives in `createBellSchedule`.
 */
export type BellSchedulePresetType = 'academic' | 'exam_day';

/**
 * One class-period row inside a preset. Shape matches
 * `classPeriodSchema` from `schemas/identity/bell-schedule.schema.ts`
 * minus the optional `description` + `dayOfWeek` fields (presets are
 * archetype-wide; per-day-of-week overrides are an operator concern).
 *
 * `periodType` is the Ed-Fi period taxonomy: 'instructional' for class
 * blocks, 'lunch' / 'recess' / 'passing' for non-academic breaks, etc.
 * Kept as a string literal union mirroring `periodTypeSchema` so this
 * file has no Zod runtime cost.
 */
export interface BellSchedulePresetPeriod {
  classPeriodName: string;
  periodNumber: number;
  periodType:
    | 'instructional'
    | 'homeroom'
    | 'lunch'
    | 'recess'
    | 'passing'
    | 'assembly'
    | 'advisory'
    | 'study_hall'
    | 'extracurricular';
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  durationMinutes: number;
  isAcademic: boolean;
}

export interface BellSchedulePreset {
  /** Human-readable name applied to the created BellSchedule. Operators can rename. */
  bellScheduleName: string;
  /** Maps to `dayType` on the created schedule. `'regular'` for academic, `'testing'` for exam day. */
  dayType: 'regular' | 'testing';
  description: string;
  classPeriods: BellSchedulePresetPeriod[];
}

export interface BellSchedulePresetSet {
  academic: BellSchedulePreset;   // C3.4
  exam_day: BellSchedulePreset;   // C3.5
}

/**
 * Compute the sum of `durationMinutes` across academic periods. Used
 * to fill `totalInstructionalTime` on the created BellSchedule so
 * downstream session-sync stays consistent.
 */
export function computeInstructionalMinutes(preset: BellSchedulePreset): number {
  return preset.classPeriods
    .filter((p) => p.isAcademic)
    .reduce((sum, p) => sum + p.durationMinutes, 0);
}

// ----------------------------------------------------------------------------
// PABSON presets — Nepal private schools, Sun–Fri week (Saturday is weekend).
// Shape modeled on typical PABSON-member primary/secondary calendars: 10:00
// arrival, 4 morning blocks separated by a short recess, lunch around 13:15,
// 3 afternoon blocks, dismissal 16:00. Exam day collapses to two long blocks
// with a 1-hour lunch break.
// ----------------------------------------------------------------------------

const PABSON_ACADEMIC: BellSchedulePreset = {
  bellScheduleName: 'PABSON Standard Day',
  dayType: 'regular',
  description: 'Canonical PABSON academic shift — 7 instructional periods with recess and lunch.',
  classPeriods: [
    { classPeriodName: 'Period 1', periodNumber: 1, periodType: 'instructional', startTime: '10:00', endTime: '10:45', durationMinutes: 45, isAcademic: true },
    { classPeriodName: 'Period 2', periodNumber: 2, periodType: 'instructional', startTime: '10:45', endTime: '11:30', durationMinutes: 45, isAcademic: true },
    { classPeriodName: 'Recess', periodNumber: 3, periodType: 'recess', startTime: '11:30', endTime: '11:45', durationMinutes: 15, isAcademic: false },
    { classPeriodName: 'Period 3', periodNumber: 4, periodType: 'instructional', startTime: '11:45', endTime: '12:30', durationMinutes: 45, isAcademic: true },
    { classPeriodName: 'Period 4', periodNumber: 5, periodType: 'instructional', startTime: '12:30', endTime: '13:15', durationMinutes: 45, isAcademic: true },
    { classPeriodName: 'Lunch', periodNumber: 6, periodType: 'lunch', startTime: '13:15', endTime: '13:45', durationMinutes: 30, isAcademic: false },
    { classPeriodName: 'Period 5', periodNumber: 7, periodType: 'instructional', startTime: '13:45', endTime: '14:30', durationMinutes: 45, isAcademic: true },
    { classPeriodName: 'Period 6', periodNumber: 8, periodType: 'instructional', startTime: '14:30', endTime: '15:15', durationMinutes: 45, isAcademic: true },
    { classPeriodName: 'Period 7', periodNumber: 9, periodType: 'instructional', startTime: '15:15', endTime: '16:00', durationMinutes: 45, isAcademic: true },
  ],
};

const PABSON_EXAM_DAY: BellSchedulePreset = {
  bellScheduleName: 'PABSON Exam Day',
  dayType: 'testing',
  description: 'PABSON exam-day shift — two long testing blocks with a midday break.',
  classPeriods: [
    { classPeriodName: 'Morning Exam', periodNumber: 1, periodType: 'instructional', startTime: '10:00', endTime: '13:00', durationMinutes: 180, isAcademic: true },
    { classPeriodName: 'Lunch', periodNumber: 2, periodType: 'lunch', startTime: '13:00', endTime: '14:00', durationMinutes: 60, isAcademic: false },
    { classPeriodName: 'Afternoon Exam', periodNumber: 3, periodType: 'instructional', startTime: '14:00', endTime: '16:00', durationMinutes: 120, isAcademic: true },
  ],
};

// ----------------------------------------------------------------------------
// GENERIC presets — US-style 5-day week, ~7:50am arrival, 7 periods of ~50
// min each with a 5-min passing window + 45-min lunch. Exam day collapses
// to 3 testing blocks separated by short breaks. Used as the fallback for
// any tenant whose archetype isn't otherwise registered.
// ----------------------------------------------------------------------------

const GENERIC_ACADEMIC: BellSchedulePreset = {
  bellScheduleName: 'Generic Academic Day',
  dayType: 'regular',
  description: 'Canonical generic 7-period academic day with passing + lunch.',
  classPeriods: [
    { classPeriodName: 'Period 1', periodNumber: 1, periodType: 'instructional', startTime: '08:00', endTime: '08:50', durationMinutes: 50, isAcademic: true },
    { classPeriodName: 'Passing', periodNumber: 2, periodType: 'passing', startTime: '08:50', endTime: '08:55', durationMinutes: 5, isAcademic: false },
    { classPeriodName: 'Period 2', periodNumber: 3, periodType: 'instructional', startTime: '08:55', endTime: '09:45', durationMinutes: 50, isAcademic: true },
    { classPeriodName: 'Passing', periodNumber: 4, periodType: 'passing', startTime: '09:45', endTime: '09:50', durationMinutes: 5, isAcademic: false },
    { classPeriodName: 'Period 3', periodNumber: 5, periodType: 'instructional', startTime: '09:50', endTime: '10:40', durationMinutes: 50, isAcademic: true },
    { classPeriodName: 'Passing', periodNumber: 6, periodType: 'passing', startTime: '10:40', endTime: '10:45', durationMinutes: 5, isAcademic: false },
    { classPeriodName: 'Period 4', periodNumber: 7, periodType: 'instructional', startTime: '10:45', endTime: '11:35', durationMinutes: 50, isAcademic: true },
    { classPeriodName: 'Lunch', periodNumber: 8, periodType: 'lunch', startTime: '11:35', endTime: '12:20', durationMinutes: 45, isAcademic: false },
    { classPeriodName: 'Period 5', periodNumber: 9, periodType: 'instructional', startTime: '12:20', endTime: '13:10', durationMinutes: 50, isAcademic: true },
    { classPeriodName: 'Passing', periodNumber: 10, periodType: 'passing', startTime: '13:10', endTime: '13:15', durationMinutes: 5, isAcademic: false },
    { classPeriodName: 'Period 6', periodNumber: 11, periodType: 'instructional', startTime: '13:15', endTime: '14:05', durationMinutes: 50, isAcademic: true },
    { classPeriodName: 'Passing', periodNumber: 12, periodType: 'passing', startTime: '14:05', endTime: '14:10', durationMinutes: 5, isAcademic: false },
    { classPeriodName: 'Period 7', periodNumber: 13, periodType: 'instructional', startTime: '14:10', endTime: '15:00', durationMinutes: 50, isAcademic: true },
  ],
};

const GENERIC_EXAM_DAY: BellSchedulePreset = {
  bellScheduleName: 'Generic Exam Day',
  dayType: 'testing',
  description: 'Canonical generic exam day — three testing blocks split by short breaks + lunch.',
  classPeriods: [
    { classPeriodName: 'Morning Block 1', periodNumber: 1, periodType: 'instructional', startTime: '08:00', endTime: '10:00', durationMinutes: 120, isAcademic: true },
    { classPeriodName: 'Break', periodNumber: 2, periodType: 'recess', startTime: '10:00', endTime: '10:15', durationMinutes: 15, isAcademic: false },
    { classPeriodName: 'Morning Block 2', periodNumber: 3, periodType: 'instructional', startTime: '10:15', endTime: '12:15', durationMinutes: 120, isAcademic: true },
    { classPeriodName: 'Lunch', periodNumber: 4, periodType: 'lunch', startTime: '12:15', endTime: '13:00', durationMinutes: 45, isAcademic: false },
    { classPeriodName: 'Afternoon Block', periodNumber: 5, periodType: 'instructional', startTime: '13:00', endTime: '15:00', durationMinutes: 120, isAcademic: true },
  ],
};

/**
 * Canonical archetype → preset registry. Operators read this implicitly
 * by hitting the `bell-schedules/preset` endpoint; AdminWeb may also
 * fetch it for previewing before apply.
 */
export const ARCHETYPE_BELL_PRESETS: Record<ActiveArchetype, BellSchedulePresetSet> = {
  PABSON: { academic: PABSON_ACADEMIC, exam_day: PABSON_EXAM_DAY },
  GENERIC: { academic: GENERIC_ACADEMIC, exam_day: GENERIC_EXAM_DAY },
};

/**
 * Resolve the bell-schedule preset for an (archetype, type) pair.
 * Falls back to GENERIC if the archetype isn't active in V1, so the
 * caller always gets a usable preset rather than a 500.
 *
 * Pure — no I/O.
 */
export function resolveBellSchedulePreset(
  archetype: string | null | undefined,
  type: BellSchedulePresetType,
): BellSchedulePreset {
  const key = (archetype ?? '').toUpperCase();
  const set = (ARCHETYPE_BELL_PRESETS as Record<string, BellSchedulePresetSet | undefined>)[key];
  if (set) return set[type];
  return ARCHETYPE_BELL_PRESETS.GENERIC[type];
}
