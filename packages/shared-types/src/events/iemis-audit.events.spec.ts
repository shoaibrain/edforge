import {
  IEMIS_AUDIT_EVENT_TYPES,
  iemisAuditEventPayloadSchema,
  iemisAuditEventSchema,
  buildIemisAuditEntityKey,
  parseIemisAuditEntityKey,
  IEMIS_AUDIT_PII_METADATA_KEYS,
} from './iemis-audit.events';

describe('IEMIS_AUDIT_EVENT_TYPES', () => {
  it('contains the S1 event types', () => {
    expect(IEMIS_AUDIT_EVENT_TYPES).toContain('code.verified');
    expect(IEMIS_AUDIT_EVENT_TYPES).toContain('code.verify.denied');
    expect(IEMIS_AUDIT_EVENT_TYPES).toContain('audit.viewed');
  });

  it('contains the S3 student descriptor event', () => {
    expect(IEMIS_AUDIT_EVENT_TYPES).toContain('student.descriptor.edited');
  });

  it('contains the S4.7 staff credential event types', () => {
    expect(IEMIS_AUDIT_EVENT_TYPES).toContain('staff.credential.created');
    expect(IEMIS_AUDIT_EVENT_TYPES).toContain('staff.credential.edited');
    expect(IEMIS_AUDIT_EVENT_TYPES).toContain('staff.credential.deleted');
  });

  it('contains the S4.7 staff assignment event types', () => {
    expect(IEMIS_AUDIT_EVENT_TYPES).toContain('staff.assignment.created');
    expect(IEMIS_AUDIT_EVENT_TYPES).toContain('staff.assignment.edited');
    expect(IEMIS_AUDIT_EVENT_TYPES).toContain('staff.assignment.deleted');
  });

  it('pre-registers the S4.3 staff training event types so the next entity does not need a shared-types bump', () => {
    expect(IEMIS_AUDIT_EVENT_TYPES).toContain('staff.training.created');
    expect(IEMIS_AUDIT_EVENT_TYPES).toContain('staff.training.edited');
    expect(IEMIS_AUDIT_EVENT_TYPES).toContain('staff.training.deleted');
  });

  it('has no duplicates', () => {
    expect(new Set(IEMIS_AUDIT_EVENT_TYPES).size).toBe(IEMIS_AUDIT_EVENT_TYPES.length);
  });

  it('all entries match the canonical dot-namespaced pattern', () => {
    for (const type of IEMIS_AUDIT_EVENT_TYPES) {
      expect(type).toMatch(/^[a-z]+(\.[a-z]+)+$/);
    }
  });
});

describe('iemisAuditEventPayloadSchema', () => {
  const validPayload = {
    eventType: 'code.verified' as const,
    tenantId: 'tenant-a',
    schoolId: 'school-1',
    actorUserId: 'user-abc',
    actorName: 'Shoaib Rain',
    ipAddress: '10.0.0.1',
    metadata: { code: '12345678' },
  };

  it('accepts a well-formed payload', () => {
    expect(iemisAuditEventPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it('requires eventType + tenantId + actorUserId', () => {
    const { eventType, tenantId, actorUserId, ...rest } = validPayload;
    expect(iemisAuditEventPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it('allows missing schoolId (cross-tenant / platform events)', () => {
    const { schoolId, ...rest } = validPayload;
    expect(iemisAuditEventPayloadSchema.safeParse(rest).success).toBe(true);
  });

  it('rejects unknown event types', () => {
    const bad = { ...validPayload, eventType: 'completely.made.up' };
    expect(iemisAuditEventPayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('allows metadata to be any JSON-serializable shape', () => {
    const p = { ...validPayload, metadata: { nested: { key: [1, 2, { deep: true }] } } };
    expect(iemisAuditEventPayloadSchema.safeParse(p).success).toBe(true);
  });
});

describe('iemisAuditEventSchema (persisted shape)', () => {
  it('requires eventId (uuid) and timestamp (ISO-8601)', () => {
    const persisted = {
      eventType: 'export.generated' as const,
      tenantId: 'tenant-a',
      actorUserId: 'user-abc',
      eventId: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: '2026-04-23T10:30:00.000Z',
    };
    expect(iemisAuditEventSchema.safeParse(persisted).success).toBe(true);
  });

  it('rejects malformed uuid', () => {
    const persisted = {
      eventType: 'export.generated' as const,
      tenantId: 'tenant-a',
      actorUserId: 'user-abc',
      eventId: 'not-a-uuid',
      timestamp: '2026-04-23T10:30:00.000Z',
    };
    expect(iemisAuditEventSchema.safeParse(persisted).success).toBe(false);
  });

  it('rejects non-ISO timestamp', () => {
    const persisted = {
      eventType: 'export.generated' as const,
      tenantId: 'tenant-a',
      actorUserId: 'user-abc',
      eventId: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: 'yesterday at noon',
    };
    expect(iemisAuditEventSchema.safeParse(persisted).success).toBe(false);
  });
});

describe('buildIemisAuditEntityKey / parseIemisAuditEntityKey', () => {
  it('composes and parses a valid key round-trip', () => {
    const ts = '2026-04-23T10:30:00.000Z';
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const key = buildIemisAuditEntityKey(ts, id);
    expect(key).toBe(`AUDIT#IEMIS#${ts}#${id}`);
    const parsed = parseIemisAuditEntityKey(key);
    expect(parsed).toEqual({ timestamp: ts, eventId: id });
  });

  it('returns null for malformed keys', () => {
    expect(parseIemisAuditEntityKey('AUDIT#OTHER#2026-04-23#foo')).toBeNull();
    expect(parseIemisAuditEntityKey('gibberish')).toBeNull();
    expect(parseIemisAuditEntityKey('AUDIT#IEMIS#2026-04-23T10:30:00.000Z#not-uuid')).toBeNull();
  });

  it('key sort order places newest events last lexicographically (reverse via DESC scan)', () => {
    const older = buildIemisAuditEntityKey('2026-01-01T00:00:00.000Z', '550e8400-e29b-41d4-a716-446655440000');
    const newer = buildIemisAuditEntityKey('2026-12-01T00:00:00.000Z', '550e8400-e29b-41d4-a716-446655440001');
    expect(older < newer).toBe(true);
  });
});

describe('IEMIS_AUDIT_PII_METADATA_KEYS', () => {
  it('is a non-empty frozen set of string keys', () => {
    expect(IEMIS_AUDIT_PII_METADATA_KEYS.length).toBeGreaterThan(0);
    for (const k of IEMIS_AUDIT_PII_METADATA_KEYS) {
      expect(typeof k).toBe('string');
    }
  });

  it('includes the canonical student + staff + contact keys', () => {
    expect(IEMIS_AUDIT_PII_METADATA_KEYS).toContain('emisStudentId');
    expect(IEMIS_AUDIT_PII_METADATA_KEYS).toContain('emisStaffId');
    expect(IEMIS_AUDIT_PII_METADATA_KEYS).toContain('contactEmail');
    expect(IEMIS_AUDIT_PII_METADATA_KEYS).toContain('contactPhone');
  });
});
