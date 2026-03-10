/**
 * Staff Assignment Schemas - Identity Service
 *
 * Zod schemas for first-class staff-to-school assignment management.
 * Aligns with Ed-Fi StaffEducationOrganizationAssignmentAssociation.
 */

import { z } from 'zod';
import { dateSchema, createPaginatedResponseSchema } from '../common';
import { staffRoleSchema } from './staff.schema';

// ============================================
// Assignment Status
// ============================================

export const staffAssignmentStatusSchema = z.enum(['active', 'ended', 'pending']);
export type StaffAssignmentStatus = z.infer<typeof staffAssignmentStatusSchema>;

// ============================================
// Create Staff Assignment Schema
// ============================================

export const createStaffAssignmentSchema = z.object({
  schoolId: z.string().uuid(),
  role: staffRoleSchema,
  departmentId: z.string().uuid().optional(),    // FK to school's Department entity
  isPrimary: z.boolean().default(false),
  beginDate: dateSchema,
  endDate: dateSchema.optional(),
  positionTitle: z.string().max(100).optional(),
  fullTimeEquivalency: z.number().min(0).max(1).optional(),
  staffClassificationDescriptor: z.string().max(300).optional(),
  orderOfAssignment: z.number().int().min(1).optional(),
});

export type CreateStaffAssignmentDto = z.infer<typeof createStaffAssignmentSchema>;

// ============================================
// Update Staff Assignment Schema
// ============================================

export const updateStaffAssignmentSchema = z.object({
  role: staffRoleSchema.optional(),
  departmentId: z.string().uuid().optional(),    // FK to school's Department entity
  isPrimary: z.boolean().optional(),
  endDate: dateSchema.optional(),
  positionTitle: z.string().max(100).optional(),
  fullTimeEquivalency: z.number().min(0).max(1).optional(),
  staffClassificationDescriptor: z.string().max(300).optional(),
  orderOfAssignment: z.number().int().min(1).optional(),
  assignmentStatus: staffAssignmentStatusSchema.optional(),
});

export type UpdateStaffAssignmentDto = z.infer<typeof updateStaffAssignmentSchema>;

// ============================================
// Staff Assignment Response Schema
// ============================================

export const staffAssignmentResponseSchema = z.object({
  assignmentId: z.string().uuid(),
  staffId: z.string().uuid(),
  schoolId: z.string().uuid(),
  role: staffRoleSchema,
  departmentId: z.string().uuid().optional(),
  departmentName: z.string().optional(),         // Denormalized for display
  isPrimary: z.boolean(),
  beginDate: z.string(),
  endDate: z.string().optional(),
  positionTitle: z.string().optional(),
  fullTimeEquivalency: z.number().optional(),
  staffClassificationDescriptor: z.string().optional(),
  orderOfAssignment: z.number().optional(),
  assignmentStatus: staffAssignmentStatusSchema,
  staffName: z.string().optional(),
  schoolName: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type StaffAssignmentResponseDto = z.infer<typeof staffAssignmentResponseSchema>;

// ============================================
// Staff Assignment List Response
// ============================================

export const staffAssignmentListResponseSchema = createPaginatedResponseSchema(staffAssignmentResponseSchema);
export type StaffAssignmentListResponseDto = z.infer<typeof staffAssignmentListResponseSchema>;
