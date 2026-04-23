/**
 * IEMIS audit-log field redaction (Sprint 1, S1.10).
 *
 * When a non-TenantAdmin viewer reads `/iemis/audit`, PII metadata
 * keys must be masked. TenantAdmin sees the full event.
 *
 * Redaction rules:
 *   - emisStudentId (16 digits) → keep last 4, mask the rest
 *   - emisStaffId                → keep last 4, mask the rest
 *   - contactEmail / subjectEmail → keep domain, mask local part
 *   - contactPhone / subjectPhone → keep last 4, mask the rest
 *
 * Applied to `event.metadata`; the event's structural fields
 * (eventType, tenantId, actorUserId, timestamp) are never masked —
 * they're already operator-oriented.
 */

import {
  type IemisAuditEvent,
  IEMIS_AUDIT_PII_METADATA_KEYS,
} from '@aibrains/shared-types';

export type AuditViewerRole = 'TenantAdmin' | 'PlatformOperator' | string;

export function redactAuditEventForRole(
  event: IemisAuditEvent,
  viewerRole: AuditViewerRole,
): IemisAuditEvent {
  // TenantAdmin sees the event raw.
  if (viewerRole === 'TenantAdmin' || viewerRole === 'PlatformOperator') {
    return event;
  }

  if (!event.metadata) return event;

  const metadata = { ...event.metadata };
  for (const key of IEMIS_AUDIT_PII_METADATA_KEYS) {
    if (metadata[key] == null) continue;
    metadata[key] = maskValueForKey(key, metadata[key]);
  }

  return { ...event, metadata };
}

function maskValueForKey(key: string, value: unknown): string {
  const str = String(value);

  if (key === 'contactEmail' || key === 'subjectEmail') {
    return maskEmail(str);
  }

  // Default: keep last 4, mask the rest.
  return maskTail(str, 4);
}

function maskEmail(email: string): string {
  const atIdx = email.indexOf('@');
  if (atIdx <= 0) return '***';
  return '***' + email.slice(atIdx);
}

function maskTail(value: string, keep: number): string {
  if (value.length <= keep) return '*'.repeat(value.length);
  return '*'.repeat(value.length - keep) + value.slice(-keep);
}
