/**
 * Academic-foundation generator — Sprint S1.3.
 *
 * Expands a roster config into the school + academic year + terms that every
 * other entity hangs off. Pure (config → structure); no RNG needed.
 */

import { gregorianToBs } from '@aibrains/shared-types';

import type { DemoRosterConfig } from './roster-config';
import type {
  DemoAcademicFoundation,
  DemoAcademicYear,
  DemoSchool,
  DemoTerm,
} from './generated-types';

/** Number of terms to split the academic year into. */
const TERM_COUNT = 3;

/** Initials → 2–10 char uppercased school code. */
function schoolCodeFromName(name: string): string {
  const initials = name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  const code = initials.slice(0, 10);
  return code.length >= 2 ? code : (name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'SCHOOL');
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(startIso: string, endIso: string): number {
  const a = new Date(`${startIso}T12:00:00Z`).getTime();
  const b = new Date(`${endIso}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function gregorianToBsString(iso: string): string {
  const { year, month, day } = gregorianToBs(iso);
  return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
}

function buildTerms(startDate: string, endDate: string): DemoTerm[] {
  const span = daysBetween(startDate, endDate); // inclusive-ish span in days
  const perTerm = Math.floor(span / TERM_COUNT);
  const terms: DemoTerm[] = [];
  for (let i = 0; i < TERM_COUNT; i++) {
    const tStart = addDays(startDate, i * perTerm);
    // Last term runs to the AY end exactly; earlier terms end the day before
    // the next term begins.
    const tEnd = i === TERM_COUNT - 1 ? endDate : addDays(startDate, (i + 1) * perTerm - 1);
    // Exam window = the last 10 days of the term (or the whole term if short).
    const examStart = daysBetween(tStart, tEnd) > 12 ? addDays(tEnd, -10) : tStart;
    terms.push({
      ref: `term:${i + 1}`,
      name: `Term ${i + 1}`,
      termType: 'trimester',
      sequence: i + 1,
      startDate: tStart,
      endDate: tEnd,
      examStartDate: examStart,
      examEndDate: tEnd,
    });
  }
  return terms;
}

function buildSchool(config: DemoRosterConfig): DemoSchool {
  const localeKey = config.locale.split('-')[0] || 'en';
  const gradeLevelLabels: Record<string, Record<string, string>> = {};
  for (const g of config.gradeLevels) {
    gradeLevelLabels[g.code] = { [localeKey]: g.label };
  }
  return {
    ref: 'school:0',
    name: config.school.name,
    schoolCode: schoolCodeFromName(config.school.name),
    // PABSON demo runs as a Nepal private school; GENERIC as a US K-12.
    schoolType: config.archetype === 'PABSON' ? 'private' : 'k12',
    emisSchoolCode: config.school.emisSchoolCode,
    address: config.school.address,
    gradeRange: {
      start: config.gradeLevels[0].code,
      end: config.gradeLevels[config.gradeLevels.length - 1].code,
    },
    enabledGradeLevels: config.gradeLevels.map((g) => g.code),
    gradeLevelLabels,
  };
}

function buildAcademicYear(config: DemoRosterConfig): DemoAcademicYear {
  const { startDate, endDate } = config.academicYear;
  const ay: DemoAcademicYear = {
    ref: 'ay:0',
    name: config.academicYear.name,
    startDate,
    endDate,
    calendarType: 'trimester',
    terms: buildTerms(startDate, endDate),
  };
  if (config.calendarSystem === 'bikram_sambat') {
    ay.startDateBS = gregorianToBsString(startDate);
    ay.endDateBS = gregorianToBsString(endDate);
  }
  return ay;
}

export function generateAcademicFoundation(config: DemoRosterConfig): DemoAcademicFoundation {
  return {
    school: buildSchool(config),
    academicYear: buildAcademicYear(config),
  };
}
