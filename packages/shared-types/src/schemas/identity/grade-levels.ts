/**
 * Grade Level Constants — Shared across all EdForge apps
 *
 * Canonical definitions for grade ordering, display labels,
 * EdFi descriptor mapping, and school-type-to-grade-range defaults.
 *
 * IMPORTANT: This is the single source of truth for grade-level constants.
 * Do NOT duplicate these arrays in other files — import from here.
 */

// ============================================================================
// GRADE ORDERING & OPTIONS
// ============================================================================

/**
 * Canonical ordered grade codes from earliest to latest.
 *
 * ECD + PPC prepend the sequence for the PABSON (Nepal) archetype, which
 * uses Early Childhood Development + Pre-Primary Class as the two
 * pre-school bands (Saraswati's IEMIS export puts students here before
 * Class 1). Generic tenants treat them as equivalent to Pre-K / K.
 */
export const ORDERED_GRADES = [
  'ECD', 'PPC', 'PK', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
] as const;

export type GradeCode = (typeof ORDERED_GRADES)[number];

/**
 * Grade codes accepted for the PABSON archetype (Nepal private schools).
 * ECD and PPC are the canonical pre-school bands; no PK/K for PABSON.
 */
export const PABSON_GRADE_LEVELS = [
  'ECD', 'PPC', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
] as const;

/** Grade display options for dropdowns and tables (ECD/PPC/PK–12) */
export const GRADE_LEVEL_OPTIONS = [
  { value: 'ECD', label: 'ECD (Early Childhood Development)' },
  { value: 'PPC', label: 'PPC (Pre-Primary Class)' },
  { value: 'PK', label: 'Pre-K' },
  { value: 'K', label: 'Kindergarten' },
  { value: '1', label: 'Grade 1' },
  { value: '2', label: 'Grade 2' },
  { value: '3', label: 'Grade 3' },
  { value: '4', label: 'Grade 4' },
  { value: '5', label: 'Grade 5' },
  { value: '6', label: 'Grade 6' },
  { value: '7', label: 'Grade 7' },
  { value: '8', label: 'Grade 8' },
  { value: '9', label: 'Grade 9' },
  { value: '10', label: 'Grade 10' },
  { value: '11', label: 'Grade 11' },
  { value: '12', label: 'Grade 12' },
] as const;

/** Get display label for a grade code. Returns the code itself if not found. */
export function getGradeLevelLabel(value: string): string {
  const option = GRADE_LEVEL_OPTIONS.find((o) => o.value === value);
  return option?.label ?? value;
}

/** Get the numeric index of a grade code in ORDERED_GRADES. Returns -1 if not found. */
export function getGradeIndex(grade: string): number {
  return (ORDERED_GRADES as readonly string[]).indexOf(grade);
}

/** Returns true if startGrade comes before or is equal to endGrade in the ordering. */
export function isValidGradeRange(start: string, end: string): boolean {
  const startIdx = getGradeIndex(start);
  const endIdx = getGradeIndex(end);
  return startIdx !== -1 && endIdx !== -1 && startIdx <= endIdx;
}

// ============================================================================
// GRADE RANGE → ED-FI DESCRIPTOR MAPPING
// ============================================================================

/**
 * Maps simple grade codes (ECD, PPC, PK, K, 1–12) to Ed-Fi GradeLevelDescriptor values.
 *
 * ECD + PPC use PABSON-specific Ed-Fi descriptors carried in
 * `schoolGradeLevelDescriptorSchema` and the `GRADE_LEVEL_DESCRIPTOR_CATALOG`.
 * Earlier revisions mapped ECD → 'EarlyEducation' (which is not a valid Ed-Fi
 * code) and PPC → 'Prekindergarten' (which collapses PPC into PK and produces
 * duplicate chips when both bands are in range).
 */
export const GRADE_RANGE_TO_DESCRIPTOR: Record<string, string> = {
  ECD: 'EarlyChildhoodDevelopment',
  PPC: 'PrePrimaryClass',
  PK: 'Prekindergarten',
  K: 'Kindergarten',
  '1': 'FirstGrade',
  '2': 'SecondGrade',
  '3': 'ThirdGrade',
  '4': 'FourthGrade',
  '5': 'FifthGrade',
  '6': 'SixthGrade',
  '7': 'SeventhGrade',
  '8': 'EighthGrade',
  '9': 'NinthGrade',
  '10': 'TenthGrade',
  '11': 'EleventhGrade',
  '12': 'TwelfthGrade',
};

/**
 * Compute Ed-Fi grade level descriptor array from a grade range.
 * Returns empty array if inputs are invalid.
 */
export function computeGradeLevels(start: string, end: string): string[] {
  if (!start || !end) return [];
  const startIdx = getGradeIndex(start);
  const endIdx = getGradeIndex(end);
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return [];
  return ORDERED_GRADES.slice(startIdx, endIdx + 1)
    .map((g) => GRADE_RANGE_TO_DESCRIPTOR[g])
    .filter(Boolean);
}

// ============================================================================
// SCHOOL TYPE → GRADE RANGE DEFAULTS
// ============================================================================

