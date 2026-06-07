/**
 * ResultCard Entity — Sprint A.4.2
 *
 * Per-student per-term aggregated result. Written by the result-batch
 * Lambda (A.4.3) when an Exam transitions to `closed` and re-published
 * to `published` by the operator via the ResultCardsService publish path.
 *
 * Key Structure (DynamoDB single-table; bare-UUID tenantId per memory
 * `edforge_identity_ddb_bare_uuid_partition_key`):
 *   - PK: tenantId (bare UUID stored; logical notation TENANT#{tid})
 *   - SK: RESULT_CARD#{enrollmentId}#{cardId}
 *
 * GSI1 (school-scope):   GSI1PK=tenant#{tid}#school#{schoolId},
 *                        GSI1SK=result-card#{academicYearId}#{termId}#{examId}#{enrollmentId}
 * GSI2 (enrollment-scope cross-AY transcript):
 *                        GSI2PK=enrollment#{enrollmentId},
 *                        GSI2SK=result-card#{academicYearId}#{termId}#{examId}
 * GSI3 (exam-scope; "list all cards for this exam"):
 *                        GSI3PK=exam#{examId},
 *                        GSI3SK=result-card#{enrollmentId}
 *
 * **GSI key casing: lowercase** per S3.2.
 *
 * **Invariant 3 (key shape):** keyed by `enrollmentId`, NOT
 * `(studentId, examId)`. When promotion (D.2.10) rewrites Enrollment,
 * the ResultCard stays bound to the prior-AY enrollment row.
 *
 * **Invariant 2 (denormalization):** `courseScores[].academicSubject` is
 * copied from Course at aggregation time so renderer + downstream
 * importers don't need extra GetItem lookups per row.
 *
 * **R42 mitigation:** `studentId` is resolved from Enrollment at
 * aggregation time (NOT read from ExamScore.studentId which may carry
 * the 'unknown' placeholder for bulk-written A.3 rows).
 *
 * **Ed-Fi V6 alignment: Student Academic Record domain — Ed-Fi `ReportCard`.**
 * Per-(student, GradingPeriod) summary: `courseScores[]` → `ReportCardGrade[]`,
 * `termGpa` → `ReportCardGradePointAverage`, cumulative across terms →
 * `StudentAcademicRecord`. `conduct` / `classTeacherRemark` are Nepal-archetype
 * edge fields with no core Ed-Fi `ReportCard` equivalent. This is distinct from
 * the Assessment domain, which the external board-exam result uses.
 *
 * @see docs/pilot-greenlight/a4-sprint-plan.md §4 A.4.2
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';
import type {
  ResultCardStatus,
  AcademicSubjectDescriptor,
  CourseSubjectArea,
  ResultCardComponentScoreDto,
} from '@aibrains/shared-types';

/**
 * Per-course aggregated score row inside ResultCard.courseScores[].
 * Denormalizes subject identity from the ExamCourse. `academicSubject` is the
 * finer, optional Course descriptor; `subjectArea` is the required Ed-Fi rollup;
 * `courseName` is the human label. Renderer resolves the shown subject as
 * `academicSubject ?? subjectArea ?? courseName` so a valid course never reads
 * "unknown" (P1a).
 */
export interface ResultCardCourseScore {
  courseId: string;
  examCourseId: string;
  academicSubject?: AcademicSubjectDescriptor;
  subjectArea?: CourseSubjectArea;
  courseName?: string;
  rawScore: number;                             // rolled-up subject mark ("Obt.M.")
  maxMarks: number;                             // "Full M."
  // P1.5c — subject superset (real Saraswati card columns).
  passMarks?: number;                           // "Pass M."
  pass?: boolean;                               // subject pass (per-component in division scheme)
  components?: ResultCardComponentScoreDto[];   // Theory/Practical breakdown
  highestInClass?: number | null;              // "H.M." — field now, compute V1.5
  // P1b — Absent / Not-Graded: distinct non-failing state (render "AB"/"—", not 0%→E)
  notGraded?: boolean;
  grade: string;                                // letter, e.g. 'A+', 'NG'
  gpa: number;                                  // letterGradeEntry.gpaPoints
  isPassing: boolean;
  isTerminalFail?: boolean;                     // CEHRD NG semantics
}

/**
 * ResultCard — per-student per-term aggregated card. State `draft`
 * after Lambda writes it; `published` after operator action via the
 * dedicated publish endpoint.
 */
export interface ResultCard extends BaseEntity {
  entityType: 'RESULT_CARD';

  // Identity (per invariant 3 — keyed by enrollmentId)
  cardId: string;
  enrollmentId: string;

