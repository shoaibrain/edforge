/**
 * Descriptor transforms — Sprint E.1.3
 *
 * Materializes the `transform` enums declared on template column source-paths
 * into runtime strings emitted in the CSV cell.
 *
 * Ed-Fi descriptor URIs look like:
 *   uri://ed-fi.org/SexDescriptor#Male
 *   uri://ed-fi.org/EthnicityDescriptor#Hill_Brahmin   (edforge: namespace for Nepal)
 *
 * The transforms here are intentionally tolerant: descriptor missing → empty
 * string (operator UI shows row-level warnings via pre-flight before commit).
 */

import { formatBsDate, resolveDescriptorEntry } from '@aibrains/shared-types';
import {
  defaultReportingCardStrategy,
  selectReportingCard,
  type ReportRowResultCard,
} from './result-card-select';

/** Narrow the template-resolved `resultCards` source value to a typed array. */
function asReportCards(value: unknown): ReportRowResultCard[] {
  return Array.isArray(value) ? (value as ReportRowResultCard[]) : [];
}

/** Maps SexDescriptor to CEHRD-canonical M/F/O (other). */
export function sexDescriptorToMF(descriptor: unknown): string {
  if (typeof descriptor !== 'string' || !descriptor) return '';
  const code = descriptor.split('#').pop()?.toLowerCase() ?? '';
  if (code === 'male' || code === 'm') return 'M';
  if (code === 'female' || code === 'f') return 'F';
  if (code === 'other' || code === 'o' || code === 'nonbinary') return 'O';
  return '';
}

/**
 * Maps an EthnicityDescriptor (URI or `edforge:`-namespaced token) → CEHRD band
 * (the value IEMIS expects), via the EthnicityDescriptor catalog (GB3.3 — was a
 * hardcoded regex). Unmapped → '' (a real signal the pre-flight surfaces),
 * NOT a silent 'Other' bucket — a misclassified caste band is real harm.
 */
export function ethnicityDescriptorToBand(descriptor: unknown): string {
  if (typeof descriptor !== 'string' || !descriptor) return '';
  const afterHash = descriptor.includes('#') ? descriptor.split('#').pop() ?? '' : descriptor;
  const token = afterHash.replace(/^edforge:/, '');
  return resolveDescriptorEntry('EthnicityDescriptor', token)?.displayName.en ?? '';
}

/**
 * Maps LanguageDescriptor → display name.
 * Strips both `uri://…#` prefix AND `edforge:` short-namespace prefix.
 */
export function languageDescriptorToName(descriptor: unknown): string {
  if (typeof descriptor !== 'string' || !descriptor) return '';
  // Strip `uri://…#` prefix if present, then `edforge:` short-namespace prefix.
  const afterHash = descriptor.includes('#')
    ? descriptor.split('#').pop() ?? ''
    : descriptor;
  const code = afterHash.replace(/^edforge:/, '');
  // Canonical Nepal mother-tongues per CEHRD; the descriptor short-code already
  // matches the display name in most cases.
  return code.replace(/_/g, ' ');
}

/** Maps the first disability descriptor in a list → display name. */
export function disabilityFirstDescriptorToName(disabilities: unknown): string {
  if (!Array.isArray(disabilities) || disabilities.length === 0) return '';
  const first = disabilities[0];
  if (typeof first !== 'string' || !first) return '';
  const afterHash = first.includes('#') ? first.split('#').pop() ?? '' : first;
  return afterHash.replace(/^edforge:/, '').replace(/_/g, ' ');
}

