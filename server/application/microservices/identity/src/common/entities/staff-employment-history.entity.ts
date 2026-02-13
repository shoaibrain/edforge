/**
 * Staff Employment History Entity - Identity Service
 *
 * DynamoDB Entity for tracking employment status changes over time.
 * Creates an immutable audit trail of status transitions.
 *
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: STAFF#{staffId}#EMPHIST#{timestamp}
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';

// ============================================
// Employment History Entity Interface
// ============================================

export interface StaffEmploymentHistory extends BaseEntity {
  entityType: 'STAFF_EMPLOYMENT_HISTORY';

  // Identifiers
  id: string;                     // History record UUID
  staffId: string;                // FK to Staff entity

  // Status transition
  previousStatus: string;         // e.g. 'active', 'on_leave'
  newStatus: string;              // e.g. 'terminated', 'retired'
  effectiveDate: string;          // ISO date when the change takes effect
  reason?: string;
  notes?: string;

  // Denormalized for query convenience
  staffName?: string;
  changedByName?: string;
}

// ============================================
// Factory Function
// ============================================

export function createEmploymentHistoryEntity(
  tenantId: string,
  historyId: string,
  staffId: string,
  timestamp: string,
  data: Omit<StaffEmploymentHistory, 'tenantId' | 'entityKey' | 'entityType' | 'id' | 'staffId'>
): StaffEmploymentHistory {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.staffEmploymentHistory(staffId, timestamp),
    entityType: 'STAFF_EMPLOYMENT_HISTORY',
    id: historyId,
    staffId,
    ...data,
  };
}