/** Default grade range for each school type */
export const SCHOOL_TYPE_GRADE_DEFAULTS: Record<string, { start: string; end: string }> = {
  elementary: { start: 'PK', end: '5' },
  middle: { start: '6', end: '8' },
  high: { start: '9', end: '12' },
  k12: { start: 'PK', end: '12' },
  charter: { start: 'PK', end: '12' },
  private: { start: 'PK', end: '12' },
  vocational: { start: '9', end: '12' },
  special_education: { start: 'PK', end: '12' },
};

/**
 * Get the default grade range for a given school type.
 * Falls back to PK–12 for unknown types.
 */
export function getDefaultGradeRange(schoolType: string): { start: string; end: string } {
  return SCHOOL_TYPE_GRADE_DEFAULTS[schoolType] ?? { start: 'PK', end: '12' };
}

// ============================================================================
// SCHOOL TYPE → ED-FI SUGGESTIONS
// ============================================================================

/** Map internal school type to suggested Ed-Fi school category */
export const TYPE_TO_SUGGESTED_CATEGORY: Record<string, string> = {
  elementary: 'Elementary',
  middle: 'MiddleSchool',
  high: 'HighSchool',
  k12: 'AllLevels',
  charter: 'AllLevels',
  private: 'AllLevels',
  vocational: 'SecondarySchool',
  special_education: 'Ungraded',
};

/** Map internal school type to suggested Ed-Fi school type descriptor */
export const TYPE_TO_SUGGESTED_DESCRIPTOR: Record<string, string> = {
  elementary: 'Regular',
  middle: 'Regular',
  high: 'Regular',
  k12: 'Regular',
  charter: 'Regular',
  private: 'Regular',
  vocational: 'CareerAndTechnical',
  special_education: 'SpecialEducation',
};

/** Get the suggested Ed-Fi school category for a school type */
export function getSuggestedCategory(schoolType: string): string | undefined {
  return TYPE_TO_SUGGESTED_CATEGORY[schoolType];
}

/** Get the suggested Ed-Fi school type descriptor for a school type */
export function getSuggestedDescriptor(schoolType: string): string | undefined {
  return TYPE_TO_SUGGESTED_DESCRIPTOR[schoolType];
}

// ============================================================================
// SCHOOL TYPE OPTIONS & LABELS
// ============================================================================

export const SCHOOL_TYPE_OPTIONS = [
  { value: 'elementary', label: 'Elementary School' },
  { value: 'middle', label: 'Middle School' },
  { value: 'high', label: 'High School' },
  { value: 'k12', label: 'K-12 School' },
  { value: 'charter', label: 'Charter School' },
  { value: 'private', label: 'Private School' },
  { value: 'vocational', label: 'Vocational School' },
  { value: 'special_education', label: 'Special Education' },
] as const;

export const SCHOOL_TYPE_LABELS: Record<string, string> = {
  elementary: 'Elementary',
  middle: 'Middle School',
  high: 'High School',
  k12: 'K-12',
  charter: 'Charter',
  private: 'Private',
  vocational: 'Vocational',
  special_education: 'Special Ed',
  other: 'Other',
};

// ============================================================================
// CROSS-VALIDATION: SCHOOL TYPE VS GRADE RANGE
// ============================================================================

/**
 * Acceptable grade range boundaries per school type.
 * `null` means no constraint on that end.
 * Uses grade index values (0=PK, 1=K, 2=1st, ... 13=12th).
 */
const SCHOOL_TYPE_GRADE_BOUNDARIES: Record<string, { minStart?: number; maxEnd?: number } | null> = {
  elementary: { maxEnd: 9 },       // end ≤ 8th grade (index 9)
  middle: { minStart: 5, maxEnd: 10 }, // start ≥ 4th grade (index 5), end ≤ 9th grade (index 10)
  high: { minStart: 8 },           // start ≥ 7th grade (index 8)
  k12: null,                       // any range
  charter: null,                   // any range
  private: null,                   // any range
  vocational: { minStart: 8 },     // start ≥ 7th grade
  special_education: null,         // any range
};

/**
 * Validate that a school type and grade range combination is reasonable.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateSchoolTypeGradeRange(
  schoolType: string,
  gradeRange: { start: string; end: string },
): string | null {
  const startIdx = getGradeIndex(gradeRange.start);
  const endIdx = getGradeIndex(gradeRange.end);

  if (startIdx === -1 || endIdx === -1) {
    return 'Invalid grade values';
  }

  if (startIdx > endIdx) {
    return 'Start grade must be before or equal to end grade';
  }

  const boundaries = SCHOOL_TYPE_GRADE_BOUNDARIES[schoolType];
  if (boundaries === null || boundaries === undefined) {
    return null; // no constraints for this type
  }

  if (boundaries.minStart !== undefined && startIdx < boundaries.minStart) {
    const minGrade = ORDERED_GRADES[boundaries.minStart];
    const label = getGradeLevelLabel(minGrade);
    return `${SCHOOL_TYPE_LABELS[schoolType] || schoolType} school grade range should start at or above ${label}`;
  }

  if (boundaries.maxEnd !== undefined && endIdx > boundaries.maxEnd) {
    const maxGrade = ORDERED_GRADES[boundaries.maxEnd];
    const label = getGradeLevelLabel(maxGrade);
    return `${SCHOOL_TYPE_LABELS[schoolType] || schoolType} school grade range should end at or below ${label}`;
  }

  return null;
}
