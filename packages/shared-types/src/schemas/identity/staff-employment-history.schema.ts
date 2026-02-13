/**
 * Staff Employment History Schemas - Identity Service
 *
 * Zod schemas for immutable employment status change audit trail.
 */

import { z } from 'zod';
import { createPaginatedResponseSchema } from '../common';
import { employmentStatusSchema } from './staff.schema';

// ============================================
// Employment History Response Schema
// ============================================

export const employmentHistoryResponseSchema = z.object({
  historyId: z.string().uuid(),
  staffId: z.string().uuid(),
  previousStatus: employmentStatusSchema,
  newStatus: employmentStatusSchema,
  effectiveDate: z.string(),
  reason: z.string().optional(),
  notes: z.string().optional(),
  staffName: z.string().optional(),
  changedByName: z.string().optional(),
  createdAt: z.string(),
});

export type EmploymentHistoryResponseDto = z.infer<typeof employmentHistoryResponseSchema>;

// ============================================
// Employment History List Response
// ============================================

export const employmentHistoryListResponseSchema = createPaginatedResponseSchema(employmentHistoryResponseSchema);
export type EmploymentHistoryListResponseDto = z.infer<typeof employmentHistoryListResponseSchema>;
