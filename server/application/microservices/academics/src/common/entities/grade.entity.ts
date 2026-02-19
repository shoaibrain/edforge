/**
 * Grade Entity for Academics Service
 * 
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: GRADE#{studentId}#{courseId}#{termId}
 * 
 * GSI1 (School scope):
 * - GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * - GSI1SK: GRADE#{courseId}#{termId}
 * 
 * GSI2 (Student-centric):
 * - GSI2PK: {studentId}
 * - GSI2SK: GRADE#{yearId}#{termId}
 */

import { 
  BaseEntity, 
  EntityKeyBuilder,
  GSIKeyBuilder,
  GradeLetter,
} from './base.entity';

/**
 * Grade entity - represents a student's grade for a course in a term
 */
export interface Grade extends BaseEntity {
  entityType: 'GRADE';
  
  // References
  gradeId: string;
  studentId: string;
  schoolId: string;
  courseId: string;
  sectionId?: string;
  teacherId: string;
  academicYearId: string;
  termId: string;

  // Denormalized names (for display — populated at write time)
  studentName?: string;
  courseName?: string;
  
  // Grade details
  numericGrade?: number;  // 0-100
  letterGrade?: GradeLetter;
  gpaPoints?: number;  // 0-4.0
  credits?: number;
  
  // Category grades (for weighted grading)
  categoryGrades?: CategoryGrade[];
  
  // Individual assignments/assessments
  assignments?: AssignmentGrade[];
  
  // Status
  isFinal: boolean;
  isPassFail?: boolean;
  isPassing?: boolean;
  
  // Comments
  teacherComment?: string;
  conductGrade?: string;
  effortGrade?: string;
  
  // Audit
  lastCalculatedAt?: string;
  publishedAt?: string;
  
  // GSI Keys
  gsi1pk: string;  // TENANT#{tid}#SCHOOL#{schoolId}
  gsi1sk: string;  // GRADE#{courseId}#{termId}
  gsi2pk: string;  // studentId
  gsi2sk: string;  // GRADE#{yearId}#{termId}
}

/**
 * Category grade (for weighted grading systems)
 */
export interface CategoryGrade {
  categoryId: string;
  categoryName: string;  // e.g., 'Homework', 'Tests', 'Quizzes'
  weight: number;  // Percentage weight
  earnedPoints: number;
  possiblePoints: number;
  percentage: number;
  letterGrade?: GradeLetter;
}

/**
 * Individual assignment/assessment grade
 */
export interface AssignmentGrade {
  assignmentId: string;
  assignmentName: string;
  assignmentType: string;
  categoryId?: string;
  dueDate?: string;
  submittedDate?: string;
  earnedPoints?: number;
  possiblePoints: number;
  percentage?: number;
  letterGrade?: GradeLetter;
  weight?: number;
  isExtraCredit?: boolean;
  isDropped?: boolean;
  isMissing?: boolean;
  isExcused?: boolean;
  comment?: string;
  gradedBy?: string;
  gradedAt?: string;
}

/**
 * Grade calculation configuration
 */
export interface GradingPolicy {
  schoolId: string;
  policyName: string;
  gradingScale: GradingScaleEntry[];
  categoryWeights?: CategoryWeight[];
  dropLowestScores?: {
    categoryId: string;
    count: number;
  }[];
  roundingRule: 'up' | 'down' | 'nearest';
  minimumPassingGrade: number;
}

/**
 * Grading scale entry
 */
export interface GradingScaleEntry {
  letter: GradeLetter;
  minPercentage: number;
  maxPercentage: number;
  gpaPoints: number;
}

/**
 * Category weight
 */
export interface CategoryWeight {
  categoryId: string;
  categoryName: string;
  weight: number;  // Percentage
}

/**
 * Create a new Grade entity with proper keys
 */
export function createGradeEntity(
  tenantId: string,
  gradeId: string,
  studentId: string,
  schoolId: string,
  courseId: string,
  termId: string,
  academicYearId: string,
  data: Omit<Grade, 'tenantId' | 'entityKey' | 'entityType' | 'gradeId' | 'studentId' | 'schoolId' | 'courseId' | 'termId' | 'academicYearId' | 'gsi1pk' | 'gsi1sk' | 'gsi2pk' | 'gsi2sk'>
): Grade {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.grade(studentId, courseId, termId),
    entityType: 'GRADE',
    gradeId,
    studentId,
    schoolId,
    courseId,
    termId,
    academicYearId,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: `GRADE#${courseId}#${termId}`,
    gsi2pk: studentId,
    gsi2sk: `GRADE#${academicYearId}#${termId}#${courseId}`,
    ...data,
  };
}

