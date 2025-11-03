/**
 * Grading Scale Entity
 * 
 * Defines how numeric scores are converted to letter grades and GPA points
 * Supports different grading systems used across schools globally
 * 
 * SINGLE-TABLE DESIGN:
 * PK: tenantId
 * SK: GRADING_SCALE#{schoolId}#{scaleId}
 * 
 * Examples:
 * - US Standard (A-F, 4.0 GPA scale)
 * - UK System (First Class, Upper Second, etc.)
 * - IB System (1-7)
 * - Percentage-based (0-100)
 * - Competency-based (Exceeds/Meets/Approaching/Below)
 */

export interface GradingScale {
  tenantId: string;
  entityKey: string;        // GRADING_SCALE#{schoolId}#{scaleId}
  entityType: 'GRADING_SCALE';
  scaleId: string;
  schoolId: string;
  academicYearId?: string;  // Optional: Scale specific to academic year
  
  // Scale metadata
  scaleName: string;        // e.g., "Standard US Grading", "IB Grading"
  scaleType: 'letter' | 'percentage' | 'points' | 'competency' | 'ib' | 'custom';
  description?: string;
  
  // Configuration
  isDefault: boolean;       // Default scale for the school
  isActive: boolean;
  ranges: GradeRange[];     // Grade ranges and mappings
  gpaScale: number;         // 4.0, 5.0, 7.0, 100, etc.
  passingGrade: string;     // e.g., "D", "60", "Meets Expectations"
  
  // Metadata
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  
  // GSI keys
  gsi1pk: string;           // schoolId
  gsi1sk: string;           // GRADING_SCALE#{scaleId}
}

/**
 * Grade Range - Maps percentage ranges to letter grades and GPA points
 */
export interface GradeRange {
  minPercentage: number;
  maxPercentage: number;
  letterGrade: string;
  gradePoints: number;
  passingGrade: boolean;
  description?: string;     // e.g., "Excellent", "Satisfactory"
  color?: string;           // For UI display (e.g., "#4CAF50" for A)
}

/**
 * Entity Key Builder for Grading Scale
 */
export class GradingScaleKeyBuilder {
  static gradingScale(schoolId: string, scaleId: string): string {
    return `GRADING_SCALE#${schoolId}#${scaleId}`;
  }
}

/**
 * Predefined Grading Scales
 * Schools can use these as templates or create custom scales
 */

// Standard US Grading Scale (A-F, 4.0 GPA)
export const STANDARD_US_SCALE: GradeRange[] = [
  { minPercentage: 93, maxPercentage: 100, letterGrade: 'A', gradePoints: 4.0, passingGrade: true, description: 'Excellent', color: '#4CAF50' },
  { minPercentage: 90, maxPercentage: 92.99, letterGrade: 'A-', gradePoints: 3.7, passingGrade: true, description: 'Excellent', color: '#66BB6A' },
  { minPercentage: 87, maxPercentage: 89.99, letterGrade: 'B+', gradePoints: 3.3, passingGrade: true, description: 'Good', color: '#81C784' },
  { minPercentage: 83, maxPercentage: 86.99, letterGrade: 'B', gradePoints: 3.0, passingGrade: true, description: 'Good', color: '#9CCC65' },
  { minPercentage: 80, maxPercentage: 82.99, letterGrade: 'B-', gradePoints: 2.7, passingGrade: true, description: 'Good', color: '#AED581' },
  { minPercentage: 77, maxPercentage: 79.99, letterGrade: 'C+', gradePoints: 2.3, passingGrade: true, description: 'Satisfactory', color: '#FFEB3B' },
  { minPercentage: 73, maxPercentage: 76.99, letterGrade: 'C', gradePoints: 2.0, passingGrade: true, description: 'Satisfactory', color: '#FDD835' },
  { minPercentage: 70, maxPercentage: 72.99, letterGrade: 'C-', gradePoints: 1.7, passingGrade: true, description: 'Satisfactory', color: '#FBC02D' },
  { minPercentage: 67, maxPercentage: 69.99, letterGrade: 'D+', gradePoints: 1.3, passingGrade: true, description: 'Below Average', color: '#FF9800' },
  { minPercentage: 65, maxPercentage: 66.99, letterGrade: 'D', gradePoints: 1.0, passingGrade: true, description: 'Below Average', color: '#FB8C00' },
  { minPercentage: 0, maxPercentage: 64.99, letterGrade: 'F', gradePoints: 0.0, passingGrade: false, description: 'Failing', color: '#F44336' }
];

