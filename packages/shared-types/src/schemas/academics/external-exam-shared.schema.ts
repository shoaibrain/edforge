/**
 * External Exam — shared schemas (single source of truth) — Sprint D.3
 *
 * The 6 D.3 entities (RubricCategory, ExternalExamRegistration,
 * InternalAssessment, ExternalExamAdmitCard, ExternalExamResult,
 * ExternalExamRetake) all need the `examType` discriminator and
 * `examYear` BS-bounded integer validator. Defining them in one file
 * mitigates R-D3.5 (enum drift across entities) per `d3-sprint-plan.md` §5.
 *
 * **Architecture (per `d3-sprint-plan.md` §1.5):**
 *   - `examType` is a Core (archetype-blind) discriminator, NOT an archetype branch.
 *   - Every archetype that runs BLE-style exams uses the same `examType='BLE'` rows.
 *   - Service-layer code MUST NOT branch on `tenant.archetype`; it branches on `examType`.
 *
 * @see docs/pilot-greenlight/d3-sprint-plan.md §4 D.3.1
 * @see packages/shared-types/src/utils/bikram-sambat.ts (MIN_BS_YEAR/MAX_BS_YEAR)
 */

import { z } from 'zod';
import { MIN_BS_YEAR, MAX_BS_YEAR } from '../../utils/bikram-sambat';

// ============================================
// External-exam type discriminator
// ============================================

/**
 * The 4 external-assessment authorities EdForge supports in V1.
 *   - `BLE`     — Basic Level Examination (Grade 8, municipality-administered per CEHRD)
 *   - `SEE`     — Secondary Education Examination (Grade 10, NEB-administered)
 *   - `NEB_11`  — National Examination Board Grade 11 (NEB)
 *   - `NEB_12`  — National Examination Board Grade 12 (NEB)
 */
export const examTypeSchema = z.enum(['BLE', 'SEE', 'NEB_11', 'NEB_12']);
export type ExamType = z.infer<typeof examTypeSchema>;

export const EXAM_TYPES = examTypeSchema.options;

// ============================================
// External-exam registration status (state machine)
// ============================================

/**
 * Lifecycle of an ExternalExamRegistration row. See the 4×4 transition
 * matrix in `d3-sprint-plan.md` §4 D.3.1 (canonical 4 legal + 4 idempotent
 * + 8 illegal = 16 cells). The matrix validator lives in academics src
 * (`external-exams/external-exam-registration.state-machine.ts`, D.3.6
 * Phase 2); this enum is the schema-side type guard only.
 */
export const externalExamRegistrationStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED_TO_IEMIS',
  'SYMBOL_ASSIGNED',
  'CANCELLED',
]);
export type ExternalExamRegistrationStatus = z.infer<typeof externalExamRegistrationStatusSchema>;

export const EXTERNAL_EXAM_REGISTRATION_STATUSES = externalExamRegistrationStatusSchema.options;

// ============================================
// BS exam year (bounded by the shared BS converter range)
// ============================================

/**
 * BS year for `examYear` and any other BS-year-bearing fields in the D.3
 * entity family. Bounds mirror `bikram-sambat.ts` data-table coverage —
 * NEVER fork these (per `d3-sprint-plan.md` §8 #7).
 */
export const bsYearSchema = z
  .number()
  .int()
  .min(MIN_BS_YEAR)
  .max(MAX_BS_YEAR);
export type BsYear = z.infer<typeof bsYearSchema>;