  // Context FKs
  examId: string;
  termId: string;
  academicYearId: string;
  schoolId: string;

  // R42 mitigation: resolved at aggregation time from Enrollment
  studentId: string;

  // RC-UX.1: frozen student-identity snapshot, denormalized from Student at
  // generation time so the card renders names/grade/face without per-row lookups
  // and reads as printed even after later transfers / name corrections.
  studentIdentity?: {
    legalName: string;
    preferredName?: string;
    gradeLevel?: string;
    emisStudentId?: string;
    photoUrl?: string;
  };

  // Aggregated per-course results (denormalized academicSubject)
  courseScores: ResultCardCourseScore[];

  // Term totals
  totalScore: number;
  totalMaxMarks: number;
  termGpa: number;
  overallGrade: string;

  // P1.5a — division-scheme aggregate outputs. `percentage` always set;
  // `division` is the band label (or null when failed), `result` is overall
  // Pass/Fail. Absent for the letter_gpa scheme.
  percentage?: number;
  division?: string | null;
  result?: 'pass' | 'fail';

  // V1 null; V1.5 computes
  classRank?: number | null;
  sectionRank?: number | null;

  // Operator-edited
  conduct?: string | null;
  classTeacherRemark?: string | null;

  // Lifecycle
  status: ResultCardStatus;                     // 'draft' | 'published'
  publishedAt?: string | null;
  publishedBy?: string | null;

  // Drives C.9.5 cross-year handoff (`result.published.isTerminal`)
  isTerminalExam: boolean;

  // Standard flags
  isActive: boolean;

  // GSI Keys (lowercase per S3.2)
  gsi1pk: string;  // 'tenant#{tid}#school#{schoolId}'
  gsi1sk: string;  // 'result-card#{academicYearId}#{termId}#{examId}#{enrollmentId}'
  gsi2pk: string;  // 'enrollment#{enrollmentId}'
  gsi2sk: string;  // 'result-card#{academicYearId}#{termId}#{examId}'
  gsi3pk: string;  // 'exam#{examId}'
  gsi3sk: string;  // 'result-card#{enrollmentId}'
}

// ============================================================================
// GSI key builders (lowercase per S3.2)
// ============================================================================

function resultCardSchoolGsi1pk(tenantId: string, schoolId: string): string {
  return `tenant#${tenantId}#school#${schoolId}`;
}

function resultCardSchoolGsi1sk(
  academicYearId: string,
  termId: string,
  examId: string,
  enrollmentId: string,
): string {
  return `result-card#${academicYearId}#${termId}#${examId}#${enrollmentId}`;
}

function resultCardEnrollmentGsi2pk(enrollmentId: string): string {
  return `enrollment#${enrollmentId}`;
}

function resultCardEnrollmentGsi2sk(
  academicYearId: string,
  termId: string,
  examId: string,
): string {
  return `result-card#${academicYearId}#${termId}#${examId}`;
}

function resultCardExamGsi3pk(examId: string): string {
  return `exam#${examId}`;
}

function resultCardExamGsi3sk(enrollmentId: string): string {
  return `result-card#${enrollmentId}`;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new ResultCard entity with proper keys.
 *
 * Caller supplies all domain fields except generated keys (`entityKey`,
 * `entityType`, `gsi*pk`, `gsi*sk`). `tenantId` is the bare-UUID value
 * per memory. The Lambda calls this directly after term-aggregation.
 */
export function createResultCardEntity(
  tenantId: string,
  cardId: string,
  data: Omit<
    ResultCard,
    | 'tenantId'
    | 'entityKey'
    | 'entityType'
    | 'cardId'
    | 'gsi1pk'
    | 'gsi1sk'
    | 'gsi2pk'
    | 'gsi2sk'
    | 'gsi3pk'
    | 'gsi3sk'
  >,
): ResultCard {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.resultCard(data.enrollmentId, cardId),
    entityType: 'RESULT_CARD',
    cardId,
    gsi1pk: resultCardSchoolGsi1pk(tenantId, data.schoolId),
    gsi1sk: resultCardSchoolGsi1sk(
      data.academicYearId,
      data.termId,
      data.examId,
      data.enrollmentId,
    ),
    gsi2pk: resultCardEnrollmentGsi2pk(data.enrollmentId),
    gsi2sk: resultCardEnrollmentGsi2sk(data.academicYearId, data.termId, data.examId),
    gsi3pk: resultCardExamGsi3pk(data.examId),
    gsi3sk: resultCardExamGsi3sk(data.enrollmentId),
    ...data,
  };
}
