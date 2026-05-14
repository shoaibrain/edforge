/**
 * Leave Entity - Identity Service
 * 
 * DynamoDB Entity for Staff leave request management.
 * 
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: STAFF#{staffId}#LEAVE#{leaveId}
 * 
 * GSI1 (School Leave Lookup):
 * - gsi1pk: SCHOOL#{schoolId}
 * - gsi1sk: LEAVE#{startDate}
 *
 * Sprint S3.2 — GSI1 attribute names lowercased to match the DDB index
 * definition (server/lib/tenant-template/ecs-dynamodb.ts:53-54). The
 * uppercase variant silently failed to populate the GSI since this entity
 * was first written. Companion fix to S3.1 (calendar-date).
 */

import { BaseEntity } from './base.entity';

// ============================================
// Leave Types
// ============================================

export type LeaveType = 
  | 'annual'
  | 'sick'
  | 'personal'
  | 'bereavement'
  | 'maternity'
  | 'paternity'
  | 'family_medical'
  | 'jury_duty'
  | 'military'
  | 'professional_development'
  | 'sabbatical'
  | 'unpaid'
  | 'other';

export type LeaveStatus = 
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'in_progress'
  | 'completed';

export type LeaveDurationType = 
  | 'full_day'
  | 'half_day_am'
  | 'half_day_pm'
  | 'hours';

// ============================================
// Leave Emergency Contact
// ============================================

export interface LeaveEmergencyContact {
  name: string;
  phone: string;
  email?: string;
}

// ============================================
// Leave Entity Interface
// ============================================

export interface Leave extends BaseEntity {
  entityType: 'LEAVE';
  
  // Identifiers
  leaveId: string;
  staffId: string;
  staffName: string;  // Denormalized for display
  schoolId: string;
  schoolName?: string;  // Denormalized for display
  
  // Leave Details
  leaveType: LeaveType;
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  durationType: LeaveDurationType;
  hours?: number;     // For partial day leaves
  totalDays: number;  // Computed
  totalHours?: number;
  
  // Request
  reason?: string;
  notes?: string;
  documentUrl?: string;
  documentFileName?: string;
  
  // Status
  status: LeaveStatus;
  
  // Approval Workflow
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectionReason?: string;
  cancellationReason?: string;
  cancelledAt?: string;
  
  // Substitute/Coverage
  substituteStaffId?: string;
  substituteStaffName?: string;
  coverageNotes?: string;
  
  // Emergency Contact
  emergencyContact?: LeaveEmergencyContact;
  
  // GSI Keys — see entity-header comment for the S3.2 casing rename rationale.
  gsi1pk?: string;  // SCHOOL#{schoolId}
  gsi1sk?: string;  // LEAVE#{startDate}
}

// ============================================
// Leave Balance Entity
// ============================================

export interface LeaveBalance extends BaseEntity {
  entityType: 'LEAVE_BALANCE';
  
  staffId: string;
  fiscalYear: string;  // e.g., "2025-2026"
  
  balances: LeaveTypeBalance[];
  
  lastUpdated: string;
}

export interface LeaveTypeBalance {
  leaveType: LeaveType;
  accrued: number;
  used: number;
  pending: number;
  available: number;
  carryOver?: number;
}

// ============================================
// Entity Key Builders
// ============================================

export const LeaveKeyBuilder = {
  /**
   * Leave: STAFF#{staffId}#LEAVE#{leaveId}
   */
  leave: (staffId: string, leaveId: string): string => 
    `STAFF#${staffId}#LEAVE#${leaveId}`,
  
  /**
   * Leaves for staff (prefix): STAFF#{staffId}#LEAVE#
   */
  leavesPrefix: (staffId: string): string => 
    `STAFF#${staffId}#LEAVE#`,
  
  /**
   * Leave Balance: STAFF#{staffId}#BALANCE#{fiscalYear}
   */
  leaveBalance: (staffId: string, fiscalYear: string): string => 
    `STAFF#${staffId}#BALANCE#${fiscalYear}`,
  
  /**
   * gsi1pk (School lookup): SCHOOL#{schoolId}
   */
  schoolLookup: (schoolId: string): string =>
    `SCHOOL#${schoolId}`,

  /**
   * gsi1sk (Date sort): LEAVE#{startDate}
   */
  dateSort: (startDate: string): string => 
    `LEAVE#${startDate}`,
};

// ============================================
// Factory Functions
// ============================================

export function createLeaveEntity(
  tenantId: string,
  staffId: string,
  leaveId: string,
  data: Omit<Leave, 'tenantId' | 'entityKey' | 'entityType' | 'leaveId' | 'gsi1pk' | 'gsi1sk'>
): Leave {
  return {
    tenantId,
    entityKey: LeaveKeyBuilder.leave(staffId, leaveId),
    entityType: 'LEAVE',
    leaveId,
    ...data,
    // GSI Keys
    gsi1pk: LeaveKeyBuilder.schoolLookup(data.schoolId),
    gsi1sk: LeaveKeyBuilder.dateSort(data.startDate),
  };
}

export function createLeaveBalanceEntity(
  tenantId: string,
  staffId: string,
  fiscalYear: string,
  balances: LeaveTypeBalance[]
): LeaveBalance {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: LeaveKeyBuilder.leaveBalance(staffId, fiscalYear),
    entityType: 'LEAVE_BALANCE',
    staffId,
    fiscalYear,
    balances,
    lastUpdated: now,
    createdAt: now,
    createdBy: 'SYSTEM',
    updatedAt: now,
    updatedBy: 'SYSTEM',
    version: 1,
  };
}

// ============================================
// Utility Functions
// ============================================

/**
 * Calculate total days for a leave request
 */
export function calculateLeaveDays(
  startDate: string,
  endDate: string,
  durationType: LeaveDurationType
): number {
  if (durationType === 'half_day_am' || durationType === 'half_day_pm') {
    return 0.5;
  }
  
  if (durationType === 'hours') {
    // For hours-based, caller should calculate based on workday hours
    return 0;
  }
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  
  return diffDays;
}

/**
 * Check if a leave overlaps with a date range
 */
export function leaveOverlapsDateRange(
  leave: Leave,
  rangeStart: string,
  rangeEnd: string
): boolean {
  const leaveStart = new Date(leave.startDate);
  const leaveEnd = new Date(leave.endDate);
  const checkStart = new Date(rangeStart);
  const checkEnd = new Date(rangeEnd);
  
  return leaveStart <= checkEnd && leaveEnd >= checkStart;
}

/**
 * Get leave status display text
 */
export function getLeaveStatusLabel(status: LeaveStatus): string {
  const labels: Record<LeaveStatus, string> = {
    pending: 'Pending Approval',
    approved: 'Approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    in_progress: 'In Progress',
    completed: 'Completed',
  };
  return labels[status];
}
