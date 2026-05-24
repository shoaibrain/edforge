/**
 * ExternalExamRegistration schemas — Sprint D.3.1
 *
 * Per-student registration row against an external authority (CEHRD
 * municipality for BLE; NEB for SEE/NEB-11/NEB-12). Lifecycle is the
 * 4-state machine documented in `d3-sprint-plan.md` §4 D.3.1; the
 * transition-matrix validator lives in academics src (D.3.6 Phase 2).
 *
 * **Ed-Fi V6 alignment:** `edforge:StudentExternalAssessmentRegistration`
 * (analogous to V6.1 `StudentAssessmentRegistration`; `symbolNumber` is
 * Nepal-specific authority artifact with no clean Ed-Fi analogue).
 *
 * **Uniqueness:** `(schoolId, studentId, examType, examYear)` is enforced
 * via the `ExternalExamRegistrationLock` entity (D.3.1 companion; mirrors
 * `PROMOTION_RULE_LOCK` from D.2.1). D.4 controllers write the lock + the
 * registration in a single `TransactWriteItems` with
 * `attribute_not_exists(entityKey)` on the lock.
 *
 * **GSI plan** (lowercase per S3.2):
 *   - GSI1 cohort query: `gsi1pk='TENANT#{tid}#SCHOOL#{schoolId}'`,
 *     `gsi1sk='EXT_EXAM_REG#{examType}#{examYear}#{registrationId}'`
 *   - GSI2 cross-AY student view: `gsi2pk='TENANT#{tid}#ENROLLMENT#{enrollmentId}'`,
 *     `gsi2sk='EXT_EXAM_REG#{examType}'`
 *   - GSI13 sparse symbolNumber reverse: `gsi13pk='SYMBOL#{symbolNumber}'`,
 *     `gsi13sk='EXT_EXAM_REG#{registrationId}'` (populated only when symbolNumber set)
 *
 * @see docs/pilot-greenlight/d3-sprint-plan.md §4 D.3.1
 */

import { z } from 'zod';
import {
  examTypeSchema,
  externalExamRegistrationStatusSchema,
  bsYearSchema,
  gregorianDateSchema,
  EXTERNAL_EXAM_REGISTRATION_STATUSES,
} from './external-exam-shared.schema';
import { isoDateSchema } from '../common';

// Re-export so consumers have one import path.
export {
  examTypeSchema,
  externalExamRegistrationStatusSchema,
  EXTERNAL_EXAM_REGISTRATION_STATUSES,
};

// ============================================
// Create ExternalExamRegistration schema
// ============================================

/**
 * `municipalityId` is required iff `examType='BLE'` (municipality-issued
 * symbol numbers); for SEE / NEB-11 / NEB-12 the authority is `'NEB'`
 * literal and `municipalityId` MUST be undefined. Enforced via cross-field
 * refinement at parse time.
 */
export const createExternalExamRegistrationSchema = z
  .object({
    studentId: z.string().uuid(),
    enrollmentId: z.string().uuid(),
    schoolId: z.string().uuid(),
    examType: examTypeSchema,
    examYear: bsYearSchema,
    /** Municipality CEHRD code for BLE; `'NEB'` literal for SEE / NEB-11 / NEB-12. */
    examAuthority: z.string().min(1).max(40),
    /** FK to `SchoolConfiguration.municipalityConfig.municipalityId`. BLE only. */
    municipalityId: z.string().uuid().optional(),
    /** Courses (Course.courseId per A.2.0) the student is registering for. */
    courses: z.array(z.string().uuid()).max(15),
    registrationDate: gregorianDateSchema,
  })
  .superRefine((val, ctx) => {
    if (val.examType === 'BLE') {
      if (!val.municipalityId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['municipalityId'],
          message: "municipalityId is required when examType='BLE'",
        });
      }
    } else if (val.examType === 'SEE' || val.examType === 'NEB_11' || val.examType === 'NEB_12') {
      if (val.examAuthority !== 'NEB') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['examAuthority'],
          message: "examAuthority must equal 'NEB' for SEE / NEB-11 / NEB-12",
        });
      }
    }
  });
export type CreateExternalExamRegistrationDto = z.infer<typeof createExternalExamRegistrationSchema>;

// ============================================
// Update schema (status + symbolNumber + examCenter)
// ============================================

/**
 * Partial update. State-machine transitions (DRAFT → SUBMITTED_TO_IEMIS,
 * etc.) are enforced at the service layer via the academics-side
 * transition matrix; this schema only validates the field shapes.
 * Identity fields (`studentId`, `enrollmentId`, `schoolId`, `examType`,
 * `examYear`) are NOT patchable.
 */
export const updateExternalExamRegistrationSchema = z.object({
  status: externalExamRegistrationStatusSchema.optional(),
  /** Assigned by authority post-submission. Sparse GSI13 populates only when set. */
  symbolNumber: z.string().min(1).max(40).optional(),
  examCenter: z.string().min(1).max(200).optional(),
});
export type UpdateExternalExamRegistrationDto = z.infer<typeof updateExternalExamRegistrationSchema>;

// ============================================
// Response schema
// ============================================

export const externalExamRegistrationResponseSchema = z.object({
  registrationId: z.string().uuid(),
  studentId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string().uuid(),
  examType: examTypeSchema,
  examYear: bsYearSchema,
  examAuthority: z.string().min(1).max(40),
  municipalityId: z.string().uuid().nullable().optional(),
  symbolNumber: z.string().min(1).max(40).nullable().optional(),
  examCenter: z.string().min(1).max(200).nullable().optional(),
  courses: z.array(z.string().uuid()).max(15),
  registrationDate: gregorianDateSchema,
  status: externalExamRegistrationStatusSchema,
  createdAt: isoDateSchema,
  createdBy: z.string(),
  updatedAt: isoDateSchema,
  updatedBy: z.string(),
});
export type ExternalExamRegistrationResponseDto = z.infer<
  typeof externalExamRegistrationResponseSchema
>;
