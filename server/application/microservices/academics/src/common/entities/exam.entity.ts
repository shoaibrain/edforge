/**
 * Exam Entity — Sprint A.3.2
 *
 * Key Structure (DynamoDB single-table; bare-UUID tenantId per memory
 * `edforge_identity_ddb_bare_uuid_partition_key`):
 *   - PK: tenantId (bare UUID stored; logical notation TENANT#{tid})
 *   - SK: EXAM#{schoolId}#{examId}
 *
 * GSI1 (school-scope): GSI1PK=tenant#{tid}#school#{schoolId}, GSI1SK=exam#{academicYearId}#{termId}#{examName}
 * GSI2 (term-scope cross-school): GSI2PK=term#{termId}, GSI2SK=exam#{status}#{startDate}
 *
 * **GSI key casing: lowercase** per S3.2 (memory `project_s3_2_gsi_casing_shipped`).
 * Regression guard in spec asserts no `TENANT#` / `SCHOOL#` uppercase in gsi*pk/sk.
 *
 * @see docs/pilot-greenlight/a3-sprint-plan.md §4 A.3.2
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';
import type { ExamStatus } from '@aibrains/shared-types';
import type { ExamPatternKey } from '@aibrains/shared-types';

/**
 * Exam entity — represents a term-end exam with state machine lifecycle.
 *
 * Distinct from `Grade` entity (used for classwork / daily-grading). Exam +
 * ExamScore is the structured exam-only path; they coexist.
 *
 * **Ed-Fi V6 alignment: Student Academic Record (Grading) domain — NOT the
 * Assessment domain.** An Exam is a term-end summative event scoped to a
 * (school, academicYear, term/GradingPeriod); its ExamScores roll up into the
 * per-term `ResultCard` (Ed-Fi `ReportCard`). The Ed-Fi **Assessment** domain
 * (`Assessment` / `StudentAssessment`) is reserved for external standardized
 * board exams (BLE/SEE/NEB) — see `external-exam-result.entity.ts`. Keeping
 * internal term exams on the Grading domain avoids overloading a single Ed-Fi
 * domain with two distinct concepts at serialization time.
 */
export interface Exam extends BaseEntity {
  entityType: 'EXAM';

  // Identity
  examId: string;
  examName: string;
  schoolId: string;

  // Context
  academicYearId: string;
  termId: string;

  // Cadence + window
  examType: ExamPatternKey;       // 'unit_test' | 'terminal' | 'send_up' | 'pre_board' | 'final' | 'monthly_test'
  startDate: string;              // YYYY-MM-DD
  endDate: string;                // YYYY-MM-DD

  // State machine (A.3.8)
  status: ExamStatus;             // 'draft' | 'scheduled' | 'in_progress' | 'closed' | 'published'

  description?: string;

  // Read-side denormalization: sum of ExamCourse.maxMarks at last write.
  // NOT auto-recomputed; operator can refresh via PATCH.
  totalMaxMarks?: number;

  // Status
  isActive: boolean;

  // GSI Keys (lowercase per S3.2)
  gsi1pk: string;  // 'tenant#{tid}#school#{schoolId}'
  gsi1sk: string;  // 'exam#{academicYearId}#{termId}#{examName}'
  gsi2pk: string;  // 'term#{termId}'
  gsi2sk: string;  // 'exam#{status}#{startDate}'
}

/**
 * Build the school-scoped GSI1PK in lowercase form.
 */
function examSchoolGsi1pk(tenantId: string, schoolId: string): string {
  return `tenant#${tenantId}#school#${schoolId}`;
}

/**
 * Build the school-scoped GSI1SK in lowercase form.
 */
function examSchoolGsi1sk(academicYearId: string, termId: string, examName: string): string {
  return `exam#${academicYearId}#${termId}#${examName.toUpperCase()}`;
}

/**
 * Build the term-scoped GSI2PK in lowercase form.
 */
function examTermGsi2pk(termId: string): string {
  return `term#${termId}`;
}

/**
 * Build the term-scoped GSI2SK in lowercase form.
 */
function examTermGsi2sk(status: ExamStatus, startDate: string): string {
  return `exam#${status}#${startDate}`;
}

/**
 * Create a new Exam entity with proper keys.
 *
 * Caller supplies all fields except generated keys (`entityKey`, `entityType`,
 * `gsi*pk`, `gsi*sk`). `tenantId` is the bare-UUID value (per memory).
 */
export function createExamEntity(
  tenantId: string,
  examId: string,
  schoolId: string,
  data: Omit<Exam, 'tenantId' | 'entityKey' | 'entityType' | 'examId' | 'schoolId' | 'gsi1pk' | 'gsi1sk' | 'gsi2pk' | 'gsi2sk'>,
): Exam {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.exam(schoolId, examId),
    entityType: 'EXAM',
    examId,
    schoolId,
    gsi1pk: examSchoolGsi1pk(tenantId, schoolId),
    gsi1sk: examSchoolGsi1sk(data.academicYearId, data.termId, data.examName),
    gsi2pk: examTermGsi2pk(data.termId),
    gsi2sk: examTermGsi2sk(data.status, data.startDate),
    ...data,
  };
}

/**
 * Compute the GSI2SK refresh value. Used when status or startDate changes
 * on an Exam (state-machine transition or operator-led PATCH).
 */
export function refreshExamGsi2sk(status: ExamStatus, startDate: string): string {
  return examTermGsi2sk(status, startDate);
}
