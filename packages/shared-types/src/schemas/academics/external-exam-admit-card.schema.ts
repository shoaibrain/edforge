/**
 * ExternalExamAdmitCard schemas — Sprint D.3.3
 *
 * Per-registration admit-card row (1:1 with ExternalExamRegistration).
 * Carries the print artifact's S3 URL once C.4.3 renderer runs (called
 * from D.4.5 / D.5.3 / D.6.x in their respective sprints; D.3 ships
 * shape only).
 *
 * **Ed-Fi V6 alignment:** `edforge:ExternalAssessmentAdmitCard` — no
 * direct Ed-Fi analogue (Nepal-specific authority artifact).
 *
 * **GSI plan:**
 *   - GSI1: `gsi1pk='TENANT#{tid}#SCHOOL#{schoolId}'`,
 *           `gsi1sk='ADMIT_CARD#{registrationId}'`
 *
 * @see docs/pilot-greenlight/d3-sprint-plan.md §4 D.3.3
 */

import { z } from 'zod';

// ============================================
// Create AdmitCard schema
// ============================================

export const createExternalExamAdmitCardSchema = z.object({
  registrationId: z.string().uuid(),
  studentId: z.string().uuid(),
  schoolId: z.string().uuid(),
  /**
   * Mirrors `ExternalExamRegistration.symbolNumber` (denormalized for the
   * read path so the admit-card row can be served without a join).
   */
  externalRollNumber: z.string().min(1).max(40),
  examCenterName: z.string().min(1).max(200),
  examCenterAddress: z.string().min(1).max(500),
  /** ISO Gregorian dates, sorted ascending. Must be non-empty. */
  examDates: z.array(z.string()).min(1).max(20),
  issuedAt: z.string(),
});
export type CreateExternalExamAdmitCardDto = z.infer<typeof createExternalExamAdmitCardSchema>;

// ============================================
// Update schema (renderer populates pdfS3Url)
// ============================================

export const updateExternalExamAdmitCardSchema = z.object({
  pdfS3Url: z.string().min(1).max(2000).optional(),
});
export type UpdateExternalExamAdmitCardDto = z.infer<typeof updateExternalExamAdmitCardSchema>;

// ============================================
// Response schema
// ============================================

export const externalExamAdmitCardResponseSchema = z.object({
  admitCardId: z.string().uuid(),
  registrationId: z.string().uuid(),
  studentId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string().uuid(),
  externalRollNumber: z.string().min(1).max(40),
  examCenterName: z.string().min(1).max(200),
  examCenterAddress: z.string().min(1).max(500),
  examDates: z.array(z.string()).min(1).max(20),
  pdfS3Url: z.string().min(1).max(2000).nullable().optional(),
  issuedAt: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type ExternalExamAdmitCardResponseDto = z.infer<
  typeof externalExamAdmitCardResponseSchema
>;