/** Converts Gregorian ISO date → BS "YYYY-MM-DD" (CEHRD canonical separator). */
export function gregorianDateToBsString(gregorianIso: unknown): string {
  if (typeof gregorianIso !== 'string' || !gregorianIso) return '';
  try {
    // formatBsDate emits "YYYY/MM/DD" — CEHRD wants dashes; do the swap here.
    return formatBsDate(gregorianIso).replace(/\//g, '-');
  } catch {
    return '';
  }
}

/** Maps a scholarship category code → CEHRD display name. */
export function scholarshipCategoryToName(category: unknown): string {
  if (typeof category !== 'string' || !category) return '';
  const afterHash = category.includes('#') ? category.split('#').pop() ?? '' : category;
  return afterHash.replace(/^edforge:/, '').replace(/_/g, ' ');
}

/** Sums per-day attendance.presentDays — relies on caller pre-aggregating. */
export function sumAttendancePresentDays(attendance: unknown): string {
  if (
    attendance &&
    typeof attendance === 'object' &&
    'presentDays' in (attendance as object) &&
    typeof (attendance as { presentDays: unknown }).presentDays === 'number'
  ) {
    return String((attendance as { presentDays: number }).presentDays);
  }
  return '';
}

/**
 * Computes Flash II `exam_total_marks` — the obtained total from the student's
 * year-end "reporting card" (terminal exam by default; see result-card-select).
 * Empty string when the student has no result card (operator awareness via the
 * generator's missingExamPipelineCount).
 */
export function computeExamTotalMarks(resultCards: unknown): string {
  const card = selectReportingCard(asReportCards(resultCards), defaultReportingCardStrategy());
  return card ? String(card.totalScore) : '';
}

/** As above for GPA — the reporting card's weighted term GPA, 2dp. */
export function computeExamGpa(resultCards: unknown): string {
  const card = selectReportingCard(asReportCards(resultCards), defaultReportingCardStrategy());
  if (!card) return '';
  return (Math.round(card.termGpa * 100) / 100).toFixed(2);
}

/**
 * Maps enrollment.endStatus → the IEMIS year-end student-status enum.
 *
 * IEMIS uses six values (per the deep-research synthesis of the IEMIS "Manage
 * Exam" / data-list guides): `Passed`, `Passed & Transfer`, `Double promoted`,
 * `Repeated`, `Repeated & Transfer`, `Dropout`. Transfer combines with the
 * pass/repeat outcome rather than being a standalone value.
 *
 * Substring-based because our endStatus vocabulary (Ed-Fi exitWithdrawType /
 * promotion outcome) isn't a fixed enum yet. The exact mapping will firm up
 * against the real IEMIS template + the actual endStatus values once a school
 * runs Flash II — keep this map the single point of change. Unknown → ''.
 */
export function computeAcademicStatus(endStatus: unknown): string {
  if (typeof endStatus !== 'string' || !endStatus) return '';
  const s = endStatus.toLowerCase();
  const transferred = s.includes('transfer');
  if (s.includes('drop') || s.includes('withdraw')) return 'Dropout';
  if (s.includes('double') && s.includes('promot')) return 'Double promoted';
  if (s.includes('repeat') || s.includes('retain')) {
    return transferred ? 'Repeated & Transfer' : 'Repeated';
  }
  if (s.includes('promot') || s.includes('pass') || s.includes('complete')) {
    return transferred ? 'Passed & Transfer' : 'Passed';
  }
  // Bare transfer with no pass/repeat signal — default to the common case
  // (transfer after a passing year). Revisit when IEMIS endStatus vocab is fixed.
  if (transferred) return 'Passed & Transfer';
  return '';
}

/**
 * Maps a school's operator-chosen local grade-level code to the CEHRD-canonical
 * short code expected by IEMIS Flash I/II (Sprint A.3 of V1 platform hardening).
 *
 * Examples:
 *   'PG' / 'NUR'           → 'ECD'   (EarlyChildhoodDevelopment)
 *   'LKG' / 'UKG'          → 'PPC'   (PrePrimaryClass)
 *   '1' / 'Grade 1' / 'G1' → '1'
 *   '10' / 'SEE'           → '10'
 *
 * Resolution is case-insensitive + trims whitespace (per `resolveDescriptorEntry`
 * contract). Unresolvable inputs return `''` — the operator UI surfaces these
 * via pre-flight before commit. The known lossy literal `'ECD/PPC'` (54
 * Saraswati students in shared state) intentionally returns `''`; the importer
 * is the disambiguation point per the descriptor header comment.
 *
 * See CLAUDE.md "School-first architecture" section for the design rationale:
 * the school's local labels are the source of truth; CEHRD canonical is a
 * report-time projection applied only at the IEMIS export boundary.
 */
export function schoolGradeToCanonical(rawGradeLevel: unknown): string {
  const entry = resolveDescriptorEntry('GradeLevelDescriptor', rawGradeLevel);
  return entry?.codeShort ?? '';
}
