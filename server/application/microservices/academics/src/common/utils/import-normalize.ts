/**
 * Normalization helpers for student-data imports.
 *
 * Shared between the generic CSV importer (students.service#importStudents)
 * and the IEMIS importer (Project Midnight Lockin P0.6). Tolerant of real
 * upstream data quality issues — see Saraswati's IEMIS export for the
 * motivating test set (779 rows with `-null,` addresses, `Na` parent names,
 * placeholder `123` phones, mixed case, whitespace, non-zero-padded dates).
 */

import type { Gender } from '@aibrains/shared-types';
import { PABSON_GRADE_LEVELS, ORDERED_GRADES, GradeCode } from '@aibrains/shared-types';

/**
 * Normalize a gender value from upstream data to the canonical enum.
 *
 * Accepts: M, F, m, f, Male, Female, MALE, female, O, Other, other,
 * PNS / prefer_not_to_say (case-insensitive). Returns null for unrecognized
 * values so the caller can emit a row-level error instead of silently
 * corrupting data.
 */
export function normalizeGender(raw: unknown): Gender | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  switch (s) {
    case 'm':
    case 'male':
      return 'male';
    case 'f':
    case 'female':
      return 'female';
    case 'o':
    case 'other':
      return 'other';
    case 'pns':
    case 'prefer_not_to_say':
    case 'prefer not to say':
    case 'n/a':
      return 'prefer_not_to_say';
    default:
      return null;
  }
}

/**
 * Treat `Na`, `NA`, `na`, `null`, `NULL`, `-null,`, and pure-whitespace as
 * null. Also trims whitespace. Preserves non-empty "meaningful" strings
 * exactly as provided (case and internal whitespace).
 */
export function cleanNullish(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (
    lower === 'na' ||
    lower === 'n/a' ||
    lower === 'null' ||
    lower === '-null,' ||
    lower === '-null' ||
    lower === 'none' ||
    lower === 'undefined'
  ) {
    return null;
  }
  return s;
}

/**
 * Clean a phone field — returns null for placeholders like `123`, `0000000000`,
 * empty strings, and null-ish sentinels. Returns the trimmed string otherwise.
 * IEMIS exports commonly carry `123` as a placeholder for missing guardian
 * contact numbers; treat that as "no phone" rather than a literal "123".
 */
export function cleanPhone(raw: unknown): string | null {
  const cleaned = cleanNullish(raw);
  if (!cleaned) return null;
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (digitsOnly.length < 4) return null;            // placeholder "123"
  if (/^0+$/.test(digitsOnly)) return null;           // "0000000000"
  if (digitsOnly === '1234567890') return null;       // common test pattern
  return cleaned;
}

/**
 * Split a full name on the LAST whitespace run.
 *
 * The IEMIS export supplies `FullName` as a single string like
 * `"Khadka Bahadur Karki"`. Splitting on the FIRST space (first-space rule)
 * produces `{first:"Khadka", last:"Bahadur Karki"}` which mangles Nepali
 * compound given names. Last-space works for the majority of Nepali and
 * Indian naming conventions where the surname is the last token.
 *
 * Edge cases:
 *   - Single token ("Rashmi")                 → {first:"Rashmi", last:""}
 *   - Two tokens  ("Ram Prasad")              → {first:"Ram", last:"Prasad"}
 *   - Three+     ("Khadka Bahadur Karki")    → {first:"Khadka Bahadur", last:"Karki"}
 *   - Empty / whitespace only                 → {first:"", last:""}
 */
export function splitFullNameLastSpace(raw: unknown): { first: string; last: string } {
  const s = (cleanNullish(raw) || '').trim();
  if (!s) return { first: '', last: '' };
  const normalized = s.replace(/\s+/g, ' ');
  const lastSpace = normalized.lastIndexOf(' ');
  if (lastSpace === -1) {
    // Single token — treat as first name; last name blank.
    return { first: normalized, last: '' };
  }
  return {
    first: normalized.substring(0, lastSpace).trim(),
    last: normalized.substring(lastSpace + 1).trim(),
  };
}

/**
 * Validate a grade-level code against the archetype-specific allow-list.
 * PABSON tenants accept ECD/PPC/1–12. Generic tenants accept PK/K/1–12 (the
 * historical EdForge set). Returns true if the code is valid for the tenant.
 */
export function isValidGradeForArchetype(
  grade: string,
  archetype?: string,
): boolean {
  if (archetype?.toUpperCase() === 'PABSON') {
    return (PABSON_GRADE_LEVELS as readonly string[]).includes(grade);
  }
  // Generic: any ORDERED_GRADES value except the PABSON-only ECD/PPC
  return (ORDERED_GRADES as readonly string[]).includes(grade)
    && grade !== 'ECD' && grade !== 'PPC';
}

/** Title-case a single word, preserving interior hyphens and apostrophes. */
function titleCaseWord(w: string): string {
  if (!w) return w;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

/**
 * Normalize human name capitalization.
 *
 * Saraswati's IEMIS export mixes all-caps ("ROSHANI KHATUN") with mixed case
 * ("Ram Prasad") — parents see both on the same receipt unless we normalize.
 * Handles whitespace runs and preserves multi-word compounds.
 *
 * Known edge cases NOT handled (intentional — rare in Nepali data):
 *   - McDonald-style internal capitalization
 *   - Names with apostrophes that require post-apostrophe caps (O'Brien)
 */
export function normalizeName(raw: unknown): string {
  const s = cleanNullish(raw);
  if (!s) return '';
  return s
    .split(/\s+/)
    .map((w) => w.split('-').map(titleCaseWord).join('-'))
    .join(' ');
}