// Weighted GPA Scale (for Honors/AP courses)
export const WEIGHTED_US_SCALE: GradeRange[] = [
  { minPercentage: 93, maxPercentage: 100, letterGrade: 'A', gradePoints: 5.0, passingGrade: true, description: 'Excellent' },
  { minPercentage: 90, maxPercentage: 92.99, letterGrade: 'A-', gradePoints: 4.7, passingGrade: true, description: 'Excellent' },
  { minPercentage: 87, maxPercentage: 89.99, letterGrade: 'B+', gradePoints: 4.3, passingGrade: true, description: 'Good' },
  { minPercentage: 83, maxPercentage: 86.99, letterGrade: 'B', gradePoints: 4.0, passingGrade: true, description: 'Good' },
  { minPercentage: 80, maxPercentage: 82.99, letterGrade: 'B-', gradePoints: 3.7, passingGrade: true, description: 'Good' },
  { minPercentage: 77, maxPercentage: 79.99, letterGrade: 'C+', gradePoints: 3.3, passingGrade: true, description: 'Satisfactory' },
  { minPercentage: 73, maxPercentage: 76.99, letterGrade: 'C', gradePoints: 3.0, passingGrade: true, description: 'Satisfactory' },
  { minPercentage: 70, maxPercentage: 72.99, letterGrade: 'C-', gradePoints: 2.7, passingGrade: true, description: 'Satisfactory' },
  { minPercentage: 67, maxPercentage: 69.99, letterGrade: 'D+', gradePoints: 2.3, passingGrade: true, description: 'Below Average' },
  { minPercentage: 65, maxPercentage: 66.99, letterGrade: 'D', gradePoints: 2.0, passingGrade: true, description: 'Below Average' },
  { minPercentage: 0, maxPercentage: 64.99, letterGrade: 'F', gradePoints: 0.0, passingGrade: false, description: 'Failing' }
];

// International Baccalaureate (IB) Scale (1-7)
export const IB_SCALE: GradeRange[] = [
  { minPercentage: 90, maxPercentage: 100, letterGrade: '7', gradePoints: 7.0, passingGrade: true, description: 'Excellent' },
  { minPercentage: 80, maxPercentage: 89.99, letterGrade: '6', gradePoints: 6.0, passingGrade: true, description: 'Very Good' },
  { minPercentage: 70, maxPercentage: 79.99, letterGrade: '5', gradePoints: 5.0, passingGrade: true, description: 'Good' },
  { minPercentage: 60, maxPercentage: 69.99, letterGrade: '4', gradePoints: 4.0, passingGrade: true, description: 'Satisfactory' },
  { minPercentage: 50, maxPercentage: 59.99, letterGrade: '3', gradePoints: 3.0, passingGrade: false, description: 'Mediocre' },
  { minPercentage: 40, maxPercentage: 49.99, letterGrade: '2', gradePoints: 2.0, passingGrade: false, description: 'Poor' },
  { minPercentage: 0, maxPercentage: 39.99, letterGrade: '1', gradePoints: 1.0, passingGrade: false, description: 'Very Poor' }
];

// Competency-Based Scale
export const COMPETENCY_SCALE: GradeRange[] = [
  { minPercentage: 90, maxPercentage: 100, letterGrade: 'Exceeds Expectations', gradePoints: 4.0, passingGrade: true, description: 'Advanced mastery' },
  { minPercentage: 75, maxPercentage: 89.99, letterGrade: 'Meets Expectations', gradePoints: 3.0, passingGrade: true, description: 'Proficient' },
  { minPercentage: 60, maxPercentage: 74.99, letterGrade: 'Approaching Expectations', gradePoints: 2.0, passingGrade: true, description: 'Developing' },
  { minPercentage: 0, maxPercentage: 59.99, letterGrade: 'Below Expectations', gradePoints: 0.0, passingGrade: false, description: 'Beginning' }
];

// Percentage-Only Scale (no letter grades)
export const PERCENTAGE_SCALE: GradeRange[] = [
  { minPercentage: 60, maxPercentage: 100, letterGrade: 'Pass', gradePoints: 1.0, passingGrade: true, description: 'Passing' },
  { minPercentage: 0, maxPercentage: 59.99, letterGrade: 'Fail', gradePoints: 0.0, passingGrade: false, description: 'Not Passing' }
];

/**
 * Helper to create default grading scale for a school
 */
export function createDefaultGradingScale(
  tenantId: string,
  schoolId: string,
  scaleType: 'us_standard' | 'weighted' | 'ib' | 'competency' | 'percentage' = 'us_standard',
  createdBy: string
): GradingScale {
  const scaleId = `default-${scaleType}`;
  const timestamp = new Date().toISOString();
  
  const scaleConfigs = {
    us_standard: { name: 'Standard US Grading (A-F)', ranges: STANDARD_US_SCALE, gpaScale: 4.0 },
    weighted: { name: 'Weighted GPA Scale (Honors/AP)', ranges: WEIGHTED_US_SCALE, gpaScale: 5.0 },
    ib: { name: 'International Baccalaureate (1-7)', ranges: IB_SCALE, gpaScale: 7.0 },
    competency: { name: 'Competency-Based Grading', ranges: COMPETENCY_SCALE, gpaScale: 4.0 },
    percentage: { name: 'Percentage-Based (Pass/Fail)', ranges: PERCENTAGE_SCALE, gpaScale: 100 }
  };
  
  const config = scaleConfigs[scaleType];
  
  return {
    tenantId,
    entityKey: GradingScaleKeyBuilder.gradingScale(schoolId, scaleId),
    entityType: 'GRADING_SCALE',
    scaleId,
    schoolId,
    scaleName: config.name,
    scaleType: scaleType === 'us_standard' || scaleType === 'weighted' ? 'letter' : scaleType,
    description: `Default ${config.name} for ${schoolId}`,
    isDefault: true,
    isActive: true,
    ranges: config.ranges,
    gpaScale: config.gpaScale,
    passingGrade: config.ranges.find(r => r.passingGrade)?.letterGrade || 'D',
    createdAt: timestamp,
    createdBy,
    updatedAt: timestamp,
    updatedBy: createdBy,
    version: 1,
    gsi1pk: schoolId,
    gsi1sk: `GRADING_SCALE#${scaleId}`
  };
}

