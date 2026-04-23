import type { IemisAuditEvent } from '@aibrains/shared-types';
import { redactAuditEventForRole } from './iemis-audit-redact';

function eventWithMetadata(metadata: Record<string, unknown>): IemisAuditEvent {
  return {
    eventType: 'code.verified',
    tenantId: 'tenant-a',
    actorUserId: 'user-abc',
    eventId: '550e8400-e29b-41d4-a716-446655440000',
    timestamp: '2026-04-23T10:30:00.000Z',
    metadata,
  };
}

describe('redactAuditEventForRole', () => {
  it('TenantAdmin sees event raw (no redaction)', () => {
    const event = eventWithMetadata({ emisStudentId: '1234567890123456' });
    const r = redactAuditEventForRole(event, 'TenantAdmin');
    expect(r.metadata?.emisStudentId).toBe('1234567890123456');
  });

  it('PlatformOperator sees event raw too (for cross-tenant ops)', () => {
    const event = eventWithMetadata({ emisStudentId: '1234567890123456' });
    const r = redactAuditEventForRole(event, 'PlatformOperator');
    expect(r.metadata?.emisStudentId).toBe('1234567890123456');
  });

  it('non-admin viewer: emisStudentId masked to last 4 digits', () => {
    const event = eventWithMetadata({ emisStudentId: '1234567890123456' });
    const r = redactAuditEventForRole(event, 'TenantUser');
    expect(r.metadata?.emisStudentId).toBe('************3456');
  });

  it('non-admin viewer: emisStaffId masked to last 4', () => {
    const event = eventWithMetadata({ emisStaffId: '987654321' });
    const r = redactAuditEventForRole(event, 'Viewer');
    expect(r.metadata?.emisStaffId).toBe('*****4321');
  });

  it('non-admin viewer: contactEmail masked to ***@domain', () => {
    const event = eventWithMetadata({ contactEmail: 'parent@school.np' });
    const r = redactAuditEventForRole(event, 'SchoolStaff');
    expect(r.metadata?.contactEmail).toBe('***@school.np');
  });

  it('non-admin viewer: contactPhone masked to last 4', () => {
    const event = eventWithMetadata({ contactPhone: '+9779812345678' });
    const r = redactAuditEventForRole(event, 'SchoolStaff');
    expect(r.metadata?.contactPhone).toBe('**********5678');
  });

  it('non-admin viewer: unrelated metadata fields unchanged', () => {
    const event = eventWithMetadata({
      emisStudentId: '1234567890123456',
      code: 'VERIFIED',
      note: 'ok',
    });
    const r = redactAuditEventForRole(event, 'SchoolStaff');
    expect(r.metadata?.code).toBe('VERIFIED');
    expect(r.metadata?.note).toBe('ok');
    expect(r.metadata?.emisStudentId).toBe('************3456');
  });

  it('does not mutate the original event', () => {
    const event = eventWithMetadata({ emisStudentId: '1234567890123456' });
    redactAuditEventForRole(event, 'TenantUser');
    expect(event.metadata?.emisStudentId).toBe('1234567890123456');
  });

  it('returns event unchanged when metadata is missing', () => {
    const event: IemisAuditEvent = {
      eventType: 'audit.viewed',
      tenantId: 'tenant-a',
      actorUserId: 'user-x',
      eventId: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: '2026-04-23T10:30:00.000Z',
    };
    const r = redactAuditEventForRole(event, 'TenantUser');
    expect(r.metadata).toBeUndefined();
  });

  it('handles edge case: malformed email (no @)', () => {
    const event = eventWithMetadata({ contactEmail: 'not-an-email' });
    const r = redactAuditEventForRole(event, 'Viewer');
    expect(r.metadata?.contactEmail).toBe('***');
  });

  it('handles edge case: empty string values', () => {
    const event = eventWithMetadata({ emisStudentId: '' });
    const r = redactAuditEventForRole(event, 'Viewer');
    expect(r.metadata?.emisStudentId).toBe('');
  });
});
