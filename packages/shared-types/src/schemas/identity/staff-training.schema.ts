/**
 * StaffTraining Schemas — Identity Service (Sprint B.3)
 *
 * Zod schemas for staff professional development / training records. Mirrors
 * the credential schema pattern but is a separate first-class resource —
 * see docs/decisions/staff-training-entity-design.md for the full rationale.
 *
 * Used by:
 *   - StaffTrainingService backend CRUD (Sprint B.4)
 *   - Frontend Trainings tab on Staff Detail (Sprint B.10)
 *   - CEHRD Flash-II Staff register export (Sprint K)
 *
 * Audit-event metadata for `staff.training.{created,edited,deleted}` (event
 * types pre-registered in S4.7) is asserted PII-clean by the B.8 smoke:
 * `trainingTitle` / `notes` / `certificateNumber` MUST NOT appear in metadata.
 */

import { z } from 'zod';
import {
  dateSchema,
  createPaginatedResponseSchema,
} from '../common';

// ============================================
// Enums (CEHRD-aligned)
// ============================================

/**
 * Training type — categories aligned to CEHRD Teacher Professional Development
 * vocabulary. Adding a new category later = additive enum change + minor bump,
 * no DDB migration. `'other'` is the safety valve.
 */
export const trainingTypeSchema = z.enum([
  'pedagogical',
  'subject_matter',
  'technology',
  'inclusion',
  'leadership',
  'safety',
  'assessment',
  'language',
  'induction',
  'other',
]);
export type TrainingType = z.infer<typeof trainingTypeSchema>;

/**
 * Training lifecycle status — operator-set, not derived from dates.
 */
export const trainingStatusSchema = z.enum([
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
]);
export type TrainingStatus = z.infer<typeof trainingStatusSchema>;

// ============================================
// Create Training Schema
// ============================================

export const createStaffTrainingSchema = z.object({
  trainingTitle: z.string().min(1).max(150),
  trainingType: trainingTypeSchema,
  trainingProvider: z.string().min(1).max(150),
  startDate: dateSchema,
  endDate: dateSchema.optional(),
  durationHours: z.number().int().min(0).max(9999),
  status: trainingStatusSchema.default('completed'),
  certificateNumber: z.string().max(100).optional(),
  certificateUrl: z.string().url().max(500).optional(),
  notes: z.string().max(1000).optional(),
}).refine(
  (data) => {
    if (!data.endDate) return true;
    // endDate must be >= startDate when both are set.
    return data.endDate >= data.startDate;
  },
  { message: 'endDate must be on or after startDate', path: ['endDate'] },
);
export type CreateStaffTrainingDto = z.infer<typeof createStaffTrainingSchema>;

// ============================================
// Update Training Schema
// ============================================

/**
 * Update is a partial — every field optional. The endDate >= startDate
 * refinement is preserved.
 *
 * Note: we don't `.partial()` chain on the refined schema directly because
 * Zod v3 partial-on-refine doesn't preserve refinements. Instead we strip
 * refinement, build the partial, and re-apply.
 */
const _updateBase = z.object({
  trainingTitle: z.string().min(1).max(150).optional(),
  trainingType: trainingTypeSchema.optional(),
  trainingProvider: z.string().min(1).max(150).optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  durationHours: z.number().int().min(0).max(9999).optional(),
  status: trainingStatusSchema.optional(),
  certificateNumber: z.string().max(100).optional(),
  certificateUrl: z.string().url().max(500).optional(),
  notes: z.string().max(1000).optional(),
});

export const updateStaffTrainingSchema = _updateBase.refine(
  (data) => {
    // Only enforce when both dates present in this update payload —
    // the partial nature means callers can update one date alone, in
    // which case the existing entity's other date is the authoritative
    // bound (service-layer responsibility to re-validate).
    if (!data.startDate || !data.endDate) return true;
    return data.endDate >= data.startDate;
  },
  { message: 'endDate must be on or after startDate', path: ['endDate'] },
);
export type UpdateStaffTrainingDto = z.infer<typeof updateStaffTrainingSchema>;

// ============================================
// Response Schema
// ============================================

export const staffTrainingResponseSchema = z.object({
  trainingId: z.string().uuid(),
  staffId: z.string().uuid(),
  tenantId: z.string().uuid(),

  trainingTitle: z.string(),
  trainingType: trainingTypeSchema,
  trainingProvider: z.string(),
  startDate: z.string(),
  endDate: z.string().optional(),
  durationHours: z.number(),
  status: trainingStatusSchema,

  certificateNumber: z.string().optional(),
  certificateUrl: z.string().optional(),
  notes: z.string().optional(),

  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StaffTrainingResponseDto = z.infer<typeof staffTrainingResponseSchema>;

// ============================================
// List + Filter
// ============================================

export const staffTrainingListResponseSchema =
  createPaginatedResponseSchema(staffTrainingResponseSchema);
export type StaffTrainingListResponseDto = z.infer<typeof staffTrainingListResponseSchema>;

export const staffTrainingFilterSchema = z.object({
  trainingType: trainingTypeSchema.optional(),
  status: trainingStatusSchema.optional(),
  startDateFrom: dateSchema.optional(),
  startDateTo: dateSchema.optional(),
  // Pagination handled by outer paginated-response wrapper
});
export type StaffTrainingFilterDto = z.infer<typeof staffTrainingFilterSchema>;
