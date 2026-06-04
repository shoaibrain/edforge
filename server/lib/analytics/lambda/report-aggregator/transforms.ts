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
 * Computes exam_total_marks. Post-Sprint-C5+ this aggregates real Score
 * entities. V1 — returns empty string + a single console.log warning per
 * snapshot run (caller logs once aggregate over many missing rows).
 */
export function computeExamTotalMarks(_resultCards: unknown): string {
  return '';
}

/** As above for GPA. */
export function computeExamGpa(_resultCards: unknown): string {
  return '';
}

/**
 * Maps enrollment.endStatus → CEHRD academic_status code.
 *
 * Acceptable CEHRD values (per research §12): PROMOTED, REPEATED, TRANSFERRED,
 * DROPPED_OUT. V1 mapping is best-effort — unknown values return empty string
 * (operator UI flags via pre-flight).
 */
export function computeAcademicStatus(endStatus: unknown): string {
  if (typeof endStatus !== 'string' || !endStatus) return '';
  const code = endStatus.toLowerCase();
  if (code.includes('promot')) return 'PROMOTED';
  if (code.includes('repeat')) return 'REPEATED';
  if (code.includes('transfer')) return 'TRANSFERRED';
  if (code.includes('drop') || code.includes('withdraw')) return 'DROPPED_OUT';
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
