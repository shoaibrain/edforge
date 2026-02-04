/**
 * Grade Level Validators
 * 
 * Constants and validation utilities for grade levels.
 */

import { z } from 'zod';

// ============================================
// Grade Level Constants
// ============================================

export const GRADE_LEVELS = [
  'PK',  // Pre-Kindergarten
  'K',   // Kindergarten
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
] as const;

export type GradeLevel = typeof GRADE_LEVELS[number];

// ============================================
// Grade Level Display Names
// ============================================

export const GRADE_LEVEL_NAMES: Record<GradeLevel, string> = {
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

export const ELEMENTARY_GRADES: GradeLevel[] = ['PK', 'K', '1', '2', '3', '4', '5'];
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
