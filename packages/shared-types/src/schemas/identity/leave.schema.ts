/**
 * Leave Schemas - Identity Service
 * 
 * Zod schemas for staff leave management.
 * Handles leave requests, approvals, and balance tracking.
 */

import { z } from 'zod';
import { 
  dateSchema, 
  isoDateSchema,
  createPaginatedResponseSchema 
} from '../common';

// ============================================
// Enums
// ============================================

/**
 * Leave type categories
 */
export const leaveTypeSchema = z.enum([
  'annual',           // Vacation/PTO
  'sick',             // Sick leave
  'personal',         // Personal days
  'bereavement',      // Family death
  'maternity',        // Maternity leave
  'paternity',        // Paternity leave
  'family_medical',   // FMLA
  'jury_duty',        // Jury service
  'military',         // Military leave
  'professional_development', // Training/conferences
  'sabbatical',       // Extended leave
  'unpaid',           // Unpaid leave
  'other',
]);
export type LeaveType = z.infer<typeof leaveTypeSchema>;

/**
 * Leave request status
 */
export const leaveStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'in_progress',  // Currently on leave
  'completed',    // Leave period ended
]);
export type LeaveStatus = z.infer<typeof leaveStatusSchema>;

/**
 * Leave duration type
 */
export const leaveDurationTypeSchema = z.enum([
  'full_day',
  'half_day_am',
  'half_day_pm',
  'hours',
]);
export type LeaveDurationType = z.infer<typeof leaveDurationTypeSchema>;

// ============================================
// Create Leave Request Schema
// ============================================

export const createLeaveRequestSchema = z.object({
  leaveType: leaveTypeSchema,
  startDate: dateSchema,
  endDate: dateSchema,
  durationType: leaveDurationTypeSchema.default('full_day'),
  
  // For partial day leaves
  hours: z.number().min(0.5).max(24).optional(),
  
  // Request details
  reason: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
  
  // Documentation
  documentUrl: z.string().url().optional(),
  documentFileName: z.string().max(255).optional(),
  
  // Substitute/coverage
  substituteStaffId: z.string().uuid().optional(),
  coverageNotes: z.string().max(500).optional(),
  
  // Emergency contact during leave
  emergencyContact: z.object({
    name: z.string().max(100),
    phone: z.string().max(24),
    email: z.string().email().optional(),
  }).optional(),
});

// Base schema without refinement for partial usage
const baseLeaveRequestSchema = createLeaveRequestSchema;

// Add date validation refinement
export const createLeaveRequestWithValidationSchema = createLeaveRequestSchema.refine(
  data => new Date(data.endDate) >= new Date(data.startDate),
  { message: 'End date must be on or after start date' }
);

export type CreateLeaveRequestDto = z.infer<typeof createLeaveRequestWithValidationSchema>;

// ============================================
// Update Leave Request Schema
// ============================================

export const updateLeaveRequestSchema = baseLeaveRequestSchema.partial().refine(
  data => {
    if (data.startDate && data.endDate) {
      return new Date(data.endDate) >= new Date(data.startDate);
    }
    return true;
  },
  { message: 'End date must be on or after start date' }
);

export type UpdateLeaveRequestDto = z.infer<typeof updateLeaveRequestSchema>;

// ============================================
// Leave Request Response Schema
// ============================================

export const leaveRequestResponseSchema = z.object({
  // Identifiers
  leaveId: z.string().uuid(),
  staffId: z.string().uuid(),
  staffName: z.string(),
  tenantId: z.string().uuid(),
  schoolId: z.string().uuid(),
  schoolName: z.string().optional(),
  
  // Leave Details
  leaveType: leaveTypeSchema,
  startDate: z.string(),
  endDate: z.string(),
  durationType: leaveDurationTypeSchema,
  hours: z.number().optional(),
  totalDays: z.number(),
  totalHours: z.number().optional(),
  
  // Request
  reason: z.string().optional(),
  notes: z.string().optional(),
  documentUrl: z.string().optional(),
  
  // Status
  status: leaveStatusSchema,
  
  // Approval workflow
  approvedBy: z.string().uuid().optional(),
  approvedByName: z.string().optional(),
  approvedAt: z.string().optional(),
  rejectionReason: z.string().optional(),
  
  // Substitute
  substituteStaffId: z.string().optional(),
  substituteStaffName: z.string().optional(),
  coverageNotes: z.string().optional(),
  
  // Emergency contact
  emergencyContact: z.object({
    name: z.string(),
    phone: z.string(),
    email: z.string().optional(),
  }).optional(),
  
  // Metadata
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type LeaveRequestResponseDto = z.infer<typeof leaveRequestResponseSchema>;

// ============================================
// Leave List Response
// ============================================

export const leaveListResponseSchema = createPaginatedResponseSchema(leaveRequestResponseSchema);
export type LeaveListResponseDto = z.infer<typeof leaveListResponseSchema>;

// ============================================
// Leave Filter Schema
// ============================================

export const leaveFilterSchema = z.object({
  staffId: z.string().uuid().optional(),
  schoolId: z.string().uuid().optional(),
  leaveType: leaveTypeSchema.optional(),
  status: leaveStatusSchema.optional(),
  startDateFrom: dateSchema.optional(),
  startDateTo: dateSchema.optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type LeaveFilterDto = z.infer<typeof leaveFilterSchema>;

// ============================================
// Approve/Reject Leave Schema
// ============================================

export const approveLeaveSchema = z.object({
  approvalNotes: z.string().max(500).optional(),
});

export type ApproveLeaveDto = z.infer<typeof approveLeaveSchema>;

export const rejectLeaveSchema = z.object({
  rejectionReason: z.string().min(1).max(500),
});

export type RejectLeaveDto = z.infer<typeof rejectLeaveSchema>;

// ============================================
// Leave Balance Schema
// ============================================

export const leaveBalanceSchema = z.object({
  staffId: z.string().uuid(),
  fiscalYear: z.string(),  // e.g., "2025-2026"
  
  balances: z.array(z.object({
    leaveType: leaveTypeSchema,
    accrued: z.number(),          // Total accrued
    used: z.number(),             // Total used
    pending: z.number(),          // Pending approval
    available: z.number(),        // Available to use
    carryOver: z.number().optional(), // From previous year
  })),
  
  lastUpdated: z.string(),
});

export type LeaveBalanceDto = z.infer<typeof leaveBalanceSchema>;

// ============================================
// Leave Summary (for dashboard)
// ============================================

export const leaveSummarySchema = z.object({
  staffId: z.string().uuid(),
  staffName: z.string(),
  schoolId: z.string().uuid(),
  
  // Current year stats
  totalDaysTaken: z.number(),
  totalDaysRemaining: z.number(),
  pendingRequests: z.number(),
  
  // Upcoming
  upcomingLeave: z.array(z.object({
    leaveId: z.string().uuid(),
    leaveType: leaveTypeSchema,
    startDate: z.string(),
    endDate: z.string(),
    status: leaveStatusSchema,
  })).optional(),
});

export type LeaveSummaryDto = z.infer<typeof leaveSummarySchema>;

// ============================================
// Cancel Leave Schema
// ============================================

export const cancelLeaveSchema = z.object({
  cancellationReason: z.string().min(1).max(500),
});

export type CancelLeaveDto = z.infer<typeof cancelLeaveSchema>;
