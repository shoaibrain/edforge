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
 * Grade entity - represents a student's grade for a course in a term.
 *
 * **Ed-Fi V6 alignment: Student Academic Record (Grading) domain — the
 * Gradebook sub-model.** This is the classwork / daily-grading path, analogous
 * to Ed-Fi `GradebookEntry` / `StudentGradebookEntry` (formative classroom
 * grades). It coexists with the structured term-exam path (`Exam` + `ExamScore`,
 * which feed the term `ResultCard` → Ed-Fi `ReportCard`). Neither belongs to
 * the Ed-Fi Assessment domain (reserved for external board exams).
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
export type AssessmentCategory = 'formative' | 'summative';

export interface AssignmentGrade {
  assignmentId: string;
  assignmentName: string;
  assignmentType: string;
  categoryId?: string;
  assessmentCategory?: AssessmentCategory;
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
  /**
   * GPA scale ceiling — `4.0` for US scale, `4.0` for Nepal CEHRD, `5.0` for
   * weighted-honors scales. Drives honors/AP cap math in gpa-calculator and
   * is surfaced to operators in the policy UI. Required field as of D.1.1.
   */
  gpaScale: '4.0' | '5.0';
  /**
   * Letter-grade table mapping percentage ranges → letter + GPA points. Field
   * renamed from `letterGrades` (D.1.1, 2026-05-22) to match ArchetypeDefaults
   * + master-plan vocabulary. Reader path accepts both shapes during the
   * transition cycle (see D.1.5 backfill); writer always emits `letterGrades`.
   */
  letterGrades: LetterGradeEntry[];
  categoryWeights?: CategoryWeight[];
  dropLowestScores?: {
    categoryId: string;
    count: number;
  }[];
  roundingRule: 'up' | 'down' | 'nearest';
  minimumPassingGrade: number;
}

/**
 * One row of a letter-grade table — the mapping `percentage range → letter
 * grade → GPA points`.
 *
 * D.1.1 (2026-05-22) — renamed from `GradingScaleEntry` to align with
 * ArchetypeDefaults' `letterGrades[]` field; added the trailing three fields
 * to support Nepal CEHRD (`NG` Not-Graded sentinel for failed external-exam
 * subjects per D.4.0 §6.3) and human-readable display strings.
 *
 * `isTerminalFail` distinguishes `NG` (cannot retake without a supplementary
 * process — gates the BLE/SEE/NEB pipelines) from `F` (can retake within
 * term). `displayName` provides the operator-facing label.
 */
export interface LetterGradeEntry {
  letter: GradeLetter;
  minPercentage: number;
  maxPercentage: number;
  gpaPoints: number;
  isPassing: boolean;
  isTerminalFail?: boolean;
  displayName?: string;
}

/** @deprecated D.1.1 — use `LetterGradeEntry`. Alias kept for one transition cycle. */
export type GradingScaleEntry = LetterGradeEntry;

/**
 * Category weight
 */
export interface CategoryWeight {
  categoryId: string;
  categoryName: string;
  weight: number;  // Percentage
  defaultAssessmentCategory?: AssessmentCategory;
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

