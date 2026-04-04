/**
 * Audit Log Entity for Identity Service
 *
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: SCHOOL#{schoolId}#AUDIT#{timestamp}#{auditId}
 */

import { BaseEntity } from './base.entity';

/**
 * A single field change within an audit entry
 */
export interface FieldChange {
  field: string;
  oldValue: any;
  newValue: any;
}

/**
 * Audit log entry stored in DynamoDB
 */
export interface AuditLogEntry extends BaseEntity {
  entityType: 'AUDIT_LOG';
  auditId: string;
  schoolId: string;
  targetEntity: 'SCHOOL' | 'CONFIG' | 'ACADEMIC_YEAR' | 'FEE_STRUCTURE';
  targetEntityId: string;
  action: 'create' | 'update' | 'delete' | 'status_change' | 'version_change';
  changes: FieldChange[];
  changedBy: string;
  changedByName?: string;
  changedAt: string;
  reason?: string;
  severity?: 'normal' | 'high';
}

/**
 * Create a new AuditLogEntry with proper keys
 */
export function createAuditLogEntity(
  tenantId: string,
  schoolId: string,
  auditId: string,
  data: Pick<AuditLogEntry, 'targetEntity' | 'targetEntityId' | 'action' | 'changes' | 'changedBy'> & {
    changedByName?: string;
    changedAt?: string;
    reason?: string;
    severity?: 'normal' | 'high';
  },
): AuditLogEntry {
  const now = data.changedAt || new Date().toISOString();
  return {
    tenantId,
    entityKey: `SCHOOL#${schoolId}#AUDIT#${now}#${auditId}`,
    entityType: 'AUDIT_LOG',
    auditId,
    schoolId,
    targetEntity: data.targetEntity,
    targetEntityId: data.targetEntityId,
    action: data.action,
    changes: data.changes,
    changedBy: data.changedBy,
    changedByName: data.changedByName,
    changedAt: now,
    reason: data.reason,
    severity: data.severity,
    createdAt: now,
    createdBy: data.changedBy,
    updatedAt: now,
    updatedBy: data.changedBy,
    version: 1,
  };
}

/**
 * Compute the diff between old and new values for audit logging.
 * Only records fields that actually changed.
 */
export function computeFieldChanges(
  oldValues: Record<string, any>,
  newValues: Record<string, any>,
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const key of Object.keys(newValues)) {
    if (newValues[key] === undefined) continue;
    const oldVal = oldValues[key];
    const newVal = newValues[key];

    // Deep-compare objects/arrays via JSON
    const oldStr = JSON.stringify(oldVal);
    const newStr = JSON.stringify(newVal);

    if (oldStr !== newStr) {
      changes.push({ field: key, oldValue: oldVal, newValue: newVal });
    }
  }

  return changes;
}
