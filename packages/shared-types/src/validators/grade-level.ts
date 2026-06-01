/**
 * Grade Level Validators
 *
 * Constants and validation utilities for grade levels.
 *
 * The canonical grade-code list lives in schemas/identity/grade-levels.ts
 * (`ORDERED_GRADES`). This file re-exports it as `GRADE_LEVELS` so that
 * `getGradeLevelsInRange` and adjacent helpers work for the PABSON archetype's
 * ECD + PPC pre-school bands. Earlier revisions hardcoded a US-K-12 set here
 * which produced a `slice(-1, ...)` degenerate single-entry result for any
 * range starting with `'ECD'`.
 */

import { z } from 'zod';
import { ORDERED_GRADES } from '../schemas/identity/grade-levels';

// ============================================
// Grade Level Constants
// ============================================

/**
 * Canonical ordered grade codes from earliest (ECD) to latest (12).
 * Re-exports `ORDERED_GRADES` to avoid duplicate-source-of-truth drift.
 */
export const GRADE_LEVELS = ORDERED_GRADES;

export type GradeLevel = typeof GRADE_LEVELS[number];

// ============================================
// Grade Level Display Names
// ============================================

export const GRADE_LEVEL_NAMES: Record<GradeLevel, string> = {
  'ECD': 'Early Childhood Development',
  'PPC': 'Pre-Primary Class',
  // PABSON operational classes (distinct from ECD/PPC reporting bands):
  'PG': 'Playgroup',
  'NUR': 'Nursery',
  'LKG': 'Lower Kindergarten (LKG)',
  'UKG': 'Upper Kindergarten (UKG)',
  'PK': 'Pre-Kindergarten',
  'K': 'Kindergarten',
  '1': '1st Grade',
  '2': '2nd Grade',
  '3': '3rd Grade',
  '4': '4th Grade',
  '5': '5th Grade',
  '6': '6th Grade',
  '7': '7th Grade',
  '8': '8th Grade',
  '9': '9th Grade (Freshman)',
  '10': '10th Grade (Sophomore)',
  '11': '11th Grade (Junior)',
  '12': '12th Grade (Senior)',
};

// ============================================
// Grade Level Groups
// ============================================

// ECD + PPC (IEMIS bands) and PG/NUR/LKG/UKG (PABSON operational
// classes) are all pre-school levels; grouped with elementary for
// US-style grade-band consumers. Group-aware UIs that need a separate
// 'preschool' bucket should use ORDERED_GRADES + getGradeIndex directly.
// Adding a new 'preschool' GradeLevelGroup type would widen the union
// for every downstream consumer — preserving the 3-bucket model and
// rolling pre-school into elementary keeps the contract stable.
export const ELEMENTARY_GRADES: GradeLevel[] = [
  'ECD', 'PPC',
  'PG', 'NUR', 'LKG', 'UKG',
  'PK', 'K',
  '1', '2', '3', '4', '5',
];
export const MIDDLE_GRADES: GradeLevel[] = ['6', '7', '8'];
export const HIGH_GRADES: GradeLevel[] = ['9', '10', '11', '12'];

export type GradeLevelGroup = 'elementary' | 'middle' | 'high';

// ============================================
// Zod Schemas
// ============================================

/**
 * Grade level enum schema (PK, K, 1-12)
 * Note: Named with Enum suffix to avoid conflict with identity/department's gradeLevelConfigSchema
 */
export const gradeLevelEnumSchema = z.enum(GRADE_LEVELS);

/**
 * Grade level range validator schema
 * Used to validate that start grade is before or equal to end grade
 */
export const gradeLevelRangeValidatorSchema = z.object({
  start: gradeLevelEnumSchema,
  end: gradeLevelEnumSchema,
}).refine(
  data => getGradeLevelIndex(data.start) <= getGradeLevelIndex(data.end),
  { message: 'Start grade must be at or before end grade' }
);

export type GradeLevelRange = z.infer<typeof gradeLevelRangeValidatorSchema>;

// ============================================
// Utility Functions
// ============================================

/**
 * Get the numeric index of a grade level for comparison
 */
export function getGradeLevelIndex(grade: GradeLevel): number {
  return GRADE_LEVELS.indexOf(grade);
}

/**
 * Check if a string is a valid grade level
 */
export function isValidGradeLevel(grade: string): grade is GradeLevel {
  return GRADE_LEVELS.includes(grade as GradeLevel);
}

/**
 * Get the display name for a grade level
 */
export function getGradeLevelDisplayName(grade: GradeLevel): string {
  return GRADE_LEVEL_NAMES[grade];
}

/**
 * Get the grade level group (elementary, middle, high)
 */
export function getGradeLevelGroup(grade: GradeLevel): GradeLevelGroup {
  if (ELEMENTARY_GRADES.includes(grade)) return 'elementary';
  if (MIDDLE_GRADES.includes(grade)) return 'middle';
  return 'high';
}

/**
 * Compare two grade levels
 * Returns negative if a < b, positive if a > b, 0 if equal
 */
export function compareGradeLevels(a: GradeLevel, b: GradeLevel): number {
  return getGradeLevelIndex(a) - getGradeLevelIndex(b);
}

/**
 * Get all grade levels within a range (inclusive)
 */
export function getGradeLevelsInRange(start: GradeLevel, end: GradeLevel): GradeLevel[] {
  const startIndex = getGradeLevelIndex(start);
  const endIndex = getGradeLevelIndex(end);
  
  if (startIndex > endIndex) {
    return [];
  }
  
  return GRADE_LEVELS.slice(startIndex, endIndex + 1) as GradeLevel[];
}

/**
 * Check if a grade is within a range
 */
export function isGradeInRange(
  grade: GradeLevel, 
  range: { start: GradeLevel; end: GradeLevel }
): boolean {
  const gradeIndex = getGradeLevelIndex(grade);
  const startIndex = getGradeLevelIndex(range.start);
  const endIndex = getGradeLevelIndex(range.end);
  
  return gradeIndex >= startIndex && gradeIndex <= endIndex;
}

/**
 * Get the next grade level, or null if already at 12th grade
 */
export function getNextGradeLevel(grade: GradeLevel): GradeLevel | null {
  const index = getGradeLevelIndex(grade);
  if (index >= GRADE_LEVELS.length - 1) {
    return null;
  }
  return GRADE_LEVELS[index + 1];
}

/**
 * Get the previous grade level, or null if already at PK
 */
export function getPreviousGradeLevel(grade: GradeLevel): GradeLevel | null {
  const index = getGradeLevelIndex(grade);
  if (index <= 0) {
    return null;
  }
  return GRADE_LEVELS[index - 1];
}
